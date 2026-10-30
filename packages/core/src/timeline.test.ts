import { describe, it, expect } from "vitest";
import { buildTimeline } from "./timeline.js";
import type { TimelineEvent } from "./types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  id: string,
  timestampIso: string,
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id,
    source: "mock",
    timestamp: timestampIso,
    kind: "alert",
    severity: "info",
    entities: [],
    summary: `Event ${id}`,
    raw: {},
    ...overrides,
  };
}

/** ISO timestamp helper: base + offsetMinutes */
function t(offsetMinutes: number, base = "2024-01-01T12:00:00Z"): string {
  return new Date(
    new Date(base).getTime() + offsetMinutes * 60_000,
  ).toISOString();
}

// ── tests ────────────────────────────────────────────────────────────────────

describe("buildTimeline()", () => {
  // ── Requirement 4.1 — chronological ordering ───────────────────────────────

  it("returns empty timeline for empty input", () => {
    const result = buildTimeline([]);
    expect(result.events).toEqual([]);
    expect(result.clusters).toEqual([]);
    expect(result.suspectedTriggerId).toBeUndefined();
  });

  it("returns a single event in a single-event cluster", () => {
    const ev = makeEvent("mock:a", t(0), {
      entities: [{ type: "service", name: "api" }],
    });
    const result = buildTimeline([ev]);
    expect(result.events).toHaveLength(1);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.eventIds).toEqual(["mock:a"]);
  });

  it("sorts events by timestamp ascending", () => {
    const e1 = makeEvent("mock:late", t(10));
    const e2 = makeEvent("mock:early", t(0));
    const e3 = makeEvent("mock:middle", t(5));

    const result = buildTimeline([e1, e2, e3]);
    expect(result.events.map((e) => e.id)).toEqual([
      "mock:early",
      "mock:middle",
      "mock:late",
    ]);
  });

  it("breaks timestamp ties by id for determinism (Req 4.5)", () => {
    const same = t(0);
    const eA = makeEvent("mock:aaa", same);
    const eZ = makeEvent("mock:zzz", same);
    const eM = makeEvent("mock:mmm", same);

    const r1 = buildTimeline([eA, eZ, eM]);
    const r2 = buildTimeline([eM, eA, eZ]); // different input order

    expect(r1.events.map((e) => e.id)).toEqual(r2.events.map((e) => e.id));
    expect(r1.events.map((e) => e.id)).toEqual([
      "mock:aaa",
      "mock:mmm",
      "mock:zzz",
    ]);
  });

  it("does not mutate the input array", () => {
    const events = [
      makeEvent("mock:b", t(5)),
      makeEvent("mock:a", t(0)),
    ] as const;
    const original = [...events];
    buildTimeline(events);
    expect(events[0]!.id).toBe(original[0]!.id);
    expect(events[1]!.id).toBe(original[1]!.id);
  });

  // ── Requirement 4.2 — clustering ──────────────────────────────────────────

  it("groups two events sharing an entity within the gap into one cluster", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "api" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(3), { entities: svc }); // 3 min apart < 5 min gap

    const result = buildTimeline([e1, e2]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.eventIds).toEqual(["mock:1", "mock:2"]);
  });

  it("keeps two events in separate clusters when gap exceeds threshold", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "api" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(10), { entities: svc }); // 10 min apart > 5 min

    const result = buildTimeline([e1, e2]);
    expect(result.clusters).toHaveLength(2);
  });

  it("keeps two events in separate clusters when they share no entity (gap within threshold)", () => {
    const e1 = makeEvent("mock:1", t(0), {
      entities: [{ type: "service", name: "api" }],
    });
    const e2 = makeEvent("mock:2", t(1), {
      entities: [{ type: "service", name: "db" }],
    });

    const result = buildTimeline([e1, e2]);
    expect(result.clusters).toHaveLength(2);
  });

  it("uses configurable gapMinutes (2 min threshold)", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "svc" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(3), { entities: svc }); // 3 min > 2 min threshold

    const result = buildTimeline([e1, e2], { gapMinutes: 2 });
    expect(result.clusters).toHaveLength(2);
  });

  it("forms a chain cluster through transitive gap connections", () => {
    // A → B (4 min, shared entity), B → C (4 min, shared entity)
    // A → C gap is 8 min but they're chained through B
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "api" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(4), { entities: svc });
    const e3 = makeEvent("mock:3", t(8), { entities: svc });

    const result = buildTimeline([e1, e2, e3]);
    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0]!.eventIds).toEqual([
      "mock:1",
      "mock:2",
      "mock:3",
    ]);
  });

  it("groups events matching via different entity types (namespace)", () => {
    const e1 = makeEvent("mock:1", t(0), {
      entities: [
        { type: "service", name: "api" },
        { type: "namespace", name: "prod" },
      ],
    });
    const e2 = makeEvent("mock:2", t(2), {
      entities: [{ type: "namespace", name: "prod" }], // shares namespace
    });

    const result = buildTimeline([e1, e2]);
    expect(result.clusters).toHaveLength(1);
  });

  it("merges entities from all events in a cluster without duplicates", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "api" }];
    const ns: TimelineEvent["entities"] = [
      { type: "namespace", name: "prod" },
    ];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(3), { entities: [...svc, ...ns] }); // svc is shared, ns is new

    const result = buildTimeline([e1, e2]);
    const cluster = result.clusters[0]!;
    expect(cluster.entities).toHaveLength(2);
    const types = cluster.entities.map((e) => e.name).sort();
    expect(types).toEqual(["api", "prod"]);
  });

  it("cluster start/end timestamps reflect the first and last event times", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "x" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(3), { entities: svc });
    const e3 = makeEvent("mock:3", t(4), { entities: svc });

    const result = buildTimeline([e1, e2, e3]);
    const cluster = result.clusters[0]!;
    expect(cluster.start).toBe(e1.timestamp);
    expect(cluster.end).toBe(e3.timestamp);
  });

  it("produces multiple clusters sorted by start time", () => {
    const svcA: TimelineEvent["entities"] = [{ type: "service", name: "A" }];
    const svcB: TimelineEvent["entities"] = [{ type: "service", name: "B" }];

    // Two non-overlapping clusters
    const eA1 = makeEvent("mock:a1", t(0), { entities: svcA });
    const eA2 = makeEvent("mock:a2", t(3), { entities: svcA });
    const eB1 = makeEvent("mock:b1", t(30), { entities: svcB });
    const eB2 = makeEvent("mock:b2", t(33), { entities: svcB });

    const result = buildTimeline([eB2, eA1, eB1, eA2]);
    expect(result.clusters).toHaveLength(2);
    expect(new Date(result.clusters[0]!.start).getTime()).toBeLessThan(
      new Date(result.clusters[1]!.start).getTime(),
    );
  });

  it("events with no entities each form their own cluster", () => {
    const e1 = makeEvent("mock:1", t(0)); // no entities
    const e2 = makeEvent("mock:2", t(1)); // no entities, within gap

    const result = buildTimeline([e1, e2]);
    // No shared entity → no grouping, so 2 separate clusters
    expect(result.clusters).toHaveLength(2);
  });

  // ── Requirement 4.5 — determinism ─────────────────────────────────────────

  it("is deterministic: same input always produces same output (Req 4.5)", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "svc" }];
    const events = [
      makeEvent("mock:c", t(8), { entities: svc }),
      makeEvent("mock:a", t(0), { entities: svc }),
      makeEvent("mock:b", t(4), { entities: svc }),
    ];

    const r1 = buildTimeline(events);
    const r2 = buildTimeline(events);
    expect(r1).toEqual(r2);
  });

  it("produces the same result regardless of input order (Req 4.5)", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "svc" }];
    const base = [
      makeEvent("mock:1", t(0), { entities: svc }),
      makeEvent("mock:2", t(3), { entities: svc }),
      makeEvent("mock:3", t(30), { entities: svc }), // separate cluster
    ];

    const r1 = buildTimeline(base);
    const r2 = buildTimeline([...base].reverse());

    expect(r1.events.map((e) => e.id)).toEqual(r2.events.map((e) => e.id));
    expect(r1.clusters.map((c) => c.eventIds)).toEqual(
      r2.clusters.map((c) => c.eventIds),
    );
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("handles events exactly at the gap boundary (inclusive)", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "svc" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    const e2 = makeEvent("mock:2", t(5), { entities: svc }); // exactly 5 min = gapMs

    const result = buildTimeline([e1, e2]);
    // 5 * 60_000 ms diff <= gapMs (5 * 60_000) → should cluster
    expect(result.clusters).toHaveLength(1);
  });

  it("handles events just beyond the gap boundary (exclusive)", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "svc" }];
    const e1 = makeEvent("mock:1", t(0), { entities: svc });
    // 5 minutes + 1 second > default gap
    const e2 = makeEvent(
      "mock:2",
      new Date(new Date(t(0)).getTime() + 5 * 60_000 + 1000).toISOString(),
      { entities: svc },
    );

    const result = buildTimeline([e1, e2]);
    expect(result.clusters).toHaveLength(2);
  });

  it("cluster id is stable: prefixed with 'cluster:' + first event id", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "svc" }];
    const e1 = makeEvent("mock:first", t(0), { entities: svc });
    const e2 = makeEvent("mock:second", t(3), { entities: svc });

    const result = buildTimeline([e1, e2]);
    expect(result.clusters[0]!.id).toBe("cluster:mock:first");
  });

  it("suspectedTriggerId is undefined (set by findSuspectedTrigger)", () => {
    const ev = makeEvent("mock:x", t(0));
    const result = buildTimeline([ev]);
    expect(result.suspectedTriggerId).toBeUndefined();
  });

  it("handles a large set of events efficiently", () => {
    const svc: TimelineEvent["entities"] = [{ type: "service", name: "big" }];
    const events = Array.from({ length: 500 }, (_, i) =>
      makeEvent(`mock:${i}`, t(i * 0.1), { entities: svc }),
    );
    const result = buildTimeline(events);
    expect(result.events).toHaveLength(500);
    // All within 5-min gap chain → one big cluster
    expect(result.clusters).toHaveLength(1);
  });
});
