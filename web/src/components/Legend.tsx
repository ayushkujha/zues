import type { Scale } from "../lib/colors";

interface Props {
  title: string;
  unit?: string;
  scale: Scale;
  /** Words under the two ends of a diverging legend, e.g. ["drier", "wetter"]. */
  ends?: [string, string];
}

export default function Legend({ title, unit, scale, ends }: Props) {
  return (
    <div className="legend">
      <div className="legend-title">
        <b>{title}</b>
        {unit && <span>{unit}</span>}
      </div>
      <div className="legend-steps" aria-hidden="true">
        {scale.steps.map((c, i) => <i key={i} style={{ background: c }} />)}
      </div>
      <div className="legend-ticks" aria-hidden="true">
        {scale.ticks.map((t) => (
          <span key={t.at} style={{ left: `${t.at * 100}%`, transform: t.at === 0 ? "none" : t.at === 1 ? "translateX(-100%)" : undefined }}>
            {t.label}
          </span>
        ))}
      </div>
      {ends && ends[0] && (
        <div className="legend-ends">
          <span>← {ends[0]}</span>
          <span>{ends[1]} →</span>
        </div>
      )}
    </div>
  );
}
