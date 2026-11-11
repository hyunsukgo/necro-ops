/**
 * StatusChip — coloured pill showing incident or connector status.
 * Req 8.2, 8.3
 */
"use client";

type IncidentStatus = "pending" | "exhuming" | "exhumed" | "autopsied" | "failed";
type ConnectorStatus = "pending" | "running" | "done" | "skipped" | "failed";

const INCIDENT_STYLES: Record<IncidentStatus, string> = {
  pending:   "bg-blue-900/40   text-blue-300   border border-blue-700/40",
  exhuming:  "bg-yellow-900/40 text-yellow-300 border border-yellow-700/40 animate-pulse",
  exhumed:   "bg-green-900/40  text-green-300  border border-green-700/40",
  autopsied: "bg-purple-900/40 text-purple-300 border border-purple-700/40",
  failed:    "bg-red-900/40    text-red-400    border border-red-700/40",
};

const CONNECTOR_STYLES: Record<ConnectorStatus, string> = {
  pending:  "bg-slate-800 text-slate-400 border border-slate-700",
  running:  "bg-yellow-900/40 text-yellow-300 border border-yellow-700/40 animate-pulse",
  done:     "bg-green-900/40  text-green-300  border border-green-700/40",
  skipped:  "bg-slate-800 text-slate-500 border border-slate-700",
  failed:   "bg-red-900/40    text-red-400    border border-red-700/40",
};

const ICONS: Record<string, string> = {
  pending:   "○",
  running:   "◌",
  done:      "✓",
  skipped:   "—",
  failed:    "✗",
  exhuming:  "◌",
  exhumed:   "✓",
  autopsied: "☠",
};

interface StatusChipProps {
  status: IncidentStatus | ConnectorStatus;
  variant?: "incident" | "connector";
  className?: string;
}

export function StatusChip({
  status,
  variant = "incident",
  className = "",
}: StatusChipProps) {
  const styles =
    variant === "connector"
      ? CONNECTOR_STYLES[status as ConnectorStatus] ?? "bg-slate-800 text-slate-400"
      : INCIDENT_STYLES[status as IncidentStatus] ?? "bg-slate-800 text-slate-400";

  const icon = ICONS[status] ?? "?";

  return (
    <span
      className={`status-chip ${styles} ${className}`}
      aria-label={`Status: ${status}`}
    >
      <span aria-hidden="true">{icon}</span>
      {status}
    </span>
  );
}
