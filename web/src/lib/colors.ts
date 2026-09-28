import type { VariableId } from "../types";
import { RAIN_CATEGORIES, rainCategoryIndex } from "./format";

// Rain: sequential blue binned by IMD categories, ending in violet for the extremes.
export const RAIN_COLORS = ["#eef1f5", "#cfe3f7", "#8fbfeb", "#4a93db", "#1f62b3", "#123f7c", "#4b2f9b"];

// One-hue sequential ramps (light -> dark), 7 steps each.
const RAMPS = {
  warm: ["#fff1d6", "#fdd79c", "#f9b566", "#f18d44", "#df632e", "#bb4122", "#8a2a18"],
  teal: ["#e6f5f1", "#bfe6dc", "#8dd1c0", "#55b6a0", "#2b9580", "#177563", "#0c5649"],
  violet: ["#ecebf8", "#d0cdf0", "#aea8e3", "#8a80d2", "#6a5cbd", "#4f41a1", "#35297a"],
  gray: ["#f4f5f7", "#dde1e7", "#c3c9d2", "#a4adb9", "#87909e", "#6a7381", "#4f5763"],
} as const;

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
const DIV_BLUE = ["#cfe3f7", "#8fbfeb", "#4a93db", "#1f62b3"];
const DIV_MID = "#f1f1ef";
const DIV_RED = ["#fbd5cf", "#f4a194", "#e2604c", "#b73a2b"];

/** Words for the two ends of the difference legend (below / above the block value). */
export const DIFF_WORDS: Record<VariableId, [string, string]> = {
  rain_mm: ["drier", "wetter"],
  tmax_c: ["cooler", "warmer"],
  tmin_c: ["cooler", "warmer"],
  rh_max_pct: ["drier air", "more humid"],
  rh_min_pct: ["drier air", "more humid"],
  wind_kmph: ["calmer", "windier"],
  wind_dir_deg: ["", ""],
  cloud_okta: ["clearer", "cloudier"],
};

export interface Scale {
  kind: "categorical" | "sequential" | "diverging";
  color: (v: number | null | undefined) => string;
  /** Colour steps, low to high. */
  steps: string[];
  /** Tick labels at step boundaries: position 0..1 along the bar. */
  ticks: { at: number; label: string }[];
  domain: [number, number];
}

const NO_DATA = "#d4d7dc";

export function rainScale(): Scale {
  const bounds = RAIN_CATEGORIES.slice(1).map((c) => c.min);
  return {
    kind: "categorical",
    color: (v) => (v === null || v === undefined ? NO_DATA : RAIN_COLORS[rainCategoryIndex(v)]),
    steps: RAIN_COLORS,
    ticks: bounds.map((b, i) => ({ at: (i + 1) / RAIN_COLORS.length, label: String(b) })),
    domain: [0, 204.5],
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
  const tickAt = [0, 0.5, 1];
  return {
    kind: "sequential",
    color,
    steps: [...ramp],
    ticks: tickAt.map((at) => ({ at, label: (min + span * at).toFixed(digits) })),
    domain: [min, max],
  };
}

/** Difference from the block value; for rain and humidity, wetter is blue (so the sign is flipped). */
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
  const steps = [...[...neg].reverse(), DIV_MID, ...pos];
  const f = (x: number) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(digits);
  return {
    kind: "diverging",
    color,
    steps,
    ticks: [{ at: 0, label: f(-m) }, { at: 0.5, label: "0" }, { at: 1, label: f(m) }],
    domain: [-m, m],
  };
}
