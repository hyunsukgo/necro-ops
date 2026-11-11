/**
 * lib/incidents.ts — server-side data helpers for the UI pages.
 * These run in React Server Components, reading from the DB directly.
 */

import { ensureDb } from "@/lib/db";
import {
  listIncidents,
  getIncidentById,
  listEventsByIncident,
  getTimelineByIncident,
  getReportByIncident,
  listConnectorRunsByIncident,
} from "@necro-ops/db";
import type { Report, Cluster, TimelineEvent } from "@necro-ops/core";

export interface IncidentListItem {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  services: string[];
  status: string;
  createdAt: string;
}

export async function fetchIncidents(): Promise<IncidentListItem[]> {
  await ensureDb();
  const rows = await listIncidents();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    startAt: r.startAt,
    endAt: r.endAt,
    services: JSON.parse(r.servicesJson) as string[],
    status: r.status,
    createdAt: r.createdAt,
  }));
}

export interface IncidentDetail extends IncidentListItem {
  events: Array<Omit<TimelineEvent, "raw"> & { raw?: never }>;
  clusters: Cluster[];
  suspectedTriggerId: string | null;
  connectorRuns: Array<{
    connector: string;
    status: string;
    error: string | null;
    itemCount: number;
  }>;
  report: Report | null;
}

export async function fetchIncidentDetail(
  id: string,
): Promise<IncidentDetail | null> {
  await ensureDb();

  const incident = await getIncidentById(id);
  if (!incident) return null;

  const [eventRows, timelineRow, reportRow, runRows] = await Promise.all([
    listEventsByIncident(id),
    getTimelineByIncident(id),
    getReportByIncident(id),
    listConnectorRunsByIncident(id),
  ]);

  const events = eventRows.map((e) => ({
    id: e.id,
    source: e.source,
    timestamp: e.ts,
    kind: e.kind,
    severity: e.severity,
    entities: JSON.parse(e.entitiesJson) as TimelineEvent["entities"],
    summary: e.summary,
    link: e.link ?? undefined,
  })) as IncidentDetail["events"];

  return {
    id: incident.id,
    title: incident.title,
    startAt: incident.startAt,
    endAt: incident.endAt,
    services: JSON.parse(incident.servicesJson) as string[],
    status: incident.status,
    createdAt: incident.createdAt,
    events,
    clusters: timelineRow
      ? (JSON.parse(timelineRow.clustersJson) as Cluster[])
      : [],
    suspectedTriggerId: timelineRow?.suspectedTriggerId ?? null,
    connectorRuns: runRows.map((r) => ({
      connector: r.connector,
      status: r.status,
      error: r.error,
      itemCount: r.itemCount,
    })),
    report: reportRow ? (JSON.parse(reportRow.bodyJson) as Report) : null,
  };
}
