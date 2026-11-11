/**
 * lib/exhume.ts — Exhume orchestrator.
 *
 * Requirements:
 *   2.1 — Query every enabled connector for the incident window in parallel.
 *   2.3 — If a connector fails or times out (default 30 s), record the error,
 *          mark it `failed`, and continue.
 *   2.4 — If a connector has no credentials configured, mark it `skipped`.
 *   2.6 — Connectors perform read-only operations only.
 *   3.1 — normalize() each raw item; drop nulls with a warning.
 *   3.3 — dedupe() normalised events by id.
 *   4.1/4.2 — buildTimeline() to sort + cluster events.
 *   4.3 — findSuspectedTrigger() to flag the most-likely trigger.
 *
 * The orchestrator is a pure async function — no side effects beyond what
 * the caller passes in via the `persist` callbacks. This makes it testable.
 */

import crypto from "crypto";
import type { Connector, CollectWindow } from "@necro-ops/connectors";
import { mockConnector, datadogConnector, k8sConnector, terraformConnector, slackConnector } from "@necro-ops/connectors";
import {
  dedupe,
  buildTimeline,
  findSuspectedTrigger,
} from "@necro-ops/core";
import type { TimelineEvent } from "@necro-ops/core";
import {
  updateIncidentStatus,
  insertConnectorRun,
  updateConnectorRun,
  insertEvents,
  upsertTimeline,
} from "@necro-ops/db";
import type { NewEventRow } from "@necro-ops/db";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default per-connector timeout in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

// ── All registered connectors ─────────────────────────────────────────────────

const ALL_CONNECTORS: Connector[] = [mockConnector, datadogConnector, k8sConnector, terraformConnector, slackConnector];

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConnectorRunStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface ConnectorResult {
  connectorId: Connector["id"];
  status: ConnectorRunStatus;
  itemCount: number;
  error?: string;
}

export interface ExhumeResult {
  incidentId: string;
  connectorResults: ConnectorResult[];
  eventCount: number;
  clusterCount: number;
  suspectedTriggerId: string | undefined;
}

// ── Progress callback ─────────────────────────────────────────────────────────

/** Called whenever a connector's status changes. Used for SSE in task 5.3. */
export type OnProgress = (result: ConnectorResult) => void;

// ── Orchestrator ──────────────────────────────────────────────────────────────

/**
 * Run the exhume pipeline for a given incident.
 *
 * Steps:
 *   1. Mark incident as `exhuming`.
 *   2. For each connector: if disabled → skip; else run with timeout.
 *   3. All connectors run in parallel via Promise.allSettled.
 *   4. Collect all normalised events, dedupe, buildTimeline, findSuspectedTrigger.
 *   5. Persist events + timeline.
 *   6. Mark incident as `exhumed` (or `failed` if no events at all).
 */
export async function exhume(
  incidentId: string,
  window: CollectWindow,
  opts?: {
    timeoutMs?: number;
    env?: NodeJS.ProcessEnv;
    onProgress?: OnProgress;
    connectors?: Connector[]; // injectable for tests
  },
): Promise<ExhumeResult> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const env = opts?.env ?? process.env;
  const onProgress = opts?.onProgress;
  const connectors = opts?.connectors ?? ALL_CONNECTORS;

  // Step 1 — mark incident as exhuming
  await updateIncidentStatus(incidentId, "exhuming");

  // Step 2/3 — run all connectors in parallel
  const allNormalisedEvents: TimelineEvent[] = [];
  const connectorResults: ConnectorResult[] = [];

  const tasks = connectors.map(async (connector) => {
    // 2.4 — skip if not enabled
    if (!connector.isEnabled(env)) {
      const result: ConnectorResult = {
        connectorId: connector.id,
        status: "skipped",
        itemCount: 0,
      };
      connectorResults.push(result);
      onProgress?.(result);

      await insertConnectorRun({
        id: crypto.randomUUID(),
        incidentId,
        connector: connector.id,
        status: "skipped",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        itemCount: 0,
      });
      return;
    }

    // Mark running
    const runId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    await insertConnectorRun({
      id: runId,
      incidentId,
      connector: connector.id,
      status: "running",
      startedAt,
      itemCount: 0,
    });

    const runningResult: ConnectorResult = {
      connectorId: connector.id,
      status: "running",
      itemCount: 0,
    };
    onProgress?.(runningResult);

    // Per-connector AbortController for timeout
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);

    let itemCount = 0;
    try {
      const rawItems = await connector.collect(window, ac.signal);
      clearTimeout(timer);

      // normalize → drop nulls
      const normalised: TimelineEvent[] = [];
      for (const item of rawItems) {
        const ev = connector.normalize(item);
        if (ev !== null) normalised.push(ev);
      }
      itemCount = normalised.length;

      // Accumulate for global dedupe later
      allNormalisedEvents.push(...normalised);

      const doneResult: ConnectorResult = {
        connectorId: connector.id,
        status: "done",
        itemCount,
      };
      connectorResults.push(doneResult);
      onProgress?.(doneResult);

      await updateConnectorRun(runId, {
        status: "done",
        finishedAt: new Date().toISOString(),
        itemCount,
      });
    } catch (err: unknown) {
      clearTimeout(timer);

      const isTimeout =
        err instanceof Error && err.name === "AbortError";
      const message = isTimeout
        ? `Connector timed out after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : String(err);

      const failedResult: ConnectorResult = {
        connectorId: connector.id,
        status: "failed",
        itemCount,
        error: message,
      };
      connectorResults.push(failedResult);
      onProgress?.(failedResult);

      await updateConnectorRun(runId, {
        status: "failed",
        error: message,
        finishedAt: new Date().toISOString(),
        itemCount,
      });
    }
  });

  // allSettled so one rejection never kills the rest
  await Promise.allSettled(tasks);

  // Step 4 — dedupe + buildTimeline + findSuspectedTrigger
  const deduped = dedupe(allNormalisedEvents);
  const timeline = buildTimeline(deduped);
  const suspectedTriggerId = findSuspectedTrigger(timeline.events);

  // Step 5 — persist events
  if (deduped.length > 0) {
    const eventRows: NewEventRow[] = deduped.map((e) => ({
      id: e.id,
      incidentId,
      source: e.source,
      ts: e.timestamp,
      kind: e.kind,
      severity: e.severity,
      entitiesJson: JSON.stringify(e.entities),
      summary: e.summary,
      link: e.link ?? null,
      rawJson: JSON.stringify(e.raw),
    }));
    await insertEvents(eventRows);
  }

  // Persist timeline
  await upsertTimeline({
    incidentId,
    clustersJson: JSON.stringify(timeline.clusters),
    suspectedTriggerId: suspectedTriggerId ?? null,
    builtAt: new Date().toISOString(),
  });

  // Step 6 — update incident status
  const anyFailed = connectorResults.some((r) => r.status === "failed");
  const allSkipped = connectorResults.every((r) => r.status === "skipped");
  const finalStatus =
    allSkipped || (anyFailed && deduped.length === 0) ? "failed" : "exhumed";

  await updateIncidentStatus(incidentId, finalStatus);

  return {
    incidentId,
    connectorResults,
    eventCount: deduped.length,
    clusterCount: timeline.clusters.length,
    suspectedTriggerId,
  };
}
