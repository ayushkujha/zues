"""PDF agromet bulletin (English, Hindi, Kannada): per block, a panchayat forecast
table plus merged advisories.

Fonts: bundled Noto Sans (+ Devanagari, Kannada) with HarfBuzz text shaping, so
Indic scripts render with correct conjuncts and vowel signs.
"""

from __future__ import annotations

from collections import defaultdict
from pathlib import Path

import pandas as pd
from fpdf import FPDF

from ..advisory.crops import CropCalendar
from ..advisory.engine import Translations, localize_dates
from ..advisory.expr import ExprError, render
from ..advisory.rules import load_rules
from ..config import paths
from ..features.dataset import RegionContext
from ..storage.db import Repository

FONT_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"
FAMILY = {"en": "Noto", "hi": "NotoDeva", "kn": "NotoKnda"}
FONT_FILES = {
    "Noto": ("NotoSans-Regular.ttf", "NotoSans-Bold.ttf"),
    "NotoDeva": ("NotoSansDevanagari-Regular.ttf", "NotoSansDevanagari-Bold.ttf"),
    "NotoKnda": ("NotoSansKannada-Regular.ttf", "NotoSansKannada-Bold.ttf"),
}
SEV_RGB = {"red": (198, 40, 40), "orange": (239, 108, 0), "yellow": (190, 130, 0), "green": (46, 125, 50)}
ORDER = {"red": 0, "orange": 1, "yellow": 2, "green": 3}

TXT = {
    "en": {
        "title": "Panchayat-level Agromet Advisory Bulletin", "issued": "issued", "valid": "valid",
        "to": "to", "block": "Block", "panchayats": "panchayats", "panchayat": "Panchayat",
        "advisories": "Advisories", "gps": "GPs", "more": "more", "page": "page",
        "all_crops": "all crops", "and": "and",
        "demo": "DEMO: synthetic region and weather. Not for operational use.",
        "emulated": "Block forecast is emulated, not an official IMD forecast.",
        "nwp": "Block forecast is from a numerical weather model (Open-Meteo), not an official IMD forecast.",
        "unreviewed": "",
        "note": "Rain in mm/day; temperatures in °C (max/min). Panchayat values are downscaled from the block "
                "forecast and match it on average. Advisories are auto-drafted from rules and must be "
                "reviewed by the agromet scientist before dissemination.",
        "sev": {"red": "RED", "orange": "ORANGE", "yellow": "YELLOW", "green": "GREEN"},
    },
    "hi": {
        "title": "पंचायत-स्तरीय कृषि मौसम सलाह बुलेटिन", "issued": "जारी", "valid": "मान्य",
        "to": "से", "block": "ब्लॉक", "panchayats": "पंचायतें", "panchayat": "पंचायत",
        "advisories": "सलाह", "gps": "पंचायतें", "more": "और", "page": "पृष्ठ",
        "all_crops": "सभी फसलें", "and": "और",
        "demo": "डेमो: कृत्रिम क्षेत्र और मौसम। वास्तविक उपयोग के लिए नहीं।",
        "emulated": "ब्लॉक पूर्वानुमान अनुकरणित है, IMD का आधिकारिक पूर्वानुमान नहीं।",
        "nwp": "ब्लॉक पूर्वानुमान संख्यात्मक मौसम मॉडल (Open-Meteo) से है, IMD का आधिकारिक पूर्वानुमान नहीं।",
        "unreviewed": "अनुवाद की समीक्षा अभी बाकी है।",
        "note": "बारिश मिमी/दिन में; तापमान °C में (अधिकतम/न्यूनतम)। पंचायत मान ब्लॉक पूर्वानुमान से "
                "डाउनस्केल किए गए हैं। सलाह नियमों से स्वतः तैयार की गई है और भेजने से पहले कृषि मौसम "
                "वैज्ञानिक द्वारा जाँची जानी चाहिए।",
        "sev": {"red": "लाल", "orange": "नारंगी", "yellow": "पीला", "green": "हरा"},
    },
    "kn": {
        "title": "ಪಂಚಾಯತ್ ಮಟ್ಟದ ಕೃಷಿ ಹವಾಮಾನ ಸಲಹಾ ಬುಲೆಟಿನ್", "issued": "ಬಿಡುಗಡೆ", "valid": "ಮಾನ್ಯ",
        "to": "ರಿಂದ", "block": "ಬ್ಲಾಕ್", "panchayats": "ಪಂಚಾಯತ್‌ಗಳು", "panchayat": "ಪಂಚಾಯತ್",
        "advisories": "ಸಲಹೆಗಳು", "gps": "ಪಂಚಾಯತ್‌ಗಳು", "more": "ಇನ್ನಷ್ಟು", "page": "ಪುಟ",
        "all_crops": "ಎಲ್ಲಾ ಬೆಳೆಗಳು", "and": "ಮತ್ತು",
        "demo": "ಡೆಮೊ: ಕೃತಕ ಪ್ರದೇಶ ಮತ್ತು ಹವಾಮಾನ. ನೈಜ ಬಳಕೆಗೆ ಅಲ್ಲ.",
        "emulated": "ಬ್ಲಾಕ್ ಮುನ್ಸೂಚನೆ ಅನುಕರಿಸಲಾಗಿದೆ, IMD ಅಧಿಕೃತ ಮುನ್ಸೂಚನೆ ಅಲ್ಲ.",
        "nwp": "ಬ್ಲಾಕ್ ಮುನ್ಸೂಚನೆ ಸಂಖ್ಯಾತ್ಮಕ ಹವಾಮಾನ ಮಾದರಿಯಿಂದ (Open-Meteo) ಬಂದಿದೆ, IMD ಅಧಿಕೃತ ಮುನ್ಸೂಚನೆ ಅಲ್ಲ.",
        "unreviewed": "ಅನುವಾದ ಇನ್ನೂ ಪರಿಶೀಲಿಸಲಾಗಿಲ್ಲ.",
        "note": "ಮಳೆ ಮಿ.ಮೀ/ದಿನ; ತಾಪಮಾನ °C (ಗರಿಷ್ಠ/ಕನಿಷ್ಠ). ಪಂಚಾಯತ್ ಮೌಲ್ಯಗಳನ್ನು ಬ್ಲಾಕ್ ಮುನ್ಸೂಚನೆಯಿಂದ "
                "ಡೌನ್‌ಸ್ಕೇಲ್ ಮಾಡಲಾಗಿದೆ. ಸಲಹೆಗಳು ನಿಯಮಗಳಿಂದ ಸ್ವಯಂ ಸಿದ್ಧವಾಗಿವೆ; ಕಳುಹಿಸುವ ಮೊದಲು ಕೃಷಿ ಹವಾಮಾನ "
                "ವಿಜ್ಞಾನಿ ಪರಿಶೀಲಿಸಬೇಕು.",
        "sev": {"red": "ಕೆಂಪು", "orange": "ಕಿತ್ತಳೆ", "yellow": "ಹಳದಿ", "green": "ಹಸಿರು"},
    },
}


class _PDF(FPDF):
    def __init__(self, lang: str, footer_text: str):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.lang = lang
        self.footer_text = footer_text
        for fam, (reg, bold) in FONT_FILES.items():
            self.add_font(fam, "", str(FONT_DIR / reg))
            self.add_font(fam, "B", str(FONT_DIR / bold))
        self.fam = FAMILY[lang]
        # Glyphs missing from the main font (e.g. Latin in an Indic font) come from the others.
        self.set_fallback_fonts([f for f in FONT_FILES if f != self.fam], exact_match=False)
        self.set_text_shaping(True)
        self.set_auto_page_break(auto=True, margin=15)

    def font(self, style: str = "", size: float = 9) -> None:
        self.set_font(self.fam, style, size)

    def footer(self):
        self.set_y(-12)
        self.font("", 7)
        self.set_text_color(110, 110, 110)
        self.cell(0, 5, f"{self.footer_text}  |  {TXT[self.lang]['page']} {self.page_no()}", align="C")


def bulletin_pdf(ctx: RegionContext, repo: Repository, run_id: str,
                 block_lgd: int | None = None, lang: str = "en") -> bytes:
    lang = lang if lang in TXT else "en"
    T = TXT[lang]
    run = repo.get_run(run_id)
    if run is None:
        raise KeyError(run_id)
    gp = repo.gp_forecasts(run_id)
    adv = [a for a in repo.list_advisories(run_id, block_lgd=block_lgd) if a["status"] != "rejected"]
    names = ctx.panchayats.set_index("gp_lgd")
    blocks = ctx.blocks.set_index("block_lgd")
    dates = sorted(gp["valid_date"].unique())
    source = ctx.meta.get("data_source", ctx.meta.get("source"))
    cal = CropCalendar.load(paths().resolve(ctx.meta.get("crop_calendar") or "configs/crop_calendar/demo.yaml"))
    tr = Translations.load(lang) if lang != "en" else None
    crop_labels = {k: (tr.crops.get(k) if tr else None) or c.label for k, c in cal.crops.items()}
    all_crops = (tr.crops.get("all") if tr else None) or T["all_crops"]

    pdf = _PDF(lang, f"PanchayatCast | run {run_id[:8]} | model {run['model_id']} {run['model_version'] or ''}")
    pdf.add_page()
    pdf.font("B", 16)
    pdf.cell(0, 9, T["title"], new_x="LMARGIN", new_y="NEXT")
    pdf.font("", 10)
    pdf.cell(0, 6, f"{ctx.meta.get('name', ctx.region_id)}  |  {T['issued']} {run['issue_date']}  |  "
                   f"{T['valid']} {dates[0]} {T['to']} {dates[-1]}", new_x="LMARGIN", new_y="NEXT")
    notes = []
    if source == "synthetic":
        notes.append(T["demo"])
    if run["source"] in ("emulated", "nwp"):
        notes.append(T[run["source"]])
    if tr is not None and not tr.reviewed and T["unreviewed"]:
        notes.append(T["unreviewed"])
    if notes:
        pdf.set_text_color(198, 40, 40)
        pdf.font("B", 9)
        for n in notes:
            pdf.multi_cell(0, 5, n, new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
    pdf.ln(2)

    wide = gp.pivot_table(index=["gp_lgd", "valid_date"], columns="variable", values="value")
    adv_by_block = defaultdict(list)
    for a in adv:
        adv_by_block[a["block_lgd"]].append(a)
    rules = {r.id: r for r in load_rules(paths().configs / "advisory_rules.yaml")}

    block_ids = [block_lgd] if block_lgd is not None else list(ctx.weights.block_ids)
    for b in block_ids:
        b_gps = ctx.panchayats[ctx.panchayats["block_lgd"] == b].sort_values("gp_name")
        pdf.font("B", 12)
        pdf.set_fill_color(235, 242, 235)
        pdf.cell(0, 7, f"{T['block']}: {blocks.loc[b, 'block_name']}  ({len(b_gps)} {T['panchayats']})",
                 fill=True, new_x="LMARGIN", new_y="NEXT")
        _forecast_table(pdf, b_gps, wide, dates, T)
        _advisory_list(pdf, adv_by_block.get(b, []), names, rules, crop_labels, all_crops, lang, tr)
        pdf.ln(3)

    pdf.font("", 7)
    pdf.multi_cell(0, 4, T["note"])
    return bytes(pdf.output())


def _forecast_table(pdf: _PDF, gps: pd.DataFrame, wide: pd.DataFrame, dates, T: dict) -> None:
    # Numbers and (Latin) names use the Latin font: shaping digits with an Indic font as
    # the primary font garbles the leading digits of a cell.
    w_name, w_day = 46, 28
    pdf.font("B", 8)
    pdf.cell(w_name, 5.5, T["panchayat"], border=1)
    pdf.set_font("Noto", "B", 8)
    for d in dates:
        pdf.cell(w_day, 5.5, pd.Timestamp(d).strftime("%d/%m"), border=1, align="C")
    pdf.ln()
    pdf.set_font("Noto", "", 7.5)
    for r in gps.itertuples():
        pdf.cell(w_name, 5, r.gp_name, border=1)
        for d in dates:
            try:
                row = wide.loc[(r.gp_lgd, d)]
                txt = f"{row['rain_mm']:.0f} mm  {row['tmax_c']:.0f}/{row['tmin_c']:.0f}°"
            except KeyError:
                txt = "-"
            pdf.cell(w_day, 5, txt, border=1, align="C")
        pdf.ln()


class _Range:
    """Formats as 'lo-hi' (or a single value when equal) using the placeholder's format spec."""

    def __init__(self, values: list):
        nums = [v for v in values if isinstance(v, (int, float))]
        self.lo, self.hi = (min(nums), max(nums)) if nums else (None, None)
        self.texts = sorted({str(v) for v in values if v not in (None, "")})
        self.numeric = bool(nums)

    def __format__(self, spec: str) -> str:
        if self.numeric:
            a, b = format(self.lo, spec), format(self.hi, spec)
            return a if a == b else f"{a}-{b}"
        return "/".join(self.texts[:3]) + ("/..." if len(self.texts) > 3 else "")


def _merged_text(template: str, group: list[dict], crop_label: str, stage: str) -> str | None:
    """One sentence for many panchayats: the rule template filled with value ranges."""
    keys = set().union(*(a.get("params") or {} for a in group))
    params = {k: _Range([(a.get("params") or {}).get(k) for a in group]) for k in keys}
    params.update(crop=crop_label, stage=stage)
    try:
        return render(template, params)
    except (KeyError, ValueError, ExprError):
        return None


def _advisory_list(pdf: _PDF, items: list[dict], names: pd.DataFrame, rules: dict,
                   crop_labels: dict[str, str], all_crops: str, lang: str,
                   tr: Translations | None) -> None:
    if not items:
        return
    T = TXT[lang]
    pdf.ln(1)
    pdf.font("B", 9)
    pdf.cell(0, 5, T["advisories"], new_x="LMARGIN", new_y="NEXT")
    # Merge per (severity, rule, crop); advisories hand-edited by the scientist stay separate.
    groups: dict[tuple, list[dict]] = defaultdict(list)
    for a in items:
        key = (a["severity"], a["rule_id"], a["crop"], a["advisory_id"] if a.get("edited_by") else "")
        groups[key].append(a)
    # Same rule, same panchayats, same stage, different crops -> one line listing the crops.
    merged: dict[tuple, dict] = {}
    for (sev, rule_id, crop, edited), group in groups.items():
        gp_set = frozenset(a["gp_lgd"] for a in group)
        key = (sev, rule_id, edited, gp_set, group[0].get("crop_stage"))
        m = merged.setdefault(key, {"crops": [], "items": []})
        m["crops"].append(crop)
        m["items"].extend(group)

    for (sev, rule_id, edited, _, stage), m in sorted(
        merged.items(), key=lambda kv: (ORDER[kv[0][0]], kv[0][1], sorted(kv[1]["crops"]))
    ):
        crops = sorted(m["crops"])
        group = m["items"]
        if crops == ["all"]:
            label, prefix = all_crops, ""
        else:
            labels = [crop_labels.get(c, c.title()) for c in crops]
            label = labels[0] if len(labels) == 1 else f"{', '.join(labels[:-1])} {T['and']} {labels[-1]}"
            prefix = f"[{', '.join(labels)}] "
        first = group[0]
        local = (first.get("text_local") or {}).get(lang) if lang != "en" else None
        fallback = local["text"] if local else first["text_en"]
        rule = rules.get(rule_id)
        template = (tr.rules.get(rule_id) if tr else None) or (rule.text_en if rule and lang == "en" else None)
        stage_label = (tr.stages.get(stage or "", stage or "") if tr else stage or "")
        text = fallback if edited or template is None else (
            _merged_text(template, group, label, stage_label) or fallback)
        text = localize_dates(text, lang)
        gps = sorted({names.loc[a["gp_lgd"], "gp_name"] for a in group})
        short = ", ".join(g.replace("Demo GP ", "") for g in gps[:14])
        more = f" +{len(gps) - 14} {T['more']}" if len(gps) > 14 else ""
        pdf.font("B", 7.5)
        pdf.set_text_color(*SEV_RGB[sev])
        pdf.cell(18, 4.6, T["sev"][sev])
        pdf.set_text_color(0, 0, 0)
        pdf.font("", 7.5)
        pdf.multi_cell(0, 4.6, f"{prefix}{text}  ({len(gps)} {T['gps']}: {short}{more})",
                       new_x="LMARGIN", new_y="NEXT")
