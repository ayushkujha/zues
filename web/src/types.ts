export type VariableId =
  | "rain_mm"
  | "tmax_c"
  | "tmin_c"
  | "rh_max_pct"
  | "rh_min_pct"
  | "wind_kmph"
  | "wind_dir_deg"
  | "cloud_okta";

export type Severity = "green" | "yellow" | "orange" | "red";
export type Confidence = "high" | "medium" | "low";

export interface RegionSummary {
  region_id: string;
  name: string;
  data_source: string;
  bbox: [number, number, number, number];
  n_blocks: number;
  n_gps: number;
  languages: string[];
  model_version: string | null;
  latest_run_id: string | null;
}

export interface RegionDetail extends RegionSummary {
  splits: Record<string, [string, string]>;
  models: string[];
  default_model: string;
  data_period: [string, string] | null;
  n_active_cells: number;
}

export interface Run {
  run_id: string;
  region_id: string;
  issue_date: string;
  source: string;
  model_id: string;
  model_version: string | null;
  status: "queued" | "running" | "done" | "failed";
  created_at: string;
  finished_at: string | null;
  notes: string | null;
  advisory_counts?: Partial<Record<Severity, number>>;
}

export interface MapProps {
  gp_lgd?: number;
  gp_name?: string;
  block_lgd: number;
  block_name: string;
  area_km2?: number;
  value: number | null;
  p10?: number | null;
  p90?: number | null;
  confidence?: Confidence;
  block_value?: number | null;
  diff_from_block?: number | null;
}

export interface Feature<P> {
  type: "Feature";
  properties: P;
  geometry: { type: string; [key: string]: unknown };
}

export interface FeatureCollection<P, M = unknown> {
  type: "FeatureCollection";
  features: Feature<P>[];
  properties?: M;
}

export interface MapMeta {
  run_id: string;
  variable: VariableId;
  valid_date: string;
  level: "gp" | "block";
  label: string;
  unit: string;
  min: number | null;
  max: number | null;
}

export interface VarValue {
  value: number | null;
  p10: number | null;
  p90: number | null;
  confidence: Confidence;
  block: number | null;
}

export type ForecastDay = { valid_date: string; lead_day: number } & Partial<Record<VariableId, VarValue>>;

export interface GPForecast {
  gp_lgd: number;
  gp_name: string;
  block_lgd: number;
  block_name: string;
  area_km2: number;
  run: Run;
  days: ForecastDay[];
}

export interface Advisory {
  advisory_id: string;
  run_id: string;
  gp_lgd: number;
  block_lgd: number;
  crop: string;
  crop_stage: string | null;
  valid_from: string;
  valid_to: string;
  rule_id: string;
  category: string;
  severity: Severity;
  text_en: string;
  text: string;
  lang: string;
  machine_translated: boolean;
  translations: string[];
  params: Record<string, number | string> | null;
  status: "draft" | "approved" | "rejected";
  edited_by: string | null;
  updated_at: string;
}

export interface MetricRow {
  model_id: string;
  variable: VariableId;
  level: "station" | "gp";
  split: string;
  metric: string;
  threshold: number | null;
  lead_day: number | null;
  value: number | null;
  n: number;
}

export interface Validation {
  model_version: string | null;
  metrics: MetricRow[];
  summary: { model_id: string; variable: VariableId; level: string; value: number | null }[];
}

export interface CompareRow {
  block_lgd: number;
  valid_date: string;
  variable: VariableId;
  min: number;
  max: number;
  std: number | null;
  range: number;
  block_value: number | null;
}

export interface GPSearchHit {
  gp_lgd: number;
  gp_name: string;
  block_lgd: number;
  block_name: string;
}
