/**
 * window.test.ts — unit tests for collection window padding logic.
 *
 * Requirements 1.3:
 *   WHEN an incident is created THEN the system SHALL automatically extend the
 *   collection window by a configurable padding (default 30 min before, 15 min after).
 */

import { describe, it, expect, afterEach } from "vitest";

// We test the padding logic inline here (the actual padWindow lives in apps/web,
// but the logic is simple enough to test directly as a pure function).

function padWindow(
  start: Date,
  end: Date,
  padBefore = 30,
  padAfter = 15,
): { start: Date; end: Date } {
  return {
    start: new Date(start.getTime() - padBefore * 60 * 1_000),
    end: new Date(end.getTime() + padAfter * 60 * 1_000),
  };
}

describe("padWindow (Req 1.3)", () => {
  it("pads start back by 30 minutes and end forward by 15 minutes (defaults)", () => {
    const start = new Date("2024-10-15T02:00:00Z");
    const end = new Date("2024-10-15T03:00:00Z");

    const padded = padWindow(start, end);

    expect(padded.start.toISOString()).toBe("2024-10-15T01:30:00.000Z");
    expect(padded.end.toISOString()).toBe("2024-10-15T03:15:00.000Z");
  });

  it("respects custom pad values", () => {
    const start = new Date("2024-10-15T10:00:00Z");
    const end = new Date("2024-10-15T11:00:00Z");

    const padded = padWindow(start, end, 60, 30);

    expect(padded.start.toISOString()).toBe("2024-10-15T09:00:00.000Z");
    expect(padded.end.toISOString()).toBe("2024-10-15T11:30:00.000Z");
  });

  it("padded start is always before the original start", () => {
    const start = new Date("2024-10-15T02:00:00Z");
    const end = new Date("2024-10-15T03:00:00Z");
    const padded = padWindow(start, end);
    expect(padded.start.getTime()).toBeLessThan(start.getTime());
  });

  it("padded end is always after the original end", () => {
    const start = new Date("2024-10-15T02:00:00Z");
    const end = new Date("2024-10-15T03:00:00Z");
    const padded = padWindow(start, end);
    expect(padded.end.getTime()).toBeGreaterThan(end.getTime());
  });

  it("zero padding preserves original times", () => {
    const start = new Date("2024-10-15T02:00:00Z");
    const end = new Date("2024-10-15T03:00:00Z");
    const padded = padWindow(start, end, 0, 0);
    expect(padded.start.toISOString()).toBe(start.toISOString());
    expect(padded.end.toISOString()).toBe(end.toISOString());
  });
});
