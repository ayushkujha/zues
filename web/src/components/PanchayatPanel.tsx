import { useEffect, useState } from "react";
import { api } from "../api";
import { SEVERITY_ORDER, VARIABLES, cropLabel, dayLabel, fmt, fmtRain, signed } from "../lib/format";
import type { Advisory, GPForecast } from "../types";
import { ConfidenceBadge, SeverityBadge } from "./Badges";
import { RainChart, TemperatureChart } from "./ForecastCharts";
import { Icon, WeatherIcon } from "./Icon";

interface Props {
  runId: string;
  gp: number;
  dayIndex: number;
  onDay: (i: number) => void;
  onClose: () => void;
}

const LANG_OPTIONS = [
  { id: "en", label: "EN" },
  { id: "hi", label: "हिं" },
  { id: "kn", label: "ಕ" },
];

// For these variables a higher value is "wetter", so the delta colours are flipped.
const WET = new Set(["rain_mm", "rh_max_pct", "rh_min_pct"]);

export default function PanchayatPanel({ runId, gp, dayIndex, onDay, onClose }: Props) {
  const [fc, setFc] = useState<GPForecast | null>(null);
  const [adv, setAdv] = useState<Advisory[]>([]);
  const [lang, setLang] = useState("en");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setFc(null);
    setErr(null);
    api.forecast(runId, gp).then(setFc).catch((e) => setErr(e.message));
  }, [runId, gp]);

  useEffect(() => {
    api.gpAdvisories(runId, gp, lang).then(setAdv).catch(() => setAdv([]));
  }, [runId, gp, lang]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const day = fc?.days[dayIndex];
  const sorted = [...adv].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return (
    <aside className="drawer" aria-label="Panchayat detail">
      <div className="drawer-head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>{fc?.gp_name ?? "Loading…"}</h2>
          <div className="meta">
            {fc ? <>{fc.block_name} block · {fc.area_km2?.toFixed(1)} km² · <span className="mono">LGD {fc.gp_lgd}</span></> : " "}
          </div>
        </div>
        <a className="btn sm" href={`#/farmer/${gp}`} title="Open what a farmer in this panchayat sees">
          <Icon name="phone" size={14} /> Farmer view
        </a>
        <button className="iconbtn sm" onClick={onClose} aria-label="Close panel" title="Close (Esc)"><Icon name="x" /></button>
      </div>

      <div className="drawer-body">
        {err && <div className="notice error"><Icon name="alert" /><span>{err}</span></div>}
        {!fc && !err && <div className="empty" style={{ padding: 40 }}><span className="spinner" /></div>}
        {fc && (
          <>
            <div className="days5" role="tablist" aria-label="Forecast day">
              {fc.days.map((d, i) => (
                <button key={d.valid_date} className={`day5 ${i === dayIndex ? "on" : ""}`} onClick={() => onDay(i)} role="tab" aria-selected={i === dayIndex}>
                  <span className="dn">{dayLabel(d.valid_date).split(",")[0]}</span>
                  <WeatherIcon rain={d.rain_mm?.value} cloud={d.cloud_okta?.value} size={24} />
                  <span className="rv">{fmtRain(d.rain_mm?.value ?? 0)}<small className="faint"> mm</small></span>
                  <span className="tv">{fmt(d.tmax_c?.value, 0)}° / {fmt(d.tmin_c?.value, 0)}°</span>
                </button>
              ))}
            </div>

            {day && (
              <section>
                <h3>{dayLabel(day.valid_date, "long")}</h3>
                <table className="cmp">
                  <thead>
                    <tr>
                      <td />
                      <td className="gpv small faint">Panchayat</td>
                      <td className="blk small">Block</td>
                      <td className="dlt small faint">Diff</td>
                    </tr>
                  </thead>
                  <tbody>
                    {VARIABLES.map((v) => {
                      const x = day[v.id];
                      if (!x) return null;
                      const diff = x.value !== null && x.block !== null ? x.value - x.block : null;
                      const warmer = diff !== null && Math.abs(diff) >= 0.05 ? (diff > 0) !== WET.has(v.id) : null;
                      return (
                        <tr key={v.id}>
                          <td>
                            {v.label} <span className="faint small">{v.unit}</span>
                            {x.confidence === "low" && <> <ConfidenceBadge level="low" /></>}
                          </td>
                          <td className="gpv" title={x.p10 !== null && x.p90 !== null ? `Likely range ${fmt(x.p10, v.digits)}–${fmt(x.p90, v.digits)}` : undefined}>
                            {fmt(x.value, v.digits)}
                            {x.p10 !== null && x.p90 !== null && (
                              <div className="small faint" style={{ fontWeight: 400 }}>{fmt(x.p10, v.digits)}–{fmt(x.p90, v.digits)}</div>
                            )}
                          </td>
                          <td className="blk">{fmt(x.block, v.digits)}</td>
                          <td className={`dlt ${warmer === null ? "faint" : warmer ? "up" : "down"}`}>{signed(diff, v.digits)}</td>
                        </tr>
                      );
                    })}
                    {day.wind_dir_deg?.value !== null && day.wind_dir_deg?.value !== undefined && (
                      <tr>
                        <td>Wind direction</td>
                        <td className="gpv">{compass(day.wind_dir_deg.value)} <span className="faint small">{fmt(day.wind_dir_deg.value, 0)}°</span></td>
                        <td className="blk">{day.wind_dir_deg.block !== null ? compass(day.wind_dir_deg.block) : "–"}</td>
                        <td />
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            )}

            <section className="chart-card">
              <h3>Temperature</h3>
              <TemperatureChart days={fc.days} activeIndex={dayIndex} />
            </section>
            <section className="chart-card">
              <h3>Rainfall</h3>
              <RainChart days={fc.days} activeIndex={dayIndex} />
            </section>

            <section>
              <div className="row" style={{ marginBottom: 10 }}>
                <h3 style={{ margin: 0 }}>Advisories <span className="faint" style={{ fontWeight: 500 }}>{adv.length}</span></h3>
                <div className="spacer" />
                <div className="seg" role="group" aria-label="Advisory language">
                  {LANG_OPTIONS.map((l) => (
                    <button key={l.id} className={lang === l.id ? "on" : ""} onClick={() => setLang(l.id)} lang={l.id}>{l.label}</button>
                  ))}
                </div>
              </div>
              <div className="advlist">
                {sorted.length === 0 && <div className="muted small">No advisories for this panchayat in this run.</div>}
                {sorted.map((a) => (
                  <div key={a.advisory_id} className={`adv ${a.severity}`}>
                    <div>
                      <div className="top">
                        <SeverityBadge severity={a.severity} />
                        <span className="small muted">{cropLabel(a.crop)}{a.crop_stage ? ` · ${a.crop_stage}` : ""}</span>
                      </div>
                      <p lang={a.lang}>{a.text}</p>
                      <div className="foot">
                        {dayLabel(a.valid_from).split(",")[0]}{a.valid_to !== a.valid_from ? `–${dayLabel(a.valid_to).split(",")[0]}` : ""} · {a.status}
                        {a.machine_translated ? " · translation not yet reviewed" : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </aside>
  );
}

function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
