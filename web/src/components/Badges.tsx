import { SEVERITY_LABEL } from "../lib/format";
import type { Severity } from "../types";
import { SeverityIcon } from "./Icon";

export function SeverityBadge({ severity, label }: { severity: Severity; label?: string }) {
  return (
    <span className={`sev sev-${severity}`}>
      <SeverityIcon severity={severity} size={11} />
      {label ?? SEVERITY_LABEL[severity]}
    </span>
  );
}

export function ConfidenceBadge({ level }: { level?: string | null }) {
  if (!level || level === "high") return null;
  return <span className={`chip ${level === "low" ? "warn" : ""}`} title="How much the models agree for this panchayat">{level} confidence</span>;
}

const SOURCE_LABEL: Record<string, string> = {
  official: "IMD block forecast",
  upload: "Uploaded forecast",
  emulated: "Emulated forecast",
  nwp: "Live NWP forecast",
};

export const sourceLabel = (source: string) => SOURCE_LABEL[source] ?? source;

export function SourceBadge({ source }: { source: string }) {
  return (
    <span className="row" style={{ gap: 7, fontSize: 13 }}>
      <span className={`status-dot ${source}`} />
      {sourceLabel(source)}
    </span>
  );
}
