/**
 * template.ts — deterministic template-based autopsy report generator.
 *
 * Requirements 5.1, 5.4:
 *   5.1 — Report MUST contain sections: Summary, Cause of Death, Contributing
 *          Factors, Timeline, Impact, Detection & Response, Action Items.
 *   5.4 — When Bedrock is not configured or fails twice, produce a template-
 *          based report from the timeline and suspected trigger.
 *
 * The function is pure and deterministic: identical inputs always produce
 * identical outputs (no randomness, no timestamps injected at call time —
 * the caller supplies `now`).
 *
 * Must NOT import from any package other than @necro-ops/core.
 */

import type { Timeline, TimelineEvent } from "@necro-ops/core";
import type { Report, Incident } from "@necro-ops/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Format a UTC ISO-8601 string as "YYYY-MM-DD HH:MM UTC". */
function fmt(ts: string): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/** Capitalise the first letter of a string. */
function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Collect all unique service names across a set of events. */
function affectedServices(events: TimelineEvent[]): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    for (const en of e.entities) {
      if (en.type === "service") seen.add(en.name);
    }
  }
  return [...seen].sort();
}

/** Duration in minutes between two ISO-8601 timestamps, always ≥ 0. */
function durationMinutes(start: string, end: string): number {
  return Math.max(
    0,
    Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000),
  );
}

/**
 * Build a Markdown timeline table from the sorted events in a cluster list.
 * Only includes events that are part of a cluster (all of them, since
 * buildTimeline assigns every event to exactly one cluster).
 */
function buildTimelineMarkdown(timeline: Timeline): string {
  const lines: string[] = [
    "| Time (UTC) | Source | Severity | Summary |",
    "|---|---|---|---|",
  ];
  for (const event of timeline.events) {
    const time = fmt(event.timestamp);
    const sev = cap(event.severity);
    // Escape pipe characters in the summary so the table isn't broken
    const summary = event.summary.replace(/\|/g, "\\|");
    lines.push(`| ${time} | ${event.source} | ${sev} | ${summary} |`);
  }
  return lines.join("\n");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Generate a deterministic template-based postmortem report.
 *
 * @param incident  The incident record (title, window, services).
 * @param timeline  The built timeline (sorted events + clusters + suspected trigger).
 * @param now       The current timestamp (ISO-8601). Injected so the function
 *                  remains pure and testable.
 * @returns         A fully populated `Report` object with `generatedBy: "template"`.
 */
export function templateReport(
  incident: Pick<Incident, "id" | "title" | "startAt" | "endAt" | "services">,
  timeline: Timeline,
  now: string,
): Report {
  const { events, clusters, suspectedTriggerId } = timeline;

  const trigger = suspectedTriggerId
    ? events.find((e) => e.id === suspectedTriggerId)
    : undefined;

  const services = affectedServices(events);
  const serviceList =
    services.length > 0
      ? services.join(", ")
      : incident.services.join(", ") || "unknown";

  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];
  const incidentStart = firstEvent?.timestamp ?? incident.startAt;
  const incidentEnd = lastEvent?.timestamp ?? incident.endAt;
  const durationMins = durationMinutes(incidentStart, incidentEnd);

  // Critical events — used for impact + detection sections
  const criticalEvents = events.filter((e) => e.severity === "critical");
  const firstCritical = criticalEvents[0];

  // Recovery events
  const recoveryEvents = events.filter((e) => e.kind === "recovery");
  const firstRecovery = recoveryEvents[0];

  // ── Summary ────────────────────────────────────────────────────────────────

  const summary =
    `Incident "${incident.title}" affected service(s) ${serviceList} ` +
    `from ${fmt(incidentStart)} to ${fmt(incidentEnd)} ` +
    `(approximately ${durationMins} minute${durationMins !== 1 ? "s" : ""}). ` +
    `The timeline contains ${events.length} event${events.length !== 1 ? "s" : ""} ` +
    `grouped into ${clusters.length} cluster${clusters.length !== 1 ? "s" : ""}. ` +
    (trigger
      ? `The suspected trigger is: ${trigger.summary} [${trigger.id}].`
      : "No suspected trigger was automatically identified.");

  // ── Cause of Death ────────────────────────────────────────────────────────

  const causeOfDeath = trigger
    ? [
        {
          text:
            `The most likely root cause was a change event that preceded the first ` +
            `critical alert: "${trigger.summary}" (source: ${trigger.source}, ` +
            `time: ${fmt(trigger.timestamp)}).`,
          citations: [trigger.id],
        },
      ]
    : firstCritical
      ? [
          {
            text:
              `No change event was found before the first critical alert. ` +
              `The earliest critical signal was: "${firstCritical.summary}" ` +
              `(source: ${firstCritical.source}, time: ${fmt(firstCritical.timestamp)}).`,
            citations: [firstCritical.id],
          },
        ]
      : [
          {
            text:
              "No critical events were detected in the timeline. " +
              "Manual investigation is required to determine the root cause.",
            citations: firstEvent ? [firstEvent.id] : [],
          },
        ];

  // ── Contributing Factors ──────────────────────────────────────────────────

  const contributingFactors: Report["contributingFactors"] = [];

  // One factor per cluster that contains at least one non-trigger event
  for (const cluster of clusters) {
    const clusterEvents = cluster.eventIds
      .map((eid) => events.find((e) => e.id === eid))
      .filter((e): e is TimelineEvent => e !== undefined);

    // Skip clusters that only have the trigger itself
    const nonTrigger = clusterEvents.filter((e) => e.id !== trigger?.id);
    if (nonTrigger.length === 0) continue;

    const severities = [...new Set(nonTrigger.map((e) => e.severity))];
    const hasCritical = severities.includes("critical");

    const entityNames = cluster.entities
      .filter((en) => en.type === "service")
      .map((en) => en.name);
    const entityStr =
      entityNames.length > 0 ? `affecting ${entityNames.join(", ")}` : "";

    contributingFactors.push({
      text:
        `A cluster of ${nonTrigger.length} related event${nonTrigger.length !== 1 ? "s" : ""} ` +
        `${entityStr} was observed between ${fmt(cluster.start)} and ${fmt(cluster.end)}` +
        (hasCritical ? ", including critical-severity signals" : "") +
        ".",
      citations: nonTrigger.slice(0, 3).map((e) => e.id), // cap at 3 citations
    });
  }

  // Fallback: if no clusters contributed, cite the first event
  if (contributingFactors.length === 0 && firstEvent) {
    contributingFactors.push({
      text: "Insufficient event data to determine contributing factors automatically.",
      citations: [firstEvent.id],
    });
  }

  // ── Timeline markdown ─────────────────────────────────────────────────────

  const timelineMarkdown = buildTimelineMarkdown(timeline);

  // ── Impact ────────────────────────────────────────────────────────────────

  const impact =
    `Service(s) ${serviceList} experienced degraded availability for approximately ` +
    `${durationMins} minute${durationMins !== 1 ? "s" : ""}. ` +
    (criticalEvents.length > 0
      ? `${criticalEvents.length} critical alert${criticalEvents.length !== 1 ? "s" : ""} were raised during this period.`
      : "No critical alerts were raised during this period.");

  // ── Detection & Response ──────────────────────────────────────────────────

  const detectionAndResponse = firstCritical
    ? `The incident was first detected via a critical alert at ${fmt(firstCritical.timestamp)} ` +
      `(source: ${firstCritical.source}): "${firstCritical.summary}". ` +
      (firstRecovery
        ? `Recovery was confirmed at ${fmt(firstRecovery.timestamp)}: "${firstRecovery.summary}".`
        : "No explicit recovery event was recorded in the timeline.")
    : "No critical alert was recorded. The incident may have been detected through manual observation.";

  // ── Action Items ──────────────────────────────────────────────────────────

  const actionItems: Report["actionItems"] = [];

  if (trigger) {
    actionItems.push({
      title: `Review change process for ${trigger.source} to add pre-deploy validation`,
      type: "prevent",
      priority: "P2",
    });
  }

  if (criticalEvents.length > 0) {
    actionItems.push({
      title: `Improve alerting thresholds to detect the incident pattern earlier`,
      type: "detect",
      priority: "P2",
    });
  }

  if (durationMins > 30) {
    actionItems.push({
      title: `Create a runbook for faster mitigation of ${serviceList} incidents`,
      type: "mitigate",
      priority: "P3",
    });
  }

  // Always add a postmortem action item
  actionItems.push({
    title: "Schedule a blameless postmortem meeting and share findings with the team",
    type: "prevent",
    priority: "P3",
  });

  return {
    incidentId: incident.id,
    summary,
    causeOfDeath,
    contributingFactors,
    timeline: timelineMarkdown,
    impact,
    detectionAndResponse,
    actionItems,
    isDraft: true,
    generatedBy: "template",
    updatedAt: now,
  };
}
