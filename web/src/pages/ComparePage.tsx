import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "../components/Icon";
import Legend from "../components/Legend";
import MapView, { type ColoredProps, type MapViewState } from "../components/MapView";
import { rainScale, sequentialScale, type Scale } from "../lib/colors";
import { VARIABLES, addDays, dayLabel, fmt, varInfo } from "../lib/format";
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
    (fc: FeatureCollection<MapProps> | null): FeatureCollection<ColoredProps> | null =>
      fc && scale
        ? { ...fc, features: fc.features.map((f) => ({ ...f, properties: { ...f.properties, _color: scale.color(f.properties.value) } })) }
        : null,
    [scale],
  );

  const onPointer = (clientX: number) => {
    const r = wrapRef.current?.getBoundingClientRect();
    if (!r) return;
    setSplit(Math.max(3, Math.min(97, ((clientX - r.left) / r.width) * 100)));
  };

  const table = useMemo(
    () => rows.filter((r) => r.variable === variable && r.valid_date === date).sort((a, b) => b.range - a.range),
    [rows, variable, date],
  );
  const lo = Math.min(...table.map((r) => Math.min(r.min, r.block_value ?? r.min)));
  const hi = Math.max(...table.map((r) => Math.max(r.max, r.block_value ?? r.max)));
  const pos = (v: number) => `${((v - lo) / (hi - lo || 1)) * 100}%`;

  if (!region) return <div className="empty"><span className="spinner" /></div>;
  if (!run || !date) return <div className="empty"><h2>No forecast yet</h2><a className="btn primary" href="#/runs">Go to runs</a></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Block vs panchayat</h1>
          <p>The same forecast at two resolutions. Drag the divider: the official block value on the left, PanchayatCast's panchayat forecast on the right.</p>
        </div>
      </div>

      <div className="toolbar">
        <select className="select" value={variable} onChange={(e) => setVariable(e.target.value as VariableId)} aria-label="Variable">
          {VARIABLES.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
        <div className="seg" role="tablist" aria-label="Forecast day">
          {dates.map((d, i) => (
            <button key={d} role="tab" aria-selected={i === dayIndex} className={i === dayIndex ? "on" : ""} onClick={() => setDayIndex(i)}>
              {dayLabel(d).replace(",", "")}
            </button>
          ))}
        </div>
      </div>

      <div
        className="compare-stage"
        ref={wrapRef}
        onPointerMove={(e) => dragging.current && onPointer(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerLeave={() => (dragging.current = false)}
      >
        <div className="layer">
          <MapView data={paint(blockData)} blocks={blocks} idKey="block_lgd" bbox={region.bbox} dark={dark} view={view} onView={setView} navPosition="bottom-right" />
        </div>
        <div className="layer" style={{ clipPath: `inset(0 0 0 ${split}%)` }}>
          <MapView data={paint(gpData)} blocks={blocks} idKey="gp_lgd" bbox={region.bbox} dark={dark} view={view} onView={setView} navPosition="bottom-right" />
        </div>
        <div
          className="divider"
          style={{ left: `${split}%` }}
          onPointerDown={(e) => {
            dragging.current = true;
            (e.target as Element).setPointerCapture?.(e.pointerId);
          }}
          onPointerMove={(e) => dragging.current && onPointer(e.clientX)}
          onPointerUp={() => (dragging.current = false)}
          role="slider"
          aria-label="Compare divider"
          aria-valuenow={Math.round(split)}
          aria-valuemin={0}
          aria-valuemax={100}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setSplit((s) => Math.max(3, s - 5));
            if (e.key === "ArrowRight") setSplit((s) => Math.min(97, s + 5));
          }}
        >
          <div className="knob"><Icon name="swap" size={16} /></div>
        </div>
        <div className="side-label" style={{ left: 14 }}>Block forecast</div>
        <div className="side-label" style={{ right: 14 }}>Panchayat forecast</div>
        {scale && (
          <div className="float panel" style={{ left: 14, bottom: 14, width: 280, padding: "12px 14px" }}>
            <Legend title={info.label} unit={variable === "rain_mm" ? "mm/day · IMD categories" : info.unit} scale={scale} />
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div className="card-head">
          <div>
            <h2>Where panchayat detail matters most</h2>
            <p className="small muted" style={{ marginTop: 2 }}>
              {info.label} on {dayLabel(date, "long")}: the block value (black tick) against the range of its panchayats (bar).
            </p>
          </div>
        </div>
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Block</th>
                <th className="r">Block value</th>
                <th className="r">Panchayat range</th>
                <th className="r">Spread</th>
                <th style={{ width: "36%" }}><span className="sr-only">Range chart</span></th>
              </tr>
            </thead>
            <tbody>
              {table.map((r) => (
                <tr key={r.block_lgd}>
                  <td><b style={{ fontWeight: 500 }}>{blockNames.get(r.block_lgd) ?? r.block_lgd}</b></td>
                  <td className="r">{fmt(r.block_value, info.digits)}</td>
                  <td className="r">{fmt(r.min, info.digits)} – {fmt(r.max, info.digits)}</td>
                  <td className="r"><b>{fmt(r.range, info.digits)}</b> <span className="faint small">{info.unit}</span></td>
                  <td>
                    <div className="rangebar" aria-hidden="true">
                      <div className="track" />
                      <div className="span" style={{ left: pos(r.min), width: `calc(${pos(r.max)} - ${pos(r.min)})`, background: variable.startsWith("t") ? "var(--warm)" : undefined }} />
                      {r.block_value !== null && <div className="blk" style={{ left: pos(r.block_value) }} />}
                    </div>
                  </td>
                </tr>
              ))}
              {!table.length && <tr><td colSpan={5} className="muted">No data for this day.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
