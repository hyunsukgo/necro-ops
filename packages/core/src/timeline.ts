/**
 * timeline.ts — sort + union-find clustering for timeline events.
 *
 * Requirements 4.1, 4.2, 4.3, 4.5:
 *   4.1 — Order all events chronologically into a single timeline.
 *   4.2 — Group events into clusters when they share at least one entity
 *          (service, namespace, pod, resource address) and occur within a
 *          configurable gap (default 5 minutes).
 *   4.3 — Flag the earliest change-type event (deploy, infra_change, config
 *          change) preceding the first critical alert as the suspected trigger.
 *   4.5 — Correlation functions SHALL be pure and deterministic for the same input.
 *
 * Must NOT import from any other package.
 */

import type { Cluster, Entity, Timeline, TimelineEvent } from "./types.js";

// ── Union-Find (path-compressed, union-by-rank) ──────────────────────────────

class UnionFind {
  private parent: number[];
  private rank: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
    this.rank = new Array<number>(size).fill(0);
  }

  find(x: number): number {
    // Path compression
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]!);
    }
    return this.parent[x]!;
  }

  union(x: number, y: number): void {
    const rx = this.find(x);
    const ry = this.find(y);
    if (rx === ry) return;

    // Union by rank
    if (this.rank[rx]! < this.rank[ry]!) {
      this.parent[rx] = ry;
    } else if (this.rank[rx]! > this.rank[ry]!) {
      this.parent[ry] = rx;
    } else {
      this.parent[ry] = rx;
      this.rank[rx]!++;
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Encode an entity to a stable string key for set membership tests. */
function entityKey(e: Entity): string {
  return `${e.type}:${e.name}`;
}

/** Build a Set of entity keys for a given event. */
function entityKeySet(event: TimelineEvent): Set<string> {
  return new Set(event.entities.map(entityKey));
}

/** Return true if two entity-key sets share at least one key. */
function sharesEntity(a: Set<string>, b: Set<string>): boolean {
  for (const key of a) {
    if (b.has(key)) return true;
  }
  return false;
}

/** Merge two Entity arrays, deduplicating by entityKey. */
function mergeEntities(a: Entity[], b: Entity[]): Entity[] {
  const seen = new Set<string>(a.map(entityKey));
  const result: Entity[] = [...a];
  for (const e of b) {
    const k = entityKey(e);
    if (!seen.has(k)) {
      seen.add(k);
      result.push(e);
    }
  }
  return result;
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface BuildTimelineOptions {
  /** Max gap in minutes between consecutive events in a cluster. Default 5. */
  gapMinutes?: number;
}

/**
 * Build a `Timeline` from a set of normalised `TimelineEvent` objects.
 *
 * Steps:
 *   1. Sort events by timestamp (ascending, then by id for stability).
 *   2. Use a union-find structure to group events that share ≥1 entity
 *      AND are within `gapMinutes` of each other.
 *   3. Produce `Cluster` objects with merged entity lists and time bounds.
 *
 * The function is pure and deterministic: identical inputs always produce
 * identical outputs.
 *
 * @param events    Normalised, deduped events (not mutated).
 * @param options   Optional tuning params.
 * @returns         A `Timeline` with `events` (sorted), `clusters`, and no
 *                  `suspectedTriggerId` (that is set by `findSuspectedTrigger`).
 */
export function buildTimeline(
  events: readonly TimelineEvent[],
  options: BuildTimelineOptions = {},
): Timeline {
  const gapMs = (options.gapMinutes ?? 5) * 60 * 1_000;

  // 1 — Sort chronologically; break ties by id for determinism.
  const sorted: TimelineEvent[] = [...events].sort((a, b) => {
    const diff =
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  if (sorted.length === 0) {
    return { events: [], clusters: [], suspectedTriggerId: undefined };
  }

  // 2 — Union-Find clustering.
  //
  // For each consecutive pair (i, i+1) in the sorted array:
  //   • If |time diff| ≤ gapMs AND they share at least one entity → union them.
  //
  // Using consecutive pairs (in time order) is sufficient because the gap
  // constraint is transitive when events form a chain: if A→B and B→C both
  // satisfy the gap, A and C are also reachable through B even if A→C alone
  // would exceed the gap.

  const uf = new UnionFind(sorted.length);
  const entitySets = sorted.map(entityKeySet);

  for (let i = 0; i < sorted.length - 1; i++) {
    const tA = new Date(sorted[i]!.timestamp).getTime();
    const tB = new Date(sorted[i + 1]!.timestamp).getTime();

    if (tB - tA <= gapMs && sharesEntity(entitySets[i]!, entitySets[i + 1]!)) {
      uf.union(i, i + 1);
    }
  }

  // 3 — Collect groups and build Cluster objects.
  //
  // Group indices by their root representative.
  const rootToIndices = new Map<number, number[]>();
  for (let i = 0; i < sorted.length; i++) {
    const root = uf.find(i);
    let group = rootToIndices.get(root);
    if (!group) {
      group = [];
      rootToIndices.set(root, group);
    }
    group.push(i);
  }

  // Build clusters in time order (root = smallest index in group → already sorted).
  const clusters: Cluster[] = [];

  for (const [, indices] of rootToIndices) {
    // indices are already in ascending order (we iterated i = 0..n-1).
    const clusterEvents = indices.map((i) => sorted[i]!);

    // Merge entities across all events in the cluster.
    let mergedEntities: Entity[] = [];
    for (const ev of clusterEvents) {
      mergedEntities = mergeEntities(mergedEntities, ev.entities);
    }

    const clusterId = clusterEvents[0]!.id; // stable: first event id
    clusters.push({
      id: `cluster:${clusterId}`,
      eventIds: clusterEvents.map((e) => e.id),
      entities: mergedEntities,
      start: clusterEvents[0]!.timestamp,
      end: clusterEvents[clusterEvents.length - 1]!.timestamp,
    });
  }

  // Sort clusters by their start time for consistent output.
  clusters.sort(
    (a, b) =>
      new Date(a.start).getTime() - new Date(b.start).getTime() ||
      a.id.localeCompare(b.id),
  );

  return { events: sorted, clusters };
}

// ── findSuspectedTrigger ──────────────────────────────────────────────────────

/** Event kinds considered "change" events — potential triggers. */
const CHANGE_KINDS = new Set<TimelineEvent["kind"]>(["deploy", "infra_change"]);

/**
 * Identify the most-likely trigger event in a sorted timeline.
 *
 * Algorithm (Requirement 4.3):
 *   1. Find T = first event in `events` whose severity is `critical`.
 *      If there is no critical event, return `undefined`.
 *   2. Build a candidate pool: all events whose:
 *        - kind is in { deploy, infra_change }, AND
 *        - timestamp < T's timestamp.
 *   3. Primary candidate: the LATEST candidate in the pool that shares at
 *      least one entity with T.
 *   4. If no primary candidate exists, fall back to the LATEST candidate in
 *      the pool regardless of entity overlap.
 *   5. If the pool is empty, return `undefined`.
 *
 * The function is pure and deterministic: identical inputs always produce
 * identical outputs (ties are broken by event `id` for stability).
 *
 * @param events  Events sorted chronologically (output of `buildTimeline`).
 *                The function also works on unsorted arrays; it re-sorts
 *                internally for determinism.
 * @returns       The `id` of the suspected trigger event, or `undefined`.
 */
export function findSuspectedTrigger(
  events: readonly TimelineEvent[],
): string | undefined {
  if (events.length === 0) return undefined;

  // Sort chronologically (asc), break ties by id for determinism.
  const sorted = [...events].sort((a, b) => {
    const diff =
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });

  // 1 — Find first critical event (T).
  const firstCritical = sorted.find((e) => e.severity === "critical");
  if (!firstCritical) return undefined;

  const tTime = new Date(firstCritical.timestamp).getTime();
  const tEntityKeys = entityKeySet(firstCritical);

  // 2 — Build candidate pool: change-kind events strictly before T.
  const candidates = sorted.filter(
    (e) => CHANGE_KINDS.has(e.kind) && new Date(e.timestamp).getTime() < tTime,
  );

  if (candidates.length === 0) return undefined;

  // Helper: pick the "latest" event from a list; break ties by id descending
  // (larger id = later alphabetically) so the result is always deterministic.
  function latest(pool: TimelineEvent[]): TimelineEvent {
    return pool.reduce((best, current) => {
      const timeDiff =
        new Date(current.timestamp).getTime() -
        new Date(best.timestamp).getTime();
      if (timeDiff > 0) return current;
      if (timeDiff < 0) return best;
      // Tie: prefer larger id for a stable, deterministic choice.
      return current.id > best.id ? current : best;
    });
  }

  // 3 — Primary: latest change event that shares an entity with T.
  const sharedEntityCandidates = candidates.filter((e) =>
    sharesEntity(entityKeySet(e), tEntityKeys),
  );

  if (sharedEntityCandidates.length > 0) {
    return latest(sharedEntityCandidates).id;
  }

  // 4 — Fallback: latest change event regardless of entity overlap.
  return latest(candidates).id;
}
