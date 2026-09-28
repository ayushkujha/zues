import { useEffect, useMemo, useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { Icon } from "../components/Icon";
import { VARIABLES, varInfo } from "../lib/format";
import { useApp } from "../state";
import type { Validation, VariableId } from "../types";

interface Model { id: string; name: string; color: string }
const MODELS: Model[] = [
  { id: "M0", name: "Copy block value", color: "var(--chart-axis)" },
  { id: "M1", name: "Interpolation", color: "#9bb9dd" },
  { id: "M2", name: "+ lapse rate", color: "#5b8fd0" },
  { id: "M3", name: "LightGBM", color: "var(--accent)" },
  { id: "M3S", name: "LightGBM + stations", color: "#d9a400" },
  { id: "M4", name: "U-Net", color: "#b565a7" },
];
const SPLITS: Record<string, { label: string; help: string; phrase: (lead: number) => string }> = {
  test: {
    label: "Held-out year",
    help: "A year the models never saw, with a perfect block forecast as input. Isolates the downscaling error itself.",
    phrase: () => "On the held-out year",
  },
  forecast: {
    label: "Forecast mode",
    help: "The block input carries realistic forecast error that grows with lead time, like a real 5-day bulletin.",
    phrase: (lead) => `For day-${lead} forecasts`,
  },
  spatial_cv: {
    label: "Unseen places",
    help: "Spatial cross-validation: the model is retrained without whole blocks (and without their climatology) and scored only there.",
    phrase: () => "In blocks the model never saw",
  },
  station_cv: {
    label: "Station correction",
    help: "M3 against M3S at weather stations that were held out from fitting the station correction.",
    phrase: () => "At held-out weather stations",
  },
};
const KPI_VARS: VariableId[] = ["tmax_c", "tmin_c", "rain_mm", "wind_kmph"];
const LEAD_VARS: { id: VariableId; color: string }[] = [
  { id: "tmax_c", color: "var(--warm)" },
  { id: "tmin_c", color: "var(--cool)" },
  { id: "rh_min_pct", color: "#2b9580" },
  { id: "rain_mm", color: "#6a5cbd" },
];
const RAIN_CLASS: Record<number, string> = { 2.5: "light", 15.6: "moderate", 64.5: "heavy" };

export default function ValidationPage() {
  const { region, regionId } = useApp();
  const [data, setData] = useState<Validation | null>(null);
  const [level, setLevel] = useState<"station" | "gp">("station");
  const [split, setSplit] = useState("test");
  const [lead, setLead] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!regionId) return;
    setData(null);
    api.validation(regionId).then(setData).catch((e) => setErr(e.message));
  }, [regionId]);

  const splits = useMemo(() => Object.keys(SPLITS).filter((s) => (data?.metrics ?? []).some((m) => m.split === s)), [data]);
  useEffect(() => {
    if (splits.length && !splits.includes(split)) setSplit(splits[0]);
  }, [splits, split]);
  const levels = useMemo(() => new Set((data?.metrics ?? []).filter((m) => m.split === split).map((m) => m.level)), [data, split]);
  useEffect(() => {
    if (levels.size && !levels.has(level)) setLevel(levels.has("station") ? "station" : "gp");
  }, [levels, level]);

  const rows = useMemo(
    () => (data?.metrics ?? []).filter((m) => m.split === split && m.level === level && (split !== "forecast" || m.lead_day === lead)),
    [data, split, level, lead],
  );
  const reference = split === "station_cv" ? "M3" : "M0";
  const best = split === "station_cv" ? "M3S" : "M3";
  const skillKey = `skill_vs_${reference}`;
  const get = (model: string, variable: string, metric: string, thr?: number): number | null =>
    rows.find((m) => m.model_id === model && m.variable === variable && m.metric === metric && (thr === undefined || m.threshold === thr))?.value ?? null;
  const models = MODELS.filter((m) => rows.some((r) => r.model_id === m.id));
  const vars = VARIABLES.map((v) => v.id).filter((v) => rows.some((r) => r.variable === v && r.metric === "rmse"));
  const thresholds = [...new Set(rows.filter((r) => r.variable === "rain_mm" && r.metric === "csi").map((r) => r.threshold as number))].sort((a, b) => a - b);
  const bestModel = MODELS.find((m) => m.id === best)!;
  const refName = reference === "M0" ? "copying the block value" : "M3 alone";

  const leadRows = useMemo(() => {
    if (split !== "forecast") return [];
    const all = (data?.metrics ?? []).filter((m) => m.split === "forecast" && m.level === level && m.model_id === "M3" && m.metric === "skill_vs_M0");
    return [1, 2, 3, 4, 5].map((ld) => {
      const o: Record<string, number | string | null> = { lead: `Day ${ld}` };
      for (const v of LEAD_VARS) o[v.id] = pct(all.find((m) => m.variable === v.id && m.lead_day === ld)?.value ?? null);
      return o;
    });
  }, [data, split, level]);

  if (err) return <div className="page"><div className="notice error"><Icon name="alert" /><span>{err}</span></div></div>;
  if (!data) return <div className="empty"><span className="spinner" /></div>;
  if (!data.metrics.length) {
    return (
      <div className="page">
        <div className="empty">
          <h2>No validation results yet</h2>
          <p>Run <code className="mono">pcast evaluate {regionId}</code> on the server.</p>
        </div>
      </div>
    );
  }

  const skills = vars.map((v) => ({ v, s: get(best, v, skillKey) })).filter((x): x is { v: VariableId; s: number } => x.s !== null);
  const headline = makeHeadline(SPLITS[split]?.phrase(lead) ?? "", bestModel, refName, skills);
  const synthetic = region?.data_source === "synthetic";

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Validation</h1>
          <p>
            How much each model reduces forecast error compared with {refName}. Model version{" "}
            <span className="mono" style={{ whiteSpace: "nowrap" }}>{data.model_version}</span>.
          </p>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg" role="tablist" aria-label="Evaluation">
          {splits.map((s) => (
            <button key={s} role="tab" aria-selected={split === s} className={split === s ? "on" : ""} onClick={() => setSplit(s)}>{SPLITS[s].label}</button>
          ))}
        </div>
        {split === "forecast" && (
          <div className="seg" role="group" aria-label="Lead day">
            {[1, 2, 3, 4, 5].map((ld) => (
              <button key={ld} className={lead === ld ? "on" : ""} onClick={() => setLead(ld)}>Day {ld}</button>
            ))}
          </div>
        )}
        <div className="spacer" />
        {levels.size > 1 && (
          <div className="seg" role="group" aria-label="Truth">
            <button className={level === "station" ? "on" : ""} onClick={() => setLevel("station")}>vs stations</button>
            <button className={level === "gp" ? "on" : ""} onClick={() => setLevel("gp")}>vs panchayat means</button>
          </div>
        )}
      </div>
      <p className="muted" style={{ marginBottom: 16, maxWidth: 820 }}>
        {SPLITS[split]?.help}{" "}
        {level === "station" ? "Truth: weather-station observations." : "Truth: the area-mean of the fine-resolution field over each panchayat."}
      </p>

      {synthetic && (
        <div className="notice warn" style={{ marginBottom: 20 }}>
          <Icon name="info" />
          <span><b>Synthetic demo data.</b> These scores show the pipeline learns known local effects. They are not real-world skill.</span>
        </div>
      )}

      {headline && <p className="headline">{headline}</p>}

      <div className="kpis">
        {KPI_VARS.filter((v) => vars.includes(v)).map((v) => {
          const s = get(best, v, skillKey);
          return (
            <div key={v} className="kpi">
              <div className={`v ${s === null ? "" : s > 0 ? "good" : "bad"}`}>{s === null ? "–" : `${Math.abs(s * 100).toFixed(0)}%`}</div>
              <div className="l">{s !== null && s < 0 ? "more" : "less"} error in {varInfo(v).label.toLowerCase()}</div>
            </div>
          );
        })}
      </div>

      <div className="grid2">
        <div className="card card-pad">
          <h2 className="section-title">Error reduction by variable</h2>
          <DotPlot
            rows={vars.map((v) => ({
              label: varInfo(v).label,
              values: models.filter((m) => m.id !== reference).map((m) => ({ model: m, value: pct(get(m.id, v, skillKey)) })),
            }))}
            highlight={best}
            format={(v) => `${v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`}
            axisLabel={`% less error than ${refName}`}
            zero
          />
          <ModelLegend models={models.filter((m) => m.id !== reference)} />
        </div>

        {split === "forecast" ? (
          <div className="card card-pad">
            <h2 className="section-title">LightGBM gain by lead day</h2>
            <p className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
              As the block forecast itself gets less accurate, the local detail matters less.
            </p>
            <div className="chart-legend" style={{ marginBottom: 6 }}>
              {LEAD_VARS.map((v) => <span key={v.id}><i style={{ background: v.color }} />{varInfo(v.id).label}</span>)}
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={leadRows} margin={{ top: 8, right: 8, bottom: 0, left: -14 }}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="lead" tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
                <YAxis tick={{ fill: "var(--chart-axis)", fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                <ReferenceLine y={0} stroke="var(--border-strong)" />
                <Tooltip
                  content={({ active, payload, label }) =>
                    active && payload?.length ? (
                      <div className="rc-tooltip">
                        <div className="h">{label}</div>
                        {payload.map((p) => (
                          <div key={String(p.dataKey)} className="kv"><span>{varInfo(p.dataKey as VariableId).label}</span><b>{Number(p.value).toFixed(1)}%</b></div>
                        ))}
                      </div>
                    ) : null
                  }
                />
                {LEAD_VARS.map((v) => (
                  <Line key={v.id} dataKey={v.id} stroke={v.color} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: v.color }} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : thresholds.length > 0 ? (
          <div className="card card-pad">
            <h2 className="section-title">Catching rain events</h2>
            <p className="small muted" style={{ marginTop: -6, marginBottom: 8 }}>
              Critical success index (0 = misses everything, 1 = perfect) for daily rain above each IMD threshold.
            </p>
            <DotPlot
              rows={thresholds.map((t) => ({
                label: `≥ ${t} mm`,
                sub: RAIN_CLASS[t],
                values: models.map((m) => ({ model: m, value: get(m.id, "rain_mm", "csi", t) })),
              }))}
              highlight={best}
              domain={[0, 1]}
              ticks={[0, 0.25, 0.5, 0.75, 1]}
              format={(v) => v.toFixed(2)}
              rightText={(r) => {
                const a = r.values.find((x) => x.model.id === reference)?.value;
                const b = r.values.find((x) => x.model.id === best)?.value;
                return a !== null && a !== undefined && b !== null && b !== undefined ? `${a.toFixed(2)} → ${b.toFixed(2)}` : "";
              }}
              rightWidth={92}
              axisLabel="CSI (higher is better)"
            />
            <ModelLegend models={models} />
          </div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-head"><h2>Root-mean-square error</h2><span className="small muted">lower is better · lowest in bold</span></div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Variable</th>
                {models.map((m) => <th key={m.id} className="r">{m.id} <span style={{ fontWeight: 400 }}>{m.name}</span></th>)}
                <th className="r">{best} vs {reference}</th>
              </tr>
            </thead>
            <tbody>
              {vars.map((v) => {
                const lowest = Math.min(...models.map((m) => get(m.id, v, "rmse") ?? Infinity));
                const s = get(best, v, skillKey);
                return (
                  <tr key={v}>
                    <td>{varInfo(v).label} <span className="faint small">{varInfo(v).unit}</span></td>
                    {models.map((m) => {
                      const x = get(m.id, v, "rmse");
                      return <td key={m.id} className={`r ${x === lowest ? "best" : "muted"}`}>{fmt2(x)}</td>;
                    })}
                    <td className="r">
                      {s === null ? "–" : <span className={s >= 0 ? "sev-green" : "sev-red"} style={{ fontWeight: 600 }}>{Math.abs(s * 100).toFixed(0)}% {s >= 0 ? "less" : "more"}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {thresholds.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Rain event scores</h2><span className="small muted">CSI, POD, HSS: higher is better · FAR: lower is better</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Daily rain</th><th>Score</th>{models.map((m) => <th key={m.id} className="r">{m.id}</th>)}</tr>
              </thead>
              <tbody>
                {thresholds.flatMap((t) =>
                  ["csi", "pod", "far", "hss"].filter((k) => rows.some((r) => r.metric === k && r.threshold === t)).map((k, i) => {
                    const vals = models.map((m) => get(m.id, "rain_mm", k, t));
                    const target = k === "far" ? Math.min(...vals.map((x) => x ?? Infinity)) : Math.max(...vals.map((x) => x ?? -Infinity));
                    return (
                      <tr key={`${t}-${k}`}>
                        <td>{i === 0 && <><b style={{ fontWeight: 500 }}>≥ {t} mm</b> <span className="faint small">{RAIN_CLASS[t]}</span></>}</td>
                        <td className="mono small">{k.toUpperCase()}</td>
                        {vals.map((x, j) => <td key={models[j].id} className={`r ${x === target ? "best" : "muted"}`}>{fmt2(x)}</td>)}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function makeHeadline(phrase: string, model: Model, refName: string, skills: { v: VariableId; s: number }[]) {
  if (!skills.length) return null;
  const sorted = [...skills].sort((a, b) => b.s - a.s);
  const good = sorted.filter((x) => x.s > 0.005);
  const bad = sorted.filter((x) => x.s < -0.005);
  const name = (v: VariableId) => varInfo(v).label.toLowerCase();
  const list = (xs: { v: VariableId; s: number }[]) =>
    xs.map((x, i) => (
      <span key={x.v}>
        {i > 0 && (i === xs.length - 1 ? " and " : ", ")}
        <b>{Math.abs(x.s * 100).toFixed(0)}%</b> for {name(x.v)}
      </span>
    ));
  if (!good.length) {
    return <>{phrase}, {model.name} ({model.id}) does not beat {refName}.</>;
  }
  const top = good.slice(0, 3);
  const rain = good.find((x) => x.v === "rain_mm");
  if (rain && !top.includes(rain)) top.push(rain);
  return (
    <>
      {phrase}, {model.name} ({model.id}) cuts the error of {refName} by {list(top)}
      {bad.length > 0 && <>, but is worse for {bad.map((x) => name(x.v)).join(" and ")}</>}.
    </>
  );
}

interface DotRow { label: string; sub?: string; values: { model: Model; value: number | null }[] }

function DotPlot({ rows, highlight, format, axisLabel, zero = false, domain, ticks, rightText, rightWidth = 56 }: {
  rows: DotRow[];
  highlight: string;
  format: (v: number) => string;
  axisLabel: string;
  zero?: boolean;
  domain?: [number, number];
  ticks?: number[];
  rightText?: (r: DotRow) => string;
  rightWidth?: number;
}) {
  // Drawn at the container's real pixel width so text stays at its intended size.
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(320, Math.round(e[0].contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  const rowH = 36;
  const top = 26;
  const left = Math.min(150, W * 0.28);
  const right = W - rightWidth - 12;
  const H = top + rows.length * rowH + 30;
  const all = rows.flatMap((r) => r.values.map((v) => v.value)).filter((v): v is number => v !== null);
  let [lo, hi] = domain ?? [Math.min(0, ...all), Math.max(10, ...all)];
  if (!domain) {
    const step = hi - lo > 60 ? 20 : 10;
    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    ticks = [];
    for (let t = lo; t <= hi + 1e-9; t += step) ticks.push(t);
  }
  const x = (v: number) => left + ((v - lo) / (hi - lo || 1)) * (right - left);
  return (
    <div ref={ref}>
    <svg className="dotplot" viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={axisLabel} style={{ display: "block", maxWidth: "100%" }}>
      {(ticks ?? []).map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={top - 6} y2={H - 30} className={zero && t === 0 ? "zero" : "axis"} />
          <text x={x(t)} y={top - 12} textAnchor="middle" style={{ fontSize: 11, fill: "var(--chart-axis)" }}>{format(t)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = top + i * rowH + rowH / 2;
        const vals = r.values.filter((v): v is { model: Model; value: number } => v.value !== null);
        const hl = vals.find((v) => v.model.id === highlight);
        const ordered = [...vals].sort((a, b) => Number(a.model.id === highlight) - Number(b.model.id === highlight));
        return (
          <g key={r.label}>
            <text x={0} y={cy + (r.sub ? -1 : 4)} style={{ fill: "var(--text)", fontSize: 13 }}>{r.label}</text>
            {r.sub && <text x={0} y={cy + 13} style={{ fontSize: 11, fill: "var(--text-3)" }}>{r.sub}</text>}
            {vals.length > 1 && (
              <line x1={x(Math.min(...vals.map((v) => v.value)))} x2={x(Math.max(...vals.map((v) => v.value)))} y1={cy} y2={cy} className="guide" />
            )}
            {ordered.map((v) => (
              <circle key={v.model.id} cx={x(Math.max(lo, Math.min(hi, v.value)))} cy={cy} r={v.model.id === highlight ? 7 : 5}
                style={{ fill: v.model.color, stroke: "var(--surface)", strokeWidth: 2 }}>
                <title>{`${v.model.id} ${v.model.name}: ${format(v.value)}`}</title>
              </circle>
            ))}
            <text x={W} y={cy + 4} textAnchor="end" style={{ fill: hl && hl.value < 0 ? "var(--sev-red)" : "var(--text)", fontWeight: 600, fontSize: 13 }}>
              {rightText ? rightText(r) : hl ? format(hl.value) : ""}
            </text>
          </g>
        );
      })}
      <text x={(left + right) / 2} y={H - 8} textAnchor="middle" style={{ fontSize: 11.5, fill: "var(--text-3)" }}>{axisLabel}</text>
    </svg>
    </div>
  );
}

function ModelLegend({ models }: { models: Model[] }) {
  return (
    <div className="legend-inline" style={{ marginTop: 10 }}>
      {models.map((m) => <span key={m.id}><i style={{ background: m.color }} />{m.id} {m.name}</span>)}
    </div>
  );
}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
const fmt2 = (v: number | null) => (v === null ? "–" : v.toFixed(2));
