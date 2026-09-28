import { useCallback, useEffect, useMemo, useState } from "react";
import { api, downloads } from "../api";
import { SeverityBadge } from "../components/Badges";
import { Icon, SeverityIcon } from "../components/Icon";
import { SEVERITY_LABEL, SEVERITY_ORDER, cropLabel, dayLabel } from "../lib/format";
import { useApp } from "../state";
import type { Advisory, Severity } from "../types";

const LANGS = [
  { id: "en", label: "English" },
  { id: "hi", label: "हिंदी" },
  { id: "kn", label: "ಕನ್ನಡ" },
];

export default function AdvisoriesPage() {
  const { run, runId, gpNames, blockNames, refreshRuns } = useApp();
  const [items, setItems] = useState<Advisory[]>([]);
  const [loading, setLoading] = useState(false);
  const [block, setBlock] = useState<string>("");
  const [severity, setSeverity] = useState<Severity | "">("");
  const [crop, setCrop] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [lang, setLang] = useState("en");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Severity is filtered client-side so the tab counts always reflect the other filters.
  const reload = useCallback(() => {
    if (!runId) return;
    setLoading(true);
    api
      .advisories(runId, { block_lgd: block ? Number(block) : undefined, status, lang })
      .then(setItems)
      .catch((e) => setMsg({ ok: false, text: e.message }))
      .finally(() => setLoading(false));
  }, [runId, block, status, lang]);

  useEffect(reload, [reload]);

  const crops = useMemo(() => [...new Set(items.map((a) => a.crop))].sort(), [items]);
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return items
      .filter((a) => !crop || a.crop === crop)
      .filter((a) => !s || (gpNames.get(a.gp_lgd) ?? "").toLowerCase().includes(s) || a.text.toLowerCase().includes(s));
  }, [items, crop, search, gpNames]);
  const shown = useMemo(
    () =>
      filtered
        .filter((a) => !severity || a.severity === severity)
        .sort((a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
          (gpNames.get(a.gp_lgd) ?? "").localeCompare(gpNames.get(b.gp_lgd) ?? ""),
        ),
    [filtered, severity, gpNames],
  );
  const counts = useMemo(
    () => Object.fromEntries(SEVERITY_ORDER.map((s) => [s, filtered.filter((a) => a.severity === s).length])) as Record<Severity, number>,
    [filtered],
  );
  const total = filtered.length || 1;

  const update = async (a: Advisory, body: Partial<Pick<Advisory, "text_en" | "status">>) => {
    try {
      const updated = await api.updateAdvisory(a.advisory_id, { ...body, edited_by: body.text_en ? "scientist" : a.edited_by ?? undefined });
      setItems((xs) => xs.map((x) => (x.advisory_id === a.advisory_id ? { ...updated, text: lang === "en" ? updated.text_en : x.text } : x)));
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };

  const bulk = async (s: "approved" | "rejected") => {
    const targets = shown.filter((a) => a.status !== s);
    if (!targets.length) return;
    if (!window.confirm(`Mark ${targets.length} advisories as ${s}?`)) return;
    setBusy(true);
    try {
      for (const a of targets) await api.updateAdvisory(a.advisory_id, { status: s });
      setMsg({ ok: true, text: `${targets.length} advisories marked ${s}.` });
      reload();
      refreshRuns();
    } catch (e) {
      setMsg({ ok: false, text: `Failed: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  };

  if (!run || !runId) return <div className="empty"><h2>No forecast yet</h2><a className="btn primary" href="#/runs">Go to runs</a></div>;

  const pending = shown.filter((a) => a.status !== "approved").length;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Advisories</h1>
          <p>Drafted automatically from each panchayat's forecast and crop calendar. Review, edit and approve them before they go out.</p>
        </div>
        <div className="spacer" />
        <div className="row wrap">
          <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
            {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
          <a className="btn" href={downloads.sms(runId, lang)}><Icon name="download" size={15} /> SMS list</a>
          <a className="btn primary" href={downloads.pdf(runId, lang, block ? Number(block) : undefined)} target="_blank" rel="noreferrer">
            <Icon name="file" size={15} /> PDF bulletin
          </a>
        </div>
      </div>

      <div className="sevtabs" role="tablist" aria-label="Severity">
        {SEVERITY_ORDER.map((s) => (
          <button key={s} role="tab" aria-selected={severity === s} className={`sevtab sev-${s} ${severity === s ? "on" : ""}`}
            onClick={() => setSeverity(severity === s ? "" : s)}>
            <span className="n">{counts[s]}</span>
            <span className="l row" style={{ gap: 6 }}><SeverityIcon severity={s} size={11} /> {SEVERITY_LABEL[s]}</span>
          </button>
        ))}
      </div>
      <div className="distbar" aria-hidden="true">
        {SEVERITY_ORDER.map((s) => counts[s] > 0 && <i key={s} style={{ width: `${(counts[s] / total) * 100}%`, background: `var(--sev-${s})` }} />)}
      </div>

      <div className="card">
        <div className="filters">
          <div className="search">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Search panchayat or advisory text" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search" />
          </div>
          <select className="select" value={block} onChange={(e) => setBlock(e.target.value)} aria-label="Block">
            <option value="">All blocks</option>
            {[...blockNames.entries()].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </select>
          <select className="select" value={crop} onChange={(e) => setCrop(e.target.value)} aria-label="Crop">
            <option value="">All crops</option>
            {crops.map((c) => <option key={c} value={c}>{c === "all" ? "Any crop" : cropLabel(c)}</option>)}
          </select>
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
            <option value="">Any status</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <div className="spacer" />
          <span className="small muted num">{shown.length} shown</span>
          <button className="btn" disabled={busy || !pending} onClick={() => bulk("approved")}>
            {busy ? <span className="spinner" /> : <Icon name="check" size={15} />} Approve {pending || ""}
          </button>
        </div>
        {msg && (
          <div className={`notice ${msg.ok ? "ok" : "error"}`} style={{ margin: 12 }}>
            <Icon name={msg.ok ? "check" : "alert"} />
            <span style={{ flex: 1 }}>{msg.text}</span>
            <button className="iconbtn sm" onClick={() => setMsg(null)} aria-label="Dismiss"><Icon name="x" size={14} /></button>
          </div>
        )}
        <div className="table-wrap" style={{ maxHeight: "calc(100vh - 330px)", minHeight: 320 }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 130 }}>Severity</th>
                <th>Panchayat</th>
                <th>Crop</th>
                <th>Advisory</th>
                <th>Valid</th>
                <th>Status</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && !items.length && <tr><td colSpan={7}><span className="spinner" /></td></tr>}
              {shown.slice(0, 400).map((a) => (
                <tr key={a.advisory_id} className="advrow">
                  <td><SeverityBadge severity={a.severity} /></td>
                  <td>
                    <a className="gp" href={`#/farmer/${a.gp_lgd}`} title="Open the farmer view">{gpNames.get(a.gp_lgd) ?? a.gp_lgd}</a>
                    <div className="small faint">{blockNames.get(a.block_lgd)}</div>
                  </td>
                  <td className="small">
                    {cropLabel(a.crop)}
                    {a.crop_stage && <div className="faint">{a.crop_stage}</div>}
                  </td>
                  <td>
                    {editing === a.advisory_id ? (
                      <div className="stack" style={{ gap: 8 }}>
                        <textarea className="textarea" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="Advisory text" autoFocus />
                        <div className="row">
                          <button className="btn sm primary" onClick={async () => { await update(a, { text_en: draft }); setEditing(null); }}>Save</button>
                          <button className="btn sm ghost" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="txt" lang={a.lang}>{a.text}</div>
                        <div className="rule">
                          {a.rule_id}{a.edited_by ? ` · edited by ${a.edited_by}` : ""}{a.machine_translated ? " · translation not reviewed" : ""}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="small num" style={{ whiteSpace: "nowrap" }}>
                    {dayLabel(a.valid_from).split(",")[1]}
                    {a.valid_to !== a.valid_from ? ` –${dayLabel(a.valid_to).split(",")[1]}` : ""}
                  </td>
                  <td><span className={`status ${a.status}`}>{a.status}</span></td>
                  <td>
                    <div className="actions">
                      {a.status !== "approved" && (
                        <button className="iconbtn sm ok" title="Approve" aria-label="Approve" onClick={() => update(a, { status: "approved" })}><Icon name="check" size={15} /></button>
                      )}
                      {a.status !== "rejected" && (
                        <button className="iconbtn sm no" title="Reject" aria-label="Reject" onClick={() => update(a, { status: "rejected" })}><Icon name="x" size={15} /></button>
                      )}
                      {lang === "en" && editing !== a.advisory_id && (
                        <button className="iconbtn sm" title="Edit text" aria-label="Edit text" onClick={() => { setEditing(a.advisory_id); setDraft(a.text_en); }}><Icon name="pencil" size={14} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {shown.length > 400 && (
                <tr><td colSpan={7} className="muted small">Showing the first 400 of {shown.length}. Narrow the filters to see the rest.</td></tr>
              )}
              {!loading && !shown.length && <tr><td colSpan={7}><div className="empty" style={{ padding: 32 }}>No advisories match these filters.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
