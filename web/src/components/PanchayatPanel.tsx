import { useEffect, useState } from "react";
import { api } from "../api";
import { SEVERITY_ORDER, VARIABLES, dayLabel, cropLabel, fmtRain, fmtVar, signed, weatherIcon } from "../lib/format";
import type { Advisory, GPForecast } from "../types";
import { ConfidenceBadge, SeverityBadge } from "./Badges";
import { RainChart, TemperatureChart } from "./ForecastCharts";

interface Props {
  runId: string;
  gp: number;
  dayIndex: number;
  onDay: (i: number) => void;
  onClose: () => void;
}

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

  const day = fc?.days[dayIndex];
  const sorted = [...adv].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));

  return (
    <aside className="panel" aria-label="Panchayat detail">
      <div className="panel-head">
        <div className="row">
          <div>
            <h2 style={{ fontSize: 17 }}>{fc?.gp_name ?? "…"}</h2>
            <div className="muted small">
              {fc ? `${fc.block_name} · ${fc.area_km2?.toFixed(1)} km² · LGD ${fc.gp_lgd}` : "Loading"}
            </div>
          </div>
          <div className="spacer" />
          <a className="btn sm" href={`#/farmer/${gp}`} title="Open the farmer view for this panchayat">Farmer view</a>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close panel">✕</button>
        </div>
      </div>
      <div className="panel-body">
        {err && <div className="errorbox">{err}</div>}
        {fc && (
          <>
            <div className="daycards">
              {fc.days.map((d, i) => (
                <button key={d.valid_date} className={`daycard ${i === dayIndex ? "on" : ""}`} onClick={() => onDay(i)}>
                  <div className="dd">{dayLabel(d.valid_date).split(",")[0]}</div>
                  <div className="ic" aria-hidden>{weatherIcon(d.rain_mm?.value, d.cloud_okta?.value)}</div>
                  <div className="rv">{fmtRain(d.rain_mm?.value ?? 0)} mm</div>
                  <div className="tv">{d.tmax_c?.value?.toFixed(0)}° / {d.tmin_c?.value?.toFixed(0)}°</div>
                </button>
              ))}
            </div>

            <section>
              <h3 className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 4 }}>Temperature (°C)</h3>
              <TemperatureChart days={fc.days} />
            </section>
            <section>
              <h3 className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".03em", marginBottom: 4 }}>Rainfall (mm/day)</h3>
              <RainChart days={fc.days} />
            </section>

            {day && (
              <section>
                <div className="row" style={{ marginBottom: 6 }}>
                  <h3 className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".03em" }}>
                    {dayLabel(day.valid_date, "long")}: panchayat vs block
                  </h3>
                </div>
                <div className="table-wrap">
                  <table className="tbl">
                    <thead>
                      <tr><th>Variable</th><th className="r">Panchayat</th><th className="r">Block</th><th className="r">Diff</th><th>Range (p10–p90)</th></tr>
                    </thead>
                    <tbody>
                      {VARIABLES.map((v) => {
                        const x = day[v.id];
                        if (!x) return null;
                        const diff = x.value !== null && x.block !== null ? x.value - x.block : null;
                        return (
                          <tr key={v.id}>
                            <td>{v.label}</td>
                            <td className="r"><b>{fmtVar(v.id, x.value)}</b></td>
                            <td className="r">{fmtVar(v.id, x.block)}</td>
                            <td className="r">{signed(diff, v.digits)}</td>
                            <td className="small muted num">
                              {x.p10 !== null && x.p90 !== null ? `${x.p10.toFixed(v.digits)}–${x.p90.toFixed(v.digits)}` : "–"}{" "}
                              <ConfidenceBadge level={x.confidence} />
                            </td>
                          </tr>
                        );
                      })}
                      {day.wind_dir_deg && (
                        <tr><td>Wind direction</td><td className="r"><b>{day.wind_dir_deg.value?.toFixed(0)}°</b></td><td className="r">{day.wind_dir_deg.block?.toFixed(0)}°</td><td /><td /></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <section>
              <div className="row" style={{ marginBottom: 8 }}>
                <h3 className="small muted" style={{ textTransform: "uppercase", letterSpacing: ".03em" }}>Advisories ({adv.length})</h3>
                <div className="spacer" />
                <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Advisory language">
                  <option value="en">English</option>
                  <option value="hi">हिंदी</option>
                  <option value="kn">ಕನ್ನಡ</option>
                </select>
              </div>
              <div className="stack" style={{ gap: 8 }}>
                {sorted.length === 0 && <div className="muted small">No advisories for this panchayat.</div>}
                {sorted.map((a) => (
                  <div key={a.advisory_id} className={`adv sev-${a.severity}`}>
                    <div className="meta">
                      <SeverityBadge severity={a.severity} />
                      <span className="badge neutral">{cropLabel(a.crop)}{a.crop_stage ? ` · ${a.crop_stage}` : ""}</span>
                      {a.machine_translated && <span className="badge neutral" title="Translation not yet reviewed by a native speaker">unreviewed translation</span>}
                    </div>
                    <div>{a.text}</div>
                    <div className="small faint" style={{ marginTop: 3 }}>Rule {a.rule_id} · {a.status}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
        {!fc && !err && <div className="empty"><span className="spinner" /></div>}
      </div>
    </aside>
  );
}
