import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import DaySlider from "../components/DaySlider";
import Legend from "../components/Legend";
import MapView, { type ColoredProps, type MapViewState } from "../components/MapView";
import { rainScale, sequentialScale, type Scale } from "../lib/colors";
import { VARIABLES, addDays, fmtVar, varInfo } from "../lib/format";
import { useApp } from "../state";
import type { CompareRow, FeatureCollection, MapProps, VariableId } from "../types";

export default function ComparePage() {
  const { region, run, runId, blocks, blockNames, dark } = useApp();
  const [variable, setVariable] = useState<VariableId>("rain_mm");
  const [dayIndex, setDayIndex] = useState(0);
  const [gpData, setGpData] = useState<FeatureCollection<MapProps> | null>(null);
  const [blockData, setBlockData] = useState<FeatureCollection<MapProps> | null>(null);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [split, setSplit] = useState(50);
  const [view, setView] = useState<MapViewState | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const dates = useMemo(() => (run ? [1, 2, 3, 4, 5].map((i) => addDays(run.issue_date, i)) : []), [run]);
  const date = dates[dayIndex];

  useEffect(() => {
    if (!runId || !date) return;
    api.map(runId, variable, date, "gp").then(setGpData).catch(() => setGpData(null));
    api.map(runId, variable, date, "block").then(setBlockData).catch(() => setBlockData(null));
  }, [runId, variable, date]);

  useEffect(() => {
    if (runId) api.compare(runId).then(setRows).catch(() => setRows([]));
  }, [runId]);

  const info = varInfo(variable);
  // One shared scale for both sides so colours are directly comparable.
  const scale: Scale | null = useMemo(() => {
    const vals = [...(gpData?.features ?? []), ...(blockData?.features ?? [])]
      .map((f) => f.properties.value)
      .filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return null;
    return variable === "rain_mm" ? rainScale() : sequentialScale(variable, Math.min(...vals), Math.max(...vals), info.digits);
  }, [gpData, blockData, variable, info.digits]);

  const paint = useCallback(
    (fc: FeatureCollection<MapProps> | null) =>
      fc && scale
        ? { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, _color: scale.color(f.properties.value) } })) }
        : null,
    [scale],
  ) as (fc: FeatureCollection<MapProps> | null) => FeatureCollection<ColoredProps> | null;

  const onPointer = (clientX: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setSplit(Math.max(3, Math.min(97, ((clientX - r.left) / r.width) * 100)));
  };

  const table = useMemo(
    () =>
      rows
        .filter((r) => r.variable === variable && r.valid_date === date)
        .sort((a, b) => b.range - a.range),
    [rows, variable, date],
  );

  if (!region || !run) return <div className="empty">No completed forecast run yet.</div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Block vs Panchayat</h1>
          <p>Drag the divider. Left: the official block forecast. Right: PanchayatCast's panchayat-level forecast.</p>
        </div>
        <div className="spacer" />
        <select className="select" value={variable} onChange={(e) => setVariable(e.target.value as VariableId)} aria-label="Variable">
          {VARIABLES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>

      <div
        className="comparewrap"
        ref={wrapRef}
        onPointerMove={(e) => dragging.current && onPointer(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        <div className="layer">
          <MapView data={paint(blockData)} blocks={blocks} idKey="block_lgd" bbox={region.bbox} dark={dark} view={view} onView={setView} />
        </div>
        <div className="layer" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
          <MapView data={paint(gpData)} blocks={blocks} idKey="gp_lgd" bbox={region.bbox} dark={dark} view={view} onView={setView} />
        </div>
        <div className="divider" style={{ left: `${split}%` }} onPointerDown={(e) => { dragging.current = true; (e.target as Element).setPointerCapture?.(e.pointerId); }}
          onPointerMove={(e) => dragging.current && onPointer(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          role="slider" aria-label="Compare divider" aria-valuenow={Math.round(split)} tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSplit((s) => Math.max(3, s - 5));
            if (e.key === "ArrowRight") setSplit((s) => Math.min(97, s + 5));
          }}
        >
          <div className="knob">⇆</div>
        </div>
        <div className="sidetag" style={{ left: 10 }}>Block forecast</div>
        <div className="sidetag" style={{ right: 50 }}>Panchayat forecast</div>
        {scale && (
          <div className="map-overlay" style={{ left: 12, bottom: 12 }}>
            <Legend title={`${info.label} (${info.unit})`} scale={scale} />
          </div>
        )}
      </div>

      <div className="row" style={{ justifyContent: "center", margin: "12px 0 20px" }}>
        <DaySlider dates={dates} index={dayIndex} onChange={setDayIndex} />
      </div>

      <div className="card card-pad">
        <h2>Where panchayat detail matters most</h2>
        <p className="muted small" style={{ marginTop: -4 }}>
          For each block: the official block value and the range of panchayat values inside it ({info.label}, {date}).
        </p>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Block</th><th className="r">Block value</th><th className="r">Panchayat min</th><th className="r">Panchayat max</th><th className="r">Spread</th></tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.block_lgd}>
                  <td>{blockNames.get(r.block_lgd) ?? r.block_lgd}</td>
                  <td className="r">{fmtVar(variable, r.block_value)}</td>
                  <td className="r">{fmtVar(variable, r.min)}</td>
                  <td className="r">{fmtVar(variable, r.max)}</td>
                  <td className="r"><b>{fmtVar(variable, r.range)}</b></td>
                </tr>
              ))}
              {!table.length && <tr><td colSpan={5} className="muted">No data.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
