import ComparePage from "./pages/ComparePage";
import AdvisoriesPage from "./pages/AdvisoriesPage";
import FarmerPage from "./pages/FarmerPage";
import MapPage from "./pages/MapPage";
import RunsPage from "./pages/RunsPage";
import ValidationPage from "./pages/ValidationPage";
import { useRoute } from "./router";
import { useApp } from "./state";

const NAV = [
  { href: "#/", page: "map", label: "Forecast map" },
  { href: "#/compare", page: "compare", label: "Compare" },
  { href: "#/advisories", page: "advisories", label: "Advisories" },
  { href: "#/validation", page: "validation", label: "Validation" },
  { href: "#/runs", page: "runs", label: "Runs" },
  { href: "#/farmer", page: "farmer", label: "Farmer view" },
];

export default function App() {
  const route = useRoute();
  const { regions, regionId, setRegionId, runs, runId, setRunId, region, run, error, dark, toggleTheme } = useApp();

  if (route.page === "farmer") {
    return (
      <div className="main" style={{ height: "100%" }}>
        <FarmerPage gp={route.gp} />
      </div>
    );
  }

  const done = runs.filter((r) => r.status === "done");
  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/"><span className="brand-mark" aria-hidden>☁</span>PanchayatCast</a>
        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.page} href={n.href} className={route.page === n.page ? "active" : ""}>{n.label}</a>
          ))}
        </nav>
        <div className="controls">
          {regions.length > 1 && (
            <select className="select" value={regionId ?? ""} onChange={(e) => setRegionId(e.target.value)} aria-label="Region">
              {regions.map((r) => <option key={r.region_id} value={r.region_id}>{r.name}</option>)}
            </select>
          )}
          {regions.length === 1 && <span className="small muted" style={{ whiteSpace: "nowrap" }}>{region?.name ?? regions[0].name}</span>}
          <select className="select" value={runId ?? ""} onChange={(e) => setRunId(e.target.value)} aria-label="Forecast run" disabled={!done.length}>
            {!done.length && <option value="">No runs</option>}
            {done.map((r) => (
              <option key={r.run_id} value={r.run_id}>Issued {r.issue_date} · {r.source}</option>
            ))}
          </select>
          <button className="btn ghost" onClick={toggleTheme} aria-label="Toggle dark mode" title="Toggle dark mode">{dark ? "☀" : "☾"}</button>
        </div>
      </header>
      {(region?.data_source === "synthetic" || run?.source === "emulated" || run?.source === "nwp") && (
        <div className="banner" role="note">
          {region?.data_source === "synthetic" && <span>⚠️ <b>Synthetic demo district:</b> generated terrain, boundaries and weather. Not real places or forecasts.</span>}
          {run?.source === "emulated" && <span>Block forecast for this run is <b>emulated</b>, not an official IMD forecast.</span>}
          {run?.source === "nwp" && <span>Block forecast for this run is a <b>live NWP forecast</b> (Open-Meteo) at block centroids, not an official IMD forecast.</span>}
        </div>
      )}
      {error && <div className="errorbox" style={{ margin: 16 }}>{error}</div>}
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
