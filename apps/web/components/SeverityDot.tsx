/**
 * SeverityDot — small coloured dot indicating severity. Req 8.3
 */
const SEVERITY_COLORS: Record<string, string> = {
  info:     "bg-blue-400",
  warning:  "bg-yellow-400",
  critical: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]",
};

interface SeverityDotProps {
  severity: string;
  className?: string;
}

export function SeverityDot({ severity, className = "" }: SeverityDotProps) {
  const color = SEVERITY_COLORS[severity] ?? "bg-slate-500";
  return (
    <span
      className={`inline-block h-2 w-2 rounded-full ${color} ${className}`}
      aria-label={severity}
      title={severity}
    />
  );
}
