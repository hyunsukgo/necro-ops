/**
 * k8s.test.ts — fixture-based tests for the Kubernetes connector (task 6.2).
 *
 * These tests NEVER touch the network: they feed raw Kubernetes API fixtures
 * (the provider's own response shape — core/v1 EventList and PodList) through
 * the pure `normalize()` path and assert the resulting `TimelineEvent`s.
 * `collect()` is intentionally not exercised — that is the credentialed/network
 * half, split out by design.
 *
 * Coverage:
 *   가) every normalized event passes TimelineEventSchema
 *   나) severity / kind / entities mapping (esp. OOMKilled → critical)
 *   다) redaction: no email leaks into summary
 *   라) healthy pods are dropped; isEnabled is false without KUBECONFIG
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TimelineEventSchema } from "@necro-ops/core";
import type { TimelineEvent } from "@necro-ops/core";
import type { RawItem } from "@necro-ops/connectors";
import { k8sConnector } from "@necro-ops/connectors";
import { K8S_EVENT, K8S_POD } from "./normalize.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "__fixtures__");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")) as unknown;
}

/** Stamp raw items with `_k8sType` exactly as collect() would, for normalize. */
function stamp(items: unknown[], type: string): RawItem[] {
  return items.map((i) => ({
    ...(i as Record<string, unknown>),
    _k8sType: type,
  }));
}

function loadRawEvents(): RawItem[] {
  const body = readJson("events.json") as { items: unknown[] };
  return stamp(body.items, K8S_EVENT);
}

function loadRawPods(): RawItem[] {
  const body = readJson("pods.json") as { items: unknown[] };
  return stamp(body.items, K8S_POD);
}

function normalizeAll(items: RawItem[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const item of items) {
    const ev = k8sConnector.normalize(item);
    if (ev !== null) out.push(ev);
  }
  return out;
}

// ── 가) schema conformance ────────────────────────────────────────────────────

describe("k8s normalize: schema conformance", () => {
  it("every normalized event (events + pods) passes TimelineEventSchema", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawPods()]);
    // 5 events (none dropped) + 1 abnormal pod (payments-xkp2q);
    // the healthy checkout + recovered payments pods are dropped.
    expect(all.length).toBe(6);
    for (const ev of all) {
      const result = TimelineEventSchema.safeParse(ev);
      expect(result.success, result.error?.message).toBe(true);
    }
  });

  it("ids follow the k8s:<nativeId> convention and source is k8s", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawPods()]);
    for (const ev of all) {
      expect(ev.source).toBe("k8s");
      expect(ev.id).toMatch(/^k8s:/);
    }
  });

  it("all kinds are k8s_event", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawPods()]);
    for (const ev of all) {
      expect(ev.kind).toBe("k8s_event");
    }
  });

  it("timestamps are valid UTC ISO-8601 with offset", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawPods()]);
    for (const ev of all) {
      expect(new Date(ev.timestamp).toString()).not.toBe("Invalid Date");
      expect(ev.timestamp).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
    }
  });

  it("no summary exceeds 200 characters", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawPods()]);
    for (const ev of all) {
      expect(ev.summary.length).toBeLessThanOrEqual(200);
    }
  });
});

// ── 나) severity / kind / entities mapping ────────────────────────────────────

describe("k8s normalize: severity / entities", () => {
  const eventById = (): Map<string, TimelineEvent> =>
    new Map(normalizeAll(loadRawEvents()).map((e) => [e.id, e]));

  it("maps a Warning event to warning severity", () => {
    const m = eventById();
    const backoff = m.get("k8s:payments-7d8f9c-xkp2q.17fd3a1b2c3d5000")!;
    expect(backoff.severity).toBe("warning");
  });

  it("maps an OOMKilling reason event to critical", () => {
    const m = eventById();
    const oom = m.get("k8s:payments-7d8f9c-xkp2q.17fd3a1b2c3d4e5f")!;
    expect(oom.severity).toBe("critical");
  });

  it("maps a Normal event to info", () => {
    const m = eventById();
    const scaled = m.get("k8s:payments-7d8f9c.17fd3a1a9b8c7d6e")!;
    expect(scaled.severity).toBe("info");
  });

  it("extracts namespace + pod entities for a Pod event", () => {
    const m = eventById();
    const oom = m.get("k8s:payments-7d8f9c-xkp2q.17fd3a1b2c3d4e5f")!;
    const ents = oom.entities.map((e) => `${e.type}:${e.name}`);
    expect(ents).toContain("namespace:prod");
    expect(ents).toContain("pod:payments-7d8f9c-xkp2q");
  });

  it("maps a non-Pod involvedObject (Deployment) to a service entity", () => {
    const m = eventById();
    const scaled = m.get("k8s:payments-7d8f9c.17fd3a1a9b8c7d6e")!;
    const ents = scaled.entities.map((e) => `${e.type}:${e.name}`);
    expect(ents).toContain("namespace:prod");
    expect(ents).toContain("service:payments");
  });
});

// ── OOMKilled pod snapshot → critical ─────────────────────────────────────────

describe("k8s normalize: pod status", () => {
  const podById = (): Map<string, TimelineEvent> =>
    new Map(normalizeAll(loadRawPods()).map((e) => [e.id, e]));

  it("maps an OOMKilled / CrashLoopBackOff container to critical", () => {
    const m = podById();
    const oomPod = m.get("k8s:pod-p0d00001-0000-4000-8000-000000000001")!;
    expect(oomPod).toBeDefined();
    expect(oomPod.severity).toBe("critical");
    // Both abnormal reasons surface in the summary.
    expect(oomPod.summary).toContain("OOMKilled");
    expect(oomPod.summary).toContain("CrashLoopBackOff");
    const ents = oomPod.entities.map((e) => `${e.type}:${e.name}`);
    expect(ents).toContain("namespace:prod");
    expect(ents).toContain("pod:payments-7d8f9c-xkp2q");
  });

  it("drops healthy / recovered pods (no incident signal)", () => {
    const pods = normalizeAll(loadRawPods());
    // Only the OOMKilled pod survives; checkout (ready:false but Running, no
    // abnormal container state) and the recovered payments pod are dropped.
    expect(pods.length).toBe(1);
    expect(pods[0]!.id).toBe("k8s:pod-p0d00001-0000-4000-8000-000000000001");
  });
});

// ── 다) redaction ─────────────────────────────────────────────────────────────

describe("k8s normalize: redaction", () => {
  it("does not leak emails into the summary", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawPods()]);
    for (const ev of all) {
      expect(ev.summary).not.toContain("oncall@example.com");
    }
    const oom = normalizeAll(loadRawEvents()).find(
      (e) => e.id === "k8s:payments-7d8f9c-xkp2q.17fd3a1b2c3d4e5f",
    )!;
    expect(oom.summary).toContain("[REDACTED]");
  });

  it("keeps the raw payload on the event but it is not the summary", () => {
    const ev = normalizeAll(loadRawEvents())[0]!;
    expect(ev.raw).toBeDefined();
    expect(typeof ev.summary).toBe("string");
  });
});

// ── invalid input handling ────────────────────────────────────────────────────

describe("k8s normalize: invalid input", () => {
  it("drops an item with an unknown _k8sType and returns null", () => {
    expect(k8sConnector.normalize({ metadata: { name: "x" }, _k8sType: "nope" })).toBeNull();
  });

  it("drops a malformed pod (missing metadata.name) and returns null", () => {
    expect(
      k8sConnector.normalize({ _k8sType: K8S_POD, status: { phase: "Failed" } }),
    ).toBeNull();
  });
});

// ── 라) isEnabled ─────────────────────────────────────────────────────────────

describe("k8s connector: isEnabled", () => {
  it("is false when KUBECONFIG is absent", () => {
    expect(k8sConnector.isEnabled({})).toBe(false);
  });

  it("is true when KUBECONFIG is present", () => {
    expect(
      k8sConnector.isEnabled({ NECRO_MODE: "live", KUBECONFIG: "/home/u/.kube/config" }),
    ).toBe(true);
  });

  it("has id 'k8s'", () => {
    expect(k8sConnector.id).toBe("k8s");
  });
});
