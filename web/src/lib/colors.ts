import type { Severity, VariableId } from "../types";
import { RAIN_CATEGORIES, rainCategoryIndex } from "./format";

// Rain: sequential blue binned by IMD categories, ending in violet for extremes.
export const RAIN_COLORS = ["#e9eef4", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b", "#4a3aa7"];

// One-hue sequential ramps (light -> dark), 7 steps each.
const RAMPS: Record<string, string[]> = {
  warm: ["#fde9d9", "#f9c9a7", "#f4a472", "#eb6834", "#c9501f", "#a03d17", "#74290f"],
  teal: ["#d6f2ea", "#a6e0cf", "#6fcab0", "#1baf7a", "#148a60", "#0e6848", "#094a33"],
  violet: ["#e6e3f8", "#c9c3f0", "#a79de5", "#8577d6", "#6655c0", "#4a3aa7", "#33287a"],
  gray: ["#f3f3f1", "#dcdbd6", "#c3c2b7", "#a3a29a", "#898781", "#6b6a65", "#52514e"],
};

const RAMP_FOR: Record<VariableId, keyof typeof RAMPS> = {
  rain_mm: "teal",
  tmax_c: "warm",
  tmin_c: "warm",
  rh_max_pct: "teal",
  rh_min_pct: "teal",
  wind_kmph: "violet",
  wind_dir_deg: "violet",
  cloud_okta: "gray",
};

// Diverging: blue <- neutral -> red. Each arm is ordered light -> dark (by magnitude).
const DIV_BLUE = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab"];
const DIV_MID = "#f0efec";
const DIV_RED = ["#fbd3d2", "#f19b9a", "#e34948", "#b8302f"];

export const SEVERITY_COLOR: Record<Severity, string> = {
  red: "#C62828",
  orange: "#EF6C00",
  yellow: "#F9A825",
  green: "#2E7D32",
};

export const SEVERITY_ICON: Record<Severity, string> = {
  red: "⛔",
  orange: "⚠️",
  yellow: "👁️",
  green: "✅",
};

export interface Scale {
  kind: "categorical" | "sequential" | "diverging";
  color: (v: number | null | undefined) => string;
  stops: { color: string; label: string }[];
}

const NO_DATA = "#d9d9d9";

export function rainScale(): Scale {
  return {
    kind: "categorical",
    color: (v) => (v === null || v === undefined ? NO_DATA : RAIN_COLORS[rainCategoryIndex(v)]),
    stops: RAIN_CATEGORIES.map((c, i) => ({
      color: RAIN_COLORS[i],
      label: c.max === Infinity ? `≥ ${c.min}` : i === 0 ? "0" : `${c.min}–${c.max}`,
    })),
  };
}

export function sequentialScale(variable: VariableId, min: number, max: number, digits = 1): Scale {
  const ramp = RAMPS[RAMP_FOR[variable]];
  const span = max - min || 1;
  const color = (v: number | null | undefined) => {
    if (v === null || v === undefined) return NO_DATA;
    const t = Math.min(0.999, Math.max(0, (v - min) / span));
    return ramp[Math.floor(t * ramp.length)];
  };
  const stops = ramp.map((c, i) => ({
    color: c,
    label: (min + (span * (i + 0.5)) / ramp.length).toFixed(digits),
  }));
  return { kind: "sequential", color, stops };
}

/** Difference from the block value; for rain, wetter is blue (so the sign is flipped). */
export function divergingScale(variable: VariableId, maxAbs: number, digits = 1): Scale {
  const m = maxAbs || 1;
  const flip = variable === "rain_mm" || variable.startsWith("rh_");
  const neg = flip ? DIV_RED : DIV_BLUE;
  const pos = flip ? DIV_BLUE : DIV_RED;
  const color = (v: number | null | undefined) => {
    if (v === null || v === undefined) return NO_DATA;
    const t = Math.max(-1, Math.min(1, v / m));
    if (Math.abs(t) < 0.1) return DIV_MID;
    const arm = t < 0 ? neg : pos;
    return arm[Math.min(arm.length - 1, Math.floor(((Math.abs(t) - 0.1) / 0.9) * arm.length))];
  };
  const steps = [-1, -0.7, -0.4, -0.15, 0, 0.15, 0.4, 0.7, 1];
  const stops = steps.map((s) => ({ color: color(s * m), label: (s * m).toFixed(digits) }));
  return { kind: "diverging", color, stops };
}
