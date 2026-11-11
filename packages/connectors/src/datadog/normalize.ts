/**
 * normalize.ts — pure Datadog → TimelineEvent conversion.
 *
 * Two raw shapes are supported, discriminated by a synthetic `_ddType` field
 * that `datadog-connector.collect()` stamps onto each raw item:
 *
 *   - "event"   → a Datadog event   (/api/v1/events  → events[])
 *   - "monitor" → a Datadog monitor (/api/v1/monitor → [])
 *
 * These functions are PURE: no network, no env, no SDK. They take one raw
 * object and return a validated `TimelineEvent`, or `null` when the raw item
 * cannot be parsed or the result fails `TimelineEventSchema` (dropped with a
 * warning that names the source and reason — same contract as the mock
 * connector, requirement 3.1).
 *
 * All connector-specific logic lives here, inside datadog/.
 */

import { z } from "zod";
import { TimelineEventSchema, redact } from "@necro-ops/core";
import type {
  TimelineEvent,
  EventKind,
  Severity,
  Entity,
} from "@necro-ops/core";
import type { RawItem } from "../interface.js";

/** Marker stamped by collect() so normalize can tell the two shapes apart. */
export const DD_EVENT = "event" as const;
export const DD_MONITOR = "monitor" as const;
export type DatadogRawType = typeof DD_EVENT | typeof DD_MONITOR;

const SUMMARY_MAX = 200;
const DD_APP_BASE = "https://app.datadoghq.com";

// ── Raw zod schemas (shallow — only the fields we read) ───────────────────────

const DatadogEventRawSchema = z.object({
  _ddType: z.literal(DD_EVENT),
  id: z.union([z.number(), z.string()]),
  title: z.string().optional(),
  text: z.string().optional(),
  // Datadog events use unix seconds in `date_happened`.
  date_happened: z.number(),
  alert_type: z.string().optional(),
  priority: z.string().optional(),
  tags: z.array(z.string()).optional(),
  host: z.string().optional(),
  url: z.string().optional(),
});

const DatadogMonitorRawSchema = z.object({
  _ddType: z.literal(DD_MONITOR),
  id: z.union([z.number(), z.string()]),
  name: z.string().optional(),
  message: z.string().optional(),
  type: z.string().optional(),
  overall_state: z.string().optional(),
  // ISO-8601 string on the monitor payload.
  overall_state_modified: z.string().optional(),
  modified: z.string().optional(),
  priority: z.union([z.number(), z.null()]).optional(),
  tags: z.array(z.string()).optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Truncate to SUMMARY_MAX, keeping an ellipsis to show it was cut. */
function clampSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return trimmed.slice(0, SUMMARY_MAX - 1).trimEnd() + "…";
}

/**
 * Parse Datadog `key:value` tags into TimelineEvent entities.
 * Only the entity-bearing keys are mapped; everything else (env, team, …) is
 * ignored so the timeline stays focused on service/host/pod/namespace.
 */
function entitiesFromTags(tags: string[] | undefined): Entity[] {
  if (!tags) return [];
  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const tag of tags) {
    const idx = tag.indexOf(":");
    if (idx <= 0) continue;
    const key = tag.slice(0, idx).trim().toLowerCase();
    const value = tag.slice(idx + 1).trim();
    if (!value) continue;

    let type: Entity["type"] | null = null;
    if (key === "service") type = "service";
    // Datadog `host:` has no first-class TimelineEvent entity type; the domain
    // model (core) only has service/namespace/pod/resource, so a host is
    // recorded as a `resource` entity.
    else if (key === "host") type = "resource";
    else if (key === "pod" || key === "pod_name") type = "pod";
    else if (key === "namespace" || key === "kube_namespace")
      type = "namespace";

    if (!type) continue;
    const dedupeKey = `${type}:${value}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    entities.push({ type, name: value });
  }
  return entities;
}

/**
 * Datadog `alert_type` → severity.
 *   error        → critical
 *   warning      → warning
 *   success      → info (a recovery is not an error)
 *   info / other → info
 */
function severityFromAlertType(alertType: string | undefined): Severity {
  switch ((alertType ?? "").toLowerCase()) {
    case "error":
      return "critical";
    case "warning":
    case "warn":
      return "warning";
    default:
      return "info";
  }
}

/** A Datadog "success" alert_type is a recovery; everything else is an alert. */
function kindFromAlertType(alertType: string | undefined): EventKind {
  return (alertType ?? "").toLowerCase() === "success" ? "recovery" : "alert";
}

/**
 * Datadog monitor `overall_state` → severity.
 *   Alert          → critical
 *   Warn           → warning
 *   OK / No Data   → info
 */
function severityFromMonitorState(state: string | undefined): Severity {
  switch ((state ?? "").toLowerCase()) {
    case "alert":
      return "critical";
    case "warn":
      return "warning";
    default:
      return "info";
  }
}

/** Monitor state → kind: a recovered (OK) monitor is a recovery; else alert. */
function kindFromMonitorState(state: string | undefined): EventKind {
  return (state ?? "").toLowerCase() === "ok" ? "recovery" : "alert";
}

// ── Normalizers (one per raw shape) ───────────────────────────────────────────

function normalizeEvent(raw: z.infer<typeof DatadogEventRawSchema>): unknown {
  const nativeId = String(raw.id);
  const entities = entitiesFromTags(raw.tags);
  if (raw.host) {
    const hostKey = `resource:${raw.host}`;
    if (!entities.some((e) => `${e.type}:${e.name}` === hostKey)) {
      entities.push({ type: "resource", name: raw.host });
    }
  }

  const summarySource = [raw.title, raw.text].filter(Boolean).join(" — ");
  const summary = clampSummary(redact(summarySource || "(no title)"));

  const candidate: Record<string, unknown> = {
    id: `datadog:${nativeId}`,
    source: "datadog",
    timestamp: new Date(raw.date_happened * 1000).toISOString(),
    kind: kindFromAlertType(raw.alert_type),
    severity: severityFromAlertType(raw.alert_type),
    entities,
    summary,
    raw,
  };
  if (raw.url) {
    candidate["link"] = raw.url.startsWith("http")
      ? raw.url
      : `${DD_APP_BASE}${raw.url}`;
  }
  return candidate;
}

function normalizeMonitor(
  raw: z.infer<typeof DatadogMonitorRawSchema>,
): unknown {
  const nativeId = String(raw.id);
  const entities = entitiesFromTags(raw.tags);

  const state = raw.overall_state;
  const summarySource = [raw.name, state ? `state: ${state}` : "", raw.message]
    .filter(Boolean)
    .join(" — ");
  const summary = clampSummary(redact(summarySource || "(no name)"));

  const timestamp = raw.overall_state_modified ?? raw.modified;

  const candidate: Record<string, unknown> = {
    id: `datadog:monitor-${nativeId}`,
    source: "datadog",
    timestamp: timestamp
      ? new Date(timestamp).toISOString()
      : new Date(0).toISOString(),
    kind: kindFromMonitorState(state),
    severity: severityFromMonitorState(state),
    entities,
    summary,
    raw,
  };
  if (raw.id) {
    candidate["link"] = `${DD_APP_BASE}/monitors/${nativeId}`;
  }
  return candidate;
}

/**
 * Convert one raw Datadog item (event or monitor) into a validated
 * `TimelineEvent`. Returns `null` on any parse/validation failure, after
 * logging a warning that names the source and reason (requirement 3.1).
 */
export function normalizeDatadog(item: RawItem): TimelineEvent | null {
  const ddType = item["_ddType"];

  let candidate: unknown;
  if (ddType === DD_EVENT) {
    const parsed = DatadogEventRawSchema.safeParse(item);
    if (!parsed.success) {
      warn("event", item, parsed.error.message);
      return null;
    }
    candidate = normalizeEvent(parsed.data);
  } else if (ddType === DD_MONITOR) {
    const parsed = DatadogMonitorRawSchema.safeParse(item);
    if (!parsed.success) {
      warn("monitor", item, parsed.error.message);
      return null;
    }
    candidate = normalizeMonitor(parsed.data);
  } else {
    warn("unknown", item, `missing or unknown _ddType: ${String(ddType)}`);
    return null;
  }

  const result = TimelineEventSchema.safeParse(candidate);
  if (!result.success) {
    warn(String(ddType), item, result.error.message);
    return null;
  }
  return result.data as TimelineEvent;
}

function warn(kind: string, item: RawItem, reason: string): void {
  const id = typeof item["id"] !== "undefined" ? String(item["id"]) : "(no id)";
  console.warn(
    `[datadog-connector] Dropping invalid ${kind} (source=datadog, id=${id}): ${reason}`,
  );
}
