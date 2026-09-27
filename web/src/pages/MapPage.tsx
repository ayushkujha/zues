import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { SeverityBadge } from "../components/Badges";
import DaySlider from "../components/DaySlider";
import Legend from "../components/Legend";
import MapView, { type ColoredProps, type MapViewState } from "../components/MapView";
import PanchayatPanel from "../components/PanchayatPanel";
import { divergingScale, rainScale, sequentialScale, type Scale } from "../lib/colors";
import { SEVERITY_ORDER, VARIABLES, addDays, fmtVar, signed, varInfo } from "../lib/format";
import { load, save } from "../lib/storage";
import { useApp } from "../state";
import type { Advisory, FeatureCollection, MapMeta, Severity, VariableId } from "../types";

type View = "gp" | "block" | "diff";

export default function MapPage() {
  const { region, run, runId, blocks, gpNames, dark } = useApp();
  const [variable, setVariable] = useState<VariableId>(() => load("map.variable", "rain_mm"));
  const [view, setView] = useState<View>(() => load("map.view", "gp"));
  const [dayIndex, setDayIndex] = useState(0);
  const [basemap, setBasemap] = useState(() => load("map.basemap", true));
  const [lowConf, setLowConf] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ p: ColoredProps; x: number; y: number } | null>(null);
  const [data, setData] = useState<FeatureCollection<ColoredProps, MapMeta> | null>(null);
  const [mapView, setMapView] = useState<MapViewState | null>(null);
  const [alerts, setAlerts] = useState<Advisory[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => save("map.variable", variable), [variable]);
  useEffect(() => save("map.view", view), [view]);
  useEffect(() => save("map.basemap", basemap), [basemap]);

  const dates = useMemo(
    () => (run ? [1, 2, 3, 4, 5].map((i) => addDays(run.issue_date, i)) : []),
    [run],
  );
  const date = dates[Math.min(dayIndex, dates.length - 1)];
  const level = view === "block" ? "block" : "gp";

  useEffect(() => {
    if (!runId || !date) return;
    setErr(null);
    api
      .map(runId, variable, date, level)
      .then((fc) => setData(fc as FeatureCollection<ColoredProps, MapMeta>))
      .catch((e) => {
        setData(null);
        setErr(e.message);
      });
  }, [runId, variable, date, level]);

  useEffect(() => {
    if (!runId) return;
    Promise.all([api.advisories(runId, { severity: "red" }), api.advisories(runId, { severity: "orange" })])
      .then(([r, o]) => setAlerts([...r, ...o]))
      .catch(() => setAlerts([]));
  }, [runId]);

  const info = varInfo(variable);
  const scale: Scale | null = useMemo(() => {
    if (!data) return null;
    const vals = data.features
      .map((f) => (view === "diff" ? f.properties.diff_from_block : f.properties.value))
      .filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return null;
    if (view === "diff") {
      const maxAbs = Math.max(...vals.map(Math.abs));
      return divergingScale(variable, maxAbs, info.digits);
    }
    if (variable === "rain_mm") return rainScale();
    return sequentialScale(variable, Math.min(...vals), Math.max(...vals), info.digits);
  }, [data, view, variable, info.digits]);

  const colored = useMemo(() => {
    if (!data || !scale) return null;
    return {
      ...data,
      features: data.features.map((f) => ({
        ...f,
        properties: {
          ...f.properties,
          _color: scale.color(view === "diff" ? f.properties.diff_from_block : f.properties.value),
        },
      })),
    };
  }, [data, scale, view]);

  const spread = useMemo(() => {
    if (!data || view === "block") return null;
    const byBlock = new Map<number, number[]>();
    for (const f of data.features) {
      const v = f.properties.value;
      if (v === null || v === undefined) continue;
      const arr = byBlock.get(f.properties.block_lgd) ?? [];
      arr.push(v);
      byBlock.set(f.properties.block_lgd, arr);
    }
    let maxRange = 0;
    let blockName = "";
    for (const [b, arr] of byBlock) {
      const r = Math.max(...arr) - Math.min(...arr);
      if (r > maxRange) {
        maxRange = r;
        blockName = data.features.find((f) => f.properties.block_lgd === b)?.properties.block_name ?? "";
      }
    }
    return { maxRange, blockName };
  }, [data, view]);

  const onSelect = useCallback((p: ColoredProps) => {
    if (p.gp_lgd) setSelected(p.gp_lgd);
  }, []);
  const onHover = useCallback((p: ColoredProps | null, x: number, y: number) => setHover(p ? { p, x, y } : null), []);

  const counts = run?.advisory_counts ?? {};
  const alertGps = useMemo(() => {
    const seen = new Map<number, Severity>();
    for (const a of alerts) {
      const cur = seen.get(a.gp_lgd);
      if (!cur || SEVERITY_ORDER.indexOf(a.severity) < SEVERITY_ORDER.indexOf(cur)) seen.set(a.gp_lgd, a.severity);
    }
    return [...seen.entries()].sort((a, b) => SEVERITY_ORDER.indexOf(a[1]) - SEVERITY_ORDER.indexOf(b[1]));
  }, [alerts]);

  if (!region || !run) {
    return <div className="empty">{region ? "No completed forecast run yet. Create one on the Runs page." : <span className="spinner" />}</div>;
  }

  return (
    <div className={`mapgrid ${selected ? "with-panel" : ""}`}>
      <aside className="sidebar">
        <section>
          <h3>Variable</h3>
          <div className="varlist">
            {VARIABLES.map((v) => (
              <button key={v.id} className={v.id === variable ? "on" : ""} onClick={() => setVariable(v.id)}>
                <span>{v.label}</span>
                <span className="small faint">{v.unit}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3>View</h3>
          <div className="seg" role="group" aria-label="Map view">
            <button className={view === "gp" ? "on" : ""} onClick={() => setView("gp")}>Panchayat</button>
            <button className={view === "block" ? "on" : ""} onClick={() => setView("block")}>Block</button>
            <button className={view === "diff" ? "on" : ""} onClick={() => setView("diff")}>Difference</button>
          </div>
          <p className="small muted" style={{ margin: "6px 0 0" }}>
            {view === "gp" && "Downscaled forecast for each Gram Panchayat."}
            {view === "block" && "The official block-level forecast (input)."}
            {view === "diff" && "Panchayat value minus its block's value."}
          </p>
          <label className="row small" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={basemap} onChange={(e) => setBasemap(e.target.checked)} /> Basemap
          </label>
          {level === "gp" && (
            <label className="row small" style={{ marginTop: 4 }}>
              <input type="checkbox" checked={lowConf} onChange={(e) => setLowConf(e.target.checked)} />
              Outline low-confidence panchayats
            </label>
          )}
        </section>

        {spread && spread.maxRange > 0 && (
          <section className="card card-pad" style={{ boxShadow: "none" }}>
            <div className="small muted">Largest spread inside one block</div>
            <div style={{ fontSize: 22, fontWeight: 700 }} className="num">{fmtVar(variable, spread.maxRange)}</div>
            <div className="small muted">in {spread.blockName}: a single block value would hide this.</div>
          </section>
        )}

        <section>
          <h3>Advisories this run</h3>
          <div className="sevcounts">
            {(["red", "orange", "yellow", "green"] as Severity[]).map((s) => (
              <div key={s}>
                <b style={{ color: `var(--sev-${s})` }}>{counts[s] ?? 0}</b>
                <span>{s}</span>
              </div>
            ))}
          </div>
        </section>

        {alertGps.length > 0 && (
          <section>
            <h3>Panchayats on alert</h3>
            <div className="alertlist">
              {alertGps.slice(0, 10).map(([gp, sev]) => (
                <button key={gp} onClick={() => setSelected(gp)}>
                  <SeverityBadge severity={sev} label={sev} />
                  <span>{gpNames.get(gp) ?? gp}</span>
                </button>
              ))}
              {alertGps.length > 10 && <a className="small" href="#/advisories">+{alertGps.length - 10} more →</a>}
            </div>
          </section>
        )}
      </aside>

      <div className="mapwrap">
        <MapView
          key={level}
          data={colored}
          blocks={blocks}
          idKey={level === "gp" ? "gp_lgd" : "block_lgd"}
          bbox={region.bbox}
          selectedId={level === "gp" ? selected : null}
          basemap={basemap}
          dark={dark}
          onHover={onHover}
          onSelect={onSelect}
          view={mapView}
          onView={setMapView}
          showLowConfidence={lowConf}
        />
        {scale && (
          <div className="map-overlay" style={{ left: 12, top: 12 }}>
            <Legend
              title={`${view === "diff" ? "Difference: " : ""}${info.label} (${info.unit})`}
              scale={scale}
            />
          </div>
        )}
        <div className="map-overlay" style={{ left: "50%", bottom: 16, transform: "translateX(-50%)", maxWidth: "calc(100% - 24px)", overflowX: "auto" }}>
          <DaySlider dates={dates} index={dayIndex} onChange={setDayIndex} />
        </div>
        {err && <div className="map-overlay errorbox" style={{ right: 60, top: 12 }}>{err}</div>}
        {hover && (
          <div className="tooltip" style={{ left: hover.x, top: hover.y }}>
            <div className="t">{hover.p.gp_name ?? hover.p.block_name}</div>
            {hover.p.gp_name && <div className="small muted">{hover.p.block_name}</div>}
            <div className="kv"><span>{level === "gp" ? "Panchayat" : "Block"}</span><b>{fmtVar(variable, hover.p.value)}</b></div>
            {level === "gp" && (
              <>
                <div className="kv"><span>Block</span><span>{fmtVar(variable, hover.p.block_value)}</span></div>
                <div className="kv"><span>Difference</span><span>{signed(hover.p.diff_from_block, info.digits)}</span></div>
                {hover.p.p10 !== null && hover.p.p10 !== undefined && (
                  <div className="kv"><span>Likely range</span><span>{hover.p.p10?.toFixed(info.digits)}–{hover.p.p90?.toFixed(info.digits)}</span></div>
                )}
                <div className="kv"><span>Confidence</span><span>{hover.p.confidence}</span></div>
              </>
            )}
          </div>
        )}
      </div>

      {selected && runId && (
        <PanchayatPanel runId={runId} gp={selected} dayIndex={dayIndex} onDay={setDayIndex} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
