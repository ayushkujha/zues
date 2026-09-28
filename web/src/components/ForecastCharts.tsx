import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dayLabel } from "../lib/format";
import type { ForecastDay } from "../types";

const AXIS = { fill: "var(--chart-axis)", fontSize: 11 };

type TipRow = { label: string; value: string };
function Tip({ active, label, rows }: { active?: boolean; label?: string; rows: TipRow[] | null }) {
  if (!active || !rows) return null;
  return (
    <div className="rc-tooltip">
      <div className="h">{label}</div>
      {rows.map((r) => (
        <div key={r.label} className="kv"><span>{r.label}</span><b>{r.value}</b></div>
      ))}
    </div>
  );
}

const f1 = (v: number | null | undefined) => (v === null || v === undefined ? "–" : v.toFixed(1));

export function TemperatureChart({ days, activeIndex }: { days: ForecastDay[]; activeIndex?: number }) {
  const rows = days.map((d) => ({
    day: dayLabel(d.valid_date).split(",")[0],
    tmax: d.tmax_c?.value,
    tmin: d.tmin_c?.value,
    tmaxBand: [d.tmax_c?.p10, d.tmax_c?.p90],
    tminBand: [d.tmin_c?.p10, d.tmin_c?.p90],
    blockTmax: d.tmax_c?.block,
    blockTmin: d.tmin_c?.block,
  }));
  const active = activeIndex !== undefined ? rows[activeIndex]?.day : undefined;
  return (
    <>
      <div className="chart-legend">
        <span><i style={{ background: "var(--warm)" }} />Max</span>
        <span><i style={{ background: "var(--cool)" }} />Min</span>
        <span><i className="box" style={{ background: "var(--warm)", opacity: 0.2 }} />Likely range</span>
        <span><i className="dash" />Block forecast</span>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={rows} margin={{ top: 8, right: 6, bottom: 0, left: -22 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          {active && <ReferenceLine x={active} stroke="var(--border-strong)" strokeWidth={6} strokeOpacity={0.5} />}
          <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={["dataMin - 1", "dataMax + 1"]} allowDecimals={false} unit="°" />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active: a, payload, label }) => (
              <Tip active={a} label={label as string} rows={payload?.length ? (() => {
                const r = payload[0].payload as (typeof rows)[number];
                return [
                  { label: "Max", value: `${f1(r.tmax)} °C` },
                  { label: "Min", value: `${f1(r.tmin)} °C` },
                  { label: "Block max / min", value: `${f1(r.blockTmax)} / ${f1(r.blockTmin)}` },
                ];
              })() : null} />
            )}
          />
          <Area dataKey="tmaxBand" stroke="none" fill="var(--warm)" fillOpacity={0.14} isAnimationActive={false} />
          <Area dataKey="tminBand" stroke="none" fill="var(--cool)" fillOpacity={0.14} isAnimationActive={false} />
          <Line dataKey="blockTmax" stroke="var(--chart-axis)" strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} />
          <Line dataKey="blockTmin" stroke="var(--chart-axis)" strokeDasharray="4 3" strokeWidth={1.25} dot={false} isAnimationActive={false} />
          <Line dataKey="tmax" stroke="var(--warm)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--warm)" }} isAnimationActive={false} />
          <Line dataKey="tmin" stroke="var(--cool)" strokeWidth={2} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--cool)" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}

export function RainChart({ days, activeIndex }: { days: ForecastDay[]; activeIndex?: number }) {
  const rows = days.map((d) => ({
    day: dayLabel(d.valid_date).split(",")[0],
    rain: d.rain_mm?.value,
    p90: d.rain_mm?.p90,
    block: d.rain_mm?.block,
  }));
  return (
    <>
      <div className="chart-legend">
        <span><i className="box" style={{ background: "var(--cool)" }} />Panchayat (mm/day)</span>
        <span><i className="dash" />Block forecast</span>
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart data={rows} margin={{ top: 8, right: 6, bottom: 0, left: -22 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            content={({ active, payload, label }) => (
              <Tip active={active} label={label as string} rows={payload?.length ? (() => {
                const r = payload[0].payload as (typeof rows)[number];
                return [
                  { label: "Panchayat", value: `${f1(r.rain)} mm` },
                  { label: "Up to (p90)", value: `${f1(r.p90)} mm` },
                  { label: "Block", value: `${f1(r.block)} mm` },
                ];
              })() : null} />
            )}
          />
          <Bar dataKey="rain" radius={[3, 3, 0, 0]} maxBarSize={26} isAnimationActive={false}>
            {rows.map((_, i) => (
              <Cell key={i} fill="var(--cool)" fillOpacity={activeIndex === undefined || activeIndex === i ? 1 : 0.45} />
            ))}
          </Bar>
          <Line dataKey="block" stroke="var(--chart-axis)" strokeDasharray="4 3" strokeWidth={1.25} dot={{ r: 2.5, strokeWidth: 0, fill: "var(--chart-axis)" }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </>
  );
}
