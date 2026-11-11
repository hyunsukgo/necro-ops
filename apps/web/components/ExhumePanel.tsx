/**
 * ExhumePanel — triggers exhume and shows per-connector progress via SSE.
 * Req 2.2, 8.3
 */
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { streamExhume } from "@/lib/sse-client";
import type { ConnectorResult } from "@/lib/exhume";
import { StatusChip } from "@/components/StatusChip";
import { SourceBadge } from "@/components/SourceBadge";

const KNOWN_CONNECTORS = ["mock", "datadog", "k8s", "terraform", "slack"];

interface ExhumePanelProps {
  incidentId: string;
  initialStatus: string;
  initialRuns: Array<{ connector: string; status: string; itemCount: number }>;
}

export function ExhumePanel({
  incidentId,
  initialStatus,
  initialRuns,
}: ExhumePanelProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<Record<string, ConnectorResult>>(() => {
    const seed: Record<string, ConnectorResult> = {};
    for (const r of initialRuns) {
      seed[r.connector] = {
        connectorId: r.connector as ConnectorResult["connectorId"],
        status: r.status as ConnectorResult["status"],
        itemCount: r.itemCount,
      };
    }
    return seed;
  });

  function startExhume() {
    setRunning(true);
    setResults({});
    streamExhume(incidentId, {
      onProgress(r) {
        setResults((prev) => ({ ...prev, [r.connectorId]: r }));
      },
      onComplete() {
        setRunning(false);
        router.refresh();
      },
      onError() {
        setRunning(false);
        router.refresh();
      },
    });
  }

  const connectorsToShow =
    Object.keys(results).length > 0 ? Object.keys(results) : KNOWN_CONNECTORS;

  return (
    <section className="rounded-xl border border-morgue-border bg-morgue-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-bold uppercase tracking-wide text-morgue-muted">
          Exhume
        </h2>
        <button
          onClick={startExhume}
          disabled={running}
          className="rounded-lg border border-formaldehyde-green/50 bg-formaldehyde-green/10 px-3 py-1.5 text-sm font-semibold text-formaldehyde-green transition-colors hover:bg-formaldehyde-green/20 disabled:opacity-50"
        >
          {running ? "Exhuming…" : initialStatus === "pending" ? "Exhume" : "Re-exhume"}
        </button>
      </div>

      <ul className="space-y-2">
        {connectorsToShow.map((cid) => {
          const r = results[cid];
          return (
            <li
              key={cid}
              className="flex items-center justify-between rounded-lg bg-morgue-bg px-3 py-2"
            >
              <SourceBadge source={cid} />
              <div className="flex items-center gap-3">
                {r && r.itemCount > 0 && (
                  <span className="font-mono text-xs text-morgue-muted">
                    {r.itemCount} events
                  </span>
                )}
                <StatusChip
                  status={(r?.status ?? "pending") as never}
                  variant="connector"
                />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
