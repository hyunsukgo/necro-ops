// Demo-mode seed: loads fixture scenarios into the DB when the incidents table
// is empty. Safe to call on every startup — it is a no-op if data exists.

import { count } from "drizzle-orm";
import { getDb } from "./client.js";
import { incidents, events, timelines } from "./schema.js";
import type {
  NewIncidentRow,
  NewEventRow,
  NewTimelineRow,
} from "./schema.js";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  TimelineEventSchema,
  buildTimeline,
  findSuspectedTrigger,
} from "@necro-ops/core";
import { z } from "zod";

// ── Fixture types (mirrors the fixture JSON shape) ───────────────────────────

interface ScenarioMetadata {
  id: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  services: string[];
}

// ── Resolve fixture paths ────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Walk up from packages/db/src → monorepo root → fixtures/
const fixturesRoot = path.resolve(__dirname, "../../../fixtures/scenarios");

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

// ── Core seed logic ──────────────────────────────────────────────────────────

/**
 * Seed demo scenarios.
 * In "demo" mode (NECRO_MODE=demo or absent), automatically seeds when the
 * incidents table is empty. In "live" mode, does nothing unless `force` is set.
 */
export async function seedDemoScenarios(opts?: { force?: boolean }): Promise<void> {
  const mode = process.env["NECRO_MODE"] ?? "demo";
  if (mode !== "demo" && !opts?.force) {
    return;
  }

  const db = getDb();

  // Check whether any incidents exist.
  const countResult = await db
    .select({ value: count() })
    .from(incidents);

  const existingCount = countResult[0]?.value ?? 0;

  if (existingCount > 0 && !opts?.force) {
    // Already seeded — nothing to do.
    return;
  }

  // Load the scenario index.
  let scenarioIds: string[];
  try {
    scenarioIds = readJson<string[]>(path.join(fixturesRoot, "index.json"));
  } catch {
    console.warn("[seed] Could not read fixtures/scenarios/index.json — skipping seed.");
    return;
  }

  for (const scenarioId of scenarioIds) {
    const scenarioDir = path.join(fixturesRoot, scenarioId);

    let metadata: ScenarioMetadata;
    let parsedEvents: z.infer<typeof TimelineEventSchema>[];
    try {
      metadata = readJson<ScenarioMetadata>(path.join(scenarioDir, "metadata.json"));
      const rawEvents = readJson<unknown[]>(path.join(scenarioDir, "events.json"));
      parsedEvents = z.array(TimelineEventSchema).parse(rawEvents);
    } catch (err) {
      console.warn(`[seed] Skipping scenario "${scenarioId}" — missing or invalid data: ${String(err)}`);
      continue;
    }

    // ── Insert incident ──────────────────────────────────────────────────────

    const incidentRow: NewIncidentRow = {
      id: metadata.id,
      title: metadata.title,
      startAt: metadata.startAt,
      endAt: metadata.endAt,
      servicesJson: JSON.stringify(metadata.services),
      status: "exhumed",
      createdAt: new Date().toISOString(),
    };

    await db.insert(incidents).values(incidentRow).onConflictDoNothing();

    // ── Insert events ────────────────────────────────────────────────────────

    const eventRows: NewEventRow[] = parsedEvents.map((e) => ({
      id: e.id,
      incidentId: metadata.id,
      source: e.source,
      ts: e.timestamp,
      kind: e.kind,
      severity: e.severity,
      entitiesJson: JSON.stringify(e.entities),
      summary: e.summary,
      link: e.link ?? null,
      rawJson: JSON.stringify(e.raw),
    }));

    if (eventRows.length > 0) {
      await db.insert(events).values(eventRows).onConflictDoNothing();
    }

    // ── Build and insert timeline using core functions ────────────────────────
    // Uses the same buildTimeline + findSuspectedTrigger as the golden tests,
    // so the seeded data is always consistent with tested expectations.

    const timeline = buildTimeline(parsedEvents as Parameters<typeof buildTimeline>[0]);
    const suspectedTriggerId = findSuspectedTrigger(timeline.events);

    const timelineRow: NewTimelineRow = {
      incidentId: metadata.id,
      clustersJson: JSON.stringify(timeline.clusters),
      suspectedTriggerId: suspectedTriggerId ?? null,
      builtAt: new Date().toISOString(),
    };

    await db.insert(timelines).values(timelineRow).onConflictDoNothing();

    console.log(
      `[seed] Seeded scenario "${scenarioId}" — ${eventRows.length} events, ${timeline.clusters.length} clusters.`
    );
  }
}
