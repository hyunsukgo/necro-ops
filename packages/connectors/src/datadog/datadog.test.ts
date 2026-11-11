/**
 * datadog.test.ts — fixture-based tests for the Datadog connector (task 6.1).
 *
 * These tests NEVER touch the network: they feed raw Datadog API fixtures
 * (the provider's own response shape) through the pure `normalize()` path and
 * assert the resulting `TimelineEvent`s. `collect()` is intentionally not
 * exercised — that is the credentialed/network half, split out by design.
 *
 * Coverage:
 *   가) every normalized event passes TimelineEventSchema
 *   나) expected severity / kind / entities mapping
 *   다) redaction: no api_key / bearer / email leaks into summary
 *   라) isEnabled is false without Datadog keys
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TimelineEventSchema } from "@necro-ops/core";
import type { TimelineEvent } from "@necro-ops/core";
import type { RawItem } from "@necro-ops/connectors";
import { datadogConnector } from "@necro-ops/connectors";
import { DD_EVENT, DD_MONITOR } from "./normalize.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "__fixtures__");

function readJson(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf-8")) as unknown;
}

/** Stamp raw items with `_ddType` exactly as collect() would, for normalize. */
function stamp(items: unknown[], type: string): RawItem[] {
  return items.map((i) => ({
    ...(i as Record<string, unknown>),
    _ddType: type,
  }));
}

function loadRawEvents(): RawItem[] {
  const body = readJson("events.json") as { events: unknown[] };
  return stamp(body.events, DD_EVENT);
}

function loadRawMonitors(): RawItem[] {
  return stamp(readJson("monitors.json") as unknown[], DD_MONITOR);
}

function normalizeAll(items: RawItem[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const item of items) {
    const ev = datadogConnector.normalize(item);
    if (ev !== null) out.push(ev);
  }
  return out;
}

// ── 가) schema conformance ────────────────────────────────────────────────────

describe("datadog normalize: schema conformance", () => {
  it("every normalized event (events + monitors) passes TimelineEventSchema", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawMonitors()]);
    expect(all.length).toBe(8); // 4 events + 4 monitors, none dropped
    for (const ev of all) {
      const result = TimelineEventSchema.safeParse(ev);
      expect(result.success, result.error?.message).toBe(true);
    }
  });

  it("ids follow the datadog:<nativeId> convention", () => {
    const events = normalizeAll(loadRawEvents());
    for (const ev of events) {
      expect(ev.source).toBe("datadog");
      expect(ev.id).toMatch(/^datadog:/);
    }
    const monitors = normalizeAll(loadRawMonitors());
    for (const ev of monitors) {
      expect(ev.id).toMatch(/^datadog:monitor-/);
    }
  });

  it("timestamps are valid UTC ISO-8601 with offset", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawMonitors()]);
    for (const ev of all) {
      expect(new Date(ev.timestamp).toString()).not.toBe("Invalid Date");
      expect(ev.timestamp).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
    }
  });

  it("no summary exceeds 200 characters", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawMonitors()]);
    for (const ev of all) {
      expect(ev.summary.length).toBeLessThanOrEqual(200);
    }
  });
});

// ── 나) severity / kind / entities mapping ────────────────────────────────────

describe("datadog normalize: severity / kind / entities", () => {
  const byId = (items: RawItem[]): Map<string, TimelineEvent> =>
    new Map(normalizeAll(items).map((e) => [e.id, e]));

  it("maps event alert_type → severity and kind", () => {
    const m = byId(loadRawEvents());

    const err = m.get("datadog:7213948571234001")!;
    expect(err.severity).toBe("critical");
    expect(err.kind).toBe("alert");

    const warn = m.get("datadog:7213948571234002")!;
    expect(warn.severity).toBe("warning");
    expect(warn.kind).toBe("alert");

    const ok = m.get("datadog:7213948571234003")!;
    expect(ok.severity).toBe("info");
    expect(ok.kind).toBe("recovery");

    const info = m.get("datadog:7213948571234004")!;
    expect(info.severity).toBe("info");
    expect(info.kind).toBe("alert");
  });

  it("maps monitor overall_state → severity and kind", () => {
    const m = byId(loadRawMonitors());

    const alert = m.get("datadog:monitor-123456")!;
    expect(alert.severity).toBe("critical");
    expect(alert.kind).toBe("alert");

    const warn = m.get("datadog:monitor-123457")!;
    expect(warn.severity).toBe("warning");

    const ok = m.get("datadog:monitor-123458")!;
    expect(ok.severity).toBe("info");
    expect(ok.kind).toBe("recovery");

    const noData = m.get("datadog:monitor-123459")!;
    expect(noData.severity).toBe("info");
    expect(noData.kind).toBe("alert");
  });

  it("extracts service / pod / host entities from tags", () => {
    const m = byId(loadRawEvents());

    const err = m.get("datadog:7213948571234001")!;
    const errEntities = err.entities.map((e) => `${e.type}:${e.name}`);
    expect(errEntities).toContain("service:payments");
    // host tag AND top-level host → single resource entity (deduped)
    expect(errEntities).toContain("resource:ip-10-0-3-21");
    expect(
      errEntities.filter((x) => x === "resource:ip-10-0-3-21").length,
    ).toBe(1);
    // env/team tags are intentionally dropped
    expect(errEntities.some((x) => x.startsWith("service:env"))).toBe(false);

    const warn = m.get("datadog:7213948571234002")!;
    const warnEntities = warn.entities.map((e) => `${e.type}:${e.name}`);
    expect(warnEntities).toContain("pod:payments-7d8f9c-xkp2q");
  });

  it("builds a link for events and monitors", () => {
    const ev = byId(loadRawEvents()).get("datadog:7213948571234001")!;
    expect(ev.link).toContain("/event/event?id=");

    const mon = byId(loadRawMonitors()).get("datadog:monitor-123456")!;
    expect(mon.link).toContain("/monitors/123456");
  });
});

// ── 다) redaction ─────────────────────────────────────────────────────────────

describe("datadog normalize: redaction", () => {
  it("does not leak api keys, bearer tokens or emails into summary", () => {
    const all = normalizeAll([...loadRawEvents(), ...loadRawMonitors()]);
    for (const ev of all) {
      expect(ev.summary).not.toMatch(/dd-sekret-/);
      expect(ev.summary.toLowerCase()).not.toContain("abc123def456ghi789");
      expect(ev.summary).not.toContain("oncall@example.com");
      // the redaction placeholder should be present where a secret was
    }
    const errEvent = normalizeAll(loadRawEvents()).find(
      (e) => e.id === "datadog:7213948571234001",
    )!;
    expect(errEvent.summary).toContain("[REDACTED]");
  });

  it("keeps the raw payload on the event but it is not the summary", () => {
    const ev = normalizeAll(loadRawEvents())[0]!;
    expect(ev.raw).toBeDefined();
    expect(typeof ev.summary).toBe("string");
  });
});

// ── invalid input handling ────────────────────────────────────────────────────

describe("datadog normalize: invalid input", () => {
  it("drops an item with an unknown _ddType and returns null", () => {
    expect(datadogConnector.normalize({ id: 1, _ddType: "nope" })).toBeNull();
  });

  it("drops a malformed event (missing date_happened) and returns null", () => {
    expect(
      datadogConnector.normalize({ _ddType: DD_EVENT, id: 9, title: "x" }),
    ).toBeNull();
  });
});

// ── 라) isEnabled ─────────────────────────────────────────────────────────────

describe("datadog connector: isEnabled", () => {
  it("is false when Datadog keys are absent", () => {
    expect(datadogConnector.isEnabled({})).toBe(false);
  });

  it("is false when only one key is present", () => {
    expect(datadogConnector.isEnabled({ DATADOG_API_KEY: "k" })).toBe(false);
    expect(datadogConnector.isEnabled({ DATADOG_APP_KEY: "k" })).toBe(false);
  });

  it("is true when both keys are present", () => {
    expect(
      datadogConnector.isEnabled({
        NECRO_MODE: "live",
        DATADOG_API_KEY: "api",
        DATADOG_APP_KEY: "app",
      }),
    ).toBe(true);
  });

  it("has id 'datadog'", () => {
    expect(datadogConnector.id).toBe("datadog");
  });
});
