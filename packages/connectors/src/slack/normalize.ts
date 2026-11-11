/**
 * normalize.ts — pure Slack message → TimelineEvent conversion (task 6.4).
 *
 * Input shape: one element of `conversations.history`'s `messages[]` array
 * (the Slack Web API's own response shape). A message carries:
 *   - `ts`       — the message timestamp AND its native id: epoch seconds with
 *                  a microsecond fraction, e.g. "1699200180.000100".
 *   - `user`     — the author's Slack user id (U...), absent on some subtypes.
 *   - `text`     — the message body, which may contain `<@U...>` mentions,
 *                  real names, emails and secrets.
 *   - `subtype`  — set for non-plain messages (bot_message, channel_join, …).
 *   - `thread_ts`— the parent message's ts when this is a threaded reply.
 *   - `bot_id` / `username` — present on bot messages.
 *
 * These functions are PURE: no network, no env, no SDK. They take one raw
 * message plus its channel and return a validated `TimelineEvent`, or `null`
 * when the message cannot be parsed, is a non-conversational subtype, or the
 * result fails `TimelineEventSchema` (dropped with a warning that names the
 * source and reason — same contract as the other connectors, requirement 3.1).
 *
 * BLAMELESS REQUIREMENT (6.4): the summary must never leak a person. `redact()`
 * strips emails/tokens/keys but deliberately keeps human names and Slack
 * mentions, so this normalizer ALSO:
 *   - rewrites `<@U...>` / `<@U...|handle>` mentions → "a teammate",
 *   - never puts the author's `user` id (or any U-id) into the summary,
 *   - drops the `channel_join`-style "<@U..> has joined" noise entirely.
 * The channel is the only entity; individuals are never entities.
 *
 * All connector-specific logic lives here, inside slack/.
 */

import { z } from "zod";
import { TimelineEventSchema, redact } from "@necro-ops/core";
import type { TimelineEvent, Entity } from "@necro-ops/core";
import type { RawItem } from "../interface.js";

/** Synthetic field stamped by collect() so normalize knows the channel. */
export const SLACK_CHANNEL_FIELD = "_slackChannel" as const;

const SUMMARY_MAX = 200;

/**
 * Subtypes that are not incident conversation — join/leave/topic noise. These
 * are dropped so the timeline is not polluted and so we never surface a
 * "<@U..> has joined" line (which is nothing but a person reference).
 */
const DROPPED_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "bot_add",
  "bot_remove",
]);

// ── Raw zod schema (shallow — only the fields we read) ────────────────────────

const SlackMessageRawSchema = z.object({
  [SLACK_CHANNEL_FIELD]: z.string().optional(),
  type: z.string().optional(),
  subtype: z.string().optional(),
  ts: z.string(),
  thread_ts: z.string().optional(),
  user: z.string().optional(),
  bot_id: z.string().optional(),
  username: z.string().optional(),
  text: z.string().optional(),
});

type SlackMessageRaw = z.infer<typeof SlackMessageRawSchema>;

// ── Person-scrubbing (the core of 6.4) ────────────────────────────────────────

/**
 * Slack mention tokens:
 *   <@U012ABC>            — user mention
 *   <@U012ABC|handle>     — user mention with a cached handle
 *   <@W012ABC>            — enterprise-grid user id (starts with W)
 *   <!subteam^S012|@grp>  — user-group mention
 * All of these name or point at people, so every one becomes "a teammate".
 */
const MENTION_RE = /<[@!](?:subteam\^)?[UWS][A-Z0-9]*(?:\|[^>]*)?>/g;

/** A bare Slack user/bot id anywhere in free text (U…, W…, B…). */
const BARE_ID_RE = /\b[UWB][A-Z0-9]{6,}\b/g;

/**
 * Slack tokens (xoxb-/xoxp-/xapp-/xoxa-/xoxr-/xoxs-…). The shared `redact()`
 * catches generic `api_token=`/`Bearer …` forms but not a bare Slack token
 * pasted into chat, so we scrub this Slack-specific shape here.
 */
const SLACK_TOKEN_RE = /\bxox[baprse]-[A-Za-z0-9-]+/gi;

/**
 * Replace every person reference in a message body with a neutral token.
 * Mentions and bare ids both collapse to "a teammate". This runs BEFORE
 * redact() so the two passes compose (redact handles emails/secrets).
 */
function scrubPeople(text: string): string {
  return text.replace(MENTION_RE, "a teammate").replace(BARE_ID_RE, "a teammate");
}

/** Truncate to SUMMARY_MAX, keeping an ellipsis to show it was cut. */
function clampSummary(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= SUMMARY_MAX) return trimmed;
  return trimmed.slice(0, SUMMARY_MAX - 1).trimEnd() + "…";
}

/**
 * Slack `ts` → UTC ISO-8601. `ts` is epoch seconds with a microsecond
 * fraction ("1699200180.000100"); we keep millisecond precision.
 */
function tsToIso(ts: string): string | null {
  const seconds = Number.parseFloat(ts);
  if (!Number.isFinite(seconds)) return null;
  const d = new Date(Math.round(seconds * 1000));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ── Normalizer ────────────────────────────────────────────────────────────────

function normalizeMessage(raw: SlackMessageRaw): unknown | null {
  // Drop join/leave/topic noise outright (never a person-only line).
  if (raw.subtype && DROPPED_SUBTYPES.has(raw.subtype)) return null;

  const channel = raw[SLACK_CHANNEL_FIELD]?.trim() || "unknown";

  const entities: Entity[] = [{ type: "resource", name: `channel:${channel}` }];

  // Build the summary: scrub people FIRST (mentions + bare ids → "a teammate"),
  // then redact secrets/emails, then clamp to 200 chars. The author's `user`
  // id is intentionally never read into the summary.
  const body = raw.text ?? "";
  const scrubbed = scrubPeople(body).replace(SLACK_TOKEN_RE, "[REDACTED]");
  const summary = clampSummary(redact(scrubbed));

  // `ts` is unique per channel message; use it as the native id so the id is
  // stable and never carries a user id.
  const nativeId = `${channel}:${raw.ts}`;
  const timestamp = tsToIso(raw.ts);
  if (timestamp === null) return null;

  const candidate: Record<string, unknown> = {
    id: `slack:${nativeId}`,
    source: "slack",
    timestamp,
    kind: "chat",
    // Slack discussion is contextual, not an alert — always info.
    severity: "info",
    entities,
    summary: summary || "(empty message)",
    // raw is kept for correlation/debug but never exported to the user.
    raw,
  };
  return candidate;
}

/**
 * Convert one raw Slack message into a validated `TimelineEvent`. Returns
 * `null` on any parse/validation failure OR when the message is a dropped
 * subtype, after logging a warning that names the source and reason
 * (requirement 3.1).
 */
export function normalizeSlack(item: RawItem): TimelineEvent | null {
  const parsed = SlackMessageRawSchema.safeParse(item);
  if (!parsed.success) {
    warn(item, parsed.error.message);
    return null;
  }

  const candidate = normalizeMessage(parsed.data);
  if (candidate === null) return null; // dropped subtype / bad ts — not an error

  const result = TimelineEventSchema.safeParse(candidate);
  if (!result.success) {
    warn(item, result.error.message);
    return null;
  }
  return result.data as TimelineEvent;
}

function warn(item: RawItem, reason: string): void {
  const ts = typeof item["ts"] === "string" ? item["ts"] : "(no ts)";
  console.warn(
    `[slack-connector] Dropping invalid message (source=slack, ts=${ts}): ${reason}`,
  );
}
