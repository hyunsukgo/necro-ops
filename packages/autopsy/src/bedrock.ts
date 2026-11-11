/**
 * bedrock.ts — Amazon Bedrock client for autopsy report generation.
 *
 * Requirements 5.1, 5.2, 5.3, 5.4, 9.2:
 *   5.1 — Generate a report with all required sections.
 *   5.2 — Every causeOfDeath / contributingFactor statement must cite ≥1 event
 *          id; cited ids must exist in the timeline (checked post-parse).
 *   5.3 — Report uses blameless language (enforced by the prompt).
 *   5.4 — Retry once on failure; fall back to templateReport on second failure.
 *   9.2 — Raw payloads are never sent to the LLM; the prompt contains only
 *          condensed event summaries.
 *
 * Bedrock is enabled when AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and
 * AWS_REGION are set. The model is controlled by BEDROCK_MODEL_ID.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Timeline, Report, Incident } from "@necro-ops/core";
import { LlmReportSchema } from "./schema.js";
import { templateReport } from "./template.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROMPT_PATH = join(__dirname, "../prompts/autopsy.md");

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBedrockConfigured(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env["AWS_ACCESS_KEY_ID"] &&
      env["AWS_SECRET_ACCESS_KEY"] &&
      env["AWS_REGION"],
  );
}

/** Format an event for the prompt — summary only, no raw payload (Req 9.2). */
function formatEventForPrompt(e: {
  id: string;
  timestamp: string;
  source: string;
  kind: string;
  severity: string;
  summary: string;
}): string {
  return `[${e.id}] ${e.timestamp} | ${e.source} | ${e.kind} | ${e.severity} | ${e.summary}`;
}

/** Build the filled-in prompt string. */
function buildPrompt(
  incident: Pick<Incident, "id" | "title" | "startAt" | "endAt" | "services">,
  timeline: Timeline,
): string {
  const template = readFileSync(PROMPT_PATH, "utf-8");

  const incidentMeta = JSON.stringify(
    {
      title: incident.title,
      startAt: incident.startAt,
      endAt: incident.endAt,
      services: incident.services,
    },
    null,
    2,
  );

  const suspectedTrigger = timeline.suspectedTriggerId ?? "none";

  const timelineEvents = timeline.events
    .map(formatEventForPrompt)
    .join("\n");

  return template
    .replace("{{INCIDENT_METADATA}}", incidentMeta)
    .replace("{{SUSPECTED_TRIGGER}}", suspectedTrigger)
    .replace("{{EVENT_COUNT}}", String(timeline.events.length))
    .replace("{{TIMELINE_EVENTS}}", timelineEvents);
}

/** Validate that every citation id exists in the timeline events. */
function validateCitations(
  report: { causeOfDeath: Array<{ citations: string[] }>; contributingFactors: Array<{ citations: string[] }> },
  eventIds: Set<string>,
): string | null {
  const allCitations = [
    ...report.causeOfDeath.flatMap((c) => c.citations),
    ...report.contributingFactors.flatMap((c) => c.citations),
  ];
  const invalid = allCitations.filter((id) => !eventIds.has(id));
  if (invalid.length > 0) {
    return `Invalid citation ids: ${invalid.join(", ")}`;
  }
  return null;
}

/** Strip optional markdown code fences the model may wrap JSON in. */
function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
}

/** Invoke Bedrock once and return the parsed LLM output, or throw on failure. */
async function invokeOnce(
  sendFn: (input: {
    modelId: string;
    body: Uint8Array;
    contentType: string;
    accept: string;
  }) => Promise<{ body: Uint8Array }>,
  modelId: string,
  prompt: string,
): Promise<ReturnType<typeof LlmReportSchema.parse>> {
  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const response = await sendFn({
    modelId,
    body: new TextEncoder().encode(body),
    contentType: "application/json",
    accept: "application/json",
  });

  const responseBody = JSON.parse(
    new TextDecoder().decode(response.body),
  ) as { content?: Array<{ text?: string }> };

  const rawText = responseBody.content?.[0]?.text ?? "";
  const cleaned = stripFences(rawText);
  return LlmReportSchema.parse(JSON.parse(cleaned));
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  /** Override process.env for testability. */
  env?: NodeJS.ProcessEnv;
  /** Current timestamp, injected for determinism. Defaults to new Date().toISOString(). */
  now?: string;
  /**
   * Optional send function override — used in tests to inject a mock instead
   * of a real BedrockRuntimeClient. Receives the InvokeModelCommand input and
   * returns the response shape.
   */
  _sendFn?: (input: {
    modelId: string;
    body: Uint8Array;
    contentType: string;
    accept: string;
  }) => Promise<{ body: Uint8Array }>;
}

/**
 * Generate an autopsy report for the given incident and timeline.
 *
 * Strategy:
 *   1. If Bedrock is not configured → use templateReport immediately.
 *   2. Try Bedrock once.
 *   3. If it fails → retry once.
 *   4. If both attempts fail → fall back to templateReport (Req 5.4).
 *
 * Raw event payloads are never sent to the LLM (Req 9.2).
 */
export async function generate(
  incident: Pick<Incident, "id" | "title" | "startAt" | "endAt" | "services">,
  timeline: Timeline,
  opts: GenerateOptions = {},
): Promise<Report> {
  const env = opts.env ?? process.env;
  const now = opts.now ?? new Date().toISOString();

  // Fast path: no credentials → template
  if (!isBedrockConfigured(env) && !opts._sendFn) {
    return templateReport(incident, timeline, now);
  }

  const modelId =
    env["BEDROCK_MODEL_ID"] ??
    "anthropic.claude-3-5-sonnet-20241022-v2:0";
  const region = env["AWS_REGION"] ?? "us-east-1";

  // Build the real client only when no override is provided
  const sendFn: (input: {
    modelId: string;
    body: Uint8Array;
    contentType: string;
    accept: string;
  }) => Promise<{ body: Uint8Array }> =
    opts._sendFn ??
    (async (input) => {
      const client = new BedrockRuntimeClient({
        region,
        credentials: {
          accessKeyId: env["AWS_ACCESS_KEY_ID"]!,
          secretAccessKey: env["AWS_SECRET_ACCESS_KEY"]!,
          ...(env["AWS_SESSION_TOKEN"]
            ? { sessionToken: env["AWS_SESSION_TOKEN"] }
            : {}),
        },
      });
      const command = new InvokeModelCommand(input);
      return client.send(command) as Promise<{ body: Uint8Array }>;
    });

  const prompt = buildPrompt(incident, timeline);
  const eventIds = new Set(timeline.events.map((e) => e.id));

  // Try up to 2 times (Req 5.4)
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const llmOutput = await invokeOnce(sendFn, modelId, prompt);

      // Validate citation existence (Req 5.2)
      const citationError = validateCitations(llmOutput, eventIds);
      if (citationError) {
        throw new Error(`Citation validation failed: ${citationError}`);
      }

      // Build the timeline markdown from our deterministic helper (same as template)
      const tmplReport = templateReport(incident, timeline, now);

      return {
        incidentId: incident.id,
        summary: llmOutput.summary,
        causeOfDeath: llmOutput.causeOfDeath,
        contributingFactors: llmOutput.contributingFactors,
        timeline: tmplReport.timeline, // always use our deterministic table
        impact: llmOutput.impact,
        detectionAndResponse: llmOutput.detectionAndResponse,
        actionItems: llmOutput.actionItems,
        isDraft: true,
        generatedBy: "bedrock",
        updatedAt: now,
      };
    } catch (err) {
      lastError = err;
      console.warn(
        `[autopsy] Bedrock attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Both attempts failed → fall back to template (Req 5.4)
  console.warn(
    `[autopsy] Bedrock unavailable after 2 attempts, falling back to template. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
  return templateReport(incident, timeline, now);
}
