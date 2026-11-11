/**
 * exhume.test.ts — unit tests for the exhume orchestrator.
 *
 * Requirements tested:
 *   2.1 — All enabled connectors queried in parallel.
 *   2.3 — Connector timeout → status "failed", error recorded, others continue.
 *   2.4 — Disabled connector → status "skipped".
 *   3.1 — normalize() drops invalid items.
 *   3.3 — dedupe() removes duplicate ids across connectors.
 *   4.1/4.2 — buildTimeline produces clusters.
 *   4.3 — findSuspectedTrigger identifies the trigger.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import { _resetDb, getDb, runMigrations, insertIncident } from "@necro-ops/db";
import type { Connector, RawItem, CollectWindow } from "@necro-ops/connectors";
import type { TimelineEvent } from "@necro-ops/core";
import { exhume } from "./exhume.js";

// ── DB isolation helpers ──────────────────────────────────────────────────────

let _tmpDb: string;

beforeEach(() => {
  _tmpDb = join(
    tmpdir(),
    `necro-exhume-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  process.env["DATABASE_URL"] = _tmpDb;
  _resetDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMigrations(getDb() as any);
});

afterEach(() => {
  _resetDb();
  for (const ext of ["", "-shm", "-wal"]) {
    const p = _tmpDb + ext;
    if (existsSync(p)) unlinkSync(p);
  }
});

// ── Fixture helpers ───────────────────────────────────────────────────────────

const BASE_WINDOW: CollectWindow = {
  start: new Date("2024-10-15T00:00:00Z"),
  end: new Date("2024-10-15T23:59:59Z"),
  services: [],
};

/** Build a minimal valid TimelineEvent RawItem. */
function makeRawEvent(id: string, overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: `mock:${id}`,
    source: "mock",
    timestamp: "2024-10-15T02:00:00Z",
    kind: "alert",
    severity: "warning",
    entities: [{ type: "service", name: "svc-a" }],
    summary: `Test event ${id}`,
    raw: { original: true },
    ...overrides,
  };
}

/** A connector that succeeds and returns given raw items. */
function makeOkConnector(
  id: Connector["id"],
  items: RawItem[],
): Connector {
  return {
    id,
    isEnabled: () => true,
    collect: async () => items,
    normalize: (item: RawItem): TimelineEvent | null => {
      // Simple pass-through normalizer for test fixtures
      if (
        typeof item["id"] !== "string" ||
        typeof item["source"] !== "string" ||
        typeof item["timestamp"] !== "string" ||
        typeof item["kind"] !== "string" ||
        typeof item["severity"] !== "string" ||
        !Array.isArray(item["entities"]) ||
        typeof item["summary"] !== "string"
      ) {
        return null;
      }
      return item as unknown as TimelineEvent;
    },
  };
}

/** A connector that is disabled (skipped). */
function makeSkippedConnector(id: Connector["id"]): Connector {
  return {
    id,
    isEnabled: () => false,
    collect: async () => [],
    normalize: () => null,
  };
}

/** A connector that throws during collect (failed). */
function makeFailingConnector(id: Connector["id"], message: string): Connector {
  return {
    id,
    isEnabled: () => true,
    collect: async () => { throw new Error(message); },
    normalize: () => null,
  };
}

/** A connector that never resolves until signal is aborted (timeout). */
function makeHangingConnector(id: Connector["id"]): Connector {
  return {
    id,
    isEnabled: () => true,
    collect: (_window, signal) =>
      new Promise<RawItem[]>((_resolve, reject) => {
        signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
    normalize: () => null,
  };
}

// ── Seed helper ───────────────────────────────────────────────────────────────

async function seedIncident(id = "inc-test") {
  await insertIncident({
    id,
    title: "Test incident",
    startAt: "2024-10-15T00:00:00Z",
    endAt: "2024-10-15T23:59:59Z",
    servicesJson: "[]",
    status: "pending",
    createdAt: new Date().toISOString(),
  });
  return id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("exhume orchestrator", () => {
  it("marks incident exhumed and returns events + clusters (Req 2.1)", async () => {
    const incidentId = await seedIncident();

    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [makeOkConnector("mock", [makeRawEvent("e1"), makeRawEvent("e2")])],
    });

    expect(result.incidentId).toBe(incidentId);
    expect(result.eventCount).toBe(2);
    expect(result.clusterCount).toBeGreaterThanOrEqual(1);
    expect(result.connectorResults[0]?.status).toBe("done");
    expect(result.connectorResults[0]?.itemCount).toBe(2);
  });

  it("skips disabled connectors (Req 2.4)", async () => {
    const incidentId = await seedIncident();

    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [makeSkippedConnector("mock")],
    });

    expect(result.connectorResults[0]?.status).toBe("skipped");
    expect(result.eventCount).toBe(0);
  });

  it("records failed status and error when connector throws (Req 2.3)", async () => {
    const incidentId = await seedIncident();

    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [makeFailingConnector("mock", "upstream error")],
    });

    expect(result.connectorResults[0]?.status).toBe("failed");
    expect(result.connectorResults[0]?.error).toContain("upstream error");
  });

  it("continues collecting from remaining connectors after one fails (Req 2.3)", async () => {
    const incidentId = await seedIncident();

    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [
        makeFailingConnector("mock", "boom"),
        makeOkConnector("datadog", [makeRawEvent("e1", { source: "datadog", id: "datadog:e1" })]),
      ],
    });

    const statuses = result.connectorResults.map((r) => r.status);
    expect(statuses).toContain("failed");
    expect(statuses).toContain("done");
    // Events from the successful connector are still captured
    expect(result.eventCount).toBe(1);
  });

  it("times out slow connectors and marks them failed (Req 2.3)", async () => {
    const incidentId = await seedIncident();

    const result = await exhume(incidentId, BASE_WINDOW, {
      timeoutMs: 50, // very short timeout
      connectors: [makeHangingConnector("mock")],
    });

    expect(result.connectorResults[0]?.status).toBe("failed");
    expect(result.connectorResults[0]?.error).toMatch(/timed out/i);
  });

  it("deduplicates events with the same id across multiple collectors (Req 3.3)", async () => {
    const incidentId = await seedIncident();

    // Two connectors both return the same event id
    const dupEvent = makeRawEvent("dup", { id: "mock:dup" });
    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [
        makeOkConnector("mock", [dupEvent]),
        makeOkConnector("datadog", [dupEvent]), // same id, different connector slot
      ],
    });

    // After dedupe only 1 event should be stored
    expect(result.eventCount).toBe(1);
  });

  it("drops invalid raw items from normalize() (Req 3.1)", async () => {
    const incidentId = await seedIncident();

    // One valid, one missing required fields
    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [
        makeOkConnector("mock", [
          makeRawEvent("valid"),
          { id: "mock:bad" }, // missing timestamp, kind, etc.
        ]),
      ],
    });

    expect(result.eventCount).toBe(1);
  });

  it("calls onProgress for each connector state change (Req 2.2 precursor)", async () => {
    const incidentId = await seedIncident();
    const progressEvents: string[] = [];

    await exhume(incidentId, BASE_WINDOW, {
      connectors: [
        makeOkConnector("mock", [makeRawEvent("e1")]),
        makeSkippedConnector("datadog"),
      ],
      onProgress: (r) => progressEvents.push(`${r.connectorId}:${r.status}`),
    });

    expect(progressEvents).toContain("mock:running");
    expect(progressEvents).toContain("mock:done");
    expect(progressEvents).toContain("datadog:skipped");
  });

  it("identifies suspected trigger and persists it (Req 4.3)", async () => {
    const incidentId = await seedIncident();

    // deploy before critical alert → should be flagged as trigger
    const deployEvent = makeRawEvent("deploy-1", {
      id: "mock:deploy-1",
      kind: "deploy",
      severity: "info",
      timestamp: "2024-10-15T01:00:00Z",
      entities: [{ type: "service", name: "payments" }],
    });
    const criticalEvent = makeRawEvent("crit-1", {
      id: "mock:crit-1",
      kind: "alert",
      severity: "critical",
      timestamp: "2024-10-15T01:10:00Z",
      entities: [{ type: "service", name: "payments" }],
    });

    const result = await exhume(incidentId, BASE_WINDOW, {
      connectors: [makeOkConnector("mock", [deployEvent, criticalEvent])],
    });

    expect(result.suspectedTriggerId).toBe("mock:deploy-1");
  });

  it("marks incident as failed when all connectors are skipped", async () => {
    const incidentId = await seedIncident();
    const { getIncidentById } = await import("@necro-ops/db");

    await exhume(incidentId, BASE_WINDOW, {
      connectors: [makeSkippedConnector("mock")],
    });

    const row = await getIncidentById(incidentId);
    expect(row?.status).toBe("failed");
  });

  it("marks incident as exhumed after successful collection", async () => {
    const incidentId = await seedIncident();
    const { getIncidentById } = await import("@necro-ops/db");

    await exhume(incidentId, BASE_WINDOW, {
      connectors: [makeOkConnector("mock", [makeRawEvent("e1")])],
    });

    const row = await getIncidentById(incidentId);
    expect(row?.status).toBe("exhumed");
  });
});
