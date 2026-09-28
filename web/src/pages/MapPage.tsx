import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import DaySlider from "../components/DaySlider";
import { Icon, SeverityIcon, VARIABLE_ICON } from "../components/Icon";
import Legend from "../components/Legend";
import MapView, { type ColoredProps, type MapViewState } from "../components/MapView";
import PanchayatPanel from "../components/PanchayatPanel";
import { DIFF_WORDS, divergingScale, rainScale, sequentialScale, type Scale } from "../lib/colors";
import { RAIN_CATEGORIES, SEVERITY_ORDER, VARIABLES, addDays, dayLabel, fmt, rainCategoryIndex, signed, varInfo } from "../lib/format";
import { load, save } from "../lib/storage";
import { useApp } from "../state";
import type { Advisory, CompareRow, FeatureCollection, MapMeta, Severity, VariableId } from "../types";

type View = "gp" | "block" | "diff";
type MapData = FeatureCollection<ColoredProps, MapMeta>;

const VIEWS: { id: View; label: string; help: string }[] = [
  { id: "gp", label: "Panchayat", help: "Downscaled forecast for every Gram Panchayat." },
  { id: "block", label: "Block", help: "The block forecast that the downscaling starts from." },
  { id: "diff", label: "Difference", help: "How far each panchayat's forecast is from its block's value." },
];

// Map responses are cached per run, variable, day and level, so day switching and playback are instant.
const cache = new Map<string, Promise<MapData>>();
function fetchMap(runId: string, variable: VariableId, date: string, level: "gp" | "block"): Promise<MapData> {
  const key = `${runId}|${variable}|${date}|${level}`;
  let p = cache.get(key);
  if (!p) {
    p = api.map(runId, variable, date, level) as Promise<MapData>;
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 60) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

export default function MapPage() {
  const { region, run, runId, blocks, gpNames, blockNames, dark } = useApp();
  const [variable, setVariable] = useState<VariableId>(() => load("map.variable", "rain_mm"));
  const [view, setView] = useState<View>(() => load("map.view", "gp"));
  const [dayIndex, setDayIndex] = useState(0);
  const [basemap, setBasemap] = useState(() => load("map.basemap", true));
  const [lowConf, setLowConf] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<{ p: ColoredProps; x: number; y: number } | null>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [mapView, setMapView] = useState<MapViewState | null>(null);
  const [alerts, setAlerts] = useState<Advisory[]>([]);
  const [alertsOpen, setAlertsOpen] = useState(() => load("map.alertsOpen", true));
  const [compare, setCompare] = useState<CompareRow[]>([]);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const colRef = useRef<HTMLDivElement>(null);

  useEffect(() => save("map.variable", variable), [variable]);
  useEffect(() => save("map.view", view), [view]);
  useEffect(() => save("map.basemap", basemap), [basemap]);
  useEffect(() => save("map.alertsOpen", alertsOpen), [alertsOpen]);
  useEffect(() => setSelected(null), [region?.region_id]);

  const dates = useMemo(() => (run ? [1, 2, 3, 4, 5].map((i) => addDays(run.issue_date, i)) : []), [run]);
  const date = dates[Math.min(dayIndex, dates.length - 1)];
  const level = view === "block" ? "block" : "gp";

  useEffect(() => {
    if (!runId || !date) return;
    let live = true;
    setErr(null);
    fetchMap(runId, variable, date, level)
      .then((fc) => live && setData(fc))
      .catch((e) => {
        if (!live) return;
        setData(null);
        setErr(e.message);
      });
    return () => {
      live = false;
    };
  }, [runId, variable, date, level]);

  // Warm the cache for the other days once the visible one has loaded.
  const loaded = data !== null;
  useEffect(() => {
    if (!runId || !loaded) return;
    const t = window.setTimeout(() => dates.forEach((d) => fetchMap(runId, variable, d, level).catch(() => undefined)), 400);
    return () => window.clearTimeout(t);
  }, [runId, variable, level, dates, loaded]);

  useEffect(() => {
    if (!runId) return;
    api.compare(runId).then(setCompare).catch(() => setCompare([]));
    Promise.all([api.advisories(runId, { severity: "red" }), api.advisories(runId, { severity: "orange" })])
      .then(([r, o]) => setAlerts([...r, ...o]))
      .catch(() => setAlerts([]));
  }, [runId]);

  const info = varInfo(variable);

  // District average of the block forecast per day, for the timeline.
  const dayValues = useMemo(
    () =>
      dates.map((d) => {
        const xs = compare
          .filter((r) => r.variable === variable && r.valid_date === d && r.block_value !== null)
          .map((r) => r.block_value as number);
        return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      }),
    [compare, dates, variable],
  );

  const scale: Scale | null = useMemo(() => {
    if (!data) return null;
    const vals = data.features
      .map((f) => (view === "diff" ? f.properties.diff_from_block : f.properties.value))
      .filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return null;
    if (view === "diff") return divergingScale(variable, Math.max(...vals.map(Math.abs)), info.digits);
    if (variable === "rain_mm") return rainScale();
    return sequentialScale(variable, Math.min(...vals), Math.max(...vals), info.digits);
  }, [data, view, variable, info.digits]);

  const colored = useMemo(() => {
    if (!data || !scale) return null;
    return {
      ...data,
      features: data.features.map((f) => ({
        ...f,
        properties: { ...f.properties, _color: scale.color(view === "diff" ? f.properties.diff_from_block : f.properties.value) },
      })),
    };
  }, [data, scale, view]);

  const stats = useMemo(() => {
    if (!data) return null;
    const vals = data.features.map((f) => f.properties.value).filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return null;
    let spread: { range: number; block: string; lo: number; hi: number } | null = null;
    if (level === "gp") {
      const byBlock = new Map<number, number[]>();
      for (const f of data.features) {
        const v = f.properties.value;
        if (v === null || v === undefined) continue;
        byBlock.set(f.properties.block_lgd, [...(byBlock.get(f.properties.block_lgd) ?? []), v]);
      }
      for (const [b, arr] of byBlock) {
        const lo = Math.min(...arr);
        const hi = Math.max(...arr);
        if (!spread || hi - lo > spread.range) spread = { range: hi - lo, block: blockNames.get(b) ?? String(b), lo, hi };
      }
    }
    return { lo: Math.min(...vals), hi: Math.max(...vals), n: vals.length, spread };
  }, [data, level, blockNames]);

  const onSelect = useCallback((p: ColoredProps) => {
    if (p.gp_lgd) setSelected(p.gp_lgd);
  }, []);
  const onHover = useCallback((p: ColoredProps | null, x: number, y: number) => setHover(p ? { p, x, y } : null), []);

  const alertGps = useMemo(() => {
    const top = new Map<number, { sev: Severity; block: number; n: number }>();
    for (const a of alerts) {
      const cur = top.get(a.gp_lgd);
      if (!cur) top.set(a.gp_lgd, { sev: a.severity, block: a.block_lgd, n: 1 });
      else {
        cur.n += 1;
        if (SEVERITY_ORDER.indexOf(a.severity) < SEVERITY_ORDER.indexOf(cur.sev)) cur.sev = a.severity;
      }
    }
    return [...top.entries()].sort(
      (a, b) => SEVERITY_ORDER.indexOf(a[1].sev) - SEVERITY_ORDER.indexOf(b[1].sev) || b[1].n - a[1].n,
    );
  }, [alerts]);
  const nRed = alertGps.filter(([, a]) => a.sev === "red").length;
  const nOrange = alertGps.length - nRed;

  if (!region) return <div className="empty"><span className="spinner" /></div>;
  if (!run || !date) {
    return (
      <div className="empty">
        <h2>No forecast yet</h2>
        <p>Create a run from an uploaded block forecast, a live NWP forecast or an emulated one.</p>
        <a className="btn primary" href="#/runs">Go to runs</a>
      </div>
    );
  }

  const legendTitle = view === "diff" ? "Difference from block" : variable === "rain_mm" ? "Rainfall" : info.label;
  const legendUnit = variable === "rain_mm" && view !== "diff" ? "mm/day · IMD categories" : info.unit;
  const colW = colRef.current?.clientWidth ?? 1200;
  const colH = colRef.current?.clientHeight ?? 800;

  return (
    <div className={`mapstage ${selected ? "has-drawer" : ""}`}>
      <div className="mapcol" ref={colRef}>
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
          fitPadding={{ top: 40, right: 316, bottom: 120, left: 356 }}
          navPosition="bottom-right"
        />

        <aside className={`float panel ctrl ${more ? "expanded" : ""}`} aria-label="Map controls">
          <div className="ctrl-head">
            <div className="kicker">{dayLabel(date, "long")} · day {dayIndex + 1} of {dates.length}</div>
            <h1>{info.label} <span>{info.unit}</span></h1>
            <div className="seg full" role="group" aria-label="Map view" style={{ marginTop: 12 }}>
              {VIEWS.map((v) => (
                <button key={v.id} className={view === v.id ? "on" : ""} onClick={() => setView(v.id)} aria-pressed={view === v.id}>{v.label}</button>
              ))}
            </div>
            <p className="small muted help" style={{ marginTop: 8 }}>{VIEWS.find((v) => v.id === view)?.help}</p>
            <button className="btn ghost sm ctrl-more-btn" onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? "Fewer options" : "Variables and layers"} <Icon name="chevronDown" size={14} className={more ? "flip" : ""} />
            </button>
          </div>

          <div className="ctrl-sec">
            {scale ? (
              <Legend title={legendTitle} unit={legendUnit} scale={scale} ends={view === "diff" ? DIFF_WORDS[variable] : undefined} />
            ) : err ? (
              <div className="notice error"><Icon name="alert" /><span>{err}</span></div>
            ) : (
              <span className="spinner" />
            )}
          </div>

          {stats && (
            <div className="ctrl-sec more">
              {stats.spread && stats.spread.range > 0 && (
                <div className="callout">
                  Inside <b>{stats.spread.block}</b> block, panchayat forecasts range from{" "}
                  <b className="num">{fmt(stats.spread.lo, info.digits)}</b> to <b className="num">{fmt(stats.spread.hi, info.digits)} {info.unit}</b>.
                  A single block value hides this.
                </div>
              )}
              <div className="stat-line">
                <span>{level === "gp" ? `${stats.n} panchayats` : `${stats.n} blocks`}</span>
                <b>{fmt(stats.lo, info.digits)} – {fmt(stats.hi, info.digits)} {info.unit}</b>
              </div>
            </div>
          )}

          <div className="ctrl-sec more">
            <div className="label" style={{ marginBottom: 8 }}>Variable</div>
            <div className="vargrid">
              {VARIABLES.map((v) => (
                <button key={v.id} className={`vartile ${v.id === variable ? "on" : ""}`} onClick={() => setVariable(v.id)} aria-pressed={v.id === variable}>
                  <Icon name={VARIABLE_ICON[v.id]} size={17} />
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="ctrl-sec more stack" style={{ gap: 8 }}>
            <label className="check">
              <input type="checkbox" checked={basemap} onChange={(e) => setBasemap(e.target.checked)} /> Street basemap
            </label>
            {level === "gp" && (
              <label className="check">
                <input type="checkbox" checked={lowConf} onChange={(e) => setLowConf(e.target.checked)} /> Outline low-confidence panchayats
              </label>
            )}
          </div>
        </aside>

        {alertGps.length > 0 && (
          <div className="float panel alerts">
            <button className="alerts-head" onClick={() => { setAlertsOpen((o) => !o || !!selected); setSelected(null); }} aria-expanded={alertsOpen && !selected}>
              <b>Panchayats on alert</b>
              <span className="counts">
                {nRed > 0 && <span className="sev-red" title="Take action"><SeverityIcon severity="red" size={11} />{nRed}</span>}
                {nOrange > 0 && <span className="sev-orange" title="Be prepared"><SeverityIcon severity="orange" size={11} />{nOrange}</span>}
              </span>
              <Icon name="chevronDown" size={15} className={alertsOpen && !selected ? "flip" : ""} />
            </button>
            {alertsOpen && !selected && (
              <>
                <div className="alerts-list">
                  {alertGps.slice(0, 40).map(([gp, a]) => (
                    <button key={gp} onClick={() => setSelected(gp)} className={selected === gp ? "on" : ""}>
                      <SeverityIcon severity={a.sev} size={11} />
                      <span>{gpNames.get(gp) ?? gp}</span>
                      <span className="blk">{blockNames.get(a.block)}</span>
                    </button>
                  ))}
                </div>
                <a className="alerts-foot" href="#/advisories">Review all advisories <Icon name="arrow" size={14} /></a>
              </>
            )}
          </div>
        )}

        <DaySlider
          dates={dates}
          index={dayIndex}
          onChange={setDayIndex}
          values={dayValues.some((v) => v !== null) ? dayValues : undefined}
          unit={info.unit}
          digits={variable === "rain_mm" ? 1 : info.digits}
          barColor={variable.startsWith("t") ? "var(--warm)" : variable === "rain_mm" || variable.startsWith("rh") ? "var(--cool)" : "var(--text-3)"}
          valueTitle={`District average of the block ${info.label.toLowerCase()} forecast`}
        />

        {hover && (
          <div
            className="tooltip"
            style={{
              left: hover.x,
              top: hover.y,
              transform: `translate(${hover.x > colW - 290 ? "calc(-100% - 14px)" : "14px"}, ${hover.y > colH - 230 ? "calc(-100% - 14px)" : "14px"})`,
            }}
          >
            <div className="t">{hover.p.gp_name ?? hover.p.block_name}</div>
            <div className="s">{hover.p.gp_name ? `${hover.p.block_name} block` : "Block"}</div>
            <div className="tv">
              {view === "diff" ? signed(hover.p.diff_from_block, info.digits) : fmt(hover.p.value, info.digits)} <small>{info.unit}</small>
            </div>
            {variable === "rain_mm" && view !== "diff" && hover.p.value !== null && (
              <div className="s">{RAIN_CATEGORIES[rainCategoryIndex(hover.p.value)].name}</div>
            )}
            {level === "gp" && (
              <div style={{ marginTop: 6 }}>
                {view === "diff" && <div className="kv"><span>Panchayat</span><b>{fmt(hover.p.value, info.digits)}</b></div>}
                <div className="kv"><span>Block forecast</span><b>{fmt(hover.p.block_value, info.digits)}</b></div>
                {view !== "diff" && <div className="kv"><span>Difference</span><b>{signed(hover.p.diff_from_block, info.digits)}</b></div>}
                {hover.p.p10 !== null && hover.p.p10 !== undefined && (
                  <div className="kv"><span>Likely range</span><b>{fmt(hover.p.p10, info.digits)}–{fmt(hover.p.p90, info.digits)}</b></div>
                )}
                {hover.p.confidence && <div className="kv"><span>Confidence</span><b>{hover.p.confidence}</b></div>}
              </div>
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
