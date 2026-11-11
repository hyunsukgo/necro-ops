/**
 * golden.test.ts — Golden tests for mock scenarios.
 *
 * Task 3.3 / Requirements 4.3, 7.1:
 *
 *   For each of the three fixture scenarios, run the full pipeline:
 *     1. Load all events from the fixture.
 *     2. Pass them through `buildTimeline()` (sort + union-find clustering).
 *     3. Run `findSuspectedTrigger()` on the resulting event list.
 *   Then assert that:
 *     a. The cluster count matches the expected value (Requirement 4.2 / 4.5).
 *     b. The suspected-trigger id matches the expected value (Requirement 4.3).
 *
 * These tests are intentionally "golden" — they lock in the known-correct
 * output of the correlation functions for the canonical fixture data.  If a
 * fixture or algorithm changes, update the expectations here.
 *
 * Gap used: 5 minutes (the default).
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
import type { TimelineEvent } from "@necro-ops/core";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/connectors/src/ → repo root → fixtures/scenarios
const SCENARIOS_DIR = join(__dirname, "../../../fixtures/scenarios");

// ── Fixture loader ────────────────────────────────────────────────────────────

function loadScenarioEvents(scenarioName: string): TimelineEvent[] {
  const eventsPath = join(SCENARIOS_DIR, scenarioName, "events.json");
  const raw = JSON.parse(readFileSync(eventsPath, "utf-8")) as unknown;
  // `TimelineEventSchema` infers `raw` as an optional key (zod treats a
  // `z.unknown()` field as optional), while `TimelineEvent.raw` is required.
  // The fixtures always carry `raw`, so cast the validated output to the domain
  // type — the same bridge the connector normalizers use (`... as TimelineEvent`).
  return z.array(TimelineEventSchema).parse(raw) as TimelineEvent[];
}

// ── Golden expectations ───────────────────────────────────────────────────────
//
// Derivation notes (gap = 5 min, event order by timestamp then id):
//
// ── oomkilled-memory-limit ────────────────────────────────────────────────────
//   Sorted events:
//     terraform:tf-oom-001  01:48:00  infra_change  {service:payments, resource:aws_ecs_task_definition.payments}
//     terraform:tf-oom-002  01:48:22  infra_change  {service:payments-worker, resource:aws_ecs_task_definition.payments_worker}
//     k8s:k8s-oom-001       02:03:11  k8s_event     {namespace:prod, pod:payments-7d8f9c-xkp2q, service:payments}
//     datadog:dd-oom-001    02:04:30  alert         {service:payments}
//     k8s:k8s-oom-002       02:05:44  k8s_event     {namespace:prod, pod:payments-7d8f9c-mn3tz, service:payments}
//     k8s:k8s-oom-003       02:06:02  k8s_event     {namespace:prod, pod:payments-worker-9b2c-r4fwj, service:payments-worker}  ← first critical
//     datadog:dd-oom-002    02:07:15  alert         {service:payments}
//     datadog:dd-oom-003    02:08:00  metric_anomaly {service:payments}
//     k8s:k8s-oom-004       02:47:00  infra_change  {namespace:prod, service:payments}
//     datadog:dd-oom-004    03:02:00  recovery      {service:payments}
//
//   Clustering (consecutive-pair scan, gap ≤ 5 min AND shared entity):
//     [0→1] gap=22s  tf-oom-001{service:payments} ∩ tf-oom-002{service:payments-worker} = ∅ → NO
//     [1→2] gap=14m  > 5min → NO
//     [2→3] gap=79s  k8s-oom-001{service:payments} ∩ dd-oom-001{service:payments}     = ✓ → UNION(2,3)
//     [3→4] gap=74s  dd-oom-001{service:payments}  ∩ k8s-oom-002{service:payments}    = ✓ → UNION(3,4)
//     [4→5] gap=18s  k8s-oom-002{namespace:prod}   ∩ k8s-oom-003{namespace:prod}      = ✓ → UNION(4,5)
//     [5→6] gap=73s  k8s-oom-003{service:payments-worker} ∩ dd-oom-002{service:payments} = ∅ → NO
//     [6→7] gap=45s  dd-oom-002{service:payments}  ∩ dd-oom-003{service:payments}     = ✓ → UNION(6,7)
//     [7→8] gap=39m  > 5min → NO
//     [8→9] gap=15m  > 5min → NO
//   Result: clusters = {0}, {1}, {2,3,4,5}, {6,7}, {8}, {9} → 6 clusters
//
//   Suspected trigger:
//     First critical = k8s:k8s-oom-003 (02:06:02), entities: {namespace:prod, pod:..., service:payments-worker}
//     Change events before 02:06:02: tf-oom-001 (service:payments), tf-oom-002 (service:payments-worker)
//     Primary candidates sharing entity with k8s-oom-003: tf-oom-002 (shares service:payments-worker)
//     Latest primary candidate → tf-oom-002
//   Expected trigger: "terraform:tf-oom-002"
//
// ── expired-tls-cert ──────────────────────────────────────────────────────────
//   Sorted events:
//     datadog:dd-tls-001  08:01:45  alert  {service:api-gateway}
//     datadog:dd-tls-002  08:03:00  log    {service:api-gateway, service:auth-service}  ← first critical
//     k8s:k8s-tls-001     08:04:10  k8s_event {namespace:prod, pod:api-gateway-6b7d-p9xmn, service:api-gateway}
//     datadog:dd-tls-003  08:05:30  alert  {service:api-gateway}
//     datadog:dd-tls-004  08:06:15  metric_anomaly {service:user-service}
//     k8s:k8s-tls-002     08:07:55  k8s_event {namespace:prod, service:auth-service}
//     slack:slack-tls-001 08:09:00  chat   {service:api-gateway, service:auth-service}
//     slack:slack-tls-002 08:15:30  chat   {service:auth-service}
//     k8s:k8s-tls-003     08:27:00  k8s_event {namespace:prod, service:auth-service}
//     datadog:dd-tls-005  08:38:00  recovery {service:api-gateway}
//     slack:slack-tls-003 08:40:00  chat   {service:api-gateway, service:auth-service}
//
//   Clustering:
//     [0→1] gap=75s   dd-tls-001{service:api-gateway} ∩ dd-tls-002{service:api-gateway} = ✓ → UNION(0,1)
//     [1→2] gap=70s   dd-tls-002{service:api-gateway} ∩ k8s-tls-001{service:api-gateway} = ✓ → UNION(1,2)
//     [2→3] gap=80s   k8s-tls-001{service:api-gateway} ∩ dd-tls-003{service:api-gateway} = ✓ → UNION(2,3)
//     [3→4] gap=45s   dd-tls-003{service:api-gateway} ∩ dd-tls-004{service:user-service} = ∅ → NO
//     [4→5] gap=100s  dd-tls-004{service:user-service} ∩ k8s-tls-002{service:auth-service} = ∅ → NO
//     [5→6] gap=65s   k8s-tls-002{service:auth-service} ∩ slack-tls-001{service:auth-service} = ✓ → UNION(5,6)
//     [6→7] gap=390s  > 5min → NO
//     [7→8] gap=690s  > 5min → NO
//     [8→9] gap=660s  > 5min → NO
//     [9→10] gap=120s dd-tls-005{service:api-gateway} ∩ slack-tls-003{service:api-gateway} = ✓ → UNION(9,10)
//   Result: {0,1,2,3}, {4}, {5,6}, {7}, {8}, {9,10} → 6 clusters
//
//   Suspected trigger:
//     First critical = dd-tls-002 (08:03:00)
//     Change events before 08:03:00: none (no deploy or infra_change events before 08:03)
//     → undefined
//
// ── bad-deploy-rollback ───────────────────────────────────────────────────────
//   Sorted events (14:02:30 – 14:38:00, all same day 2024-12-01):
//     terraform:tf-dep-001  14:02:30  deploy  {service:checkout, resource:aws_ecs_service.checkout}
//     k8s:k8s-dep-001       14:04:00  deploy  {namespace:prod, service:checkout}
//     datadog:dd-dep-001    14:06:15  alert   {service:checkout}
//     datadog:dd-dep-002    14:08:45  log     {service:checkout, service:cart}  ← first critical
//     datadog:dd-dep-003    14:09:30  alert   {service:checkout}
//     datadog:dd-dep-004    14:10:00  metric_anomaly {service:cart}
//     slack:slack-dep-001   14:11:00  chat    {service:checkout}
//     slack:slack-dep-002   14:14:00  chat    {service:checkout}
//     terraform:tf-dep-002  14:17:00  deploy  {service:checkout, resource:aws_ecs_service.checkout}
//     k8s:k8s-dep-002       14:19:30  deploy  {namespace:prod, service:checkout}
//     slack:slack-dep-003   14:22:00  chat    {service:checkout}
//     datadog:dd-dep-005    14:25:00  recovery {service:checkout}
//     k8s:k8s-dep-003       14:26:00  recovery {namespace:prod, service:inventory}
//     slack:slack-dep-004   14:38:00  chat    {service:checkout, service:cart}
//
//   Clustering:
//     [0→1]  gap=90s   tf-dep-001{service:checkout} ∩ k8s-dep-001{service:checkout} = ✓ → UNION(0,1)
//     [1→2]  gap=135s  k8s-dep-001{service:checkout} ∩ dd-dep-001{service:checkout} = ✓ → UNION(1,2)
//     [2→3]  gap=150s  dd-dep-001{service:checkout}  ∩ dd-dep-002{service:checkout} = ✓ → UNION(2,3)
//     [3→4]  gap=45s   dd-dep-002{service:checkout}  ∩ dd-dep-003{service:checkout} = ✓ → UNION(3,4)
//     [4→5]  gap=30s   dd-dep-003{service:checkout}  ∩ dd-dep-004{service:cart}     = ∅ → NO
//     [5→6]  gap=60s   dd-dep-004{service:cart}      ∩ slack-dep-001{service:checkout} = ∅ → NO
//     [6→7]  gap=180s  slack-dep-001{service:checkout} ∩ slack-dep-002{service:checkout} = ✓ → UNION(6,7)
//     [7→8]  gap=180s  slack-dep-002{service:checkout} ∩ tf-dep-002{service:checkout} = ✓ → UNION(7,8)
//     [8→9]  gap=150s  tf-dep-002{service:checkout}  ∩ k8s-dep-002{service:checkout} = ✓ → UNION(8,9)
//     [9→10] gap=150s  k8s-dep-002{service:checkout} ∩ slack-dep-003{service:checkout} = ✓ → UNION(9,10)
//     [10→11] gap=180s slack-dep-003{service:checkout} ∩ dd-dep-005{service:checkout} = ✓ → UNION(10,11)
//     [11→12] gap=60s  dd-dep-005{service:checkout}  ∩ k8s-dep-003{service:inventory} = ∅ → NO
//     [12→13] gap=720s > 5min → NO
//   Result: {0,1,2,3,4}, {5}, {6,7,8,9,10,11}, {12}, {13} → 5 clusters
//
//   Suspected trigger:
//     First critical = dd-dep-002 (14:08:45), entities: {service:checkout, service:cart}
//     Change events before 14:08:45: tf-dep-001 (deploy, 14:02:30, service:checkout), k8s-dep-001 (deploy, 14:04:00, service:checkout)
//     Primary candidates sharing entity with dd-dep-002: both share service:checkout
//     Latest primary candidate → k8s-dep-001 (14:04:00 > 14:02:30)
//   Expected trigger: "k8s:k8s-dep-001"

interface ScenarioGolden {
  /** Human-readable description for test labelling. */
  description: string;
  /** Directory name under fixtures/scenarios/. */
  name: string;
  /** Expected number of clusters produced by buildTimeline() with default gap. */
  expectedClusterCount: number;
  /**
   * Expected suspected trigger event id from findSuspectedTrigger().
   * undefined means no trigger should be identified (e.g. expired-tls-cert
   * has no deploy/infra_change event before the first critical alert).
   */
  expectedSuspectedTriggerId: string | undefined;
}

const GOLDEN_SCENARIOS: ScenarioGolden[] = [
  {
    description: "OOMKilled pods after Terraform memory limit change (Req 7.1a)",
    name: "oomkilled-memory-limit",
    expectedClusterCount: 6,
    expectedSuspectedTriggerId: "terraform:tf-oom-002",
  },
  {
    description: "Expired TLS certificate causing 5xx (Req 7.1b)",
    name: "expired-tls-cert",
    expectedClusterCount: 6,
    expectedSuspectedTriggerId: undefined,
  },
  {
    description: "Bad deploy rolled back after Slack discussion (Req 7.1c)",
    name: "bad-deploy-rollback",
    expectedClusterCount: 5,
    expectedSuspectedTriggerId: "k8s:k8s-dep-001",
  },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("golden tests: scenario → expected cluster count and suspected trigger", () => {
  for (const scenario of GOLDEN_SCENARIOS) {
    describe(scenario.description, () => {
      // Load events once per describe block (lazy — only runs when tests execute)
      let events: TimelineEvent[];

      // We can't use beforeAll in a describe-for loop cleanly, so load inline.
      const getEvents = (): TimelineEvent[] => {
        if (!events) {
          events = loadScenarioEvents(scenario.name);
        }
        return events;
      };

      it("produces the expected number of clusters (Req 4.2, 4.5)", () => {
        const timeline = buildTimeline(getEvents());
        expect(timeline.clusters.length).toBe(scenario.expectedClusterCount);
      });

      it("identifies the expected suspected trigger (Req 4.3)", () => {
        const timeline = buildTimeline(getEvents());
        const triggerId = findSuspectedTrigger(timeline.events);
        expect(triggerId).toBe(scenario.expectedSuspectedTriggerId);
      });

      it("events in the timeline are sorted chronologically (Req 4.1)", () => {
        const timeline = buildTimeline(getEvents());
        for (let i = 1; i < timeline.events.length; i++) {
          const prev = new Date(timeline.events[i - 1]!.timestamp).getTime();
          const curr = new Date(timeline.events[i]!.timestamp).getTime();
          expect(curr).toBeGreaterThanOrEqual(prev);
        }
      });

      it("all cluster event ids reference events that exist in the timeline (Req 4.2)", () => {
        const timeline = buildTimeline(getEvents());
        const eventIdSet = new Set(timeline.events.map((e) => e.id));

        for (const cluster of timeline.clusters) {
          for (const eventId of cluster.eventIds) {
            expect(eventIdSet.has(eventId)).toBe(true);
          }
        }
      });

      it("every event belongs to exactly one cluster (Req 4.2)", () => {
        const timeline = buildTimeline(getEvents());
        const seen = new Map<string, string>(); // eventId → clusterId

        for (const cluster of timeline.clusters) {
          for (const eventId of cluster.eventIds) {
            expect(
              seen.has(eventId),
              `Event ${eventId} appears in multiple clusters`,
            ).toBe(false);
            seen.set(eventId, cluster.id);
          }
        }

        // Every event must be in a cluster
        expect(seen.size).toBe(timeline.events.length);
      });

      it("each cluster's start ≤ end timestamps (Req 4.2)", () => {
        const timeline = buildTimeline(getEvents());

        for (const cluster of timeline.clusters) {
          expect(new Date(cluster.start).getTime()).toBeLessThanOrEqual(
            new Date(cluster.end).getTime(),
          );
        }
      });

      if (scenario.expectedSuspectedTriggerId !== undefined) {
        it("suspected trigger event exists in the timeline (Req 4.3)", () => {
          const timeline = buildTimeline(getEvents());
          const triggerId = findSuspectedTrigger(timeline.events);
          const eventIds = new Set(timeline.events.map((e) => e.id));
          expect(eventIds.has(triggerId!)).toBe(true);
        });

        it("suspected trigger is a deploy or infra_change event (Req 4.3)", () => {
          const timeline = buildTimeline(getEvents());
          const triggerId = findSuspectedTrigger(timeline.events);
          const triggerEvent = timeline.events.find((e) => e.id === triggerId);
          expect(triggerEvent).toBeDefined();
          expect(["deploy", "infra_change"]).toContain(triggerEvent!.kind);
        });

        it("suspected trigger precedes the first critical event (Req 4.3)", () => {
          const timeline = buildTimeline(getEvents());
          const triggerId = findSuspectedTrigger(timeline.events);
          const triggerEvent = timeline.events.find((e) => e.id === triggerId)!;
          const firstCritical = timeline.events.find(
            (e) => e.severity === "critical",
          )!;
          expect(new Date(triggerEvent.timestamp).getTime()).toBeLessThan(
            new Date(firstCritical.timestamp).getTime(),
          );
        });
      } else {
        it("returns undefined when no change event precedes the first critical alert (Req 4.3)", () => {
          const timeline = buildTimeline(getEvents());
          const triggerId = findSuspectedTrigger(timeline.events);
          expect(triggerId).toBeUndefined();
        });
      }
    });
  }
});
