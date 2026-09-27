import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { dayLabel } from "../lib/format";
import type { ForecastDay } from "../types";

const AXIS = { fill: "var(--text-muted)", fontSize: 11 };
const tooltipStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
  color: "var(--text)",
};

export function TemperatureChart({ days }: { days: ForecastDay[] }) {
  const rows = days.map((d) => ({
    day: dayLabel(d.valid_date).split(",")[0],
    tmax: d.tmax_c?.value,
    tmin: d.tmin_c?.value,
    tmaxBand: [d.tmax_c?.p10, d.tmax_c?.p90],
    tminBand: [d.tmin_c?.p10, d.tmin_c?.p90],
    blockTmax: d.tmax_c?.block,
    blockTmin: d.tmin_c?.block,
  }));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={["dataMin - 1", "dataMax + 1"]} allowDecimals={false} unit="°" />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => (Array.isArray(v) ? v.map((x) => Number(x).toFixed(1)).join("–") : Number(v).toFixed(1)) + " °C"} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Area dataKey="tmaxBand" name="Tmax p10–p90" stroke="none" fill="var(--series-2)" fillOpacity={0.15} isAnimationActive={false} legendType="none" />
        <Area dataKey="tminBand" name="Tmin p10–p90" stroke="none" fill="var(--series-1)" fillOpacity={0.15} isAnimationActive={false} legendType="none" />
        <Line dataKey="tmax" name="Max (panchayat)" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="tmin" name="Min (panchayat)" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
        <Line dataKey="blockTmax" name="Block" stroke="var(--chart-axis)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line dataKey="blockTmin" name="Block min" stroke="var(--chart-axis)" strokeDasharray="4 3" strokeWidth={1.5} dot={false} isAnimationActive={false} legendType="none" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function RainChart({ days }: { days: ForecastDay[] }) {
  const rows = days.map((d) => ({
    day: dayLabel(d.valid_date).split(",")[0],
    rain: d.rain_mm?.value,
    block: d.rain_mm?.block,
  }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <ComposedChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey="day" tick={AXIS} tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${Number(v).toFixed(1)} mm`} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="rain" name="Rain (panchayat)" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        <Line dataKey="block" name="Block" stroke="var(--chart-axis)" strokeDasharray="4 3" strokeWidth={1.5} dot={{ r: 3 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
