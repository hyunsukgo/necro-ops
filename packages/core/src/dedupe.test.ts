import { describe, it, expect } from "vitest";
import { dedupe } from "./dedupe.js";
import type { TimelineEvent } from "./types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  id: string,
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id,
    source: "mock",
    timestamp: "2024-01-01T12:00:00Z",
    kind: "alert",
    severity: "info",
    entities: [],
    summary: `Event ${id}`,
    raw: {},
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("dedupe()", () => {
  it("returns an empty array when given an empty array", () => {
    expect(dedupe([])).toEqual([]);
  });

  it("returns the same single event unchanged", () => {
    const event = makeEvent("mock:evt-1");
    const result = dedupe([event]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(event); // same reference
  });

  it("keeps all events when every id is unique", () => {
    const events = [
      makeEvent("mock:evt-1"),
      makeEvent("mock:evt-2"),
      makeEvent("mock:evt-3"),
    ];
    const result = dedupe(events);
    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toEqual([
      "mock:evt-1",
      "mock:evt-2",
      "mock:evt-3",
    ]);
  });

  it("removes a single exact duplicate (same id)", () => {
    const first = makeEvent("datadog:alert-42");
    const duplicate = makeEvent("datadog:alert-42", { summary: "Duplicate" });
    const result = dedupe([first, duplicate]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(first); // first occurrence is kept
  });

  it("removes multiple duplicates of the same id", () => {
    const events = [
      makeEvent("k8s:pod-restart-1"),
      makeEvent("k8s:pod-restart-1"),
      makeEvent("k8s:pod-restart-1"),
    ];
    const result = dedupe(events);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(events[0]);
  });

  it("deduplicates across different sources independently", () => {
    // "alert-1" appears for two different sources → both are unique
    const ddEvent = makeEvent("datadog:alert-1");
    const k8sEvent = makeEvent("k8s:alert-1");
    const result = dedupe([ddEvent, k8sEvent]);
    expect(result).toHaveLength(2);
  });

  it("preserves original relative order", () => {
    const events = [
      makeEvent("mock:a"),
      makeEvent("mock:b"),
      makeEvent("mock:a"), // duplicate of first
      makeEvent("mock:c"),
      makeEvent("mock:b"), // duplicate of second
    ];
    const result = dedupe(events);
    expect(result.map((e) => e.id)).toEqual(["mock:a", "mock:b", "mock:c"]);
  });

  it("keeps the first occurrence, not the last", () => {
    const first = makeEvent("slack:msg-1", { summary: "First message" });
    const second = makeEvent("slack:msg-1", { summary: "Second message" });
    const result = dedupe([first, second]);
    expect(result[0]?.summary).toBe("First message");
  });

  it("handles a large batch of events with many duplicates", () => {
    const base = Array.from({ length: 100 }, (_, i) =>
      makeEvent(`mock:evt-${i % 10}`),
    );
    const result = dedupe(base);
    expect(result).toHaveLength(10);
    // order of first-seen ids: 0..9
    expect(result.map((e) => e.id)).toEqual(
      Array.from({ length: 10 }, (_, i) => `mock:evt-${i}`),
    );
  });

  it("does not mutate the input array", () => {
    const events = [makeEvent("mock:x"), makeEvent("mock:x")];
    const original = [...events];
    dedupe(events);
    expect(events).toEqual(original);
    expect(events).toHaveLength(2);
  });

  it("treats ids with same native part but different sources as distinct", () => {
    const sources = ["datadog", "k8s", "terraform", "slack", "mock"] as const;
    const events = sources.map((source) =>
      makeEvent(`${source}:native-123`, { source }),
    );
    const result = dedupe(events);
    expect(result).toHaveLength(5);
  });
});
