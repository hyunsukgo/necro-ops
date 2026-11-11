/**
 * terraform.test.ts — fixture-based tests for the Terraform connector (6.3).
 *
 * These tests NEVER touch the filesystem: they feed the provider's own raw
 * shapes — `terraform show -json` `resource_changes[]` and `terraform apply`
 * log text — through the pure `normalize()` / `parseApplyLog()` paths and
 * assert the resulting `TimelineEvent`s. `collect()` (the file-reading half) is
 * intentionally not exercised, mirroring the datadog / k8s tests.
 *
 * Coverage:
 *   가) every normalized event passes TimelineEventSchema
 *   나) change actions / apply verbs → severity + kind
 *   다) entities (resource address + module)
 *   라) redaction: no email leaks into summary
 *   마) isEnabled is false without either source path
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TimelineEventSchema } from "@necro-ops/core";
import type { TimelineEvent } from "@necro-ops/core";
import type { RawItem } from "@necro-ops/connectors";
import { terraformConnector } from "@necro-ops/connectors";
import { parseApplyLog, TF_CHANGE } from "./normalize.js";

// ── Path helpers ─────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = join(__dirname, "__fixtures__");

/** Incident-window anchor collect() would stamp onto show-json changes. */
const ANCHOR = "2024-10-15T02:00:00Z";

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf-8");
}

/** Stamp show-json resource_changes exactly as collect() would. */
function loadRawChanges(): RawItem[] {
  const json = JSON.parse(readFixture("show.json")) as {
    resource_changes: Record<string, unknown>[];
  };
  return json.resource_changes.map((c) => ({
    ...c,
    _tfType: TF_CHANGE,
    _tfTimestamp: ANCHOR,
  }));
}

/** Parse the apply log into raw items exactly as collect() would. */
function loadRawApply(): RawItem[] {
  return parseApplyLog(readFixture("apply.log"), ANCHOR);
}

function normalizeAll(items: RawItem[]): TimelineEvent[] {
  const out: TimelineEvent[] = [];
  for (const item of items) {
    const ev = terraformConnector.normalize(item);
    if (ev !== null) out.push(ev);
  }
  return out;
}

function byId(events: TimelineEvent[]): Map<string, TimelineEvent> {
  return new Map(events.map((e) => [e.id, e]));
}

// ── 가) schema conformance ────────────────────────────────────────────────────

describe("terraform normalize: schema conformance", () => {
  it("every normalized event (changes + apply) passes TimelineEventSchema", () => {
    const all = normalizeAll([...loadRawChanges(), ...loadRawApply()]);
    // show.json → 4 kept (update, delete, replace, create); read + no-op dropped.
    // apply.log → 3 "complete" resource lines + 1 "Apply complete!" summary = 4.
    expect(all.length).toBe(8);
    for (const ev of all) {
      const result = TimelineEventSchema.safeParse(ev);
      expect(result.success, result.error?.message).toBe(true);
    }
  });

  it("ids follow the terraform:<nativeId> convention and source is terraform", () => {
    const all = normalizeAll([...loadRawChanges(), ...loadRawApply()]);
    for (const ev of all) {
      expect(ev.source).toBe("terraform");
      expect(ev.id).toMatch(/^terraform:/);
    }
  });

  it("timestamps are valid UTC ISO-8601 with offset", () => {
    const all = normalizeAll([...loadRawChanges(), ...loadRawApply()]);
    for (const ev of all) {
      expect(new Date(ev.timestamp).toString()).not.toBe("Invalid Date");
      expect(ev.timestamp).toMatch(/Z$|[+-]\d{2}:\d{2}$/);
    }
  });

  it("no summary exceeds 200 characters", () => {
    const all = normalizeAll([...loadRawChanges(), ...loadRawApply()]);
    for (const ev of all) {
      expect(ev.summary.length).toBeLessThanOrEqual(200);
    }
  });

  it("drops no-op and read changes (no incident signal)", () => {
    const changes = normalizeAll(loadRawChanges());
    expect(changes.length).toBe(4);
    const summaries = changes.map((e) => e.summary).join(" ");
    expect(summaries).not.toContain("unchanged");
    expect(summaries).not.toContain("data.aws_ami.base");
  });
});

// ── 나) change actions / apply verbs → severity + kind ────────────────────────

describe("terraform normalize: severity + kind (show-json)", () => {
  const m = (): Map<string, TimelineEvent> => byId(normalizeAll(loadRawChanges()));

  it("maps an update to warning / infra_change", () => {
    const ev = m().get("terraform:update:aws_instance.payments")!;
    expect(ev).toBeDefined();
    expect(ev.severity).toBe("warning");
    expect(ev.kind).toBe("infra_change");
  });

  it("maps a delete to critical", () => {
    const ev = m().get("terraform:delete:aws_db_instance.legacy_cache")!;
    expect(ev.severity).toBe("critical");
  });

  it("maps a replace (delete+create) to critical and labels it replace", () => {
    const ev = m().get("terraform:replace:aws_launch_template.payments")!;
    expect(ev).toBeDefined();
    expect(ev.severity).toBe("critical");
    expect(ev.summary).toContain("replace");
  });

  it("maps a create to info", () => {
    const ev = m().get("terraform:create:aws_security_group.payments")!;
    expect(ev.severity).toBe("info");
  });
});

describe("terraform normalize: severity + kind (apply log)", () => {
  const events = (): TimelineEvent[] => normalizeAll(loadRawApply());

  it("maps 'Destruction complete' to critical", () => {
    const destroy = events().find((e) =>
      e.summary.includes("Destruction complete"),
    )!;
    expect(destroy).toBeDefined();
    expect(destroy.severity).toBe("critical");
    expect(destroy.kind).toBe("infra_change");
  });

  it("maps 'Modifications complete' to warning", () => {
    const modify = events().find((e) =>
      e.summary.includes("Modifications complete"),
    )!;
    expect(modify.severity).toBe("warning");
  });

  it("maps 'Creation complete' to info", () => {
    const create = events().find((e) =>
      e.summary.includes("Creation complete"),
    )!;
    expect(create.severity).toBe("info");
  });

  it("maps the final 'Apply complete!' summary to a deploy marker", () => {
    const complete = events().find((e) => e.kind === "deploy")!;
    expect(complete).toBeDefined();
    expect(complete.severity).toBe("info");
    expect(complete.summary).toContain("Apply complete!");
  });

  it("lifts the real log timestamp onto resource lines", () => {
    const modify = events().find((e) =>
      e.summary.includes("Modifications complete"),
    )!;
    expect(modify.timestamp).toBe("2024-10-15T01:48:02.000Z");
  });

  it("skips transient 'Modifying.../Still modifying...' start lines", () => {
    const all = events();
    // 3 complete lines + 1 Apply complete summary. No start/still lines.
    expect(all.length).toBe(4);
    for (const ev of all) {
      expect(ev.summary).not.toMatch(/Still modifying/);
      expect(ev.summary).not.toMatch(/Modifying\.\.\./);
    }
  });
});

// ── 다) entities ──────────────────────────────────────────────────────────────

describe("terraform normalize: entities", () => {
  it("emits a resource entity for the address and one for the module", () => {
    const ev = byId(normalizeAll(loadRawChanges())).get(
      "terraform:update:aws_instance.payments",
    )!;
    const ents = ev.entities.map((e) => `${e.type}:${e.name}`);
    expect(ents).toContain("resource:aws_instance.payments");
    expect(ents).toContain("resource:module.payments");
  });

  it("emits a resource entity for an apply-log resource line", () => {
    const destroy = normalizeAll(loadRawApply()).find((e) =>
      e.summary.includes("Destruction complete"),
    )!;
    const ents = destroy.entities.map((e) => `${e.type}:${e.name}`);
    expect(ents).toContain(
      "resource:module.payments.aws_db_instance.legacy_cache",
    );
  });
});

// ── 라) redaction ─────────────────────────────────────────────────────────────

describe("terraform normalize: redaction", () => {
  it("does not leak an email from provider/raw into the summary", () => {
    const all = normalizeAll([...loadRawChanges(), ...loadRawApply()]);
    for (const ev of all) {
      expect(ev.summary).not.toContain("oncall@example.com");
    }
  });
});

// ── invalid input handling ────────────────────────────────────────────────────

describe("terraform normalize: invalid input", () => {
  it("drops an item with an unknown _tfType and returns null", () => {
    expect(
      terraformConnector.normalize({ address: "x", _tfType: "nope" }),
    ).toBeNull();
  });

  it("drops a malformed change (missing change.actions) and returns null", () => {
    expect(
      terraformConnector.normalize({
        _tfType: TF_CHANGE,
        _tfTimestamp: ANCHOR,
        address: "aws_instance.x",
        change: {},
      }),
    ).toBeNull();
  });
});

// ── 마) isEnabled ─────────────────────────────────────────────────────────────

describe("terraform connector: isEnabled", () => {
  it("is false when neither source path is set", () => {
    expect(terraformConnector.isEnabled({})).toBe(false);
  });

  it("is true when TERRAFORM_SHOW_JSON_PATH is set", () => {
    expect(
      terraformConnector.isEnabled({
        TERRAFORM_SHOW_JSON_PATH: "/tmp/show.json",
      }),
    ).toBe(true);
  });

  it("is true when TERRAFORM_APPLY_LOG_PATH is set", () => {
    expect(
      terraformConnector.isEnabled({
        TERRAFORM_APPLY_LOG_PATH: "/tmp/apply.log",
      }),
    ).toBe(true);
  });

  it("has id 'terraform'", () => {
    expect(terraformConnector.id).toBe("terraform");
  });
});
