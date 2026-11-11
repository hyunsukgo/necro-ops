/**
 * POST /api/incidents/[id]/autopsy
 *
 * Generate an autopsy report for the incident.
 * Uses Bedrock when configured, falls back to the template generator.
 * Saves the result to the DB as a draft report.
 *
 * Requirements: 5.1, 5.4, 5.6
 *   5.6 — Report is marked as AI-generated draft until the user saves it.
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import {
  getIncidentById,
  getTimelineByIncident,
  listEventsByIncident,
  upsertReport,
  updateIncidentStatus,
} from "@necro-ops/db";
import { generate } from "@necro-ops/autopsy";
import type { Timeline } from "@necro-ops/core";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await ensureDb();

  const incident = await getIncidentById(id);
  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  if (incident.status === "pending" || incident.status === "exhuming") {
    return NextResponse.json(
      { error: "Incident must be exhumed before autopsy can be performed" },
      { status: 409 },
    );
  }

  // Load the timeline; fall back to rebuilding from events if not stored yet
  const timelineRow = await getTimelineByIncident(id);
  const eventRows = await listEventsByIncident(id);

  const events = eventRows.map((e) => ({
    id: e.id,
    source: e.source,
    timestamp: e.ts,
    kind: e.kind,
    severity: e.severity,
    entities: JSON.parse(e.entitiesJson) as Timeline["events"][number]["entities"],
    summary: e.summary,
    link: e.link ?? undefined,
    raw: null, // raw is not needed for report generation
  }));

  const timeline: Timeline = {
    events: events as Timeline["events"],
    clusters: timelineRow
      ? (JSON.parse(timelineRow.clustersJson) as Timeline["clusters"])
      : [],
    suspectedTriggerId: timelineRow?.suspectedTriggerId ?? undefined,
  };

  const incidentMeta = {
    id: incident.id,
    title: incident.title,
    startAt: incident.startAt,
    endAt: incident.endAt,
    services: JSON.parse(incident.servicesJson) as string[],
  };

  const now = new Date().toISOString();
  const report = await generate(incidentMeta, timeline, { now });

  // Persist the report as a draft (Req 5.6)
  await upsertReport({
    incidentId: id,
    bodyJson: JSON.stringify(report),
    isDraft: true,
    generatedBy: report.generatedBy,
    updatedAt: now,
  });

  // Advance incident status to autopsied
  await updateIncidentStatus(id, "autopsied");

  return NextResponse.json(report, { status: 201 });
}
