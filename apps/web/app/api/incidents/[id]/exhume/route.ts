/**
 * POST /api/incidents/[id]/exhume
 *
 * Triggers the exhume orchestrator for the given incident.
 * Returns the full ExhumeResult once all connectors finish.
 *
 * Requirements: 2.1, 2.3, 2.4, 2.6
 */

import { NextRequest, NextResponse } from "next/server";
import { ensureDb } from "@/lib/db";
import { getIncidentById } from "@necro-ops/db";
import { exhume } from "@/lib/exhume";

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

  if (incident.status === "exhuming") {
    return NextResponse.json(
      { error: "Exhume already in progress" },
      { status: 409 },
    );
  }

  const window = {
    start: new Date(incident.startAt),
    end: new Date(incident.endAt),
    services: JSON.parse(incident.servicesJson) as string[],
  };

  const result = await exhume(id, window);

  return NextResponse.json(result, { status: 200 });
}
