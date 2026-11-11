/**
 * TimelineView — stitched vertical timeline with filters and trigger badge.
 * Req 2.2, 4.4, 8.1, 8.3
 */
"use client";

import { useMemo, useState } from "react";
import type { Cluster } from "@necro-ops/core";
import { SourceBadge } from "@/components/SourceBadge";
import { SeverityDot } from "@/components/SeverityDot";

interface TimelineEventLite {
  id: string;
  source: string;
  timestamp: string;
  kind: string;
  severity: string;
  entities: Array<{ type: string; name: string }>;
  summary: string;
  link?: string;
}

interface TimelineViewProps {
  events: TimelineEventLite[];
  clusters: Cluster[];
  suspectedTriggerId: string | null;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function TimelineView({
  events,
  clusters,
  suspectedTriggerId,
}: TimelineViewProps) {
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const sources = useMemo(
    () => [...new Set(events.map((e) => e.source))].sort(),
    [events],
  );

  // Map each event id → cluster index for the "stitch" colouring
  const clusterOf = useMemo(() => {
    const map = new Map<string, number>();
    clusters.forEach((c, i) => {
      for (const eid of c.eventIds) map.set(eid, i);
    });
    return map;
  }, [clusters]);

  const filtered = useMemo(
    () =>
      events.filter(
        (e) =>
          (sourceFilter === "all" || e.source === sourceFilter) &&
          (severityFilter === "all" || e.severity === severityFilter),
      ),
    [events, sourceFilter, severityFilter],
  );

  if (events.length === 0) {
    return (
      <section className="rounded-xl border border-morgue-border bg-morgue-surface p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-morgue-muted">
          Stitched Timeline
        </h2>
        <p className="text-morgue-muted italic">
          No events yet. Run Exhume to collect evidence.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-morgue-border bg-morgue-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-morgue-muted">
          Stitched Timeline
        </h2>
        <div className="flex gap-2">
          <select
            aria-label="Filter by source"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="rounded-lg border border-morgue-border bg-morgue-bg px-2 py-1 text-xs text-morgue-text [color-scheme:dark]"
          >
            <option value="all">All sources</option>
            {sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select
            aria-label="Filter by severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-morgue-border bg-morgue-bg px-2 py-1 text-xs text-morgue-text [color-scheme:dark]"
          >
            <option value="all">All severities</option>
            <option value="info">Info</option>
            <option value="warning">Warning</option>
            <option value="critical">Critical</option>
          </select>
        </div>
      </div>

      <ol className="relative space-y-1 border-l-2 border-morgue-border pl-5">
        {filtered.map((e) => {
          const isTrigger = e.id === suspectedTriggerId;
          const clusterIdx = clusterOf.get(e.id);
          return (
            <li
              key={e.id}
              id={`event-${e.id}`}
              className={`relative rounded-lg px-3 py-2 transition-colors ${
                isTrigger
                  ? "bg-formaldehyde-green/10 ring-1 ring-formaldehyde-green/40"
                  : "hover:bg-morgue-bg"
              }`}
            >
              {/* stitch node on the timeline spine */}
              <span
                className={`absolute -left-[1.6rem] top-3 h-3 w-3 rounded-full border-2 border-morgue-bg ${
                  isTrigger ? "bg-formaldehyde-green" : "bg-morgue-border"
                }`}
                aria-hidden="true"
              />
              <div className="flex flex-wrap items-center gap-2">
                <SeverityDot severity={e.severity} />
                <span className="font-mono text-xs text-morgue-muted">
                  {fmtTime(e.timestamp)}
                </span>
                <SourceBadge source={e.source} />
                {clusterIdx !== undefined && (
                  <span className="rounded bg-morgue-bg px-1.5 py-0.5 text-[10px] text-morgue-muted">
                    cluster {clusterIdx + 1}
                  </span>
                )}
                {isTrigger && (
                  <span className="rounded-full bg-formaldehyde-green/20 px-2 py-0.5 text-[10px] font-semibold text-formaldehyde-green">
                    ⚡ suspected trigger
                  </span>
                )}
              </div>
              <p className="mt-1 text-sm text-morgue-text">{e.summary}</p>
              {e.link && (
                <a
                  href={e.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-block text-xs text-formaldehyde-green hover:underline"
                >
                  View source ↗
                </a>
              )}
            </li>
          );
        })}
      </ol>

      {filtered.length === 0 && (
        <p className="mt-4 text-sm text-morgue-muted italic">
          No events match the current filters.
        </p>
      )}
    </section>
  );
}
