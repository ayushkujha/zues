import type { Scale } from "../lib/colors";

export default function Legend({ title, scale }: { title: string; scale: Scale }) {
  if (scale.kind === "categorical") {
    return (
      <div className="legend">
        <div className="legend-title">{title}</div>
        <div className="legend-cats">
          {scale.stops.map((s) => (
            <FragmentRow key={s.label} color={s.color} label={s.label} />
          ))}
        </div>
      </div>
    );
  }
  const first = scale.stops[0]?.label;
  const mid = scale.stops[Math.floor(scale.stops.length / 2)]?.label;
  const last = scale.stops[scale.stops.length - 1]?.label;
  return (
    <div className="legend">
      <div className="legend-title">{title}</div>
      <div className="legend-bar">
        {scale.stops.map((s, i) => (
          <span key={i} style={{ background: s.color }} />
        ))}
      </div>
      <div className="legend-labels">
        <span>{first}</span>
        <span>{mid}</span>
        <span>{last}</span>
      </div>
    </div>
  );
}

function FragmentRow({ color, label }: { color: string; label: string }) {
  return (
    <>
      <i style={{ background: color }} />
      <span className="num">{label}</span>
    </>
  );
}
