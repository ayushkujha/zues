import { sourceLabel } from "./components/Badges";
import { BrandMark, Icon } from "./components/Icon";
import AdvisoriesPage from "./pages/AdvisoriesPage";
import ComparePage from "./pages/ComparePage";
import FarmerPage from "./pages/FarmerPage";
import MapPage from "./pages/MapPage";
import RunsPage from "./pages/RunsPage";
import ValidationPage from "./pages/ValidationPage";
import { useRoute } from "./router";
import { useApp } from "./state";

const NAV = [
  { href: "#/", page: "map", label: "Forecast" },
  { href: "#/compare", page: "compare", label: "Compare" },
  { href: "#/advisories", page: "advisories", label: "Advisories" },
  { href: "#/validation", page: "validation", label: "Validation" },
  { href: "#/runs", page: "runs", label: "Runs" },
];

export default function App() {
  const route = useRoute();
  const { regions, regionId, setRegionId, runs, runId, setRunId, region, run, error, dark, toggleTheme } = useApp();

  if (route.page === "farmer") return <FarmerPage gp={route.gp} />;

  const done = runs.filter((r) => r.status === "done");
  const synthetic = region?.data_source === "synthetic";
  const unofficial = run && run.source !== "official" && run.source !== "upload";
  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/" aria-label="PanchayatCast home">
          <BrandMark />
          PanchayatCast
        </a>
        {regions.length > 0 && (
          <div className="ctx">
            <span className="ctx-label">District</span>
            {regions.length > 1 ? (
              <select value={regionId ?? ""} onChange={(e) => setRegionId(e.target.value)} aria-label="District">
                {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.name}</option>)}
              </select>
            ) : (
              <b>{region?.name ?? regions[0].name}</b>
            )}
          </div>
        )}
        <nav className="tabs" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.page} href={n.href} className={route.page === n.page ? "active" : ""} aria-current={route.page === n.page ? "page" : undefined}>
              {n.label}
            </a>
          ))}
        </nav>
        <div className="topbar-right">
          {(synthetic || unofficial) && (
            <span
              className="chip warn"
              title={synthetic
                ? "Synthetic district: generated terrain, boundaries and weather. Not real places or forecasts."
                : `This run's block forecast is ${run?.source === "nwp" ? "a live NWP forecast (Open-Meteo) at block centroids" : "emulated from historical data"}, not an official IMD bulletin.`}
            >
              <Icon name="info" size={13} />
              {synthetic ? "Demo data" : "Not an IMD bulletin"}
            </span>
          )}
          <label className="bulletin" title={run ? `Forecast run: ${sourceLabel(run.source)}, issued ${issued(run.issue_date)}, model ${run.model_id}` : undefined}>
            <span className={`status-dot ${run?.source ?? ""}`} />
            <select value={runId ?? ""} onChange={(e) => setRunId(e.target.value)} aria-label="Forecast run" disabled={!done.length}>
              {!done.length && <option value="">No forecast runs yet</option>}
              {done.map((r) => (
                <option key={r.run_id} value={r.run_id}>{issued(r.issue_date)} · {SHORT_SOURCE[r.source] ?? r.source}</option>
              ))}
            </select>
          </label>
          <a className="btn ghost" href="#/farmer" title="Phone view for farmers (English, Hindi, Kannada)">
            <Icon name="phone" />
            <span className="hide-sm">Farmer view</span>
          </a>
          <button className="iconbtn" onClick={toggleTheme} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"} title={dark ? "Light mode" : "Dark mode"}>
            <Icon name={dark ? "sun" : "moon"} />
          </button>
        </div>
      </header>
      {error && (
        <div className="notice error" role="alert" style={{ margin: 16 }}>
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      )}
      <main className="main">
        {route.page === "map" && <MapPage />}
        {route.page === "compare" && <ComparePage />}
        {route.page === "advisories" && <AdvisoriesPage />}
        {route.page === "validation" && <ValidationPage />}
        {route.page === "runs" && <RunsPage />}
      </main>
    </div>
  );
}

const SHORT_SOURCE: Record<string, string> = { official: "IMD", upload: "Uploaded", emulated: "Emulated", nwp: "Live NWP" };

function issued(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
