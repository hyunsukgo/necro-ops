/**
 * queries.test.ts — unit tests for the repository query functions.
 *
 * Uses an in-memory SQLite database (via better-sqlite3 file path ":memory:")
 * so tests are fast and self-contained.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { _resetDb, getDb, runMigrations } from "./index.js";
import {
  insertIncident,
  listIncidents,
  getIncidentById,
  updateIncidentStatus,
  listEventsByIncident,
  getTimelineByIncident,
  insertConnectorRun,
  listConnectorRunsByIncident,
  updateConnectorRun,
} from "./queries.js";

// ── Setup ─────────────────────────────────────────────────────────────────────

let _tmpDb: string;

beforeEach(() => {
  // Use a unique temp file per test so there is no state leakage between tests.
  _tmpDb = join(tmpdir(), `necro-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  process.env["DATABASE_URL"] = _tmpDb;
  _resetDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMigrations(getDb() as any);
});

afterEach(() => {
  _resetDb();
  // Clean up temp file
  for (const ext of ["", "-shm", "-wal"]) {
    const p = _tmpDb + ext;
    if (existsSync(p)) unlinkSync(p);
  }
});

// ── incidents ─────────────────────────────────────────────────────────────────

describe("insertIncident / listIncidents / getIncidentById", () => {
  it("inserts an incident and retrieves it by id", async () => {
    await insertIncident({
      id: "inc-001",
      title: "Test incident",
      startAt: "2024-10-15T02:00:00Z",
      endAt: "2024-10-15T03:00:00Z",
      servicesJson: '["payments"]',
      status: "pending",
      createdAt: "2024-10-15T01:00:00Z",
    });

    const row = await getIncidentById("inc-001");
    expect(row).toBeDefined();
    expect(row!.title).toBe("Test incident");
    expect(row!.status).toBe("pending");
  });

  it("returns undefined for a non-existent id", async () => {
    const row = await getIncidentById("no-such-id");
    expect(row).toBeUndefined();
  });

  it("listIncidents returns rows sorted by start_at descending", async () => {
    await insertIncident({
      id: "inc-a",
      title: "A",
      startAt: "2024-10-15T01:00:00Z",
      endAt: "2024-10-15T02:00:00Z",
      servicesJson: "[]",
      status: "pending",
      createdAt: "2024-10-15T00:00:00Z",
    });
    await insertIncident({
      id: "inc-b",
      title: "B",
      startAt: "2024-10-16T01:00:00Z",
      endAt: "2024-10-16T02:00:00Z",
      servicesJson: "[]",
      status: "pending",
      createdAt: "2024-10-15T00:00:00Z",
    });

    const rows = await listIncidents();
    expect(rows.length).toBe(2);
    // Newest first
    expect(rows[0]!.id).toBe("inc-b");
    expect(rows[1]!.id).toBe("inc-a");
  });
});

describe("updateIncidentStatus", () => {
  it("updates the status of an existing incident", async () => {
    await insertIncident({
      id: "inc-002",
      title: "To update",
      startAt: "2024-10-15T02:00:00Z",
      endAt: "2024-10-15T03:00:00Z",
      servicesJson: "[]",
      status: "pending",
      createdAt: "2024-10-15T01:00:00Z",
    });

    await updateIncidentStatus("inc-002", "exhuming");

    const row = await getIncidentById("inc-002");
    expect(row!.status).toBe("exhuming");
  });
});

// ── events + timelines ────────────────────────────────────────────────────────

describe("listEventsByIncident", () => {
  it("returns an empty array when no events exist", async () => {
    await insertIncident({
      id: "inc-003",
      title: "No events",
      startAt: "2024-10-15T02:00:00Z",
      endAt: "2024-10-15T03:00:00Z",
      servicesJson: "[]",
      status: "pending",
      createdAt: "2024-10-15T01:00:00Z",
    });

    const evts = await listEventsByIncident("inc-003");
    expect(evts).toHaveLength(0);
  });
});

describe("getTimelineByIncident", () => {
  it("returns undefined when no timeline exists", async () => {
    await insertIncident({
      id: "inc-004",
      title: "No timeline",
      startAt: "2024-10-15T02:00:00Z",
      endAt: "2024-10-15T03:00:00Z",
      servicesJson: "[]",
      status: "pending",
      createdAt: "2024-10-15T01:00:00Z",
    });

    const tl = await getTimelineByIncident("inc-004");
    expect(tl).toBeUndefined();
  });
});

// ── connector_runs ────────────────────────────────────────────────────────────

describe("insertConnectorRun / listConnectorRunsByIncident / updateConnectorRun", () => {
  beforeEach(async () => {
    await insertIncident({
      id: "inc-005",
      title: "Runs incident",
      startAt: "2024-10-15T02:00:00Z",
      endAt: "2024-10-15T03:00:00Z",
      servicesJson: "[]",
      status: "pending",
      createdAt: "2024-10-15T01:00:00Z",
    });
  });

  it("inserts a connector run and retrieves it", async () => {
    await insertConnectorRun({
      id: "run-001",
      incidentId: "inc-005",
      connector: "mock",
      status: "pending",
    });

    const runs = await listConnectorRunsByIncident("inc-005");
    expect(runs).toHaveLength(1);
    expect(runs[0]!.connector).toBe("mock");
    expect(runs[0]!.status).toBe("pending");
  });

  it("updateConnectorRun changes status and itemCount", async () => {
    await insertConnectorRun({
      id: "run-002",
      incidentId: "inc-005",
      connector: "mock",
      status: "pending",
    });

    await updateConnectorRun("run-002", {
      status: "done",
      itemCount: 10,
      finishedAt: "2024-10-15T02:05:00Z",
    });

    const runs = await listConnectorRunsByIncident("inc-005");
    expect(runs[0]!.status).toBe("done");
    expect(runs[0]!.itemCount).toBe(10);
    expect(runs[0]!.finishedAt).toBe("2024-10-15T02:05:00Z");
  });

  it("returns an empty array for an incident with no runs", async () => {
    const runs = await listConnectorRunsByIncident("non-existent");
    expect(runs).toHaveLength(0);
  });
});
