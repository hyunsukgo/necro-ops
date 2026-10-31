/**
 * mock-connector.test.ts — unit tests for the mock Connector implementation.
 *
 * Requirements tested:
 *   2.5 — NECRO_MODE=demo enables the mock connector; NECRO_MODE=live disables it.
 *   3.1 — normalize() produces valid TimelineEvents; drops invalid items with a warning.
 *   3.3 — de-duplication is tested at the connector level (dedupe is a core concern,
 *          but the connector should not emit duplicate ids within a single collect call).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { mockConnector } from "./mock-connector.js";
import { TimelineEventSchema } from "@necro-ops/core";
import type { RawItem } from "../interface.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A valid fixture event that should pass normalize(). */
const VALID_EVENT: RawItem = {
  id: "mock:test-event-001",
  source: "mock",
  timestamp: "2024-10-15T02:03:00Z",
  kind: "alert",
  severity: "warning",
  entities: [{ type: "service", name: "test-svc" }],
  summary: "Test event summary",
  raw: { original: true },
};

/** An invalid item missing required fields. */
const INVALID_EVENT: RawItem = {
  id: "mock:test-bad-001",
  source: "mock",
  // missing: timestamp, kind, severity, entities, summary, raw
};

// ── isEnabled ────────────────────────────────────────────────────────────────

describe("mockConnector.isEnabled", () => {
  it("returns true when NECRO_MODE is 'demo'", () => {
    expect(mockConnector.isEnabled({ NECRO_MODE: "demo" })).toBe(true);
  });

  it("returns true when NECRO_MODE is not set (default demo mode)", () => {
    expect(mockConnector.isEnabled({})).toBe(true);
  });

  it("returns false when NECRO_MODE is 'live'", () => {
    expect(mockConnector.isEnabled({ NECRO_MODE: "live" })).toBe(false);
  });

  it("returns false for arbitrary non-demo values", () => {
    expect(mockConnector.isEnabled({ NECRO_MODE: "production" })).toBe(false);
  });
});

// ── id ───────────────────────────────────────────────────────────────────────

describe("mockConnector.id", () => {
  it("is 'mock'", () => {
    expect(mockConnector.id).toBe("mock");
  });
});

// ── normalize ─────────────────────────────────────────────────────────────────

describe("mockConnector.normalize", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a valid TimelineEvent for a well-formed item", () => {
    const result = mockConnector.normalize(VALID_EVENT);
    expect(result).not.toBeNull();

    const parsed = TimelineEventSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it("preserves all fields from the raw item", () => {
    const result = mockConnector.normalize(VALID_EVENT);
    expect(result).not.toBeNull();
    expect(result!.id).toBe("mock:test-event-001");
    expect(result!.source).toBe("mock");
    expect(result!.kind).toBe("alert");
    expect(result!.severity).toBe("warning");
    expect(result!.summary).toBe("Test event summary");
  });

  it("returns null for an invalid item", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = mockConnector.normalize(INVALID_EVENT);
    expect(result).toBeNull();
  });

  it("logs a warning with source and id when item is invalid (Req 3.1)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockConnector.normalize(INVALID_EVENT);
    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("mock");         // source
    expect(message).toContain("test-bad-001"); // id
  });

  it("logs '(no id)' warning when item has no id field", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mockConnector.normalize({ source: "mock" });
    expect(warn).toHaveBeenCalledOnce();
    const message = warn.mock.calls[0]?.[0] as string;
    expect(message).toContain("(no id)");
  });

  it("returns null for a summary longer than 200 characters", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const longSummary: RawItem = {
      ...VALID_EVENT,
      summary: "x".repeat(201),
    };
    const result = mockConnector.normalize(longSummary);
    expect(result).toBeNull();
  });

  it("returns null for an unknown source value", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const badSource: RawItem = {
      ...VALID_EVENT,
      source: "not-a-source",
    };
    const result = mockConnector.normalize(badSource);
    expect(result).toBeNull();
  });
});

// ── collect ───────────────────────────────────────────────────────────────────

describe("mockConnector.collect", () => {
  const controller = new AbortController();

  it("returns an array of raw items", async () => {
    const window = {
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2030-01-01T00:00:00Z"),
      services: [],
    };
    const items = await mockConnector.collect(window, controller.signal);
    expect(Array.isArray(items)).toBe(true);
  });

  it("returns events from fixture scenarios", async () => {
    const window = {
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2030-01-01T00:00:00Z"),
      services: [],
    };
    const items = await mockConnector.collect(window, controller.signal);
    // We have 3 scenarios with multiple events each
    expect(items.length).toBeGreaterThan(0);
  });

  it("filters events to the time window", async () => {
    // OOMKilled scenario spans 2024-10-15 — use a narrow window inside it
    const window = {
      start: new Date("2024-10-15T02:00:00Z"),
      end: new Date("2024-10-15T02:10:00Z"),
      services: [],
    };
    const items = await mockConnector.collect(window, controller.signal);
    for (const item of items) {
      const ts = (item as Record<string, unknown>)["timestamp"] as string;
      if (ts) {
        const t = new Date(ts).getTime();
        expect(t).toBeGreaterThanOrEqual(window.start.getTime());
        expect(t).toBeLessThanOrEqual(window.end.getTime());
      }
    }
  });

  it("filters events to the requested services", async () => {
    const window = {
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2030-01-01T00:00:00Z"),
      services: ["payments"],
    };
    const items = await mockConnector.collect(window, controller.signal);
    // All returned items should mention "payments" in their entities
    for (const item of items) {
      const entities = (item as Record<string, unknown>)["entities"];
      if (Array.isArray(entities)) {
        const hasPayments = (
          entities as Array<{ type: string; name: string }>
        ).some((e) => e.name === "payments");
        expect(hasPayments).toBe(true);
      }
    }
  });

  it("returns all events when services array is empty", async () => {
    const narrowWindow = {
      start: new Date("2024-10-15T02:00:00Z"),
      end: new Date("2024-10-15T03:10:00Z"),
      services: [],
    };
    const allItems = await mockConnector.collect(narrowWindow, controller.signal);

    const filteredWindow = {
      start: new Date("2024-10-15T02:00:00Z"),
      end: new Date("2024-10-15T03:10:00Z"),
      services: ["payments"],
    };
    const filteredItems = await mockConnector.collect(
      filteredWindow,
      controller.signal,
    );
    // empty services = all services → should return at least as many events
    expect(allItems.length).toBeGreaterThanOrEqual(filteredItems.length);
  });

  it("throws an AbortError when signal is already aborted", async () => {
    const abortedController = new AbortController();
    abortedController.abort();

    const window = {
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2030-01-01T00:00:00Z"),
      services: [],
    };
    await expect(
      mockConnector.collect(window, abortedController.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("all returned events pass TimelineEventSchema after normalize()", async () => {
    const window = {
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2030-01-01T00:00:00Z"),
      services: [],
    };
    const items = await mockConnector.collect(window, controller.signal);

    const failures: string[] = [];
    for (const item of items) {
      const event = mockConnector.normalize(item);
      if (event === null) {
        failures.push(`Item failed normalize: ${JSON.stringify(item).slice(0, 120)}`);
      } else {
        const parsed = TimelineEventSchema.safeParse(event);
        if (!parsed.success) {
          failures.push(`Event failed schema: ${parsed.error.message}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toHaveLength(0);
  });

  it("returned event ids are unique (no duplicates within a collect call)", async () => {
    const window = {
      start: new Date("2020-01-01T00:00:00Z"),
      end: new Date("2030-01-01T00:00:00Z"),
      services: [],
    };
    const items = await mockConnector.collect(window, controller.signal);

    const ids = items
      .map((i) => (i as Record<string, unknown>)["id"])
      .filter((id): id is string => typeof id === "string");

    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ── normalize round-trips for real fixture events ─────────────────────────────

describe("mockConnector: normalize real fixture events", () => {
  it("all events from oomkilled-memory-limit normalize successfully", async () => {
    const window = {
      start: new Date("2024-10-15T00:00:00Z"),
      end: new Date("2024-10-15T23:59:59Z"),
      services: [],
    };
    const controller = new AbortController();
    const items = await mockConnector.collect(window, controller.signal);

    // Each item from the OOM scenario should normalize without errors
    for (const item of items) {
      const result = mockConnector.normalize(item);
      // Some items from other scenarios in this broad window may fail,
      // but OOM scenario items should all pass.
      if (
        typeof item["id"] === "string" &&
        (item["id"] as string).includes("-oom-")
      ) {
        expect(result).not.toBeNull();
      }
    }
  });
});
