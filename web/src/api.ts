import { load } from "./lib/storage";
import type {
  Advisory,
  CompareRow,
  FeatureCollection,
  GPForecast,
  GPSearchHit,
  MapMeta,
  MapProps,
  RegionDetail,
  RegionSummary,
  Run,
  Validation,
  VariableId,
} from "./types";

// Same-origin by default (`pcast serve`, or the Vite dev proxy). When the frontend is
// hosted separately (e.g. Vercel), set VITE_API_BASE_URL to the backend origin at build time.
const API_ORIGIN = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "").replace(/\/+$/, "");
export const API = `${API_ORIGIN}/api/v1`;

export class ApiError extends Error {
  status: number;
  details: string[];
  constructor(status: number, message: string, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(API + path, init);
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    let details: string[] = [];
    try {
      const body = await res.json();
      const d = body.detail;
      if (typeof d === "string") message = d;
      else if (d?.message) {
        message = d.message;
        details = d.errors ?? [];
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, message, details);
  }
  return res.json() as Promise<T>;
}

const q = (params: Record<string, string | number | undefined | null>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
};

export const api = {
  regions: () => request<RegionSummary[]>("/regions"),
  region: (id: string) => request<RegionDetail>(`/regions/${id}`),
  blocks: (id: string) => request<FeatureCollection<MapProps>>(`/regions/${id}/blocks`),
  panchayats: (id: string) => request<FeatureCollection<MapProps>>(`/regions/${id}/panchayats`),
  search: (id: string, text: string) =>
    request<GPSearchHit[]>(`/regions/${id}/panchayats/search${q({ q: text, limit: 12 })}`),
  locate: (id: string, lat: number, lon: number) =>
    request<GPSearchHit & { distance_km: number }>(`/regions/${id}/panchayats/locate${q({ lat, lon })}`),
  runs: (id: string) => request<Run[]>(`/regions/${id}/runs`),
  run: (runId: string) => request<Run>(`/runs/${runId}`),
  map: (runId: string, variable: VariableId, validDate: string, level: "gp" | "block") =>
    request<FeatureCollection<MapProps, MapMeta>>(
      `/runs/${runId}/map${q({ variable, valid_date: validDate, level })}`,
    ),
  forecast: (runId: string, gp: number) => request<GPForecast>(`/runs/${runId}/panchayats/${gp}/forecast`),
  gpAdvisories: (runId: string, gp: number, lang = "en") =>
    request<Advisory[]>(`/runs/${runId}/panchayats/${gp}/advisories${q({ lang })}`),
  advisories: (
    runId: string,
    f: { block_lgd?: number; severity?: string; crop?: string; status?: string; lang?: string },
  ) => request<Advisory[]>(`/runs/${runId}/advisories${q(f)}`),
  updateAdvisory: (id: string, body: Partial<Pick<Advisory, "text_en" | "status" | "edited_by">>) =>
    request<Advisory>(`/advisories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(body),
    }),
  compare: (runId: string) => request<CompareRow[]>(`/runs/${runId}/compare`),
  validation: (id: string) => request<Validation>(`/regions/${id}/validation`),
  upload: (id: string, file: File, modelId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (modelId) form.append("model_id", modelId);
    return request<{ run_id: string; warnings: string[] }>(`/regions/${id}/runs`, {
      method: "POST",
      body: form,
      headers: authHeader(),
    });
  },
  emulate: (id: string, issueDate: string) =>
    request<{ run_id: string }>(`/regions/${id}/runs/emulate${q({ issue_date: issueDate })}`, {
      method: "POST",
      headers: authHeader(),
    }),
  fetchLive: (id: string) =>
    request<{ run_id: string; provider: string }>(`/regions/${id}/runs/fetch`, {
      method: "POST",
      headers: authHeader(),
    }),
};

export const downloads = {
  csv: (runId: string) => `${API}/runs/${runId}/export.csv`,
  geojson: (runId: string) => `${API}/runs/${runId}/export.geojson`,
  pdf: (runId: string, lang = "en", block?: number) =>
    `${API}/runs/${runId}/bulletin.pdf${q({ lang, block_lgd: block })}`,
  sms: (runId: string, lang = "en") => `${API}/runs/${runId}/sms.csv${q({ lang })}`,
  tif: (runId: string, variable: string, date: string) => `${API}/runs/${runId}/raster/${variable}/${date}.tif`,
};

function authHeader(): Record<string, string> {
  const key = load<string>("apiKey", "");
  return key ? { "X-API-Key": key } : {};
}
