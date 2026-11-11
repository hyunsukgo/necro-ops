/**
 * Autopsy page — exhume panel, stitched timeline, and report view. Req 8.3, 8.4
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { fetchIncidentDetail } from "@/lib/incidents";
import { ExhumePanel } from "@/components/ExhumePanel";
import { TimelineView } from "@/components/TimelineView";
import { ReportView } from "@/components/ReportView";
import { StatusChip } from "@/components/StatusChip";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const incident = await fetchIncidentDetail(id);
  if (!incident) notFound();

  const canGenerate =
    incident.status === "exhumed" || incident.status === "autopsied";

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-6">
        <Link
          href="/morgue"
          className="text-sm text-morgue-muted hover:text-formaldehyde-green"
        >
          ← Back to the Morgue
        </Link>
      </div>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="mb-2 text-3xl font-bold tracking-tight text-formaldehyde-green">
            {incident.title}
          </h1>
          <p className="font-mono text-sm text-morgue-muted">
            {fmtDate(incident.startAt)} → {fmtDate(incident.endAt)}
          </p>
          <div className="mt-2 flex flex-wrap gap-1">
            {incident.services.map((svc) => (
              <span
                key={svc}
                className="rounded bg-morgue-surface px-1.5 py-0.5 text-xs text-morgue-muted"
              >
                {svc}
              </span>
            ))}
          </div>
        </div>
        <StatusChip status={incident.status as never} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left column: exhume panel */}
        <div className="space-y-6">
          <ExhumePanel
            incidentId={incident.id}
            initialStatus={incident.status}
            initialRuns={incident.connectorRuns.map((r) => ({
              connector: r.connector,
              status: r.status,
              itemCount: r.itemCount,
            }))}
          />
        </div>

        {/* Right column: timeline + report */}
        <div className="space-y-6">
          <TimelineView
            events={incident.events}
            clusters={incident.clusters}
            suspectedTriggerId={incident.suspectedTriggerId}
          />
          <ReportView
            incidentId={incident.id}
            initialReport={incident.report}
            canGenerate={canGenerate}
          />
        </div>
      </div>
    </main>
  );
}
