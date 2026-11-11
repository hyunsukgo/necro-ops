/**
 * GET /api/incidents/[id]/exhume/stream
 *
 * Server-Sent Events endpoint for real-time exhume progress.
 *
 * Requirement 2.2 — WHILE collection is running the system SHALL show
 * per-connector progress (pending / running / done / failed / skipped).
 *
 * Event stream format (each line is one SSE message):
 *
 *   event: progress
 *   data: {"connectorId":"mock","status":"running","itemCount":0}
 *
 *   event: progress
 *   data: {"connectorId":"mock","status":"done","itemCount":35}
 *
 *   event: complete
 *   data: {"incidentId":"...","eventCount":35,"clusterCount":6,"suspectedTriggerId":"terraform:tf-oom-002"}
 *
 *   event: error
 *   data: {"error":"Incident not found"}
 *
 * The connection is closed by the server after the `complete` or `error` event.
 *
 * Triggering behaviour:
 *   - If the incident is already `exhumed` or `autopsied`, re-runs the exhume
 *     pipeline (allows the user to refresh evidence).
 *   - If the incident is currently `exhuming`, returns 409 immediately (before
 *     the SSE handshake) to prevent duplicate runs.
 */

import { NextRequest } from "next/server";
import { ensureDb } from "@/lib/db";
import { getIncidentById } from "@necro-ops/db";
import { exhume } from "@/lib/exhume";
import type { ConnectorResult } from "@/lib/exhume";

// ── SSE helpers ───────────────────────────────────────────────────────────────

/** Encode a single SSE message frame. */
function sseMessage(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await ensureDb();

  const incident = await getIncidentById(id);
  if (!incident) {
    // Return a plain JSON 404 before upgrading to SSE — client hasn't
    // subscribed yet so a regular response is fine.
    return new Response(JSON.stringify({ error: "Incident not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (incident.status === "exhuming") {
    return new Response(
      JSON.stringify({ error: "Exhume already in progress" }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  const window = {
    start: new Date(incident.startAt),
    end: new Date(incident.endAt),
    services: JSON.parse(incident.servicesJson) as string[],
  };

  // ── Build a ReadableStream that drives the exhume pipeline ────────────────

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();

      function push(event: string, data: unknown) {
        controller.enqueue(enc.encode(sseMessage(event, data)));
      }

      const onProgress = (result: ConnectorResult) => {
        push("progress", result);
      };

      try {
        const result = await exhume(id, window, { onProgress });
        push("complete", result);
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unexpected error during exhume";
        push("error", { error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Needed for Next.js edge/node streaming
      "X-Accel-Buffering": "no",
    },
  });
}
