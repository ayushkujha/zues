"""Aggregate cell predictions to Gram Panchayats (area-weighted)."""

from __future__ import annotations

import numpy as np
import pandas as pd

from ..features.dataset import RegionContext
from ..models.base import Prediction
from ..variables import MODELLED, OUTPUT_VARS, confidence_label, uv_to_wind


def aggregate_to_gp(
    ctx: RegionContext,
    pred: Prediction,
    dates: pd.DatetimeIndex,
    lead_days: np.ndarray,
    model_id: str,
) -> pd.DataFrame:
    """Long table: gp_lgd, valid_date, lead_day, variable, value, p10, p90, confidence, model_id."""
    gp = {}
    for var, vp in pred.items():
        gp[var] = {
            "value": ctx.gp_means(vp.value),
            "p10": None if vp.p10 is None else ctx.gp_means(vp.p10),
            "p90": None if vp.p90 is None else ctx.gp_means(vp.p90),
        }

    D, G = len(dates), ctx.weights.n_gp
    base = {
        "gp_lgd": np.tile(ctx.weights.gp_ids, D),
        "valid_date": np.repeat(dates.date, G),
        "lead_day": np.repeat(lead_days, G),
    }
    frames = []
    for var in OUTPUT_VARS:
        if var in ("wind_kmph", "wind_dir_deg"):
            speed, direction = uv_to_wind(gp["wind_u"]["value"], gp["wind_v"]["value"])
            width = np.nanmax(
                [_width(gp["wind_u"]), _width(gp["wind_v"])], axis=0
            )
            value = speed if var == "wind_kmph" else direction
            p10 = p90 = np.full_like(value, np.nan)
            conf = confidence_label(width, MODELLED["wind_u"].conf)
        else:
            g = gp[var]
            value = g["value"]
            p10 = g["p10"] if g["p10"] is not None else np.full_like(value, np.nan)
            p90 = g["p90"] if g["p90"] is not None else np.full_like(value, np.nan)
            conf = confidence_label(p90 - p10, MODELLED[var].conf)
        frames.append(
            pd.DataFrame(
                {
                    **base,
                    "variable": var,
                    "value": value.ravel(),
                    "p10": p10.ravel(),
                    "p90": p90.ravel(),
                    "confidence": conf.ravel(),
                }
            )
        )
    out = pd.concat(frames, ignore_index=True)
    out["model_id"] = model_id
    for c in ("value", "p10", "p90"):
        out[c] = out[c].astype(float).round(2)
    return out


def _width(g: dict) -> np.ndarray:
    if g["p10"] is None or g["p90"] is None:
        return np.full_like(g["value"], np.nan)
    return g["p90"] - g["p10"]
