/**
 * slack.test.ts — fixture-based tests for the Slack connector (task 6.4).
 *
 * These tests NEVER touch the network: they feed a raw
 * `conversations.history` fixture (Slack's own response shape — a `messages[]`
 * array) through the pure `normalize()` path and assert the resulting
 * `TimelineEvent`s. `collect()` is intentionally not exercised — that is the
 * credentialed/network half, split out by design.
 *
 * Coverage:
 *   가) every normalized event passes TimelineEventSchema
 *   나) Slack `ts` → UTC ISO-8601 conversion
 *   다) BLAMELESS: no summary leaks a person name, a <@U...> mention, or a
 *       Slack user id (asserted with regexes) — the core of 6.4
 *   라) emails / API keys / tokens are redacted out of the summary
 *   마) isEnabled is false without SLACK_BOT_TOKEN
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TimelineEventSchema } from "@necro-ops/core";
import type { TimelineEvent } from "@necro-ops/core";
import type { RawItem } from "@necro-ops/connectors";
import { slackConnector } from "@necro-ops/connectors";
import { SLACK_CHANNEL_FIELD } from "./normalize.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "__fixtures__");

const CHANNEL = "C09INCIDENT";

function loadRawMessages(): RawItem[] {
  const body = JSON.parse(
    readFileSync(join(FIXTURES_DIR, "conversations-history.json"), "utf-8"),
  ) as { messages: unknown[] };
  // Stamp the channel exactly as collect() would.
  return body.messages.map((m) => ({
    ...(m as Record<string, unknown>),
    [SLACK_CHANNEL_FIELD]: CHANNEL,
  }));
}

function normalizeAll(items: RawItem[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const item of items) {
    const ev = slackConnector.normalize(item);
    if (ev !== null) out.push(ev);
  }
  return out;
}

// ── 가) schema conformance ────────────────────────────────────────────────────

describe("slack normalize: schema conformance", () => {
  it("every normalized message passes TimelineEventSchema", () => {
    const all = normalizeAll(loadRawMessages());
    // 6 messages in; the channel_join subtype is dropped → 5 survive.
    expect(all.length).toBe(5);
    for (const ev of all) {
      const result = TimelineEventSchema.safeParse(ev);
      expect(result.success, result.error?.message).toBe(true);
    }
  });

  it("drops channel_join / membership noise", () => {
    const all = normalizeAll(loadRawMessages());
    for (const ev of all) {
      expect(ev.summary).not.toContain("has joined");
    }
  });

  it("ids follow slack:<channel>:<ts> and source is slack", () => {
    const all = normalizeAll(loadRawMessages());
    for (const ev of all) {
      expect(ev.source).toBe("slack");
      expect(ev.id).toMatch(/^slack:C09INCIDENT:\d+\.\d+$/);
    }
  });

  it("all kinds are chat and all severities are info", () => {
    const all = normalizeAll(loadRawMessages());
    for (const ev of all) {
      expect(ev.kind).toBe("chat");
      expect(ev.severity).toBe("info");
    }
  });

  it("the only entity is the channel; no person entities", () => {
    const all = normalizeAll(loadRawMessages());
    for (const ev of all) {
      expect(ev.entities).toEqual([{ type: "resource", name: `channel:${CHANNEL}` }]);
    }
  });

  it("no summary exceeds 200 characters", () => {
    const all = normalizeAll(loadRawMessages());
    for (const ev of all) {
      expect(ev.summary.length).toBeLessThanOrEqual(200);
    }
  });
});

// ── 나) timestamp conversion ──────────────────────────────────────────────────

describe("slack normalize: timestamp", () => {
  it("converts Slack ts (epoch.micro) to UTC ISO-8601", () => {
    const all = normalizeAll(loadRawMessages());
    const first = all.find((e) => e.id === "slack:C09INCIDENT:1699200180.000100")!;
    expect(first).toBeDefined();
    // 1699200180 s → 2023-11-05T16:03:00.000Z
    expect(first.timestamp).toBe("2023-11-05T16:03:00.000Z");
  });

  it("every timestamp is valid UTC ISO-8601 with offset", () => {
    const all = normalizeAll(loadRawMessages());
    for (const ev of all) {
      expect(new Date(ev.timestamp).toString()).not.toBe("Invalid Date");
      expect(ev.timestamp).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
    }
  });
});

// ── 다) BLAMELESS: no person leaks (core of 6.4) ──────────────────────────────

describe("slack normalize: no person leaks into the summary", () => {
  // A Slack mention like <@U012ABC> or <@U012ABC|handle>.
  const MENTION_RE = /<[@!][^>]*>/;
  // A bare Slack user/bot id (U…, W…, B…).
  const USER_ID_RE = /\b[UWB][A-Z0-9]{6,}\b/;

  it("leaves zero <@U...> mentions in any summary", () => {
    const all = normalizeAll(loadRawMessages());
    const offenders = all.filter((e) => MENTION_RE.test(e.summary));
    expect(offenders.map((e) => e.summary)).toEqual([]);
  });

  it("leaves zero Slack user ids in any summary", () => {
    const all = normalizeAll(loadRawMessages());
    const offenders = all.filter((e) => USER_ID_RE.test(e.summary));
    expect(offenders.map((e) => e.summary)).toEqual([]);
  });

  it("does not leak the specific fixture user ids", () => {
    const all = normalizeAll(loadRawMessages());
    const joined = all.map((e) => e.summary).join("\n");
    for (const uid of ["U01ALICE", "U02BOBBY", "U03CAROL", "U05DAVE"]) {
      expect(joined).not.toContain(uid);
    }
  });

  it("generalizes mentions to a neutral teammate token", () => {
    const all = normalizeAll(loadRawMessages());
    const recovered = all.find((e) => e.id === "slack:C09INCIDENT:1699200600.000500")!;
    // original text thanked two <@U...> mentions; both become "a teammate".
    expect(recovered.summary).toContain("a teammate");
    expect(recovered.summary).not.toMatch(MENTION_RE);
  });
});

// ── 라) redaction of secrets / emails ─────────────────────────────────────────

describe("slack normalize: redaction", () => {
  it("redacts an email address out of the summary", () => {
    const all = normalizeAll(loadRawMessages());
    const joined = all.map((e) => e.summary).join("\n");
    expect(joined).not.toContain("alice.kim@example.com");
    expect(joined).toContain("[REDACTED]");
  });

  it("redacts an API key and a Slack token out of the summary", () => {
    const all = normalizeAll(loadRawMessages());
    const secretsMsg = all.find((e) => e.id === "slack:C09INCIDENT:1699200300.000300")!;
    expect(secretsMsg.summary).not.toContain("sk-live-ABCD1234567890abcdef");
    expect(secretsMsg.summary).not.toContain("xoxb-FAKE-TOKEN-FOR-TESTS-ONLY");
  });
});

// ── invalid input handling ────────────────────────────────────────────────────

describe("slack normalize: invalid input", () => {
  it("drops a message with a non-numeric ts and returns null", () => {
    expect(
      slackConnector.normalize({ ts: "not-a-ts", text: "x", [SLACK_CHANNEL_FIELD]: CHANNEL }),
    ).toBeNull();
  });

  it("drops a malformed message (missing ts) and returns null", () => {
    expect(slackConnector.normalize({ text: "no ts here" })).toBeNull();
  });
});

// ── 마) isEnabled ─────────────────────────────────────────────────────────────

describe("slack connector: isEnabled", () => {
  it("is false when SLACK_BOT_TOKEN is absent", () => {
    expect(slackConnector.isEnabled({})).toBe(false);
  });

  it("is true when SLACK_BOT_TOKEN is present", () => {
    expect(slackConnector.isEnabled({ NECRO_MODE: "live", SLACK_BOT_TOKEN: "xoxb-test" })).toBe(
      true,
    );
  });

  it("has id 'slack'", () => {
    expect(slackConnector.id).toBe("slack");
  });
});
