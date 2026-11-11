/**
 * normalize.ts — pure Kubernetes → TimelineEvent conversion (task 6.2).
 *
 * Two raw shapes are supported, discriminated by a synthetic `_k8sType` field
 * that `k8s-connector.collect()` stamps onto each raw item:
 *
 *   - "event" → one item from a core/v1 EventList
 *               (GET /api/v1/namespaces/{ns}/events → { items: [...] })
 *   - "pod"   → one item from a core/v1 PodList
 *               (GET /api/v1/namespaces/{ns}/pods   → { items: [...] })
 *
 * These functions are PURE: no network, no env, no SDK. They take one raw
 * object and return a validated `TimelineEvent`, or `null` when the raw item
 * cannot be parsed or the result fails `TimelineEventSchema` (dropped with a
 * warning that names the source and reason — same contract as the mock and
 * datadog connectors, requirement 3.1).
 *
 * All connector-specific logic lives here, inside k8s/.
 */

import { z } from "zod";
import { TimelineEventSchema, redact } from "@necro-ops/core";
import type { TimelineEvent, Severity, Entity } from "@necro-ops/core";
import type { RawItem } from "../interface.js";

/** Marker stamped by collect() so normalize can tell the two shapes apart. */
export const K8S_EVENT = "event" as const;
export const K8S_POD = "pod" as const;
export type K8sRawType = typeof K8S_EVENT | typeof K8S_POD;

const SUMMARY_MAX = 200;

/**
 * Container-state reasons that escalate a pod/event to `critical`.
 * These indicate a dead or dying container rather than a transient warning.
 */
const CRITICAL_REASONS = new Set([
  "oomkilled",
  "oomkilling",
  "crashloopbackoff",
  "error",
  "deadlineexceeded",
]);

// ── Raw zod schemas (shallow — only the fields we read) ───────────────────────

const InvolvedObjectSchema = z.object({
  kind: z.string().optional(),
  namespace: z.string().optional(),
  name: z.string().optional(),
  uid: z.string().optional(),
});

const K8sEventRawSchema = z.object({
  _k8sType: z.literal(K8S_EVENT),
  metadata: z
    .object({
      name: z.string().optional(),
      namespace: z.string().optional(),
      uid: z.string().optional(),
    })
    .optional(),
  involvedObject: InvolvedObjectSchema.optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
  type: z.string().optional(),
  // core/v1 Event legacy timestamps (may be null in the newer API shape).
  firstTimestamp: z.string().nullable().optional(),
  lastTimestamp: z.string().nullable().optional(),
  // newer events.k8s.io field; micro-time string or null.
  eventTime: z.string().nullable().optional(),
  count: z.number().optional(),
});

const ContainerStateTerminatedSchema = z.object({
  reason: z.string().optional(),
  exitCode: z.number().optional(),
  finishedAt: z.string().nullable().optional(),
  startedAt: z.string().nullable().optional(),
});

const ContainerStateWaitingSchema = z.object({
  reason: z.string().optional(),
  message: z.string().optional(),
});

const ContainerStatusSchema = z.object({
  name: z.string().optional(),
  ready: z.boolean().optional(),
  restartCount: z.number().optional(),
  state: z
    .object({
      waiting: ContainerStateWaitingSchema.optional(),
      terminated: ContainerStateTerminatedSchema.optional(),
      running: z.object({ startedAt: z.string().nullable().optional() }).optional(),
    })
    .optional(),
  lastState: z
    .object({
      waiting: ContainerStateWaitingSchema.optional(),
      terminated: ContainerStateTerminatedSchema.optional(),
    })
    .optional(),
});

const K8sPodRawSchema = z.object({
  _k8sType: z.literal(K8S_POD),
  metadata: z.object({
    name: z.string(),
    namespace: z.string().optional(),
    uid: z.string().optional(),
    creationTimestamp: z.string().nullable().optional(),
  }),
  status: z
    .object({
      phase: z.string().optional(),
      startTime: z.string().nullable().optional(),
      containerStatuses: z.array(ContainerStatusSchema).optional(),
    })
    .optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Truncate to SUMMARY_MAX, keeping an ellipsis to show it was cut. */
function clampSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return trimmed.slice(0, SUMMARY_MAX - 1).trimEnd() + "…";
}

/** De-duplicating entity collector. */
function pushEntity(entities: Entity[], seen: Set<string>, type: Entity["type"], name: string | undefined): void {
  if (!name) return;
  const key = `${type}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  entities.push({ type, name });
}

/**
 * core/v1 Event `type` + `reason` → severity.
 *   Warning + critical reason → critical
 *   Warning                   → warning
 *   Normal / other            → info
 */
function severityFromEvent(type: string | undefined, reason: string | undefined): Severity {
  const r = (reason ?? "").toLowerCase();
  if (CRITICAL_REASONS.has(r)) return "critical";
  return (type ?? "").toLowerCase() === "warning" ? "warning" : "info";
}

/** Pick the best available timestamp from a core/v1 Event. */
function eventTimestamp(
  raw: z.infer<typeof K8sEventRawSchema>,
): string | null {
  const candidate = raw.lastTimestamp ?? raw.eventTime ?? raw.firstTimestamp;
  if (!candidate) return null;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Normalizers (one per raw shape) ───────────────────────────────────────────

function normalizeEvent(raw: z.infer<typeof K8sEventRawSchema>): unknown {
  const io = raw.involvedObject ?? {};
  const ns = io.namespace ?? raw.metadata?.namespace;

  // A stable native id: the event's own name is unique per namespace/instance.
  const nativeId = raw.metadata?.name ?? raw.metadata?.uid ?? `${ns ?? "?"}/${io.name ?? "?"}/${raw.reason ?? "?"}`;

  const entities: Entity[] = [];
  const seen = new Set<string>();
  pushEntity(entities, seen, "namespace", ns);
  if ((io.kind ?? "").toLowerCase() === "pod") {
    pushEntity(entities, seen, "pod", io.name);
  } else if (io.name) {
    // Deployment / ReplicaSet / Service etc. → service entity for correlation.
    pushEntity(entities, seen, "service", io.name);
  }

  const summarySource = [
    io.kind && io.name ? `${io.kind}/${io.name}` : io.name,
    raw.reason,
    raw.message,
  ]
    .filter(Boolean)
    .join(" — ");
  const summary = clampSummary(redact(summarySource || raw.reason || "(no reason)"));

  const timestamp = eventTimestamp(raw);

  const candidate: Record<string, unknown> = {
    id: `k8s:${nativeId}`,
    source: "k8s",
    timestamp: timestamp ?? new Date(0).toISOString(),
    kind: "k8s_event",
    severity: severityFromEvent(raw.type, raw.reason),
    entities,
    summary,
    raw,
  };
  return candidate;
}

/**
 * Extract the dominant abnormal container state of a pod, if any.
 * Looks at both the current waiting/terminated state and lastState so an
 * OOMKill that already restarted into CrashLoopBackOff is still surfaced.
 */
function podAbnormalReason(
  statuses: z.infer<typeof ContainerStatusSchema>[] | undefined,
): { reason: string; detail: string } | null {
  if (!statuses) return null;
  for (const cs of statuses) {
    const waiting = cs.state?.waiting?.reason;
    const terminated = cs.state?.terminated?.reason ?? cs.lastState?.terminated?.reason;
    // terminated (OOMKilled/Error) outranks waiting (CrashLoopBackOff) for severity,
    // but we report both reasons so the timeline shows the full picture.
    const reasons = [waiting, terminated].filter(Boolean) as string[];
    if (reasons.length === 0) continue;

    // Prefer a critical reason for the headline.
    const critical = reasons.find((r) => CRITICAL_REASONS.has(r.toLowerCase()));
    const headline = critical ?? reasons[0]!;
    const exit = cs.state?.terminated?.exitCode ?? cs.lastState?.terminated?.exitCode;
    const detail = [
      cs.name ? `container ${cs.name}` : "",
      reasons.join("/"),
      typeof exit === "number" ? `exit ${exit}` : "",
      typeof cs.restartCount === "number" && cs.restartCount > 0
        ? `restarts ${cs.restartCount}`
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    return { reason: headline, detail };
  }
  return null;
}

function normalizePod(raw: z.infer<typeof K8sPodRawSchema>): unknown | null {
  const name = raw.metadata.name;
  const ns = raw.metadata.namespace;
  const phase = raw.status?.phase;
  const abnormal = podAbnormalReason(raw.status?.containerStatuses);

  // A healthy Running/Succeeded pod with no abnormal container state carries no
  // incident signal — drop it so the timeline is not flooded with "all is well".
  const phaseAbnormal = phase === "Failed" || phase === "Pending" || phase === "Unknown";
  if (!abnormal && !phaseAbnormal) {
    return null;
  }

  const entities: Entity[] = [];
  const seen = new Set<string>();
  pushEntity(entities, seen, "namespace", ns);
  pushEntity(entities, seen, "pod", name);

  const reason = abnormal?.reason ?? phase ?? "";
  let severity: Severity = "info";
  if (reason && CRITICAL_REASONS.has(reason.toLowerCase())) severity = "critical";
  else if (phase === "Failed") severity = "critical";
  else if (abnormal || phaseAbnormal) severity = "warning";

  const summarySource = [
    `Pod ${ns ? `${ns}/` : ""}${name}`,
    phase ? `phase ${phase}` : "",
    abnormal?.detail,
  ]
    .filter(Boolean)
    .join(" — ");
  const summary = clampSummary(redact(summarySource));

  // Timestamp: the pod's start time is the most meaningful anchor we have from
  // a status snapshot (no per-state transition time is guaranteed in the list).
  const ts = raw.status?.startTime ?? raw.metadata.creationTimestamp;
  const timestamp = ts && !Number.isNaN(new Date(ts).getTime())
    ? new Date(ts).toISOString()
    : new Date(0).toISOString();

  const nativeId = raw.metadata.uid ? `pod-${raw.metadata.uid}` : `pod-${ns ?? "?"}/${name}`;

  const candidate: Record<string, unknown> = {
    id: `k8s:${nativeId}`,
    source: "k8s",
    timestamp,
    kind: "k8s_event",
    severity,
    entities,
    summary,
    raw,
  };
  return candidate;
}

/**
 * Convert one raw Kubernetes item (event or pod) into a validated
 * `TimelineEvent`. Returns `null` on any parse/validation failure OR when a
 * pod snapshot carries no incident signal, after logging a warning that names
 * the source and reason (requirement 3.1).
 */
export function normalizeK8s(item: RawItem): TimelineEvent | null {
  const k8sType = item["_k8sType"];

  let candidate: unknown;
  if (k8sType === K8S_EVENT) {
    const parsed = K8sEventRawSchema.safeParse(item);
    if (!parsed.success) {
      warn("event", item, parsed.error.message);
      return null;
    }
    candidate = normalizeEvent(parsed.data);
  } else if (k8sType === K8S_POD) {
    const parsed = K8sPodRawSchema.safeParse(item);
    if (!parsed.success) {
      warn("pod", item, parsed.error.message);
      return null;
    }
    candidate = normalizePod(parsed.data);
    if (candidate === null) return null; // healthy pod — dropped, not an error
  } else {
    warn("unknown", item, `missing or unknown _k8sType: ${String(k8sType)}`);
    return null;
  }

  const result = TimelineEventSchema.safeParse(candidate);
  if (!result.success) {
    warn(String(k8sType), item, result.error.message);
    return null;
  }
  return result.data as TimelineEvent;
}

function warn(kind: string, item: RawItem, reason: string): void {
  const meta = item["metadata"] as { name?: string } | undefined;
  const id = meta?.name ?? "(no name)";
  console.warn(
    `[k8s-connector] Dropping invalid ${kind} (source=k8s, id=${id}): ${reason}`,
  );
}
