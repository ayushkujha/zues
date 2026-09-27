import { useEffect, useState } from "react";

interface Props {
  dates: string[];
  index: number;
  onChange: (i: number) => void;
}

export default function DaySlider({ dates, index, onChange }: Props) {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => onChange((index + 1) % dates.length), 1400);
    return () => window.clearInterval(t);
  }, [playing, index, dates.length, onChange]);

  return (
    <div className="dayslider" role="tablist" aria-label="Forecast day">
      {dates.map((d, i) => (
        <button key={d} className={i === index ? "on" : ""} onClick={() => onChange(i)} role="tab" aria-selected={i === index}>
          <span className="d">Day {i + 1}</span>
          {new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}
        </button>
      ))}
      <button onClick={() => setPlaying((p) => !p)} title={playing ? "Pause" : "Animate days"} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "⏸" : "▶"}
      </button>
    </div>
  );
}
