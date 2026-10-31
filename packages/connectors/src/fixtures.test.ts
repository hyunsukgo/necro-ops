/**
 * fixtures.test.ts — validate that every scenario fixture conforms to the
 * TimelineEventSchema and meets the product requirements:
 *
 * Requirement 7.1:
 *   - At least 3 scenarios (a, b, c).
 *   - Each scenario has events from ≥3 distinct sources.
 *   - All events conform to TimelineEventSchema.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TimelineEventSchema } from "@necro-ops/core";
import { z } from "zod";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Navigate from packages/connectors/src → repo root → fixtures/scenarios
const SCENARIOS_DIR = join(__dirname, "../../../fixtures/scenarios");

// ── Schema for scenario metadata ─────────────────────────────────────────────

const ScenarioMetadataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  services: z.array(z.string().min(1)).min(1),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
}

function loadScenarioNames(): string[] {
  const indexPath = join(SCENARIOS_DIR, "index.json");
  const parsed = z.array(z.string().min(1)).parse(readJson(indexPath));
  return parsed;
}

// ── Scenario-specific expectations ───────────────────────────────────────────

/**
 * Scenarios (a) and (c) are driven by an infra change / deploy, so they MUST
 * have at least one change-type event that can serve as a suspected trigger.
 * Scenario (b) — expired TLS cert — has no deploy/change event by design:
 * the cert expired on a fixed schedule, which is what makes the test realistic.
 */
const SCENARIOS_WITH_CHANGE_EVENTS = [
  "oomkilled-memory-limit",
  "bad-deploy-rollback",
];

describe("scenario-specific: change events present for trigger detection", () => {
  for (const name of SCENARIOS_WITH_CHANGE_EVENTS) {
    it(`${name} contains at least one deploy or infra_change event (Req 4.3)`, () => {
      const eventsPath = join(SCENARIOS_DIR, name, "events.json");
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(eventsPath));

      const hasChange = events.some(
        (e) => e.kind === "deploy" || e.kind === "infra_change",
      );
      expect(hasChange).toBe(true);
    });
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("fixture scenario index", () => {
  it("lists at least 3 scenarios (Req 7.1)", () => {
    const names = loadScenarioNames();
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it("includes OOMKilled scenario (Req 7.1a)", () => {
    const names = loadScenarioNames();
    expect(names).toContain("oomkilled-memory-limit");
  });

  it("includes expired TLS certificate scenario (Req 7.1b)", () => {
    const names = loadScenarioNames();
    expect(names).toContain("expired-tls-cert");
  });

  it("includes bad deploy rollback scenario (Req 7.1c)", () => {
    const names = loadScenarioNames();
    expect(names).toContain("bad-deploy-rollback");
  });
});

describe.each(loadScenarioNames())("scenario: %s", (scenarioName) => {
  const scenarioDir = join(SCENARIOS_DIR, scenarioName);

  // ── Metadata ───────────────────────────────────────────────────────────────

  describe("metadata.json", () => {
    it("is valid JSON and conforms to ScenarioMetadataSchema", () => {
      const raw = readJson(join(scenarioDir, "metadata.json"));
      const result = ScenarioMetadataSchema.safeParse(raw);
      expect(result.success, result.error?.message).toBe(true);
    });

    it("has endAt after startAt", () => {
      const meta = ScenarioMetadataSchema.parse(
        readJson(join(scenarioDir, "metadata.json")),
      );
      expect(new Date(meta.endAt).getTime()).toBeGreaterThan(
        new Date(meta.startAt).getTime(),
      );
    });

    it("lists at least one service", () => {
      const meta = ScenarioMetadataSchema.parse(
        readJson(join(scenarioDir, "metadata.json")),
      );
      expect(meta.services.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Events ─────────────────────────────────────────────────────────────────

  describe("events.json", () => {
    it("is a non-empty array", () => {
      const raw = readJson(join(scenarioDir, "events.json"));
      expect(Array.isArray(raw)).toBe(true);
      expect((raw as unknown[]).length).toBeGreaterThan(0);
    });

    it("every event conforms to TimelineEventSchema (Req 3.1)", () => {
      const events = z
        .array(z.unknown())
        .parse(readJson(join(scenarioDir, "events.json")));

      const failures: string[] = [];
      for (let i = 0; i < events.length; i++) {
        const result = TimelineEventSchema.safeParse(events[i]);
        if (!result.success) {
          failures.push(`event[${i}]: ${result.error.message}`);
        }
      }
      expect(failures, failures.join("\n")).toHaveLength(0);
    });

    it("event ids follow the '${source}:${nativeId}' convention", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      for (const event of events) {
        // id must start with `${event.source}:`
        expect(event.id).toMatch(new RegExp(`^${event.source}:`));
      }
    });

    it("all event ids are unique within the scenario", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      const ids = events.map((e) => e.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it("events cover at least 3 distinct sources (Req 7.1, 7.3)", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      const sources = new Set(events.map((e) => e.source));
      expect(sources.size).toBeGreaterThanOrEqual(3);
    });

    it("all timestamps are valid UTC ISO-8601", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      for (const event of events) {
        const d = new Date(event.timestamp);
        expect(d.toString()).not.toBe("Invalid Date");
      }
    });

    it("contains at least one critical severity event", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      const hasCritical = events.some((e) => e.severity === "critical");
      expect(hasCritical).toBe(true);
    });

    it("has a mix of event kinds (alert, log, k8s_event, deploy, infra_change, chat, or recovery)", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      const kinds = new Set(events.map((e) => e.kind));
      // Each scenario must have more than one kind of event to show stitching
      expect(kinds.size).toBeGreaterThanOrEqual(2);
    });

    it("no event summary exceeds 200 characters", () => {
      const events = z
        .array(TimelineEventSchema)
        .parse(readJson(join(scenarioDir, "events.json")));

      for (const event of events) {
        expect(event.summary.length).toBeLessThanOrEqual(200);
      }
    });
  });
});
