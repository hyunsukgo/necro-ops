/**
 * Tests for findSuspectedTrigger() — Requirement 4.3
 *
 * Spec (from design.md):
 *   findSuspectedTrigger(events): string | undefined
 *
 *   First critical alert = T.
 *   Candidate = latest event with kind in {deploy, infra_change} before T
 *     sharing an entity with T; else the latest change before T.
 */

import { describe, it, expect } from "vitest";
import { findSuspectedTrigger } from "./timeline.js";
import type { TimelineEvent } from "./types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEvent(
  id: string,
  timestampIso: string,
  overrides: Partial<TimelineEvent> = {},
): TimelineEvent {
  return {
    id,
    source: "mock",
    timestamp: timestampIso,
    kind: "alert",
    severity: "info",
    entities: [],
    summary: `Event ${id}`,
    raw: {},
    ...overrides,
  };
}

/** ISO timestamp helper: base + offsetMinutes */
function t(offsetMinutes: number, base = "2024-01-01T12:00:00Z"): string {
  return new Date(
    new Date(base).getTime() + offsetMinutes * 60_000,
  ).toISOString();
}

const svcApi = [{ type: "service" as const, name: "api" }];
const svcDb = [{ type: "service" as const, name: "db" }];
const nsDefault = [{ type: "namespace" as const, name: "default" }];

// ── tests ────────────────────────────────────────────────────────────────────

describe("findSuspectedTrigger()", () => {
  // ── No trigger possible ───────────────────────────────────────────────────

  it("returns undefined for empty input", () => {
    expect(findSuspectedTrigger([])).toBeUndefined();
  });

  it("returns undefined when there are no critical events", () => {
    const events = [
      makeEvent("mock:1", t(0), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:2", t(5), { kind: "alert", severity: "warning", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBeUndefined();
  });

  it("returns undefined when there are no change events before the first critical", () => {
    const events = [
      makeEvent("mock:1", t(0), { kind: "alert", severity: "critical", entities: svcApi }),
      makeEvent("mock:2", t(5), { kind: "deploy", entities: svcApi }), // deploy AFTER critical
    ];
    expect(findSuspectedTrigger(events)).toBeUndefined();
  });

  it("returns undefined when no change events exist at all", () => {
    const events = [
      makeEvent("mock:1", t(0), { kind: "log", severity: "info", entities: svcApi }),
      makeEvent("mock:2", t(5), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBeUndefined();
  });

  // ── Primary path: change event sharing entity with critical alert ─────────

  it("identifies a deploy before the critical alert sharing a service entity", () => {
    const events = [
      makeEvent("mock:deploy", t(0), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:critical", t(10), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:deploy");
  });

  it("identifies an infra_change before the critical alert sharing a service entity", () => {
    const events = [
      makeEvent("mock:tf", t(5), { kind: "infra_change", entities: svcApi }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:tf");
  });

  it("picks the LATEST shared-entity change event, not the first", () => {
    // Two deploys before the critical — latest should win.
    const events = [
      makeEvent("mock:deploy-early", t(0), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:deploy-late", t(8), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:deploy-late");
  });

  it("prefers shared-entity candidate over a later non-shared candidate", () => {
    // deploy-shared at t(5) shares entity with critical
    // deploy-unrelated at t(9) does NOT share entity
    const events = [
      makeEvent("mock:deploy-shared", t(5), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:deploy-unrelated", t(9), { kind: "deploy", entities: svcDb }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    // deploy-unrelated is later in time, but shares no entity → deploy-shared wins
    expect(findSuspectedTrigger(events)).toBe("mock:deploy-shared");
  });

  it("matches via namespace entity (not just service)", () => {
    const events = [
      makeEvent("mock:tf", t(5), { kind: "infra_change", entities: nsDefault }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: nsDefault }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:tf");
  });

  it("matches when critical event shares one of multiple entities", () => {
    const events = [
      makeEvent("mock:deploy", t(5), { kind: "deploy", entities: [{ type: "service", name: "api" }, { type: "namespace", name: "prod" }] }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: [{ type: "namespace", name: "prod" }] }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:deploy");
  });

  // ── Fallback path: no shared entity, use latest change before T ──────────

  it("falls back to latest change event when no candidate shares an entity", () => {
    const events = [
      makeEvent("mock:deploy-unrelated", t(5), { kind: "deploy", entities: svcDb }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:deploy-unrelated");
  });

  it("fallback picks the LATEST change event when multiple unrelated changes exist", () => {
    const events = [
      makeEvent("mock:tf-early", t(2), { kind: "infra_change", entities: svcDb }),
      makeEvent("mock:deploy-latest", t(8), { kind: "deploy", entities: svcDb }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:deploy-latest");
  });

  // ── Uses the FIRST critical event as reference point ─────────────────────

  it("uses the first critical alert as reference, not a later one", () => {
    // deploy at t(5) is before first critical at t(10) and shares entity
    // second critical at t(30) is irrelevant
    const events = [
      makeEvent("mock:deploy", t(5), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:critical-first", t(10), { kind: "alert", severity: "critical", entities: svcApi }),
      makeEvent("mock:critical-second", t(30), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    expect(findSuspectedTrigger(events)).toBe("mock:deploy");
  });

  it("ignores change events that happen at the same millisecond as the critical (not strictly before)", () => {
    const ts = t(10);
    const events = [
      makeEvent("mock:deploy-same-time", ts, { kind: "deploy", entities: svcApi }),
      makeEvent("mock:critical", ts, { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    // deploy is NOT strictly before critical → no candidate → undefined
    expect(findSuspectedTrigger(events)).toBeUndefined();
  });

  it("ignores non-change events (alert, log, chat, k8s_event, recovery, metric_anomaly)", () => {
    const nonChangeKinds: TimelineEvent["kind"][] = [
      "alert", "log", "chat", "k8s_event", "recovery", "metric_anomaly",
    ];
    for (const kind of nonChangeKinds) {
      const events = [
        makeEvent(`mock:ev-${kind}`, t(5), { kind, entities: svcApi }),
        makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
      ];
      expect(findSuspectedTrigger(events), `kind=${kind} should not be a trigger`).toBeUndefined();
    }
  });

  // ── Determinism (Requirement 4.5) ─────────────────────────────────────────

  it("is deterministic: same result regardless of input order", () => {
    const events = [
      makeEvent("mock:deploy", t(5), { kind: "deploy", entities: svcApi }),
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
      makeEvent("mock:log", t(2), { kind: "log", entities: svcApi }),
    ];
    const r1 = findSuspectedTrigger(events);
    const r2 = findSuspectedTrigger([...events].reverse());
    expect(r1).toBe(r2);
    expect(r1).toBe("mock:deploy");
  });

  it("breaks timestamp ties by id for deterministic fallback selection", () => {
    const ts = t(5); // same timestamp for both deploys
    const events = [
      makeEvent("mock:deploy-aaa", ts, { kind: "deploy", entities: svcDb }), // no shared entity
      makeEvent("mock:deploy-zzz", ts, { kind: "deploy", entities: svcDb }), // no shared entity
      makeEvent("mock:critical", t(20), { kind: "alert", severity: "critical", entities: svcApi }),
    ];
    // Both are same timestamp, no shared entity → fallback → tie-break by id descending
    const r1 = findSuspectedTrigger(events);
    const r2 = findSuspectedTrigger([...events].reverse());
    expect(r1).toBe(r2);
    expect(r1).toBe("mock:deploy-zzz"); // larger id wins the tie
  });

  // ── Integration-style scenario ────────────────────────────────────────────

  it("realistic OOMKill scenario: terraform memory change is the trigger", () => {
    const svcWorker = [{ type: "service" as const, name: "worker" }];
    const events = [
      makeEvent("slack:msg-1", t(0), { kind: "chat", entities: svcWorker }),
      makeEvent("terraform:plan-1", t(10), { kind: "infra_change", entities: svcWorker }),
      makeEvent("k8s:pod-restart-1", t(35), { kind: "k8s_event", severity: "warning", entities: svcWorker }),
      makeEvent("datadog:alert-oom", t(40), { kind: "alert", severity: "critical", entities: svcWorker }),
      makeEvent("k8s:pod-restart-2", t(42), { kind: "k8s_event", severity: "critical", entities: svcWorker }),
    ];
    // terraform infra_change at t(10) shares entity with first critical at t(40)
    expect(findSuspectedTrigger(events)).toBe("terraform:plan-1");
  });
});
