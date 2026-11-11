/**
 * normalize.ts — pure Terraform → TimelineEvent conversion (task 6.3).
 *
 * Terraform has TWO input shapes, discriminated by a synthetic `_tfType` field
 * that `terraform-connector.collect()` stamps onto each raw item:
 *
 *   - "change" → one `resource_change` entry from `terraform show -json`
 *                output (plan or state JSON). Carries change.actions and
 *                before/after. These have no native timestamp, so collect()
 *                also stamps `_tfTimestamp` (the incident window start) onto
 *                each one.
 *   - "apply"  → one parsed line from a `terraform apply` text log
 *                (resource Creation/Modification/Destruction complete, or the
 *                final "Apply complete!" line). Carries an address, a verb and
 *                a timestamp lifted from the log line's elapsed/clock info.
 *
 * These functions are PURE: no network, no env, no SDK, no file reads. They
 * take one raw object and return a validated `TimelineEvent`, or `null` when
 * the raw item cannot be parsed or the result fails `TimelineEventSchema`
 * (dropped with a warning that names the source and reason — same contract as
 * the mock / datadog / k8s connectors, requirement 3.1).
 *
 * All connector-specific logic lives here, inside terraform/.
 */

import { z } from "zod";
import { TimelineEventSchema, redact } from "@necro-ops/core";
import type { TimelineEvent, Severity, Entity } from "@necro-ops/core";
import type { RawItem } from "../interface.js";

/** Markers stamped by collect() so normalize can tell the two shapes apart. */
export const TF_CHANGE = "change" as const;
export const TF_APPLY = "apply" as const;
export type TerraformRawType = typeof TF_CHANGE | typeof TF_APPLY;

const SUMMARY_MAX = 200;

/**
 * `terraform apply` verbs and `show -json` actions that destroy or recreate a
 * resource escalate to `critical`; an update is a `warning`; a create / read /
 * no-op is `info`. Replace (delete+create) is the most dangerous and is
 * treated as critical.
 */

// ── Raw zod schemas (shallow — only the fields we read) ───────────────────────

/**
 * One `resource_changes[]` entry from `terraform show -json`.
 * `change.actions` is an array of verbs: ["create"], ["update"], ["delete"],
 * ["delete","create"] (= replace), or ["no-op"] / ["read"].
 */
const ChangeRawSchema = z.object({
  _tfType: z.literal(TF_CHANGE),
  /** Incident-window anchor stamped by collect() (show-json has no time). */
  _tfTimestamp: z.string(),
  address: z.string(),
  module_address: z.string().optional(),
  mode: z.string().optional(),
  type: z.string().optional(),
  name: z.string().optional(),
  provider_name: z.string().optional(),
  change: z.object({
    actions: z.array(z.string()),
    before: z.unknown().optional(),
    after: z.unknown().optional(),
  }),
});

/**
 * One parsed `terraform apply` log line, pre-tokenised by collect():
 *   - address:  resource address, e.g. "aws_instance.payments"
 *   - verb:     "Creating" | "Modifying" | "Destroying" | "Creation complete"
 *               | "Modifications complete" | "Destruction complete" | "apply"
 *   - timestamp: ISO-8601 for the line
 *   - detail:   the raw log text (for the summary) — redacted here
 *   - complete: true for the final "Apply complete!" summary line
 */
const ApplyRawSchema = z.object({
  _tfType: z.literal(TF_APPLY),
  _tfTimestamp: z.string(),
  address: z.string().optional(),
  verb: z.string(),
  detail: z.string(),
  complete: z.boolean().optional(),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Truncate to SUMMARY_MAX, keeping an ellipsis to show it was cut. */
function clampSummary(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return trimmed.slice(0, SUMMARY_MAX - 1).trimEnd() + "…";
}

function toIso(value: string): string | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * De-duplicating entity collector. A Terraform resource maps to a `resource`
 * entity whose name is its address (`type.name`); the module (if any) is also
 * a `resource` entity so correlation can group by module.
 */
function pushEntity(
  entities: Entity[],
  seen: Set<string>,
  type: Entity["type"],
  name: string | undefined,
): void {
  if (!name) return;
  const key = `${type}:${name}`;
  if (seen.has(key)) return;
  seen.add(key);
  entities.push({ type, name });
}

/**
 * Map a set of `terraform show -json` change actions to a severity.
 *   delete / replace (delete+create) → critical (data loss / recreation)
 *   update                           → warning
 *   create / read / no-op / other    → info
 */
function severityFromActions(actions: string[]): Severity {
  const set = new Set(actions.map((a) => a.toLowerCase()));
  const isReplace = set.has("delete") && set.has("create");
  if (set.has("delete") || isReplace) return "critical";
  if (set.has("update")) return "warning";
  return "info";
}

/** Human label for a set of actions. "delete"+"create" → "replace". */
function actionLabel(actions: string[]): string {
  const set = new Set(actions.map((a) => a.toLowerCase()));
  if (set.has("delete") && set.has("create")) return "replace";
  if (set.has("delete")) return "delete";
  if (set.has("update")) return "update";
  if (set.has("create")) return "create";
  if (set.has("read")) return "read";
  return actions.join("+") || "no-op";
}

/** Map an apply-log verb to severity. */
function severityFromVerb(verb: string, complete: boolean): Severity {
  if (complete) return "info"; // "Apply complete!" summary
  const v = verb.toLowerCase();
  if (v.startsWith("destroy") || v.startsWith("destruction")) return "critical";
  if (v.startsWith("modif")) return "warning";
  return "info"; // Creating / Creation complete
}

// ── Normalizers (one per raw shape) ───────────────────────────────────────────

function normalizeChange(raw: z.infer<typeof ChangeRawSchema>): unknown | null {
  const actions = raw.change.actions;
  const label = actionLabel(actions);

  // A no-op / read carries no incident signal — drop it so the timeline is not
  // flooded with unchanged resources.
  if (label === "no-op" || label === "read") return null;

  const entities: Entity[] = [];
  const seen = new Set<string>();
  // The resource address is the primary entity.
  pushEntity(entities, seen, "resource", raw.address);
  // The module (if any) groups related changes.
  pushEntity(entities, seen, "resource", raw.module_address);

  const summarySource = `terraform ${label}: ${raw.address}${
    raw.provider_name ? ` (${raw.provider_name})` : ""
  }`;
  const summary = clampSummary(redact(summarySource));

  const timestamp = toIso(raw._tfTimestamp);
  if (!timestamp) return null;

  // Native id: the resource address is unique per plan; prefix the action so a
  // replace (delete+create) does not collide with a later update of the same
  // address in another plan.
  const nativeId = `${label}:${raw.address}`;

  const candidate: Record<string, unknown> = {
    id: `terraform:${nativeId}`,
    source: "terraform",
    timestamp,
    kind: "infra_change",
    severity: severityFromActions(actions),
    entities,
    summary,
    raw,
  };
  return candidate;
}

function normalizeApply(raw: z.infer<typeof ApplyRawSchema>): unknown | null {
  const complete = raw.complete === true;

  const entities: Entity[] = [];
  const seen = new Set<string>();
  pushEntity(entities, seen, "resource", raw.address);

  const summary = clampSummary(redact(raw.detail));

  const timestamp = toIso(raw._tfTimestamp);
  if (!timestamp) return null;

  // Native id: address + verb keeps Creating / "Creation complete" distinct,
  // and keeps the final summary line unique.
  const nativeId = complete
    ? `apply-complete:${timestamp}`
    : `apply:${raw.address ?? "?"}:${raw.verb.toLowerCase().replace(/\s+/g, "-")}`;

  const candidate: Record<string, unknown> = {
    id: `terraform:${nativeId}`,
    source: "terraform",
    timestamp,
    // The final "Apply complete!" line is the deploy marker; individual
    // resource lines are infra changes.
    kind: complete ? "deploy" : "infra_change",
    severity: severityFromVerb(raw.verb, complete),
    entities,
    summary,
    raw,
  };
  return candidate;
}

/**
 * Convert one raw Terraform item (show-json change or apply-log line) into a
 * validated `TimelineEvent`. Returns `null` on any parse/validation failure OR
 * when the item carries no incident signal (a no-op change), after logging a
 * warning that names the source and reason (requirement 3.1).
 */
export function normalizeTerraform(item: RawItem): TimelineEvent | null {
  const tfType = item["_tfType"];

  let candidate: unknown;
  if (tfType === TF_CHANGE) {
    const parsed = ChangeRawSchema.safeParse(item);
    if (!parsed.success) {
      warn("change", item, parsed.error.message);
      return null;
    }
    candidate = normalizeChange(parsed.data);
    if (candidate === null) return null; // no-op — dropped, not an error
  } else if (tfType === TF_APPLY) {
    const parsed = ApplyRawSchema.safeParse(item);
    if (!parsed.success) {
      warn("apply", item, parsed.error.message);
      return null;
    }
    candidate = normalizeApply(parsed.data);
    if (candidate === null) return null;
  } else {
    warn("unknown", item, `missing or unknown _tfType: ${String(tfType)}`);
    return null;
  }

  const result = TimelineEventSchema.safeParse(candidate);
  if (!result.success) {
    warn(String(tfType), item, result.error.message);
    return null;
  }
  return result.data as TimelineEvent;
}

// ── Apply-log parsing (pure) ──────────────────────────────────────────────────

/**
 * A `terraform apply` log line looks like one of:
 *
 *   aws_instance.payments: Modifying... [id=i-0abc123]
 *   aws_instance.payments: Modifications complete after 42s [id=i-0abc123]
 *   aws_instance.payments: Creating...
 *   aws_instance.payments: Creation complete after 1m3s [id=i-0def456]
 *   aws_db_instance.main: Destroying... [id=main]
 *   aws_db_instance.main: Destruction complete after 5s
 *   Apply complete! Resources: 1 added, 2 changed, 1 destroyed.
 *
 * Plan/CI runners may prefix an RFC-3339 timestamp (e.g.
 * `2024-10-15T01:48:00Z `) — we lift it when present, else fall back to the
 * window anchor. We emit raw items only for the *complete* lines and the final
 * summary, since the "…ing..." start lines carry no new signal.
 */

/** Resource line: optional leading ISO timestamp, address, verb phrase. */
const RESOURCE_LINE = new RegExp(
  "^(?:(?<ts>\\d{4}-\\d{2}-\\d{2}T[\\d:.+Z-]+)\\s+)?" +
    "(?<address>[A-Za-z0-9_.\\[\\]\"\\-\\/]+):\\s+" +
    "(?<verb>Creation complete|Modifications complete|Destruction complete|" +
    "Creating|Modifying|Destroying)" +
    "(?<rest>.*)$",
);

/** Final summary line: "Apply complete! Resources: ..." */
const COMPLETE_LINE = new RegExp(
  "^(?:(?<ts>\\d{4}-\\d{2}-\\d{2}T[\\d:.+Z-]+)\\s+)?" +
    "(?<body>Apply complete!.*)$",
);

/**
 * Parse a `terraform apply` log into raw items ready for `normalizeApply`.
 * Pure: takes the log text + a fallback timestamp, returns stamped raw items.
 * Only "… complete" resource lines and the final summary produce events; the
 * transient "Creating…/Modifying…/Destroying…" lines are skipped.
 */
export function parseApplyLog(text: string, fallbackTs: string): RawItem[] {
  const out: RawItem[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const resMatch = RESOURCE_LINE.exec(line);
    if (resMatch?.groups) {
      const verb = resMatch.groups["verb"]!;
      // Skip transient start lines; only "… complete" carries a real outcome.
      if (!/complete$/i.test(verb)) continue;
      const ts = resMatch.groups["ts"] && toIso(resMatch.groups["ts"]);
      out.push({
        _tfType: TF_APPLY,
        _tfTimestamp: ts || fallbackTs,
        address: resMatch.groups["address"],
        verb,
        detail: line,
        complete: false,
      });
      continue;
    }

    const completeMatch = COMPLETE_LINE.exec(line);
    if (completeMatch?.groups) {
      const ts = completeMatch.groups["ts"] && toIso(completeMatch.groups["ts"]);
      out.push({
        _tfType: TF_APPLY,
        _tfTimestamp: ts || fallbackTs,
        verb: "apply",
        detail: completeMatch.groups["body"]!,
        complete: true,
      });
    }
  }
  return out;
}

function warn(kind: string, item: RawItem, reason: string): void {
  const id =
    (item["address"] as string | undefined) ??
    (item["detail"] as string | undefined) ??
    "(no address)";
  console.warn(
    `[terraform-connector] Dropping invalid ${kind} (source=terraform, id=${id}): ${reason}`,
  );
}
