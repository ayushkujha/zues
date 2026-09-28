import { useEffect, useState } from "react";
import { Icon } from "./Icon";

interface Props {
  dates: string[];
  index: number;
  onChange: (i: number) => void;
  /** Optional district value per day, shown under the date with a small bar. */
  values?: (number | null)[];
  unit?: string;
  digits?: number;
  barColor?: string;
  valueTitle?: string;
}

export default function DaySlider({ dates, index, onChange, values, unit, digits = 1, barColor, valueTitle }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => onChange((index + 1) % dates.length), 1400);
    return () => window.clearInterval(t);
  }, [playing, index, dates.length, onChange]);

  const nums = (values ?? []).filter((v): v is number => v !== null);
  // Bars start a little below the smallest value (never below zero) so day-to-day changes stay visible.
  const min = nums.length ? Math.min(...nums) : 0;
  const hi = nums.length ? Math.max(...nums) : 1;
  const lo = Math.max(0, min - (hi - min) * 0.6 - 1e-6);

  return (
    <div className="float panel timeline" role="tablist" aria-label="Forecast day">
      <button className="iconbtn tl-play" onClick={() => setPlaying((p) => !p)} title={playing ? "Pause" : "Play through the days"}
        aria-label={playing ? "Pause" : "Play through the days"}>
        <Icon name={playing ? "pause" : "play"} size={15} />
      </button>
      {dates.map((d, i) => {
        const v = values?.[i];
        const dt = new Date(`${d}T00:00:00`);
        return (
          <button key={d} className={`tl-day ${i === index ? "on" : ""}`} onClick={() => { setPlaying(false); onChange(i); }}
            role="tab" aria-selected={i === index} title={valueTitle}>
            <span className="d">
              <b>{dt.toLocaleDateString("en-IN", { weekday: "short" })}</b> {dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
            </span>
            {values && (
              <>
                <span className="v">{v === null || v === undefined ? "–" : v.toFixed(digits)} <small>{unit}</small></span>
                <span className="bar"><i style={{ width: v === null || v === undefined ? 0 : `${Math.max(4, ((v - lo) / (hi - lo || 1)) * 100)}%`, background: barColor }} /></span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
