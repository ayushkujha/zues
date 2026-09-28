import type { Severity, VariableId } from "../types";
import { CROP_NAMES } from "./i18n";

export const VARIABLES: { id: VariableId; label: string; short: string; unit: string; digits: number }[] = [
  { id: "rain_mm", label: "Rainfall", short: "Rain", unit: "mm", digits: 1 },
  { id: "tmax_c", label: "Max temperature", short: "Tmax", unit: "°C", digits: 1 },
  { id: "tmin_c", label: "Min temperature", short: "Tmin", unit: "°C", digits: 1 },
  { id: "rh_max_pct", label: "Max humidity", short: "RH max", unit: "%", digits: 0 },
  { id: "rh_min_pct", label: "Min humidity", short: "RH min", unit: "%", digits: 0 },
  { id: "wind_kmph", label: "Wind speed", short: "Wind", unit: "km/h", digits: 1 },
  { id: "cloud_okta", label: "Cloud cover", short: "Cloud", unit: "okta", digits: 1 },
];

export const varInfo = (id: VariableId) =>
  VARIABLES.find((v) => v.id === id) ?? { id, label: id, short: id, unit: "", digits: 1 };

export function fmt(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  return v.toFixed(digits);
}

/** Rain amount for display: one decimal below 1 mm so drizzle never reads as "0 mm". */
export function fmtRain(v: number | null | undefined): string {
  if (v === null || v === undefined) return "–";
  return v > 0 && v < 1 ? v.toFixed(1) : v.toFixed(0);
}

export function fmtVar(id: VariableId, v: number | null | undefined, withUnit = true): string {
  const info = varInfo(id);
  const s = fmt(v, info.digits);
  return withUnit && s !== "–" ? `${s} ${info.unit}` : s;
}

export function signed(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "–";
  if (Math.abs(v) < 0.5 * 10 ** -digits) return "0";
  return (v > 0 ? "+" : v < 0 ? "−" : "±") + Math.abs(v).toFixed(digits);
}

export function dayLabel(iso: string, style: "short" | "long" = "short"): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString("en-IN", style === "short"
    ? { weekday: "short", day: "numeric", month: "short" }
    : { weekday: "long", day: "numeric", month: "long" });
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export const RAIN_CATEGORIES: { name: string; min: number; max: number }[] = [
  { name: "No rain", min: 0, max: 0.1 },
  { name: "Very light", min: 0.1, max: 2.5 },
  { name: "Light", min: 2.5, max: 15.6 },
  { name: "Moderate", min: 15.6, max: 64.5 },
  { name: "Heavy", min: 64.5, max: 115.6 },
  { name: "Very heavy", min: 115.6, max: 204.5 },
  { name: "Extremely heavy", min: 204.5, max: Infinity },
];

export function rainCategoryIndex(mm: number | null | undefined): number {
  if (mm === null || mm === undefined) return 0;
  const i = RAIN_CATEGORIES.findIndex((c) => mm >= c.min && mm < c.max);
  return i < 0 ? 0 : i;
}

export const SEVERITY_ORDER: Severity[] = ["red", "orange", "yellow", "green"];

export const SEVERITY_LABEL: Record<Severity, string> = {
  red: "Take action",
  orange: "Be prepared",
  yellow: "Be aware",
  green: "No risk",
};

export function weatherIcon(rain?: number | null, cloud?: number | null): string {
  const r = rain ?? 0;
  if (r >= 64.5) return "⛈️";
  if (r >= 15.6) return "🌧️";
  if (r >= 2.5) return "🌦️";
  if ((cloud ?? 0) >= 6) return "☁️";
  if ((cloud ?? 0) >= 3) return "⛅";
  return "☀️";
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function cropLabel(crop: string): string {
  return crop === "all" ? "All crops" : CROP_NAMES.en[crop] ?? titleCase(crop);
}
