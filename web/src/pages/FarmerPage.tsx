import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { SEVERITY_ICON } from "../lib/colors";
import { SEVERITY_ORDER, fmtRain, rainCategoryIndex, weatherIcon } from "../lib/format";
import { CROP_NAMES, LANGS, RAIN_NAMES, SEVERITY_TEXT, t, type Lang } from "../lib/i18n";
import { load, save } from "../lib/storage";
import { go } from "../router";
import { useApp } from "../state";
import type { Advisory, GPForecast, GPSearchHit } from "../types";

export default function FarmerPage({ gp: routeGp }: { gp?: number }) {
  const { region, regionId, run, runId } = useApp();
  const [lang, setLangState] = useState<Lang>(() => load<Lang | null>("farmer.lang", null) ?? "kn");
  const [gp, setGp] = useState<number | null>(() => routeGp ?? load<number | null>(`farmer.gp.${regionId}`, null));
  const [fc, setFc] = useState<GPForecast | null>(null);
  const [adv, setAdv] = useState<Advisory[]>([]);
  const [crop, setCrop] = useState<string>(() => load("farmer.crop", "all"));
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => { if (routeGp) setGp(routeGp); }, [routeGp]);
  useEffect(() => { if (regionId && gp) save(`farmer.gp.${regionId}`, gp); }, [regionId, gp]);
  useEffect(() => save("farmer.crop", crop), [crop]);
  const setLang = (l: Lang) => { setLangState(l); save("farmer.lang", l); };
  const locale = LANGS.find((l) => l.id === lang)!.locale;

  useEffect(() => {
    if (!runId || !gp) return;
    setFc(null);
    api.forecast(runId, gp).then(setFc).catch(() => setFc(null));
  }, [runId, gp]);
  useEffect(() => {
    if (!runId || !gp) return;
    api.gpAdvisories(runId, gp, lang).then(setAdv).catch(() => setAdv([]));
  }, [runId, gp, lang]);
  useEffect(() => () => window.speechSynthesis?.cancel(), []);

  const crops = useMemo(() => [...new Set(adv.map((a) => a.crop).filter((c) => c !== "all"))].sort(), [adv]);
  const todo = useMemo(
    () =>
      adv
        .filter((a) => crop === "all" || a.crop === "all" || a.crop === crop)
        .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
    [adv, crop],
  );
  const demo = region?.data_source === "synthetic" || run?.source === "emulated";

  const day1 = fc?.days[0];
  const weekday = (iso: string, style: "short" | "long" = "short") =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale, style === "short" ? { weekday: "short" } : { weekday: "long", day: "numeric", month: "long" });

  const speak = () => {
    const synth = window.speechSynthesis;
    if (!synth || !day1) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const rain = day1.rain_mm?.value ?? 0;
    const summary = `${fc!.gp_name}. ${weekday(day1.valid_date, "long")}. ${RAIN_NAMES[lang][rainCategoryIndex(rain)]}, ${rain.toFixed(0)} mm. ${t("max", lang)} ${day1.tmax_c?.value?.toFixed(0)}°, ${t("min", lang)} ${day1.tmin_c?.value?.toFixed(0)}°.`;
    const text = [summary, t("whatToDo", lang), ...(todo.length ? todo.map((a) => a.text) : [t("noAdvice", lang)])].join(" ");
    const u = new SpeechSynthesisUtterance(text);
    u.lang = LANGS.find((l) => l.id === lang)!.speech;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(u.lang.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    synth.cancel();
    synth.speak(u);
    setSpeaking(true);
  };

  return (
    <div className="farmer">
      <div className="row" style={{ marginBottom: 14 }}>
        <a href="#/" className="btn ghost sm" aria-label="Back to dashboard">←</a>
        <h1>{t("title", lang)}</h1>
      </div>
      <div className="langs" style={{ marginBottom: 14 }} role="group" aria-label="Language">
        {LANGS.map((l) => (
          <button key={l.id} className={l.id === lang ? "on" : ""} onClick={() => setLang(l.id)} lang={l.id}>{l.label}</button>
        ))}
      </div>
      {demo && <div className="errorbox small" style={{ marginBottom: 12 }}>⚠️ {t("demo", lang)}</div>}

      {!gp || !regionId ? (
        regionId ? <Chooser regionId={regionId} lang={lang} onPick={(id) => { setGp(id); go(`/farmer/${id}`); }} /> : <div className="empty"><span className="spinner" /></div>
      ) : !runId ? (
        <div className="empty">{t("noForecast", lang)}</div>
      ) : !fc || !day1 ? (
        <div className="empty"><span className="spinner" /></div>
      ) : (
        <div className="stack" style={{ gap: 14 }}>
          <div className="row">
            <div>
              <div style={{ fontWeight: 700, fontSize: 19 }}>📍 {fc.gp_name}</div>
              <div className="muted small">{fc.block_name}</div>
            </div>
            <div className="spacer" />
            <button className="btn sm" onClick={() => { setGp(null); go("/farmer"); }}>{t("change", lang)}</button>
          </div>

          <div className="card today">
            <div className="big" aria-hidden>{weatherIcon(day1.rain_mm?.value, day1.cloud_okta?.value)}</div>
            <div className="muted">{t("forecast", lang)} · {weekday(day1.valid_date, "long")}</div>
            <div className="cat">{RAIN_NAMES[lang][rainCategoryIndex(day1.rain_mm?.value)]} · {fmtRain(day1.rain_mm?.value ?? 0)} mm</div>
            <div className="temps">
              {t("max", lang)} {day1.tmax_c?.value?.toFixed(0)}° · {t("min", lang)} {day1.tmin_c?.value?.toFixed(0)}° · {t("humidity", lang)} {day1.rh_max_pct?.value?.toFixed(0)}% · {t("wind", lang)} {day1.wind_kmph?.value?.toFixed(0)} km/h
            </div>
          </div>

          <div className="card todo">
            <h2>
              <span>🌾 {t("whatToDo", lang)}</span>
              <span className="spacer" />
              {"speechSynthesis" in window && (
                <button className="btn sm" onClick={speak} aria-label={t("listen", lang)}>{speaking ? `⏹ ${t("stop", lang)}` : `🔊 ${t("listen", lang)}`}</button>
              )}
            </h2>
            {crops.length > 0 && (
              <div className="langs" style={{ flexWrap: "wrap", marginBottom: 10 }}>
                <button className={crop === "all" ? "on" : ""} onClick={() => setCrop("all")}>{t("allCrops", lang)}</button>
                {crops.map((c) => (
                  <button key={c} className={crop === c ? "on" : ""} onClick={() => setCrop(c)}>{CROP_NAMES[lang][c] ?? c}</button>
                ))}
              </div>
            )}
            {todo.length === 0 && <div className="item sev-green">{t("noAdvice", lang)}</div>}
            {todo.map((a) => (
              <div key={a.advisory_id} className={`item sev-${a.severity}`}>
                <div className="sev" style={{ color: `var(--sev-${a.severity})` }}>
                  <span aria-hidden>{SEVERITY_ICON[a.severity]}</span>
                  {SEVERITY_TEXT[lang][a.severity]}
                  {a.crop !== "all" && <span className="muted" style={{ fontWeight: 500 }}>· {CROP_NAMES[lang][a.crop] ?? a.crop}</span>}
                </div>
                <div lang={a.lang}>{a.text}</div>
                {a.machine_translated && t("unreviewed", lang) && <div className="small faint" style={{ marginTop: 4 }}>{t("unreviewed", lang)}</div>}
              </div>
            ))}
          </div>

          <div>
            <h2 style={{ fontSize: 17, marginBottom: 8 }}>{t("nextDays", lang)}</h2>
            <div className="days">
              {fc.days.slice(1).map((d) => (
                <div key={d.valid_date}>
                  <div className="dn">{weekday(d.valid_date)}</div>
                  <div className="ic" aria-hidden>{weatherIcon(d.rain_mm?.value, d.cloud_okta?.value)}</div>
                  <div className="rv">{fmtRain(d.rain_mm?.value ?? 0)} mm</div>
                  <div className="small muted num">{d.tmax_c?.value?.toFixed(0)}°/{d.tmin_c?.value?.toFixed(0)}°</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Chooser({ regionId, lang, onPick }: { regionId: string; lang: Lang; onPick: (gp: number) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<GPSearchHit[]>([]);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(timer.current);
    if (!q.trim()) { setHits([]); return; }
    timer.current = window.setTimeout(() => {
      api.search(regionId, q.trim()).then(setHits).catch(() => setHits([]));
    }, 200);
  }, [q, regionId]);

  const locate = () => {
    if (!navigator.geolocation) { setErr(t("locationFailed", lang)); return; }
    setLocating(true);
    setErr(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const hit = await api.locate(regionId, pos.coords.latitude, pos.coords.longitude);
          onPick(hit.gp_lgd);
        } catch {
          setErr(t("locationFailed", lang));
        } finally {
          setLocating(false);
        }
      },
      () => { setLocating(false); setErr(t("locationFailed", lang)); },
      { timeout: 10000 },
    );
  };

  return (
    <div className="card card-pad stack">
      <h2 style={{ fontSize: 18 }}>{t("choose", lang)}</h2>
      <button className="btn primary bigbtn" onClick={locate} disabled={locating}>
        {locating ? t("locating", lang) : `📍 ${t("useLocation", lang)}`}
      </button>
      <input className="input" placeholder={t("search", lang)} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search", lang)} />
      {err && <div className="errorbox small">{err}</div>}
      <div className="hits">
        {hits.map((h) => (
          <button key={h.gp_lgd} onClick={() => onPick(h.gp_lgd)}>
            {h.gp_name}
            <small>{h.block_name}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
