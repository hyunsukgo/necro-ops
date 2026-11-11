/**
 * ReportView — renders the autopsy report with citation links, edit mode,
 * generate button, and Markdown export. Req 5.2, 5.5, 6.1, 8.4
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Report } from "@necro-ops/core";

interface ReportViewProps {
  incidentId: string;
  initialReport: Report | null;
  canGenerate: boolean;
}

/** Scroll to an event in the timeline when a citation is clicked. */
function scrollToEvent(eventId: string) {
  const el = document.getElementById(`event-${eventId}`);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-formaldehyde-green");
    setTimeout(() => el.classList.remove("ring-2", "ring-formaldehyde-green"), 1500);
  }
}

function Citations({ ids }: { ids: string[] }) {
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1">
      {ids.map((id) => (
        <button
          key={id}
          onClick={() => scrollToEvent(id)}
          className="rounded bg-formaldehyde-green/15 px-1.5 py-0.5 font-mono text-[10px] text-formaldehyde-green hover:bg-formaldehyde-green/30"
          title={`Jump to ${id}`}
        >
          {id}
        </button>
      ))}
    </span>
  );
}

export function ReportView({
  incidentId,
  initialReport,
  canGenerate,
}: ReportViewProps) {
  const router = useRouter();
  const [report, setReport] = useState<Report | null>(initialReport);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftSummary, setDraftSummary] = useState("");

  async function generate() {
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/autopsy`, {
        method: "POST",
      });
      if (res.ok) {
        const r = (await res.json()) as Report;
        setReport(r);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveSummaryEdit() {
    if (!report) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/incidents/${incidentId}/report`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary: draftSummary }),
      });
      if (res.ok) {
        const r = (await res.json()) as Report;
        setReport(r);
        setEditing(false);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (!report) {
    return (
      <section className="rounded-xl border border-morgue-border bg-morgue-surface p-5">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-wide text-morgue-muted">
          Autopsy Report
        </h2>
        {canGenerate ? (
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="rounded-lg bg-stitch-red px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Performing autopsy…" : "☠ Perform Autopsy"}
          </button>
        ) : (
          <p className="text-morgue-muted italic">
            Exhume the incident first to collect evidence.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-morgue-border bg-morgue-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide text-morgue-muted">
          Autopsy Report
        </h2>
        <div className="flex items-center gap-2">
          {report.isDraft && (
            <span className="rounded-full bg-purple-900/40 px-2 py-0.5 text-xs text-purple-300">
              AI draft · {report.generatedBy}
            </span>
          )}
          <a
            href={`/api/incidents/${incidentId}/report.md`}
            className="rounded-lg border border-morgue-border px-3 py-1.5 text-xs font-semibold text-morgue-text hover:border-formaldehyde-green"
          >
            ⬇ Export .md
          </a>
          <button
            onClick={() => void generate()}
            disabled={busy}
            className="rounded-lg border border-morgue-border px-3 py-1.5 text-xs font-semibold text-morgue-text hover:border-formaldehyde-green disabled:opacity-50"
          >
            Regenerate
          </button>
        </div>
      </div>

      {/* Summary */}
      <div className="mb-5">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase text-formaldehyde-green">Summary</h3>
          {!editing && (
            <button
              onClick={() => { setDraftSummary(report.summary); setEditing(true); }}
              className="text-xs text-morgue-muted hover:text-morgue-text"
            >
              ✎ Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draftSummary}
              onChange={(e) => setDraftSummary(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-morgue-border bg-morgue-bg px-3 py-2 text-sm text-morgue-text focus:border-formaldehyde-green focus:outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg px-3 py-1 text-xs text-morgue-muted hover:text-morgue-text"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveSummaryEdit()}
                disabled={busy}
                className="rounded-lg bg-formaldehyde-green px-3 py-1 text-xs font-semibold text-morgue-bg disabled:opacity-50"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-morgue-text">{report.summary}</p>
        )}
      </div>

      {/* Cause of Death */}
      <div className="mb-5">
        <h3 className="mb-1 text-xs font-bold uppercase text-stitch-red-light">
          Cause of Death
        </h3>
        <ul className="space-y-2">
          {report.causeOfDeath.map((c, i) => (
            <li key={i} className="text-sm text-morgue-text">
              {c.text}
              <Citations ids={c.citations} />
            </li>
          ))}
        </ul>
      </div>

      {/* Contributing Factors */}
      <div className="mb-5">
        <h3 className="mb-1 text-xs font-bold uppercase text-morgue-muted">
          Contributing Factors
        </h3>
        <ul className="space-y-2">
          {report.contributingFactors.map((c, i) => (
            <li key={i} className="text-sm text-morgue-text">
              {c.text}
              <Citations ids={c.citations} />
            </li>
          ))}
        </ul>
      </div>

      {/* Impact + Detection */}
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase text-morgue-muted">Impact</h3>
          <p className="text-sm text-morgue-text">{report.impact}</p>
        </div>
        <div>
          <h3 className="mb-1 text-xs font-bold uppercase text-morgue-muted">
            Detection &amp; Response
          </h3>
          <p className="text-sm text-morgue-text">{report.detectionAndResponse}</p>
        </div>
      </div>

      {/* Action Items */}
      <div>
        <h3 className="mb-2 text-xs font-bold uppercase text-morgue-muted">Action Items</h3>
        <ul className="space-y-1">
          {report.actionItems.map((a, i) => (
            <li key={i} className="flex items-center gap-2 text-sm text-morgue-text">
              <span className="rounded bg-morgue-bg px-1.5 py-0.5 font-mono text-[10px] text-morgue-muted">
                {a.priority}
              </span>
              <span className="rounded bg-morgue-bg px-1.5 py-0.5 text-[10px] text-morgue-muted">
                {a.type}
              </span>
              {a.title}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
