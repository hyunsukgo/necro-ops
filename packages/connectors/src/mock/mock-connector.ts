/**
 * mock-connector.ts — Mock Connector implementation.
 *
 * Requirements 2.5, 3.1:
 *   2.5 — When NECRO_MODE=demo, use only the mock connector.
 *   3.1 — Convert each raw item into a TimelineEvent; drop invalid items with
 *          a warning including the source and reason.
 *
 * Behaviour:
 *   - `isEnabled` returns true whenever NECRO_MODE is "demo" or not set.
 *   - `collect` reads every scenario from fixtures/scenarios/ and filters
 *     events to those that fall within the collect window and match at least
 *     one of the requested services.  An empty services array means "all".
 *   - `normalize` validates the raw item against TimelineEventSchema and
 *     returns the parsed event, or null on validation failure (after logging
 *     a warning).
 *   - Already-normalised fixture events are returned as-is; the raw payload
 *     is preserved on the `raw` field.
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TimelineEventSchema } from "@necro-ops/core";
import type { TimelineEvent } from "@necro-ops/core";
import { z } from "zod";
import type { Connector, CollectWindow, RawItem } from "../interface.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/connectors/src/mock/ → repo root → fixtures/scenarios
const SCENARIOS_DIR = join(__dirname, "../../../../fixtures/scenarios");

// ── Zod schemas ───────────────────────────────────────────────────────────────

const ScenarioIndexSchema = z.array(z.string().min(1));

// ── Helpers ───────────────────────────────────────────────────────────────────

function readJson(filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as unknown;
}

/** Load the scenario names from the index.json file. */
function loadScenarioNames(): string[] {
  const indexPath = join(SCENARIOS_DIR, "index.json");
  if (!existsSync(indexPath)) return [];
  return ScenarioIndexSchema.parse(readJson(indexPath));
}

/**
 * Load all raw events from every scenario fixture.
 * Returns an array of raw objects (unknown-typed until normalize() validates).
 */
function loadAllFixtureEvents(): RawItem[] {
  const scenarios = loadScenarioNames();
  const all: RawItem[] = [];
  for (const name of scenarios) {
    const eventsPath = join(SCENARIOS_DIR, name, "events.json");
    if (!existsSync(eventsPath)) continue;
    const raw = readJson(eventsPath);
    if (!Array.isArray(raw)) continue;
    for (const item of raw) {
      all.push(item as RawItem);
    }
  }
  return all;
}

/**
 * Return true when the event timestamp falls within [start, end] (inclusive).
 */
function isInWindow(timestamp: string, start: Date, end: Date): boolean {
  const t = new Date(timestamp).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

/**
 * Return true when the event matches at least one of the requested services,
 * or when `services` is empty (meaning "all services").
 */
function matchesServices(
  entities: Array<{ type: string; name: string }>,
  services: string[],
): boolean {
  if (services.length === 0) return true;
  return entities.some(
    (entity) =>
      entity.type === "service" && services.includes(entity.name),
  );
}

// ── Mock Connector ─────────────────────────────────────────────────────────────

export const mockConnector: Connector = {
  id: "mock",

  /**
   * Enabled when NECRO_MODE is "demo" (or not set at all — demo is the
   * default per requirements).
   */
  isEnabled(env: NodeJS.ProcessEnv): boolean {
    const mode = env["NECRO_MODE"] ?? "demo";
    return mode === "demo";
  },

  /**
   * Collect events from fixture files.
   *
   * Filters to events within the window AND matching at least one service.
   * Respects the AbortSignal: if aborted before we start reading, rejects.
   */
  async collect(
    window: CollectWindow,
    signal: AbortSignal,
  ): Promise<RawItem[]> {
    if (signal.aborted) {
      throw new DOMException("Collect aborted", "AbortError");
    }

    const all = loadAllFixtureEvents();

    const filtered = all.filter((item) => {
      // Quick guard: item must have a timestamp and entities field for filtering
      if (
        typeof item !== "object" ||
        item === null ||
        typeof (item as Record<string, unknown>)["timestamp"] !== "string"
      ) {
        return true; // let normalize() handle the validation failure
      }
      const ts = (item as Record<string, unknown>)["timestamp"] as string;
      const entities = (item as Record<string, unknown>)["entities"];
      const entitiesArray = Array.isArray(entities)
        ? (entities as Array<{ type: string; name: string }>)
        : [];

      return (
        isInWindow(ts, window.start, window.end) &&
        matchesServices(entitiesArray, window.services)
      );
    });

    return filtered;
  },

  /**
   * Validate a raw item against `TimelineEventSchema`.
   *
   * Returns the parsed `TimelineEvent` on success, or `null` on failure
   * (requirement 3.1: drop and log a warning with source + reason).
   */
  normalize(item: RawItem): TimelineEvent | null {
    const result = TimelineEventSchema.safeParse(item);
    if (!result.success) {
      const source =
        typeof item["source"] === "string" ? item["source"] : "unknown";
      const id =
        typeof item["id"] === "string" ? item["id"] : "(no id)";
      console.warn(
        `[mock-connector] Dropping invalid event (source=${source}, id=${id}): ${result.error.message}`,
      );
      return null;
    }
    return result.data;
  },
};
