import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { VARIABLES, varInfo } from "../lib/format";
import { useApp } from "../state";
import type { Validation, VariableId } from "../types";

const MODELS = [
  { id: "M0", name: "M0 copy block", color: "var(--chart-axis)" },
  { id: "M1", name: "M1 interpolation", color: "var(--series-1)" },
  { id: "M2", name: "M2 + lapse rate", color: "var(--series-2)" },
  { id: "M3", name: "M3 LightGBM", color: "var(--series-3)" },
  { id: "M3S", name: "M3S + stations", color: "#eda100" },
  { id: "M4", name: "M4 U-Net", color: "#e87ba4" },
];
const SPLITS: Record<string, { label: string; help: string }> = {
  test: {
    label: "Held-out year",
    help: "Held-out test period with a perfect block forecast as input: isolates the downscaling error.",
  },
  forecast: {
    label: "Forecast mode",
    help: "The block input carries realistic forecast error that grows with lead day, like a real 5-day forecast.",
  },
  spatial_cv: {
    label: "Unseen places",
    help: "Spatial cross-validation: M3 retrained without the held-out blocks and without local climatology, scored only there.",
  },
  station_cv: {
    label: "Station correction",
    help: "M3 vs M3S at weather stations held out from fitting the station correction.",
  },
};
const AXIS = { fill: "var(--text-muted)", fontSize: 11 };
const tip = { background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 };

export default function ValidationPage() {
  const { region, regionId } = useApp();
  const [data, setData] = useState<Validation | null>(null);
  const [level, setLevel] = useState<"station" | "gp">("station");
  const [split, setSplit] = useState("test");
  const [lead, setLead] = useState(1);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!regionId) return;
    api.validation(regionId).then(setData).catch((e) => setErr(e.message));
  }, [regionId]);

  const splits = useMemo(
    () => Object.keys(SPLITS).filter((s) => (data?.metrics ?? []).some((m) => m.split === s)),
    [data],
  );
  const levels = useMemo(() => new Set((data?.metrics ?? []).filter((m) => m.split === split).map((m) => m.level)), [data, split]);
  useEffect(() => {
    if (levels.size && !levels.has(level)) setLevel(levels.has("station") ? "station" : "gp");
  }, [levels, level]);

  const rows = useMemo(
    () =>
      (data?.metrics ?? []).filter(
        (m) => m.split === split && m.level === level && (split !== "forecast" || m.lead_day === lead),
      ),
    [data, split, level, lead],
  );
  const reference = split === "station_cv" ? "M3" : "M0";
  const best = split === "station_cv" ? "M3S" : "M3";
  const skillKey = `skill_vs_${reference}`;
  const get = (model: string, variable: string, metric: string, thr?: number): number | null => {
    const r = rows.find((m) => m.model_id === model && m.variable === variable && m.metric === metric && (thr === undefined || m.threshold === thr));
    return r?.value ?? null;
  };
  const models = MODELS.filter((m) => rows.some((r) => r.model_id === m.id));
  const vars = VARIABLES.map((v) => v.id).filter((v) => rows.some((r) => r.variable === v && r.metric === "rmse"));
  const chartRows = vars.map((v) => {
    const o: Record<string, string | number | null> = { variable: varInfo(v).short };
    for (const m of models) if (m.id !== reference) o[m.id] = pct(get(m.id, v, skillKey));
    return o;
  });
  const leadRows = useMemo(() => {
    if (split !== "forecast") return [];
    const all = (data?.metrics ?? []).filter((m) => m.split === "forecast" && m.level === level && m.model_id === "M3" && m.metric === "skill_vs_M0");
    return [1, 2, 3, 4, 5].map((ld) => {
      const o: Record<string, string | number | null> = { lead: `Day ${ld}` };
      for (const v of ["tmax_c", "tmin_c", "rain_mm", "wind_kmph"]) {
        o[v] = pct(all.find((m) => m.variable === v && m.lead_day === ld)?.value ?? null);
      }
      return o;
    });
  }, [data, split, level]);
  const thresholds = [...new Set(rows.filter((r) => r.variable === "rain_mm" && r.metric === "csi").map((r) => r.threshold as number))].sort((a, b) => a - b);
  const synthetic = region?.data_source === "synthetic";

  if (err) return <div className="page"><div className="errorbox">{err}</div></div>;
  if (!data) return <div className="empty"><span className="spinner" /></div>;
  if (!data.metrics.length) {
    return <div className="page"><div className="empty">No validation results yet. Run <code>pcast evaluate {regionId}</code> on the server.</div></div>;
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Validation</h1>
          <p>How much better each model is than the reference. Model version <code>{data.model_version}</code>.</p>
        </div>
        <div className="spacer" />
        <div className="seg" role="group" aria-label="Truth">
          {levels.has("station") && <button className={level === "station" ? "on" : ""} onClick={() => setLevel("station")}>vs stations</button>}
          {levels.has("gp") && <button className={level === "gp" ? "on" : ""} onClick={() => setLevel("gp")}>vs panchayat means</button>}
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Evaluation" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {splits.map((s) => (
          <button key={s} role="tab" aria-selected={split === s} className={split === s ? "on" : ""} onClick={() => setSplit(s)}>{SPLITS[s].label}</button>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{SPLITS[split]?.help}{" "}
        {level === "station" ? "Truth: weather-station observations." : "Truth: area-mean of the fine field over each panchayat."}
      </p>

      {synthetic && (
        <div className="errorbox" style={{ marginBottom: 16 }}>
          <b>Synthetic demo data.</b> These scores show the pipeline learns known local effects. They are not real-world skill; re-run on real data before quoting any number.
        </div>
      )}

      {split === "forecast" && (
        <div className="row" style={{ marginBottom: 12 }}>
          <span className="small muted">Lead day</span>
          <div className="seg">
            {[1, 2, 3, 4, 5].map((ld) => <button key={ld} className={lead === ld ? "on" : ""} onClick={() => setLead(ld)}>{ld}</button>)}
          </div>
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {(["tmax_c", "tmin_c", "rain_mm", "wind_kmph", "rh_max_pct"] as VariableId[]).filter((v) => vars.includes(v)).slice(0, 4).map((v) => {
          const s = get(best, v, skillKey);
          return (
            <div key={v} className="card stat">
              <div className="label">{varInfo(v).label}</div>
              <div className={`value num ${s !== null && s > 0 ? "good" : ""}`}>{s === null ? "–" : `${s > 0 ? "−" : "+"}${Math.abs(s * 100).toFixed(0)}%`}</div>
              <div className="sub">error, {best} vs {reference === "M0" ? "copying the block value" : "M3"}</div>
            </div>
          );
        })}
      </div>

      <div className="grid cols-2" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <h2>Error reduction vs {reference} (%)</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="variable" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} interval={0} />
              <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} contentStyle={tip} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              {models.filter((m) => m.id !== reference).map((m) => (
                <Bar key={m.id} dataKey={m.id} name={m.name} fill={m.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        {split === "forecast" ? (
          <div className="card card-pad">
            <h2>M3 skill by lead day (%)</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={leadRows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="lead" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} unit="%" />
                <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} contentStyle={tip} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="tmax_c" name="Max temp" fill="var(--series-2)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                <Bar dataKey="tmin_c" name="Min temp" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
                <Bar dataKey="rain_mm" name="Rain" fill="var(--series-3)" radius={[4, 4, 0, 0]} maxBarSize={16} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : thresholds.length > 0 ? (
          <div className="card card-pad">
            <h2>Rain event detection (CSI)</h2>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart
                data={thresholds.map((t) => {
                  const o: Record<string, number | string | null> = { thr: `≥ ${t} mm` };
                  for (const m of models) o[m.id] = get(m.id, "rain_mm", "csi", t);
                  return o;
                })}
                margin={{ top: 8, right: 8, bottom: 0, left: -12 }} barGap={2}
              >
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="thr" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
                <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 1]} />
                <Tooltip formatter={(v) => Number(v).toFixed(2)} contentStyle={tip} />
                <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
                {models.map((m) => (
                  <Bar key={m.id} dataKey={m.id} name={m.name} fill={m.color} radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <h2>RMSE (lower is better)</h2>
        <MetricTable models={models.map((m) => m.id)} vars={vars} get={get} best={best} skillKey={skillKey} reference={reference} />
      </div>

      {thresholds.length > 0 && (
        <div className="card card-pad">
          <h2>Rainfall events</h2>
          <div className="table-wrap">
            <table className="tbl">
              <thead>
                <tr><th>Threshold</th><th>Score</th>{models.map((m) => <th key={m.id} className="r">{m.name}</th>)}</tr>
              </thead>
              <tbody>
                {thresholds.flatMap((t) => ["csi", "pod", "far"].map((k) => (
                  <tr key={`${t}-${k}`}>
                    <td>≥ {t} mm</td>
                    <td>{k.toUpperCase()} <span className="faint small">{k === "far" ? "(lower is better)" : ""}</span></td>
                    {models.map((m) => <td key={m.id} className="r">{fmt2(get(m.id, "rain_mm", k, t))}</td>)}
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricTable({ models, vars, get, best, skillKey, reference }: {
  models: string[]; vars: VariableId[]; best: string; skillKey: string; reference: string;
  get: (m: string, v: string, k: string) => number | null;
}) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead>
          <tr><th>Variable</th>{models.map((m) => <th key={m} className="r">{m}</th>)}<th className="r">{best} vs {reference}</th></tr>
        </thead>
        <tbody>
          {vars.map((v) => {
            const lowest = Math.min(...models.map((m) => get(m, v, "rmse") ?? Infinity));
            const s = get(best, v, skillKey);
            return (
              <tr key={v}>
                <td>{varInfo(v).label} <span className="faint small">({varInfo(v).unit})</span></td>
                {models.map((m) => {
                  const x = get(m, v, "rmse");
                  return <td key={m} className="r" style={{ fontWeight: x === lowest ? 700 : 400 }}>{fmt2(x)}</td>;
                })}
                <td className="r">{s === null ? "–" : `${Math.abs(s * 100).toFixed(0)}% ${s >= 0 ? "better" : "worse"}`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);
const fmt2 = (v: number | null) => (v === null ? "–" : v.toFixed(2));
