import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { BrandMark, Icon, SeverityIcon, WeatherIcon, weatherKind } from "../components/Icon";
import { SEVERITY_ORDER, fmtRain, rainCategoryIndex } from "../lib/format";
import { CROP_NAMES, LANGS, RAIN_NAMES, SEVERITY_TEXT, t, type Lang } from "../lib/i18n";
import { load, save } from "../lib/storage";
import { go } from "../router";
import { useApp } from "../state";
import type { Advisory, GPForecast, GPSearchHit } from "../types";

const LANG_SHORT: Record<Lang, string> = { en: "EN", hi: "हिं", kn: "ಕ" };

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
  useEffect(() => { document.documentElement.lang = lang; return () => { document.documentElement.lang = "en"; }; }, [lang]);
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
    if (!synth || !day1 || !fc) return;
    if (speaking) { synth.cancel(); setSpeaking(false); return; }
    const rain = day1.rain_mm?.value ?? 0;
    const summary = `${fc.gp_name}. ${weekday(day1.valid_date, "long")}. ${RAIN_NAMES[lang][rainCategoryIndex(rain)]}, ${rain.toFixed(0)} mm. ${t("max", lang)} ${day1.tmax_c?.value?.toFixed(0)}°, ${t("min", lang)} ${day1.tmin_c?.value?.toFixed(0)}°.`;
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

  const kind = day1 ? weatherKind(day1.rain_mm?.value, day1.cloud_okta?.value) : "partly";

  return (
    <div className={`farmer-shell wx-${kind}`}>
      <div className="farmer">
        <div className="f-top">
          <a href="#/" className="iconbtn" aria-label="Back to dashboard" title="Dashboard"><Icon name="back" /></a>
          <span className="f-app"><BrandMark size={22} /> {t("title", lang)}</span>
          <div className="seg f-langs" role="group" aria-label="Language">
            {LANGS.map((l) => (
              <button key={l.id} className={l.id === lang ? "on" : ""} onClick={() => setLang(l.id)} lang={l.id} aria-label={l.label} aria-pressed={l.id === lang}>
                {LANG_SHORT[l.id]}
              </button>
            ))}
          </div>
        </div>

        {demo && (
          <div className="notice warn" style={{ marginBottom: 16, fontSize: 14 }}>
            <Icon name="info" />
            <span>{t("demo", lang)}</span>
          </div>
        )}

        {!gp || !regionId ? (
          regionId ? <Chooser regionId={regionId} lang={lang} onPick={(id) => { setGp(id); go(`/farmer/${id}`); }} /> : <div className="empty"><span className="spinner" /></div>
        ) : !runId ? (
          <div className="empty">{t("noForecast", lang)}</div>
        ) : !fc || !day1 ? (
          <div className="empty"><span className="spinner" /></div>
        ) : (
          <>
            <div className="f-place">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1>{fc.gp_name}</h1>
                <div className="blk"><Icon name="pin" size={14} /> {fc.block_name}</div>
              </div>
              <button className="btn sm" onClick={() => { setGp(null); go("/farmer"); }}>{t("change", lang)}</button>
            </div>

            <div className="f-hero">
              <WeatherIcon rain={day1.rain_mm?.value} cloud={day1.cloud_okta?.value} size={96} className="wxbig" />
              <div>
                <div className="when">{weekday(day1.valid_date, "long")}</div>
                <div className="temp num">{day1.tmax_c?.value?.toFixed(0)}°<span> / {day1.tmin_c?.value?.toFixed(0)}°</span></div>
                <div className="cond">{RAIN_NAMES[lang][rainCategoryIndex(day1.rain_mm?.value)]}</div>
              </div>
            </div>

            <div className="f-strip">
              <div><Icon name="drop" size={18} /><b className="num">{fmtRain(day1.rain_mm?.value ?? 0)} mm</b><span>{t("rain", lang)}</span></div>
              <div><Icon name="droplets" size={18} /><b className="num">{day1.rh_max_pct?.value?.toFixed(0)}%</b><span>{t("humidity", lang)}</span></div>
              <div><Icon name="wind" size={18} /><b className="num">{day1.wind_kmph?.value?.toFixed(0)} km/h</b><span>{t("wind", lang)}</span></div>
            </div>

            {"speechSynthesis" in window && (
              <button className={`btn lg block ${speaking ? "" : "primary"}`} onClick={speak} style={{ marginTop: 16 }}>
                <Icon name={speaking ? "stop" : "speaker"} size={18} />
                {speaking ? t("stop", lang) : t("listen", lang)}
              </button>
            )}

            <section className="f-sec">
              <h2><Icon name="sprout" size={20} /> {t("whatToDo", lang)}</h2>
              {crops.length > 0 && (
                <div className="f-crops" role="group" aria-label={t("forCrop", lang)}>
                  <button className={crop === "all" ? "on" : ""} onClick={() => setCrop("all")}>{t("allCrops", lang)}</button>
                  {crops.map((c) => (
                    <button key={c} className={crop === c ? "on" : ""} onClick={() => setCrop(c)}>{CROP_NAMES[lang][c] ?? c}</button>
                  ))}
                </div>
              )}
              <div className="f-todo">
                {todo.length === 0 && <div className="f-card green"><p>{t("noAdvice", lang)}</p></div>}
                {todo.map((a) => (
                  <div key={a.advisory_id} className={`f-card ${a.severity}`}>
                    <div className="head">
                      <span className={`sev sev-${a.severity}`} style={{ fontSize: 14 }}>
                        <SeverityIcon severity={a.severity} size={12} />
                        {SEVERITY_TEXT[lang][a.severity]}
                      </span>
                      {a.crop !== "all" && <span className="muted">· {CROP_NAMES[lang][a.crop] ?? a.crop}</span>}
                    </div>
                    <p lang={a.lang}>{a.text}</p>
                    {a.machine_translated && t("unreviewed", lang) && <div className="rv">{t("unreviewed", lang)}</div>}
                  </div>
                ))}
              </div>
            </section>

            <section className="f-sec">
              <h2>{t("nextDays", lang)}</h2>
              <div className="f-days">
                {fc.days.slice(1).map((d) => (
                  <div key={d.valid_date} className="f-day">
                    <span className="dn">{weekday(d.valid_date)}</span>
                    <WeatherIcon rain={d.rain_mm?.value} cloud={d.cloud_okta?.value} size={32} />
                    <span className="rv">{fmtRain(d.rain_mm?.value ?? 0)} mm</span>
                    <span className="tv">{d.tmax_c?.value?.toFixed(0)}° / {d.tmin_c?.value?.toFixed(0)}°</span>
                  </div>
                ))}
              </div>
            </section>

            <p className="f-foot">
              PanchayatCast · {new Date(`${fc.run.issue_date}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" })}
            </p>
          </>
        )}
      </div>
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
    <div className="f-choose">
      <h2>{t("choose", lang)}</h2>
      <button className="btn primary lg block" onClick={locate} disabled={locating}>
        {locating ? <span className="spinner" /> : <Icon name="locate" size={18} />}
        {locating ? t("locating", lang) : t("useLocation", lang)}
      </button>
      <div className="search">
        <Icon name="search" size={17} />
        <input className="input" placeholder={t("search", lang)} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("search", lang)} style={{ paddingLeft: 38 }} />
      </div>
      {err && <div className="notice error"><Icon name="alert" /><span>{err}</span></div>}
      {hits.length > 0 && (
        <div className="f-hits">
          {hits.map((h) => (
            <button key={h.gp_lgd} onClick={() => onPick(h.gp_lgd)}>
              <span>{h.gp_name}</span>
              <small>{h.block_name} <Icon name="chevronRight" size={14} className="inline" /></small>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
