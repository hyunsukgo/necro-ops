/**
 * bedrock.test.ts — unit tests for the autopsy generate() function.
 *
 * Requirements 5.1, 5.2, 5.3, 5.4, 9.2:
 *   5.4 — No credentials → template fallback immediately.
 *   5.4 — Bedrock fails twice → template fallback.
 *   5.2 — Invalid citation ids → retry then fallback.
 *   9.2 — Prompt never contains raw payloads (only summary fields).
 *
 * We use dependency injection (_sendFn) to avoid real AWS calls.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  TimelineEventSchema,
  buildTimeline,
  findSuspectedTrigger,
} from "@necro-ops/core";
import type { Timeline } from "@necro-ops/core";
import { generate } from "./bedrock.js";
import { LlmReportSchema } from "./schema.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCENARIOS_DIR = join(__dirname, "../../../fixtures/scenarios");

function loadTimeline(scenarioName: string): Timeline {
  const eventsPath = join(SCENARIOS_DIR, scenarioName, "events.json");
  const raw = JSON.parse(readFileSync(eventsPath, "utf-8")) as unknown;
  const events = z.array(TimelineEventSchema).parse(raw);
  const tl = buildTimeline(events as Parameters<typeof buildTimeline>[0]);
  return { ...tl, suspectedTriggerId: findSuspectedTrigger(tl.events) };
}

const FIXED_NOW = "2024-10-15T04:00:00.000Z";

const BASE_INCIDENT = {
  id: "inc-test",
  title: "Payments OOMKill",
  startAt: "2024-10-15T01:18:00.000Z",
  endAt: "2024-10-15T03:17:00.000Z",
  services: ["payments"],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

type SendFn = NonNullable<Parameters<typeof generate>[2]>["_sendFn"];

function makeSuccessSendFn(payload: unknown): SendFn {
  return vi.fn().mockResolvedValue({
    body: new TextEncoder().encode(
      JSON.stringify({ content: [{ text: JSON.stringify(payload) }] }),
    ),
  });
}

function makeFailingSendFn(message: string): SendFn {
  return vi.fn().mockRejectedValue(new Error(message));
}

function makeValidLlmOutput(eventIds: string[]) {
  return {
    summary: "Test summary from Bedrock.",
    causeOfDeath: [
      { text: "Root cause from LLM.", citations: [eventIds[0]!] },
    ],
    contributingFactors: [
      {
        text: "Contributing factor.",
        citations: [eventIds[1] ?? eventIds[0]!],
      },
    ],
    impact: "Impact description.",
    detectionAndResponse: "Detection and response.",
    actionItems: [{ title: "Add monitoring", type: "detect", priority: "P2" }],
  };
}

const BEDROCK_ENV: NodeJS.ProcessEnv = {
  AWS_ACCESS_KEY_ID: "test-key",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  AWS_REGION: "us-east-1",
  BEDROCK_MODEL_ID: "anthropic.claude-3-5-sonnet-20241022-v2:0",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("generate() — no credentials → template fallback (Req 5.4)", () => {
  it("returns a template report when env has no AWS credentials", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");

    const report = await generate(BASE_INCIDENT, timeline, {
      env: {},
      now: FIXED_NOW,
    });

    expect(report.generatedBy).toBe("template");
    expect(report.isDraft).toBe(true);
  });
});

describe("generate() — successful Bedrock call", () => {
  it("returns a bedrock report when LLM succeeds on first attempt", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const eventIds = timeline.events.map((e) => e.id);
    const sendFn = makeSuccessSendFn(makeValidLlmOutput(eventIds));

    const report = await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn,
    });

    expect(report.generatedBy).toBe("bedrock");
    expect(report.summary).toBe("Test summary from Bedrock.");
    expect(report.isDraft).toBe(true);
    expect(report.incidentId).toBe(BASE_INCIDENT.id);
    expect(sendFn).toHaveBeenCalledOnce();
  });

  it("timeline markdown is always the deterministic table (not from LLM)", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const eventIds = timeline.events.map((e) => e.id);
    const sendFn = makeSuccessSendFn(makeValidLlmOutput(eventIds));

    const report = await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn,
    });

    expect(report.timeline).toContain("| Time (UTC) |");
    expect(report.timeline).toContain("| Source |");
  });
});

describe("generate() — retry then fallback (Req 5.4)", () => {
  it("retries once and falls back to template when both Bedrock calls fail", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const sendFn = makeFailingSendFn("Service unavailable");

    const report = await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn,
    });

    expect(report.generatedBy).toBe("template");
    expect(sendFn).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the second attempt without falling back", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const eventIds = timeline.events.map((e) => e.id);
    const sendFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("Transient error"))
      .mockResolvedValueOnce({
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: JSON.stringify(makeValidLlmOutput(eventIds)) }],
          }),
        ),
      });

    const report = await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn as SendFn,
    });

    expect(report.generatedBy).toBe("bedrock");
    expect(sendFn).toHaveBeenCalledTimes(2);
  });
});

describe("generate() — citation validation (Req 5.2)", () => {
  it("falls back to template when LLM returns invalid citation ids (both attempts)", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");

    const badOutput = {
      summary: "Summary.",
      causeOfDeath: [
        { text: "Cause.", citations: ["nonexistent:event-id-xyz"] },
      ],
      contributingFactors: [
        { text: "Factor.", citations: ["another:fake-id"] },
      ],
      impact: "Impact.",
      detectionAndResponse: "Detection.",
      actionItems: [{ title: "Fix it", type: "prevent", priority: "P1" }],
    };

    const sendFn = makeSuccessSendFn(badOutput);

    const report = await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn,
    });

    expect(report.generatedBy).toBe("template");
    expect(sendFn).toHaveBeenCalledTimes(2);
  });
});

describe("generate() — JSON parse failure → fallback (Req 5.4)", () => {
  it("falls back to template when LLM returns non-JSON", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");

    const sendFn: SendFn = vi.fn().mockResolvedValue({
      body: new TextEncoder().encode(
        JSON.stringify({ content: [{ text: "Not JSON at all!" }] }),
      ),
    });

    const report = await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn,
    });

    expect(report.generatedBy).toBe("template");
  });
});

describe("generate() — prompt content (Req 9.2)", () => {
  it("prompt does NOT contain raw payload fields from fixture events", async () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const eventIds = timeline.events.map((e) => e.id);

    let capturedBody: Uint8Array | undefined;
    const sendFn: SendFn = vi.fn().mockImplementation(
      async (input: { body: Uint8Array }) => {
        capturedBody = input.body;
        return {
          body: new TextEncoder().encode(
            JSON.stringify({
              content: [
                { text: JSON.stringify(makeValidLlmOutput(eventIds)) },
              ],
            }),
          ),
        };
      },
    );

    await generate(BASE_INCIDENT, timeline, {
      env: BEDROCK_ENV,
      now: FIXED_NOW,
      _sendFn: sendFn,
    });

    expect(capturedBody).toBeDefined();
    const bodyText = new TextDecoder().decode(capturedBody);
    const parsedBody = JSON.parse(bodyText) as {
      messages: Array<{ content: string }>;
    };
    const promptText = parsedBody.messages[0]?.content ?? "";

    // Raw payload fields from the OOM fixture must NOT appear in the prompt
    expect(promptText).not.toContain("run-tf-oom-001"); // raw.run_id
    expect(promptText).not.toContain("monitor_id"); // raw.monitor_id
    expect(promptText).not.toContain("anon-rss"); // raw k8s message

    // But the event summaries SHOULD be present
    expect(promptText).toContain("payments");
  });
});

describe("LlmReportSchema", () => {
  it("rejects output missing required sections", () => {
    const result = LlmReportSchema.safeParse({ summary: "only this" });
    expect(result.success).toBe(false);
  });

  it("rejects causeOfDeath entries with empty citations array", () => {
    const result = LlmReportSchema.safeParse({
      summary: "s",
      causeOfDeath: [{ text: "t", citations: [] }],
      contributingFactors: [{ text: "t", citations: ["x"] }],
      impact: "i",
      detectionAndResponse: "d",
      actionItems: [{ title: "a", type: "prevent", priority: "P1" }],
    });
    expect(result.success).toBe(false);
  });

  it("accepts a fully valid LLM output shape", () => {
    const result = LlmReportSchema.safeParse({
      summary: "Summary.",
      causeOfDeath: [{ text: "Cause.", citations: ["mock:event-1"] }],
      contributingFactors: [{ text: "Factor.", citations: ["mock:event-2"] }],
      impact: "Impact.",
      detectionAndResponse: "Detection.",
      actionItems: [{ title: "Fix it", type: "mitigate", priority: "P2" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects actionItems with invalid type value", () => {
    const result = LlmReportSchema.safeParse({
      summary: "s",
      causeOfDeath: [{ text: "t", citations: ["x"] }],
      contributingFactors: [{ text: "t", citations: ["x"] }],
      impact: "i",
      detectionAndResponse: "d",
      actionItems: [{ title: "a", type: "blame", priority: "P1" }],
    });
    expect(result.success).toBe(false);
  });
});
