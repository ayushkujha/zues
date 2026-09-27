"""SMS export: one short message per panchayat, for bulk-SMS gateways (e.g. mKisan).

Each message has the day-1 forecast plus the most severe advisory. English fits
GSM-7 (160 characters per segment); Hindi/Kannada need Unicode SMS (70 characters
per segment), so the segment count is reported for cost planning.
"""

from __future__ import annotations

import math

import pandas as pd

from ..features.dataset import RegionContext
from ..storage.db import Repository

LABELS = {
    "en": {"rain": "rain", "max": "max", "min": "min", "sign": "PanchayatCast"},
    "hi": {"rain": "बारिश", "max": "अधिकतम", "min": "न्यूनतम", "sign": "पंचायतकास्ट"},
    "kn": {"rain": "ಮಳೆ", "max": "ಗರಿಷ್ಠ", "min": "ಕನಿಷ್ಠ", "sign": "ಪಂಚಾಯತ್‌ಕಾಸ್ಟ್"},
}
SEV_RANK = {"red": 0, "orange": 1, "yellow": 2, "green": 3}


def _segments(text: str) -> int:
    unicode = any(ord(ch) > 127 for ch in text.replace("°", ""))
    single, multi = (70, 67) if unicode else (160, 153)
    n = len(text)
    return 1 if n <= single else math.ceil(n / multi)


def sms_messages(ctx: RegionContext, repo: Repository, run_id: str, lang: str = "en") -> pd.DataFrame:
    lab = LABELS.get(lang, LABELS["en"])
    gp = repo.gp_forecasts(run_id)
    first = gp[gp["lead_day"] == gp["lead_day"].min()]
    wide = first.pivot_table(index="gp_lgd", columns="variable", values="value")
    day = pd.Timestamp(first["valid_date"].iloc[0])
    adv = [a for a in repo.list_advisories(run_id) if a["status"] != "rejected"]
    best: dict[int, dict] = {}
    for a in adv:
        cur = best.get(a["gp_lgd"])
        if cur is None or SEV_RANK[a["severity"]] < SEV_RANK[cur["severity"]]:
            best[a["gp_lgd"]] = a

    rows = []
    for g in ctx.panchayats.itertuples():
        if g.gp_lgd not in wide.index:
            continue
        w = wide.loc[g.gp_lgd]
        head = (f"{g.gp_name} {day:%d/%m}: {lab['rain']} {w['rain_mm']:.0f}mm, "
                f"{lab['max']} {w['tmax_c']:.0f}°C {lab['min']} {w['tmin_c']:.0f}°C.")
        a = best.get(g.gp_lgd)
        advice = ""
        if a is not None:
            local = (a.get("text_local") or {}).get(lang)
            advice = local["text"] if lang != "en" and local else a["text_en"]
        text = f"{head} {advice} -{lab['sign']}".replace("  ", " ").strip()
        rows.append({
            "gp_lgd": g.gp_lgd, "gp_name": g.gp_name, "block_name": g.block_name, "lang": lang,
            "severity": a["severity"] if a else "", "approved": bool(a and a["status"] == "approved"),
            "message": text, "chars": len(text), "sms_segments": _segments(text),
        })
    return pd.DataFrame(rows)
