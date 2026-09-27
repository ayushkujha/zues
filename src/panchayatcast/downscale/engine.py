"""Downscaling engine: block fields -> post-processed cell fields -> outputs."""

from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr

from ..config import ModelConfig
from ..features.dataset import RegionContext
from ..models.base import Prediction, VarPrediction
from ..models.registry import ModelBundle
from ..variables import OUTPUT_META, OUTPUT_VARS, uv_to_wind
from .postprocess import postprocess


def downscale(
    ctx: RegionContext,
    bundle: ModelBundle,
    blk: dict[str, np.ndarray],
    dates: pd.DatetimeIndex,
    model_id: str,
    cfg: ModelConfig,
    consistency: bool | None = None,
) -> Prediction:
    raw = bundle.get(model_id).predict(ctx, blk, dates)
    return postprocess(ctx, raw, blk, cfg, consistency)


def output_fields(pred: Prediction) -> dict[str, VarPrediction]:
    """Modelled variables -> user-facing variables (wind u/v -> speed/direction)."""
    out = {v: pred[v] for v in OUTPUT_VARS if v in pred}
    speed, direction = uv_to_wind(pred["wind_u"].value, pred["wind_v"].value)
    out["wind_kmph"] = VarPrediction(speed)
    out["wind_dir_deg"] = VarPrediction(direction)
    return {v: out[v] for v in OUTPUT_VARS}


def to_dataset(
    ctx: RegionContext,
    pred: Prediction,
    dates: pd.DatetimeIndex,
    lead_days: np.ndarray,
    attrs: dict | None = None,
) -> xr.Dataset:
    """Gridded output: (valid_date, lat, lon) per variable, plus p10/p90 where available."""
    g, cells = ctx.grid, ctx.weights.active_cells
    data_vars = {}
    for var, vp in output_fields(pred).items():
        for suffix, arr in (("", vp.value), ("_p10", vp.p10), ("_p90", vp.p90)):
            if arr is None:
                continue
            cube = np.stack([g.to_2d(arr[i], cells) for i in range(len(dates))])
            data_vars[var + suffix] = (
                ("valid_date", "lat", "lon"),
                cube,
                {"units": OUTPUT_META[var]["unit"], "long_name": OUTPUT_META[var]["label"] + suffix},
            )
    ds = xr.Dataset(
        data_vars,
        coords={"valid_date": dates, "lead_day": ("valid_date", lead_days), "lat": g.lat, "lon": g.lon},
        attrs={k: str(v) for k, v in (attrs or {}).items()},
    )
    return ds
