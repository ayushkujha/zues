import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloads } from "../api";
import { SeverityBadge } from "../components/Badges";
import { SEVERITY_ORDER, cropLabel, dayLabel } from "../lib/format";
import { useApp } from "../state";
import type { Advisory, Severity } from "../types";

export default function AdvisoriesPage() {
  const { run, runId, gpNames, blockNames, refreshRuns } = useApp();
  const [items, setItems] = useState<Advisory[]>([]);
  const [loading, setLoading] = useState(false);
  const [block, setBlock] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [crop, setCrop] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [lang, setLang] = useState("en");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!runId) return;
    setLoading(true);
    api
      .advisories(runId, { block_lgd: block ? Number(block) : undefined, severity, status, lang })
      .then(setItems)
      .finally(() => setLoading(false));
  }, [runId, block, severity, status, lang]);

  useEffect(reload, [reload]);

  const crops = useMemo(() => [...new Set(items.map((a) => a.crop))].sort(), [items]);
  const shown = useMemo(
    () =>
      items
        .filter((a) => !crop || a.crop === crop)
        .filter((a) => !search || (gpNames.get(a.gp_lgd) ?? "").toLowerCase().includes(search.toLowerCase()) || a.text.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          (gpNames.get(a.gp_lgd) ?? "").localeCompare(gpNames.get(b.gp_lgd) ?? ""),
        ),
    [items, crop, search, gpNames],
  );

  const update = async (a: Advisory, body: Partial<Pick<Advisory, "text_en" | "status">>) => {
    const updated = await api.updateAdvisory(a.advisory_id, { ...body, edited_by: body.text_en ? "scientist" : a.edited_by ?? undefined });
    setItems((xs) => xs.map((x) => (x.advisory_id === a.advisory_id ? { ...updated, text: lang === "en" ? updated.text_en : x.text } : x)));
  };

  const bulk = async (s: "approved" | "rejected") => {
    const targets = shown.filter((a) => a.status !== s);
    if (!targets.length) return;
    if (!window.confirm(`Mark ${targets.length} shown advisories as ${s}?`)) return;
    setBusy(true);
    try {
      for (const a of targets) await api.updateAdvisory(a.advisory_id, { status: s });
      setMsg(`${targets.length} advisories marked ${s}.`);
      reload();
      refreshRuns();
    } catch (e) {
      setMsg(`Failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!run || !runId) return <div className="empty">No completed forecast run yet.</div>;

  const counts = SEVERITY_ORDER.map((s) => [s, items.filter((a) => a.severity === s).length] as const);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Advisories</h1>
          <p>Auto-drafted from panchayat forecasts and the crop calendar. Review, edit and approve before sending.</p>
        </div>
        <div className="spacer" />
        <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
          <option value="en">English</option><option value="hi">हिंदी</option><option value="kn">ಕನ್ನಡ</option>
        </select>
        <a className="btn primary" href={downloads.pdf(runId, lang, block ? Number(block) : undefined)} target="_blank" rel="noreferrer">PDF bulletin</a>
        <a className="btn" href={downloads.sms(runId, lang)}>SMS list (CSV)</a>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        {counts.map(([s, n]) => (
          <button key={s} className="card stat" style={{ textAlign: "left", cursor: "pointer", outline: severity === s ? "2px solid var(--accent)" : "none" }}
            onClick={() => setSeverity(severity === s ? "" : s)}>
            <div className="label"><SeverityBadge severity={s as Severity} /></div>
            <div className="value num">{n}</div>
            <div className="sub">{severity === s ? "filtering, click to clear" : "click to filter"}</div>
          </button>
        ))}
      </div>

      <div className="card card-pad" style={{ marginBottom: 16 }}>
        <div className="row wrap">
          <label className="field"><span>Block</span>
            <select className="select" value={block} onChange={(e) => setBlock(e.target.value)}>
              <option value="">All blocks</option>
              {[...blockNames.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
          <label className="field"><span>Crop</span>
            <select className="select" value={crop} onChange={(e) => setCrop(e.target.value)}>
              <option value="">All</option>
              {crops.map((c) => <option key={c} value={c}>{c === "all" ? "Crop-agnostic" : cropLabel(c)}</option>)}
            </select>
          </label>
          <label className="field"><span>Status</span>
            <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="draft">Draft</option><option value="approved">Approved</option><option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 180 }}><span>Search</span>
            <input className="input" placeholder="Panchayat or text" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <div className="field"><span>&nbsp;</span>
            <div className="row">
              <button className="btn" disabled={busy || !shown.length} onClick={() => bulk("approved")}>✓ Approve shown ({shown.length})</button>
            </div>
          </div>
        </div>
        {msg && <div className="okbox" style={{ marginTop: 10 }}>{msg}</div>}
      </div>

      <div className="card">
        <div className="table-wrap" style={{ maxHeight: "65vh" }}>
          <table className="tbl">
            <thead>
              <tr><th>Severity</th><th>Panchayat</th><th>Crop</th><th style={{ width: "46%" }}>Advisory</th><th>Valid</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7}><span className="spinner" /></td></tr>}
              {!loading && shown.map((a) => (
                <tr key={a.advisory_id}>
                  <td><SeverityBadge severity={a.severity} label={a.severity} /></td>
                  <td>
                    <a href={`#/farmer/${a.gp_lgd}`}>{gpNames.get(a.gp_lgd) ?? a.gp_lgd}</a>
                    <div className="small faint">{blockNames.get(a.block_lgd)}</div>
                  </td>
                  <td className="small">{cropLabel(a.crop)}{a.crop_stage && <div className="faint">{a.crop_stage}</div>}</td>
                  <td>
                    {editing === a.advisory_id ? (
                      <div className="stack" style={{ gap: 6 }}>
                        <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Advisory text" />
                        <div className="row">
                          <button className="btn sm primary" onClick={async () => { await update(a, { text_en: draft }); setEditing(null); }}>Save</button>
                          <button className="btn sm" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {a.text}
                        <div className="small faint" style={{ marginTop: 2 }}>
                          {a.rule_id}{a.edited_by ? ` · edited by ${a.edited_by}` : ""}{a.machine_translated ? " · unreviewed translation" : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="small num">{dayLabel(a.valid_from).split(",")[0]}{a.valid_to !== a.valid_from ? ` – ${dayLabel(a.valid_to).split(",")[0]}` : ""}</td>
                  <td><span className={`badge status-${a.status}`}>{a.status}</span></td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {a.status !== "approved" && <button className="btn sm" title="Approve" onClick={() => update(a, { status: "approved" })}>✓</button>}
                      {a.status !== "rejected" && <button className="btn sm danger" title="Reject" onClick={() => update(a, { status: "rejected" })}>✕</button>}
                      {lang === "en" && editing !== a.advisory_id && (
                        <button className="btn sm" title="Edit text" onClick={() => { setEditing(a.advisory_id); setDraft(a.text_en); }}>✎</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!loading && !shown.length && <tr><td colSpan={7} className="muted">No advisories match these filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
