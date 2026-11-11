/**
 * template.test.ts — unit tests for the deterministic template report generator.
 *
 * Requirements 5.1, 5.4:
 *   5.1 — Report MUST contain all required sections.
 *   5.4 — templateReport() is the fallback when Bedrock is unavailable.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  TimelineEventSchema,
  buildTimeline,
  findSuspectedTrigger,
} from "@necro-ops/core";
import type { Timeline } from "@necro-ops/core";
import { templateReport } from "./template.js";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SCENARIOS_DIR = join(__dirname, "../../../fixtures/scenarios");

function loadTimeline(scenarioName: string): Timeline {
  const eventsPath = join(SCENARIOS_DIR, scenarioName, "events.json");
  const raw = JSON.parse(readFileSync(eventsPath, "utf-8")) as unknown;
  const events = z.array(TimelineEventSchema).parse(raw);
  const tl = buildTimeline(events as Parameters<typeof buildTimeline>[0]);
  return {
    ...tl,
    suspectedTriggerId: findSuspectedTrigger(tl.events),
  };
}

const FIXED_NOW = "2024-10-15T04:00:00.000Z";

const BASE_INCIDENT = {
  id: "inc-test",
  title: "Payments OOMKill",
  startAt: "2024-10-15T01:18:00.000Z",
  endAt: "2024-10-15T03:17:00.000Z",
  services: ["payments"],
};

// ── Section presence (Req 5.1) ────────────────────────────────────────────────

describe("templateReport — required sections (Req 5.1)", () => {
  const timeline = loadTimeline("oomkilled-memory-limit");
  const report = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);

  it("report has a non-empty summary", () => {
    expect(report.summary.length).toBeGreaterThan(0);
  });

  it("report has at least one causeOfDeath entry", () => {
    expect(report.causeOfDeath.length).toBeGreaterThanOrEqual(1);
  });

  it("every causeOfDeath entry has text and ≥1 citation", () => {
    for (const item of report.causeOfDeath) {
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.citations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("report has at least one contributingFactor entry", () => {
    expect(report.contributingFactors.length).toBeGreaterThanOrEqual(1);
  });

  it("every contributingFactor entry has text and ≥1 citation", () => {
    for (const item of report.contributingFactors) {
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.citations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("report has a non-empty timeline markdown table", () => {
    expect(report.timeline).toContain("| Time (UTC) |");
    expect(report.timeline.length).toBeGreaterThan(0);
  });

  it("report has a non-empty impact section", () => {
    expect(report.impact.length).toBeGreaterThan(0);
  });

  it("report has a non-empty detectionAndResponse section", () => {
    expect(report.detectionAndResponse.length).toBeGreaterThan(0);
  });

  it("report has at least one action item", () => {
    expect(report.actionItems.length).toBeGreaterThanOrEqual(1);
  });

  it("every action item has valid type and priority", () => {
    const validTypes = new Set(["prevent", "detect", "mitigate"]);
    const validPriorities = new Set(["P1", "P2", "P3"]);
    for (const item of report.actionItems) {
      expect(validTypes.has(item.type)).toBe(true);
      expect(validPriorities.has(item.priority)).toBe(true);
      expect(item.title.length).toBeGreaterThan(0);
    }
  });
});

// ── Metadata fields ───────────────────────────────────────────────────────────

describe("templateReport — metadata fields", () => {
  const timeline = loadTimeline("oomkilled-memory-limit");
  const report = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);

  it("incidentId matches the input", () => {
    expect(report.incidentId).toBe(BASE_INCIDENT.id);
  });

  it("isDraft is true", () => {
    expect(report.isDraft).toBe(true);
  });

  it("generatedBy is 'template'", () => {
    expect(report.generatedBy).toBe("template");
  });

  it("updatedAt matches the injected now value", () => {
    expect(report.updatedAt).toBe(FIXED_NOW);
  });
});

// ── Determinism (Req 5.4 / 4.5) ──────────────────────────────────────────────

describe("templateReport — determinism", () => {
  it("produces identical output for the same input (called twice)", () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const r1 = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);
    const r2 = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });

  it("different `now` values produce different updatedAt only", () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const r1 = templateReport(BASE_INCIDENT, timeline, "2024-10-15T04:00:00.000Z");
    const r2 = templateReport(BASE_INCIDENT, timeline, "2024-10-15T05:00:00.000Z");
    expect(r1.updatedAt).not.toBe(r2.updatedAt);
    expect(r1.summary).toBe(r2.summary);
    expect(r1.causeOfDeath).toEqual(r2.causeOfDeath);
  });
});

// ── Citation validity ─────────────────────────────────────────────────────────

describe("templateReport — all citations reference real event ids", () => {
  for (const scenario of [
    "oomkilled-memory-limit",
    "expired-tls-cert",
    "bad-deploy-rollback",
  ]) {
    it(`${scenario}: every citation id exists in the timeline`, () => {
      const timeline = loadTimeline(scenario);
      const incident = { ...BASE_INCIDENT, id: `inc-${scenario}` };
      const report = templateReport(incident, timeline, FIXED_NOW);

      const eventIds = new Set(timeline.events.map((e) => e.id));

      const allCitations = [
        ...report.causeOfDeath.flatMap((c) => c.citations),
        ...report.contributingFactors.flatMap((c) => c.citations),
      ];

      for (const citation of allCitations) {
        expect(
          eventIds.has(citation),
          `Citation "${citation}" not found in timeline events`,
        ).toBe(true);
      }
    });
  }
});

// ── Suspected trigger in report ───────────────────────────────────────────────

describe("templateReport — suspected trigger handling", () => {
  it("oomkilled scenario: summary mentions the trigger event", () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const report = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);
    // suspectedTriggerId = terraform:tf-oom-002
    expect(report.summary).toContain("terraform:tf-oom-002");
  });

  it("expired-tls scenario: no trigger → causeOfDeath notes no change event found", () => {
    const timeline = loadTimeline("expired-tls-cert");
    const report = templateReport(
      { ...BASE_INCIDENT, id: "inc-tls" },
      timeline,
      FIXED_NOW,
    );
    // No deploy/infra_change before first critical → trigger is undefined
    expect(report.summary).toContain("No suspected trigger");
  });

  it("bad-deploy scenario: summary mentions the trigger event", () => {
    const timeline = loadTimeline("bad-deploy-rollback");
    const report = templateReport(
      { ...BASE_INCIDENT, id: "inc-deploy" },
      timeline,
      FIXED_NOW,
    );
    // suspectedTriggerId = k8s:k8s-dep-001
    expect(report.summary).toContain("k8s:k8s-dep-001");
  });
});

// ── Empty timeline edge case ──────────────────────────────────────────────────

describe("templateReport — empty timeline", () => {
  it("handles an empty timeline gracefully without throwing", () => {
    const emptyTimeline: Timeline = { events: [], clusters: [] };
    expect(() =>
      templateReport(BASE_INCIDENT, emptyTimeline, FIXED_NOW),
    ).not.toThrow();
  });

  it("empty timeline report has required fields", () => {
    const emptyTimeline: Timeline = { events: [], clusters: [] };
    const report = templateReport(BASE_INCIDENT, emptyTimeline, FIXED_NOW);
    expect(report.summary.length).toBeGreaterThan(0);
    expect(report.isDraft).toBe(true);
    expect(report.generatedBy).toBe("template");
    expect(report.actionItems.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Timeline markdown table ───────────────────────────────────────────────────

describe("templateReport — timeline markdown", () => {
  it("contains a row for every event in the timeline", () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const report = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);
    // Header + separator + one row per event
    const rows = report.timeline.split("\n").filter((l) => l.startsWith("|"));
    // rows = header + separator + N events
    expect(rows.length).toBe(2 + timeline.events.length);
  });

  it("does not include raw JSON payloads (Req 6.2)", () => {
    const timeline = loadTimeline("oomkilled-memory-limit");
    const report = templateReport(BASE_INCIDENT, timeline, FIXED_NOW);
    // raw payloads contain `"run_id"` or `"monitor_id"` — should NOT appear
    expect(report.timeline).not.toContain("run_id");
    expect(report.timeline).not.toContain("monitor_id");
  });
});
