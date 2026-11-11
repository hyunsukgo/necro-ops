/**
 * POST /api/incidents — create a new incident.
 * GET  /api/incidents — list all incidents, newest first (Req 1.4).
 *
 * Requirements:
 *   1.1 — Create incident with title, startAt, endAt, services → status pending.
 *   1.2 — Reject if endAt ≤ startAt with a 422 and a validation message.
 *   1.3 — Automatically extend the collection window by padding.
 *   1.4 — List incidents sorted by start_at desc.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import crypto from "crypto";
import { ensureDb } from "@/lib/db";
import { listIncidents, insertIncident } from "@necro-ops/db";
import { padWindow } from "@/lib/window";

// ── Request schema ────────────────────────────────────────────────────────────

const CreateIncidentSchema = z.object({
  title: z.string().min(1, "title is required").max(200),
  startAt: z.string().datetime({ message: "startAt must be a UTC ISO-8601 datetime" }),
  endAt: z.string().datetime({ message: "endAt must be a UTC ISO-8601 datetime" }),
  services: z
    .array(z.string().min(1))
    .min(1, "at least one service name is required"),
});

// ── POST ──────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Ensure DB is migrated and seeded before any query.
  await ensureDb();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Validate shape.
  const parsed = CreateIncidentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const { title, startAt, endAt, services } = parsed.data;

  // Req 1.2 — end must be strictly after start.
  if (new Date(endAt).getTime() <= new Date(startAt).getTime()) {
    return NextResponse.json(
      { error: "endAt must be after startAt" },
      { status: 422 },
    );
  }

  // Req 1.3 — extend the collection window with padding.
  const padded = padWindow(new Date(startAt), new Date(endAt));

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await insertIncident({
    id,
    title,
    startAt: padded.start.toISOString(),
    endAt: padded.end.toISOString(),
    servicesJson: JSON.stringify(services),
    status: "pending",
    createdAt: now,
  });

  return NextResponse.json(
    {
      id,
      title,
      startAt: padded.start.toISOString(),
      endAt: padded.end.toISOString(),
      services,
      status: "pending",
      createdAt: now,
    },
    { status: 201 },
  );
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  await ensureDb();

  const rows = await listIncidents();

  return NextResponse.json(
    rows.map((r) => ({
      id: r.id,
      title: r.title,
      startAt: r.startAt,
      endAt: r.endAt,
      services: JSON.parse(r.servicesJson) as string[],
      status: r.status,
      createdAt: r.createdAt,
    })),
  );
}
