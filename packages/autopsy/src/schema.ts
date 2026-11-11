/**
 * schema.ts — Zod schema for the Bedrock LLM output.
 *
 * Requirement 5.2: every statement in causeOfDeath and contributingFactors
 * must cite at least one event id. The citation-existence check (against the
 * actual timeline) is done in bedrock.ts after parsing.
 */

import { z } from "zod";

export const LlmCitedStatementSchema = z.object({
  text: z.string().min(1),
  citations: z.array(z.string().min(1)).min(1),
});

export const LlmActionItemSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["prevent", "detect", "mitigate"]),
  priority: z.enum(["P1", "P2", "P3"]),
});

/**
 * Schema for the raw JSON the LLM returns.
 * Does NOT include incidentId / isDraft / generatedBy / updatedAt —
 * those are added by the caller.
 */
export const LlmReportSchema = z.object({
  summary: z.string().min(1),
  causeOfDeath: z.array(LlmCitedStatementSchema).min(1),
  contributingFactors: z.array(LlmCitedStatementSchema).min(1),
  impact: z.string().min(1),
  detectionAndResponse: z.string().min(1),
  actionItems: z.array(LlmActionItemSchema).min(1),
});

export type LlmReport = z.infer<typeof LlmReportSchema>;
