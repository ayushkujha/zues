import { SEVERITY_ICON } from "../lib/colors";
import { SEVERITY_LABEL } from "../lib/format";
import type { Severity } from "../types";

export function SeverityBadge({ severity, label }: { severity: Severity; label?: string }) {
  return (
    <span className={`badge sev-${severity}`}>
      <span aria-hidden>{SEVERITY_ICON[severity]}</span>
      {label ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

export function ConfidenceBadge({ level }: { level?: string | null }) {
  if (!level) return null;
  const cls = level === "high" ? "sev-green" : level === "low" ? "sev-orange" : "neutral";
  return <span className={`badge ${cls}`}>{level} confidence</span>;
}

export function SourceBadge({ source }: { source: string }) {
  const cls = source === "official" ? "sev-green" : source === "emulated" ? "sev-yellow" : "info";
  return <span className={`badge ${cls}`}>{source}</span>;
}
