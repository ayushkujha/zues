import { useEffect, useRef, useState } from "react";
import { ApiError, api, downloads } from "../api";
import { SourceBadge } from "../components/Badges";
import { go } from "../router";
import { load, save } from "../lib/storage";
import { useApp } from "../state";

export default function RunsPage() {
  const { region, regionId, runs, runId, setRunId, refreshRuns } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [over, setOver] = useState(false);
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<{ message: string; details: string[] } | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState(() => load<string>("apiKey", ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (region?.data_period && !issue) {
      // Default to a monsoon day inside the data period (emulation needs 5 days of data after it).
      const last = region.data_period[1];
      const year = last.slice(0, 4);
      const candidate = `${year}-07-10`;
      setIssue(candidate < last ? candidate : region.data_period[0]);
    }
  }, [region, issue]);

  // Poll while any run is still being processed.
  useEffect(() => {
    if (!runs.some((r) => r.status === "queued" || r.status === "running")) return;
    const t = window.setInterval(() => refreshRuns(), 1500);
    return () => window.clearInterval(t);
  }, [runs, refreshRuns]);

  const saveKey = (k: string) => {
    setApiKey(k);
    save("apiKey", k);
  };

  const handle = async (label: string, fn: () => Promise<{ run_id: string; warnings?: string[] }>) => {
    if (!regionId) return;
    setBusy(label);
    setErrors(null);
    setOk(null);
    try {
      const res = await fn();
      setOk(`Run ${res.run_id.slice(0, 8)} started.${res.warnings?.length ? ` Warnings: ${res.warnings.join("; ")}` : ""}`);
      const rs = await refreshRuns();
      const poll = async (tries: number): Promise<void> => {
        const r = (await refreshRuns()).find((x) => x.run_id === res.run_id);
        if (r?.status === "done") {
          setRunId(res.run_id);
          setOk(`Run ${res.run_id.slice(0, 8)} is ready. It is now the selected run.`);
        } else if (r?.status === "failed") {
          setErrors({ message: "The run failed", details: [r.notes ?? ""] });
        } else if (tries > 0) {
          await new Promise((ok) => setTimeout(ok, 1200));
          return poll(tries - 1);
        }
      };
      if (rs.length) await poll(40);
    } catch (e) {
      const err = e as ApiError;
      setErrors({ message: err.message, details: err.details ?? [] });
    } finally {
      setBusy(null);
    }
  };

  if (!region) return <div className="empty"><span className="spinner" /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Forecast runs</h1>
          <p>Upload the official block forecast, or create a demo run. Each run downscales all variables to every panchayat and drafts advisories.</p>
        </div>
      </div>

      <div className="grid cols-3" style={{ marginBottom: 16 }}>
        <div className="card card-pad">
          <h2>Upload block forecast</h2>
          <div
            className={`dropzone ${over ? "over" : ""}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); setFile(e.dataTransfer.files[0] ?? null); }}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
          >
            <div style={{ fontSize: 26 }}>📄</div>
            <div><b>{file ? file.name : "Drop CSV here or click to choose"}</b></div>
            <div className="small muted">block_lgd, issue_date, valid_date, rain_mm, tmax_c, tmin_c, rh_max_pct, rh_min_pct, wind_kmph, wind_dir_deg, cloud_okta</div>
            <input ref={inputRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <button className="btn primary" style={{ marginTop: 10, width: "100%" }} disabled={!file || !!busy}
            onClick={() => file && handle("upload", () => api.upload(region.region_id, file))}>
            {busy === "upload" ? <span className="spinner" /> : "Downscale this forecast"}
          </button>
        </div>

        <div className="card card-pad">
          <h2>Demo: emulated forecast</h2>
          <p className="small muted">Builds a block forecast from the region's historical data plus realistic forecast error (for demos without an official feed).</p>
          <label className="field"><span>Issue date</span>
            <input className="input" type="date" value={issue} min={region.data_period?.[0]} max={region.data_period?.[1]} onChange={(e) => setIssue(e.target.value)} />
          </label>
          <button className="btn" style={{ marginTop: 10, width: "100%" }} disabled={!issue || !!busy}
            onClick={() => handle("emulate", () => api.emulate(region.region_id, issue))}>
            {busy === "emulate" ? <span className="spinner" /> : "Create emulated run"}
          </button>
        </div>

        <div className="card card-pad">
          <h2>Live NWP forecast</h2>
          <p className="small muted">Fetches today's 5-day numerical weather forecast for every block centroid (Open-Meteo, GFS/ECMWF) and downscales it. Needs internet.</p>
          <button className="btn" style={{ marginTop: 10, width: "100%" }} disabled={!!busy}
            onClick={() => handle("live", () => api.fetchLive(region.region_id))}>
            {busy === "live" ? <span className="spinner" /> : "Fetch live forecast"}
          </button>
          <details style={{ marginTop: 12 }}>
            <summary className="small muted" style={{ cursor: "pointer" }}>API key (only if the server requires one)</summary>
            <input className="input" style={{ marginTop: 6, width: "100%" }} type="password" value={apiKey} onChange={(e) => saveKey(e.target.value)} placeholder="X-API-Key" />
          </details>
        </div>
      </div>

      {errors && (
        <div className="errorbox" style={{ marginBottom: 16 }}>
          <b>{errors.message}</b>
          {errors.details.length > 0 && <ul>{errors.details.map((d) => <li key={d}>{d}</li>)}</ul>}
        </div>
      )}
      {ok && <div className="okbox" style={{ marginBottom: 16 }}>{ok}</div>}

      <div className="card">
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>Issue date</th><th>Source</th><th>Model</th><th>Status</th><th>Created</th><th>Downloads</th><th /></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.run_id} style={r.run_id === runId ? { background: "var(--primary-soft)" } : undefined}>
                  <td className="num"><b>{r.issue_date}</b><div className="small faint">{r.run_id.slice(0, 8)}</div></td>
                  <td><SourceBadge source={r.source} /></td>
                  <td className="small">{r.model_id}<div className="faint">{r.model_version}</div></td>
                  <td>
                    {r.status === "done" && <span className="badge status-approved">done</span>}
                    {r.status === "failed" && <span className="badge status-rejected" title={r.notes ?? ""}>failed</span>}
                    {(r.status === "queued" || r.status === "running") && <span className="badge neutral"><span className="spinner" style={{ width: 10, height: 10 }} /> {r.status}</span>}
                    {r.notes && r.status !== "failed" && <div className="small faint">{r.notes}</div>}
                  </td>
                  <td className="small num">{r.created_at?.slice(0, 16).replace("T", " ")}</td>
                  <td className="small">
                    {r.status === "done" && (
                      <div className="row wrap" style={{ gap: 6 }}>
                        <a href={downloads.csv(r.run_id)}>CSV</a>
                        <a href={downloads.geojson(r.run_id)}>GeoJSON</a>
                        <a href={downloads.pdf(r.run_id)} target="_blank" rel="noreferrer">PDF</a>
                        <a href={downloads.sms(r.run_id)}>SMS</a>
                      </div>
                    )}
                  </td>
                  <td>
                    {r.status === "done" && (
                      <button className="btn sm" onClick={() => { setRunId(r.run_id); go("/"); }}>
                        {r.run_id === runId ? "Selected" : "Open"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!runs.length && <tr><td colSpan={7} className="muted">No runs yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
