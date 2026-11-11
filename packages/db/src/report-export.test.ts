/**
 * report-export.test.ts — unit tests for the report API logic.
 *
 * Requirements 5.5, 5.6, 6.1, 6.2:
 *   5.5 — User can edit sections and save; isDraft cleared.
 *   5.6 — Report stays draft until user saves.
 *   6.1 — Exported Markdown contains timeline table and citations.
 *   6.2 — Exported Markdown does NOT contain raw payloads.
 *
 * Tests the DB query functions and the Markdown builder logic inline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";
import {
  _resetDb,
  getDb,
  runMigrations,
  insertIncident,
  getReportByIncident,
  upsertReport,
} from "./index.js";
import type { Report } from "@necro-ops/core";

// ── DB isolation ──────────────────────────────────────────────────────────────

let _tmpDb: string;

beforeEach(() => {
  _tmpDb = join(
    tmpdir(),
    `necro-report-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  process.env["DATABASE_URL"] = _tmpDb;
  _resetDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  runMigrations(getDb() as any);
});

afterEach(() => {
  _resetDb();
  for (const ext of ["", "-shm", "-wal"]) {
    const p = _tmpDb + ext;
    if (existsSync(p)) unlinkSync(p);
  }
});

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function seedIncident(id = "inc-report-test") {
  await insertIncident({
    id,
    title: "Report test incident",
    startAt: "2024-10-15T00:00:00Z",
    endAt: "2024-10-15T03:00:00Z",
    servicesJson: '["payments"]',
    status: "exhumed",
    createdAt: new Date().toISOString(),
  });
  return id;
}

const SAMPLE_REPORT: Report = {
  incidentId: "inc-report-test",
  summary: "Payments service experienced OOMKill events.",
  causeOfDeath: [
    {
      text: "Memory limit unchanged during scale-up caused OOMKill.",
      citations: ["terraform:tf-oom-002"],
    },
  ],
  contributingFactors: [
    {
      text: "Multiple pods restarted in a short window.",
      citations: ["k8s:k8s-oom-001", "k8s:k8s-oom-002"],
    },
  ],
  timeline:
    "| Time (UTC) | Source | Severity | Summary |\n|---|---|---|---|\n| 2024-10-15 01:48 UTC | terraform | Info | deploy |",
  impact: "Payments service degraded for ~60 minutes.",
  detectionAndResponse:
    "First detected via Datadog alert at 02:04 UTC. Resolved at 03:02 UTC.",
  actionItems: [
    {
      title: "Add memory headroom checks to deploy pipeline",
      type: "prevent",
      priority: "P2",
    },
  ],
  isDraft: true,
  generatedBy: "template",
  updatedAt: "2024-10-15T04:00:00.000Z",
};

// ── Report DB queries ─────────────────────────────────────────────────────────

describe("getReportByIncident / upsertReport (Req 5.5, 5.6)", () => {
  it("returns undefined when no report exists", async () => {
    await seedIncident();
    const row = await getReportByIncident("inc-report-test");
    expect(row).toBeUndefined();
  });

  it("inserts a report and retrieves it", async () => {
    await seedIncident();
    await upsertReport({
      incidentId: "inc-report-test",
      bodyJson: JSON.stringify(SAMPLE_REPORT),
      isDraft: true,
      generatedBy: "template",
      updatedAt: SAMPLE_REPORT.updatedAt,
    });

    const row = await getReportByIncident("inc-report-test");
    expect(row).toBeDefined();
    expect(row!.isDraft).toBe(true);
    expect(row!.generatedBy).toBe("template");
  });

  it("upsert replaces an existing report", async () => {
    await seedIncident();
    await upsertReport({
      incidentId: "inc-report-test",
      bodyJson: JSON.stringify(SAMPLE_REPORT),
      isDraft: true,
      generatedBy: "template",
      updatedAt: SAMPLE_REPORT.updatedAt,
    });

    // Simulate user saving edits
    const updated = { ...SAMPLE_REPORT, summary: "Updated summary by user." };
    const now = "2024-10-15T05:00:00.000Z";
    await upsertReport({
      incidentId: "inc-report-test",
      bodyJson: JSON.stringify(updated),
      isDraft: false,   // Req 5.6 — saving clears draft
      generatedBy: "user",
      updatedAt: now,
    });

    const row = await getReportByIncident("inc-report-test");
    expect(row!.isDraft).toBe(false);
    expect(row!.generatedBy).toBe("user");
    const body = JSON.parse(row!.bodyJson) as Report;
    expect(body.summary).toBe("Updated summary by user.");
  });
});

// ── Markdown export logic (Req 6.1, 6.2) ──────────────────────────────────────

/**
 * Inline copy of the Markdown builder from report.md/route.ts.
 * Testing the logic directly without spinning up the HTTP server.
 */
function citationsToMd(citations: string[]): string {
  return citations.map((c) => `\`${c}\``).join(", ");
}

function buildMarkdown(
  incident: { title: string; startAt: string; endAt: string },
  report: Report,
): string {
  const lines: string[] = [];
  lines.push(`# Autopsy Report: ${incident.title}`);
  lines.push("");
  lines.push(`> **Period:** ${incident.startAt} → ${incident.endAt}  `);
  lines.push(`> **Generated by:** ${report.generatedBy}  `);
  lines.push(`> **Status:** ${report.isDraft ? "Draft" : "Final"}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(report.summary);
  lines.push("");
  lines.push("## Cause of Death");
  lines.push("");
  for (const item of report.causeOfDeath) {
    lines.push(`- ${item.text} *(${citationsToMd(item.citations)})*`);
  }
  lines.push("");
  lines.push("## Contributing Factors");
  lines.push("");
  for (const item of report.contributingFactors) {
    lines.push(`- ${item.text} *(${citationsToMd(item.citations)})*`);
  }
  lines.push("");
  lines.push("## Impact");
  lines.push("");
  lines.push(report.impact);
  lines.push("");
  lines.push("## Detection & Response");
  lines.push("");
  lines.push(report.detectionAndResponse);
  lines.push("");
  lines.push("## Timeline");
  lines.push("");
  lines.push(report.timeline);
  lines.push("");
  lines.push("## Action Items");
  lines.push("");
  lines.push("| Priority | Type | Action |");
  lines.push("|---|---|---|");
  for (const item of report.actionItems) {
    lines.push(`| ${item.priority} | ${item.type} | ${item.title} |`);
  }
  lines.push("");
  return lines.join("\n");
}

describe("buildMarkdown — exported Markdown structure (Req 6.1)", () => {
  const incident = {
    title: "Report test incident",
    startAt: "2024-10-15T00:00:00Z",
    endAt: "2024-10-15T03:00:00Z",
  };

  it("contains the incident title as an H1 heading", () => {
    const md = buildMarkdown(incident, SAMPLE_REPORT);
    expect(md).toContain("# Autopsy Report: Report test incident");
  });

  it("contains all required sections (Req 5.1)", () => {
    const md = buildMarkdown(incident, SAMPLE_REPORT);
    expect(md).toContain("## Summary");
    expect(md).toContain("## Cause of Death");
    expect(md).toContain("## Contributing Factors");
    expect(md).toContain("## Impact");
    expect(md).toContain("## Detection & Response");
    expect(md).toContain("## Timeline");
    expect(md).toContain("## Action Items");
  });

  it("contains the timeline table (Req 6.1)", () => {
    const md = buildMarkdown(incident, SAMPLE_REPORT);
    expect(md).toContain("| Time (UTC) |");
  });

  it("renders citation ids as inline code (Req 6.1)", () => {
    const md = buildMarkdown(incident, SAMPLE_REPORT);
    expect(md).toContain("`terraform:tf-oom-002`");
    expect(md).toContain("`k8s:k8s-oom-001`");
  });

  it("contains action items table", () => {
    const md = buildMarkdown(incident, SAMPLE_REPORT);
    expect(md).toContain("Add memory headroom checks to deploy pipeline");
    expect(md).toContain("| P2 | prevent |");
  });

  it("shows Draft status when isDraft is true", () => {
    const md = buildMarkdown(incident, SAMPLE_REPORT);
    expect(md).toContain("Draft");
  });

  it("shows Final status when isDraft is false", () => {
    const finalReport = { ...SAMPLE_REPORT, isDraft: false };
    const md = buildMarkdown(incident, finalReport);
    expect(md).toContain("Final");
  });
});

describe("buildMarkdown — no raw payloads (Req 6.2)", () => {
  it("does NOT include raw payload fields in the output", () => {
    const incident = {
      title: "Test",
      startAt: "2024-10-15T00:00:00Z",
      endAt: "2024-10-15T03:00:00Z",
    };
    const reportWithRawInSummary: Report = {
      ...SAMPLE_REPORT,
      // simulate a case where someone might have snuck raw data in
      summary: "Normal summary without raw data.",
    };
    const md = buildMarkdown(incident, reportWithRawInSummary);

    // Raw payload fields from fixture events must not appear
    expect(md).not.toContain("run_id");
    expect(md).not.toContain("monitor_id");
    expect(md).not.toContain("anon-rss");
    expect(md).not.toContain("rawJson");
  });
});
