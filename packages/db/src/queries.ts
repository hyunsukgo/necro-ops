/**
 * queries.ts — typed repository functions for the web app.
 *
 * All drizzle-orm imports are kept inside this package so callers
 * (e.g. the Next.js app) never need to depend on drizzle-orm directly.
 */

import { eq, desc } from "drizzle-orm";
import { getDb } from "./client.js";
import { incidents, events, timelines, connectorRuns, reports } from "./schema.js";
import type {
  IncidentRow,
  NewIncidentRow,
  EventRow,
  NewEventRow,
  TimelineRow,
  NewTimelineRow,
  ConnectorRunRow,
  NewConnectorRunRow,
  ReportRow,
  NewReportRow,
} from "./schema.js";

// ── incidents ─────────────────────────────────────────────────────────────────

export async function listIncidents(): Promise<IncidentRow[]> {
  return getDb().select().from(incidents).orderBy(desc(incidents.startAt));
}

export async function getIncidentById(
  id: string,
): Promise<IncidentRow | undefined> {
  const rows = await getDb()
    .select()
    .from(incidents)
    .where(eq(incidents.id, id))
    .limit(1);
  return rows[0];
}

export async function insertIncident(row: NewIncidentRow): Promise<void> {
  await getDb().insert(incidents).values(row);
}

export async function updateIncidentStatus(
  id: string,
  status: IncidentRow["status"],
): Promise<void> {
  await getDb()
    .update(incidents)
    .set({ status })
    .where(eq(incidents.id, id));
}

// ── events ────────────────────────────────────────────────────────────────────

export async function listEventsByIncident(
  incidentId: string,
): Promise<EventRow[]> {
  return getDb()
    .select()
    .from(events)
    .where(eq(events.incidentId, incidentId))
    .orderBy(events.ts);
}

export async function insertEvents(rows: NewEventRow[]): Promise<void> {
  if (rows.length === 0) return;
  // Insert in batches to avoid hitting SQLite's variable limit.
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    await getDb()
      .insert(events)
      .values(rows.slice(i, i + BATCH))
      .onConflictDoNothing();
  }
}

// ── timelines ─────────────────────────────────────────────────────────────────

export async function getTimelineByIncident(
  incidentId: string,
): Promise<TimelineRow | undefined> {
  const rows = await getDb()
    .select()
    .from(timelines)
    .where(eq(timelines.incidentId, incidentId))
    .limit(1);
  return rows[0];
}

export async function upsertTimeline(row: NewTimelineRow): Promise<void> {
  await getDb()
    .insert(timelines)
    .values(row)
    .onConflictDoUpdate({
      target: timelines.incidentId,
      set: {
        clustersJson: row.clustersJson,
        suspectedTriggerId: row.suspectedTriggerId,
        builtAt: row.builtAt,
      },
    });
}

// ── connector_runs ────────────────────────────────────────────────────────────

export async function listConnectorRunsByIncident(
  incidentId: string,
): Promise<ConnectorRunRow[]> {
  return getDb()
    .select()
    .from(connectorRuns)
    .where(eq(connectorRuns.incidentId, incidentId));
}

export async function insertConnectorRun(
  row: NewConnectorRunRow,
): Promise<void> {
  await getDb().insert(connectorRuns).values(row);
}

export async function updateConnectorRun(
  id: string,
  patch: Partial<
    Pick<
      ConnectorRunRow,
      "status" | "error" | "startedAt" | "finishedAt" | "itemCount"
    >
  >,
): Promise<void> {
  await getDb()
    .update(connectorRuns)
    .set(patch)
    .where(eq(connectorRuns.id, id));
}

// ── reports ───────────────────────────────────────────────────────────────────

export async function getReportByIncident(
  incidentId: string,
): Promise<ReportRow | undefined> {
  const rows = await getDb()
    .select()
    .from(reports)
    .where(eq(reports.incidentId, incidentId))
    .limit(1);
  return rows[0];
}

export async function upsertReport(row: NewReportRow): Promise<void> {
  await getDb()
    .insert(reports)
    .values(row)
    .onConflictDoUpdate({
      target: reports.incidentId,
      set: {
        bodyJson: row.bodyJson,
        isDraft: row.isDraft,
        generatedBy: row.generatedBy,
        updatedAt: row.updatedAt,
      },
    });
}
