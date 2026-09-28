import type { Severity, VariableId } from "../types";

// Line icons (24px grid, 1.75 stroke) so the UI never depends on emoji rendering.
const PATHS = {
  sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z", "M12 2v2", "M12 20v2", "m4.93 4.93 1.41 1.41", "m17.66 17.66 1.41 1.41", "M2 12h2", "M20 12h2", "m6.34 17.66-1.41 1.41", "m19.07 4.93-1.41 1.41"],
  moon: ["M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"],
  x: ["M18 6 6 18", "m6 6 12 12"],
  check: ["M20 6 9 17l-5-5"],
  pencil: ["M21.17 6.81a2.83 2.83 0 0 0-4-4L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5Z", "m15 5 4 4"],
  play: ["M7 4.5v15a.5.5 0 0 0 .76.43l12.5-7.5a.5.5 0 0 0 0-.86L7.76 4.07A.5.5 0 0 0 7 4.5Z"],
  pause: ["M8 5v14", "M16 5v14"],
  back: ["m12 19-7-7 7-7", "M19 12H5"],
  pin: ["M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z", "M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"],
  speaker: ["M11 5 6 9H2v6h4l5 4V5Z", "M15.54 8.46a5 5 0 0 1 0 7.07", "M19.07 4.93a10 10 0 0 1 0 14.14"],
  stop: ["M7 7h10v10H7z"],
  file: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v5h5"],
  swap: ["m8 7-5 5 5 5", "m16 7 5 5-5 5"],
  download: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
  upload: ["M12 15V3", "m7 8 5-5 5 5", "M5 21h14"],
  sprout: ["M7 20h10", "M12 20v-9", "M12 11c0-3.5-2.5-6-7-6 0 4 2.5 6 7 6Z", "M12 13c0-3.5 2.5-6 7-6 0 4-2.5 6-7 6Z"],
  alert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z", "M12 9v4", "M12 17h.01"],
  arrow: ["M5 12h14", "m12 5 7 7-7 7"],
  chevronDown: ["m6 9 6 6 6-6"],
  chevronRight: ["m9 18 6-6-6-6"],
  search: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16Z", "m21 21-4.3-4.3"],
  radio: ["M4.9 19.1C1 15.2 1 8.8 4.9 4.9", "M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5", "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z", "M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5", "M19.1 4.9C23 8.8 23 15.1 19.1 19"],
  flask: ["M10 2v7.53a2 2 0 0 1-.21.9L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.07-10.12A2 2 0 0 1 14 9.53V2", "M8.5 2h7", "M7 16h10"],
  phone: ["M17 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2Z", "M12 18h.01"],
  external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  info: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z", "M12 16v-4", "M12 8h.01"],
  locate: ["M2 12h3", "M19 12h3", "M12 2v3", "M12 19v3", "M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z", "M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"],
  calendar: ["M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z", "M16 2v4", "M8 2v4", "M3 10h18"],
  key: ["m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4", "m21 2-9.6 9.6", "M7.5 13a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"],
  // weather variables
  drop: ["M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7Z"],
  thermoUp: ["M11 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z", "M18 4v9", "m15 7 3-3 3 3"],
  thermoDown: ["M11 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z", "M18 4v9", "m15 10 3 3 3-3"],
  droplets: ["M7 16.3c2.2 0 4-1.83 4-4.05 0-1.16-.57-2.26-1.71-3.19S7.29 6.75 7 5.3c-.29 1.45-1.14 2.84-2.29 3.76S3 11.1 3 12.25c0 2.22 1.8 4.05 4 4.05Z", "M12.56 6.6A10.97 10.97 0 0 0 14 3.02c.5 2.5 2 4.9 4 6.5s3 3.5 3 5.5a6.98 6.98 0 0 1-11.91 4.97"],
  wind: ["M12.8 19.6A2 2 0 1 0 14 16H2", "M17.5 8a2.5 2.5 0 1 1 2 4H2", "M9.8 4.4A2 2 0 1 1 11 8H2"],
  cloud: ["M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"],
} as const;

export type IconName = keyof typeof PATHS;

export const VARIABLE_ICON: Record<VariableId, IconName> = {
  rain_mm: "drop",
  tmax_c: "thermoUp",
  tmin_c: "thermoDown",
  rh_max_pct: "droplets",
  rh_min_pct: "droplets",
  wind_kmph: "wind",
  wind_dir_deg: "wind",
  cloud_okta: "cloud",
};

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={`ico ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}

// Severity shapes differ as well as colours, so the level never relies on colour alone.
export function SeverityIcon({ severity, size = 12 }: { severity: Severity; size?: number }) {
  return (
    <svg className={`ico sev-${severity}`} width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {severity === "red" && <path d="M3.9 0.5h4.2l3.4 3.4v4.2l-3.4 3.4H3.9L0.5 8.1V3.9ZM3 5v2h6V5Z" fill="currentColor" fillRule="evenodd" />}
      {severity === "orange" && <path d="M6 0.8 11.4 10.6H0.6Z" fill="currentColor" />}
      {severity === "yellow" && <circle cx="6" cy="6" r="5" fill="currentColor" />}
      {severity === "green" && <path d="m2 6.2 2.6 2.6L10 3.4" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// ---- weather ---------------------------------------------------------------------------
type Tone = "sun" | "cloud" | "rain" | "bolt";
type Glyph = { d: string; tone: Tone }[];

const CLOUD_TOP = "M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24";
const GLYPHS: Record<WeatherKind, Glyph> = {
  clear: PATHS.sun.map((d) => ({ d, tone: "sun" as const })),
  partly: [
    { d: "M12 2v2", tone: "sun" }, { d: "m4.93 4.93 1.41 1.41", tone: "sun" }, { d: "M20 12h2", tone: "sun" },
    { d: "m19.07 4.93-1.41 1.41", tone: "sun" }, { d: "M15.95 12.65a4 4 0 0 0-5.93-4.13", tone: "sun" },
    { d: "M13 22H7a5 5 0 1 1 4.9-6H13a3 3 0 0 1 0 6Z", tone: "cloud" },
  ],
  cloudy: [{ d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z", tone: "cloud" }],
  drizzle: [
    { d: CLOUD_TOP, tone: "cloud" },
    { d: "M8 19v1", tone: "rain" }, { d: "M8 14v1", tone: "rain" }, { d: "M16 19v1", tone: "rain" },
    { d: "M16 14v1", tone: "rain" }, { d: "M12 21v1", tone: "rain" }, { d: "M12 16v1", tone: "rain" },
  ],
  rain: [
    { d: CLOUD_TOP, tone: "cloud" },
    { d: "M16 14v6", tone: "rain" }, { d: "M8 14v6", tone: "rain" }, { d: "M12 16v6", tone: "rain" },
  ],
  storm: [
    { d: "M6 16.33A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 .5 8.97", tone: "cloud" },
    { d: "m13 12-3 5h4l-3 5", tone: "bolt" },
  ],
};

export type WeatherKind = "clear" | "partly" | "cloudy" | "drizzle" | "rain" | "storm";

export function weatherKind(rain?: number | null, cloud?: number | null): WeatherKind {
  const r = rain ?? 0;
  if (r >= 64.5) return "storm";
  if (r >= 15.6) return "rain";
  if (r >= 2.5) return "drizzle";
  if ((cloud ?? 0) >= 6) return "cloudy";
  if ((cloud ?? 0) >= 3) return "partly";
  return "clear";
}

export function WeatherIcon({ rain, cloud, size = 28, className }: { rain?: number | null; cloud?: number | null; size?: number; className?: string }) {
  const kind = weatherKind(rain, cloud);
  return (
    <svg className={`wx ${className ?? ""}`} width={size} height={size} viewBox="0 0 24 24" fill="none" strokeWidth={size > 48 ? 1.2 : 1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {GLYPHS[kind].map((g) => <path key={g.d} d={g.d} className={`wx-${g.tone}`} />)}
    </svg>
  );
}

// Brand mark: a district cut into panchayat cells, one of them lit.
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="28" height="28" rx="7" fill="#116149" />
      <path d="M13.2 10.4 17.8 13.6 16.4 19.2 11.2 19.8 9 15.2Z" fill="#7fe0bc" />
      <path d="M5 9.5 13.2 10.4 14 4.5M13.2 10.4 17.8 13.6 23 11M17.8 13.6 16.4 19.2 19 23.5M16.4 19.2 11.2 19.8 9.5 23.5M11.2 19.8 9 15.2 4.5 16.5M9 15.2 13.2 10.4"
        fill="none" stroke="#fff" strokeOpacity={0.55} strokeWidth={1.1} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
