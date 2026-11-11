/**
 * SourceBadge — coloured pill with source-specific icon. Req 8.1, 8.3
 */
const SOURCE_STYLES: Record<string, { bg: string; label: string; icon: string }> = {
  datadog:   { bg: "bg-[#632ca6]/30 text-purple-300  border border-[#632ca6]/50", label: "Datadog",   icon: "🐶" },
  k8s:       { bg: "bg-[#326ce5]/30 text-blue-300   border border-[#326ce5]/50", label: "K8s",       icon: "⎈" },
  terraform: { bg: "bg-[#7b42bc]/30 text-violet-300 border border-[#7b42bc]/50", label: "Terraform", icon: "◈" },
  slack:     { bg: "bg-[#4a154b]/30 text-pink-300   border border-[#4a154b]/50", label: "Slack",     icon: "💬" },
  mock:      { bg: "bg-teal-900/30  text-teal-300   border border-teal-700/50",  label: "Mock",      icon: "🧪" },
};

interface SourceBadgeProps {
  source: string;
  className?: string;
}

export function SourceBadge({ source, className = "" }: SourceBadgeProps) {
  const style = SOURCE_STYLES[source] ?? {
    bg: "bg-slate-800 text-slate-400 border border-slate-700",
    label: source,
    icon: "◆",
  };

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-mono font-medium ${style.bg} ${className}`}
    >
      <span aria-hidden="true">{style.icon}</span>
      {style.label}
    </span>
  );
}
