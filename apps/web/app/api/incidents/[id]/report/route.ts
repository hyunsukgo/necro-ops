/**
 * GET /api/incidents/[id]/report — fetch the current report.
 * PUT /api/incidents/[id]/report — save user edits (clears isDraft).
 *
 * Requirements: 5.5, 5.6
 *   5.5 — User can edit any section and save the edited version.
 *   5.6 — Report is marked as draft until a user saves it.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureDb } from "@/lib/db";
import { getReportByIncident, upsertReport } from "@necro-ops/db";
import type { Report } from "@necro-ops/core";

// ── Zod schema for partial edits ──────────────────────────────────────────────

const CitedStatementSchema = z.object({
  text: z.string().min(1),
  citations: z.array(z.string().min(1)).min(1),
});

const ActionItemSchema = z.object({
  title: z.string().min(1),
  type: z.enum(["prevent", "detect", "mitigate"]),
  priority: z.enum(["P1", "P2", "P3"]),
});

// All fields are optional so the user can patch just the sections they want
const EditReportSchema = z.object({
  summary: z.string().min(1).optional(),
  causeOfDeath: z.array(CitedStatementSchema).min(1).optional(),
  contributingFactors: z.array(CitedStatementSchema).min(1).optional(),
  timeline: z.string().optional(),
  impact: z.string().min(1).optional(),
  detectionAndResponse: z.string().min(1).optional(),
  actionItems: z.array(ActionItemSchema).min(1).optional(),
});

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await ensureDb();

  const row = await getReportByIncident(id);
  if (!row) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  const body = JSON.parse(row.bodyJson) as Report;
  return NextResponse.json({ ...body, isDraft: row.isDraft });
}

// ── PUT ───────────────────────────────────────────────────────────────────────

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await ensureDb();

  const row = await getReportByIncident(id);
  if (!row) {
    return NextResponse.json({ error: "Report not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = EditReportSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const existing = JSON.parse(row.bodyJson) as Report;
  const updated: Report = {
    ...existing,
    ...parsed.data,
    // Saving always clears the draft flag (Req 5.6)
    isDraft: false,
    generatedBy: "user",
    updatedAt: new Date().toISOString(),
  };

  await upsertReport({
    incidentId: id,
    bodyJson: JSON.stringify(updated),
    isDraft: false,
    generatedBy: "user",
    updatedAt: updated.updatedAt,
  });

  return NextResponse.json(updated);
}
