"""Turn panchayat forecasts into crop-specific agromet advisories."""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import load_yaml, paths
from ..variables import OUTPUT_VARS
from .crops import CropCalendar
from .expr import Evaluator, ExprError, render
from .rules import SEVERITY_RANK, Rule, load_rules


@dataclass
class Translations:
    lang: str
    reviewed: bool
    rules: dict[str, str]
    crops: dict[str, str]
    stages: dict[str, str]

    @classmethod
    def load(cls, lang: str) -> Translations | None:
        p = paths().configs / "i18n" / f"advisories.{lang}.yaml"
        if not p.exists():
            return None
        raw = load_yaml(p)
        return cls(
            lang=lang,
            reviewed=bool(raw.get("reviewed", False)),
            rules=raw.get("rules", {}) or {},
            crops=raw.get("crops", {}) or {},
            stages=raw.get("stages", {}) or {},
        )


class AdvisoryEngine:
    def __init__(
        self,
        rules: list[Rule],
        calendar: CropCalendar,
        languages: list[str] | None = None,
    ):
        self.rules = rules
        self.calendar = calendar
        self.translations = {
            lang: t
            for lang in (languages or [])
            if lang != "en" and (t := Translations.load(lang)) is not None
        }

    @classmethod
    def for_region(cls, meta: dict) -> AdvisoryEngine:
        p = paths()
        rules = load_rules(p.configs / "advisory_rules.yaml")
        cal_path = meta.get("crop_calendar") or "configs/crop_calendar/demo.yaml"
        calendar = CropCalendar.load(p.resolve(cal_path))
        return cls(rules, calendar, meta.get("languages", ["en"]))

    def generate(self, gp_df: pd.DataFrame, gps: pd.DataFrame) -> list[dict]:
        """gp_df: long panchayat forecast (aggregate_to_gp output); gps: gp_lgd, block_lgd."""
        if gp_df.empty:
            return []
        wide = gp_df.pivot_table(
            index=["gp_lgd", "valid_date"], columns="variable", values="value"
        ).sort_index()
        dates = sorted(gp_df["valid_date"].unique())
        dates = [pd.Timestamp(d).date() for d in dates]
        crops = self.calendar.stage_window(dates[0], horizon=len(dates))
        block_of = dict(zip(gps["gp_lgd"], gps["block_lgd"]))

        out: list[dict] = []
        for gp_lgd, sub in wide.groupby(level=0):
            series = {v: sub[v].to_numpy() for v in OUTPUT_VARS if v in sub}
            ev = Evaluator(series, dates)
            for rule in self.rules:
                targets = (
                    [("all", None)]
                    if rule.crop_agnostic
                    else [
                        (c, s)
                        for c, s in crops.items()
                        if c in rule.crops and ("*" in rule.stages or s in rule.stages)
                    ]
                )
                for crop, stage in targets:
                    ev.context = {"crop": crop, "stage": stage}
                    try:
                        if not ev.truthy(rule.when):
                            continue
                        params = {k: ev.eval(e) for k, e in rule.params.items()}
                    except ExprError:
                        continue
                    out.append(self._advisory(rule, int(gp_lgd), block_of.get(gp_lgd), crop, stage,
                                              params, ev, dates))
        out.sort(key=lambda a: (a["gp_lgd"], -SEVERITY_RANK[a["severity"]], a["rule_id"]))
        return out

    def _advisory(self, rule, gp_lgd, block_lgd, crop, stage, params, ev, dates) -> dict:
        a = ev._name(rule.window[0])
        b = ev._name(rule.window[1])
        b = min(b, len(dates) - 1)
        spec = self.calendar.crops.get(crop)
        base = {
            **{k: _fmt(v) for k, v in params.items()},
            "crop": spec.label if spec else "all crops",
            "stage": stage or "",
        }
        text_en = render(rule.text_en, base)
        local = {}
        for lang, t in self.translations.items():
            tmpl = t.rules.get(rule.id)
            if not tmpl:
                continue
            p = dict(base)
            p["crop"] = t.crops.get(crop, base["crop"]) if crop != "all" else t.crops.get("all", base["crop"])
            p["stage"] = t.stages.get(stage or "", base["stage"])
            local[lang] = {"text": localize_dates(render(tmpl, p), lang), "reviewed": t.reviewed}
        return {
            "advisory_id": str(uuid.uuid4()),
            "gp_lgd": gp_lgd,
            "block_lgd": None if block_lgd is None else int(block_lgd),
            "crop": crop,
            "crop_stage": stage,
            "valid_from": dates[a],
            "valid_to": dates[b],
            "rule_id": rule.id,
            "category": rule.category,
            "severity": rule.severity,
            "text_en": text_en,
            "text_local": local,
            "params": {k: _fmt(v) for k, v in params.items()},
            "status": "draft",
        }


_EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
_LOCAL_MONTHS = {
    "hi": ["जनवरी", "फ़रवरी", "मार्च", "अप्रैल", "मई", "जून", "जुलाई", "अगस्त", "सितंबर", "अक्टूबर",
           "नवंबर", "दिसंबर"],
    "kn": ["ಜನವರಿ", "ಫೆಬ್ರವರಿ", "ಮಾರ್ಚ್", "ಏಪ್ರಿಲ್", "ಮೇ", "ಜೂನ್", "ಜುಲೈ", "ಆಗಸ್ಟ್", "ಸೆಪ್ಟೆಂಬರ್",
           "ಅಕ್ಟೋಬರ್", "ನವೆಂಬರ್", "ಡಿಸೆಂಬರ್"],
}
_DATE_RE = re.compile(r"\b(\d{1,2}) (" + "|".join(_EN_MONTHS) + r")\b")


def localize_dates(text: str, lang: str) -> str:
    """'30 Sep' -> '30 ಸೆಪ್ಟೆಂಬರ್' in rendered regional-language text."""
    months = _LOCAL_MONTHS.get(lang)
    if not months:
        return text
    return _DATE_RE.sub(lambda m: f"{m.group(1)} {months[_EN_MONTHS.index(m.group(2))]}", text)


def _fmt(v):
    """Round numbers for display; keep strings as-is."""
    if isinstance(v, (float, np.floating)):
        return round(float(v), 1)
    return v


def rules_path() -> Path:
    return paths().configs / "advisory_rules.yaml"
