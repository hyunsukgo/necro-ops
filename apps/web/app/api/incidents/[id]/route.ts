/**
 * GET /api/incidents/[id] — fetch a single incident with its events and timeline.
 *
 * Returns 404 when the incident does not exist.
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import {
  getIncidentById,
  listEventsByIncident,
  getTimelineByIncident,
} from "@necro-ops/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await ensureDb();

  const incident = await getIncidentById(id);
  if (!incident) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }

  const incidentEvents = await listEventsByIncident(id);
  const timeline = await getTimelineByIncident(id);

  return NextResponse.json({
    id: incident.id,
    title: incident.title,
    startAt: incident.startAt,
    endAt: incident.endAt,
    services: JSON.parse(incident.servicesJson) as string[],
    status: incident.status,
    createdAt: incident.createdAt,
    events: incidentEvents.map((e) => ({
      id: e.id,
      source: e.source,
      timestamp: e.ts,
      kind: e.kind,
      severity: e.severity,
      entities: JSON.parse(e.entitiesJson) as unknown[],
      summary: e.summary,
      link: e.link ?? null,
    })),
    timeline: timeline
      ? {
          clusters: JSON.parse(timeline.clustersJson) as unknown[],
          suspectedTriggerId: timeline.suspectedTriggerId ?? null,
          builtAt: timeline.builtAt,
        }
      : null,
  });
}
