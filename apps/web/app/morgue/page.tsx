/**
 * The Morgue — incident list page. Req 1.4, 8.2
 * Lists incidents as "tombstones", newest first, with a new-incident form.
 */

import Link from "next/link";
import { fetchIncidents } from "@/lib/incidents";
import { NewIncidentForm } from "@/components/NewIncidentForm";
import { StatusChip } from "@/components/StatusChip";

export const dynamic = "force-dynamic";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

export default async function MorguePage() {
  const incidents = await fetchIncidents();

  return (
    <main className="mx-auto max-w-5xl px-4 py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="mb-2 text-4xl font-bold tracking-tight text-formaldehyde-green">
            ☠ The Morgue
          </h1>
          <p className="text-morgue-muted">
            Every resolved incident, awaiting its autopsy.
          </p>
        </div>
        <NewIncidentForm />
      </header>

      {incidents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-morgue-border bg-morgue-surface/50 p-12 text-center">
          <p className="text-morgue-muted">
            The morgue is empty. Register an incident to begin the autopsy.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {incidents.map((inc) => (
            <li key={inc.id}>
              <Link
                href={`/incidents/${inc.id}`}
                className="tombstone block focus-visible:outline focus-visible:outline-2 focus-visible:outline-formaldehyde-green"
              >
                <div className="mb-3 flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-morgue-text">{inc.title}</h2>
                  <StatusChip status={inc.status as never} />
                </div>
                <p className="mb-2 font-mono text-xs text-morgue-muted">
                  {fmtDate(inc.startAt)}
                </p>
                <div className="flex flex-wrap gap-1">
                  {inc.services.map((svc) => (
                    <span
                      key={svc}
                      className="rounded bg-morgue-bg px-1.5 py-0.5 text-xs text-morgue-muted"
                    >
                      {svc}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
