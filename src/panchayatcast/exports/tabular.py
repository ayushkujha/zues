"""CSV and GeoJSON exports of panchayat forecasts."""

from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..features.dataset import RegionContext
from ..storage.db import Repository
from ..variables import OUTPUT_VARS


def gp_forecast_wide(ctx: RegionContext, repo: Repository, run_id: str) -> pd.DataFrame:
    """One row per panchayat per day; value, p10, p90 and confidence per variable."""
    long = repo.gp_forecasts(run_id)
    if long.empty:
        return long
    idx = ["gp_lgd", "valid_date", "lead_day"]
    parts = [long.pivot_table(index=idx, columns="variable", values="value")[OUTPUT_VARS]]
    for stat in ("p10", "p90"):
        p = long.pivot_table(index=idx, columns="variable", values=stat)
        parts.append(p.add_suffix(f"_{stat}"))
    conf = long.pivot(index=idx, columns="variable", values="confidence")[OUTPUT_VARS]
    parts.append(conf.add_suffix("_conf"))
    wide = pd.concat(parts, axis=1).reset_index()
    names = ctx.panchayats[["gp_lgd", "gp_name", "block_lgd", "block_name"]]
    wide = names.merge(wide, on="gp_lgd", how="right")
    wide = wide.dropna(axis=1, how="all")
    return wide.sort_values(["valid_date", "block_name", "gp_name"]).reset_index(drop=True)


def gp_geojson(ctx: RegionContext, repo: Repository, run_id: str,
               simplify_deg: float = 0.0005) -> dict:
    """Panchayat polygons with every day's values as flat properties (d1_rain_mm, ...)."""
    wide = gp_forecast_wide(ctx, repo, run_id)
    gps = ctx.panchayats[["gp_lgd", "gp_name", "block_lgd", "block_name", "area_km2", "geometry"]].copy()
    if simplify_deg:
        gps["geometry"] = gps.geometry.simplify(simplify_deg, preserve_topology=True)
    for lead, day in wide.groupby("lead_day"):
        cols = [v for v in OUTPUT_VARS if v in day]
        d = day[["gp_lgd", *cols]].rename(columns={v: f"d{int(lead)}_{v}" for v in cols})
        gps = gps.merge(d, on="gp_lgd", how="left")
    fc = json.loads(gps.to_json(na="null"))
    fc["properties"] = {"run_id": run_id, "dates": sorted(str(d) for d in wide["valid_date"].unique())}
    return fc


def records(df: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe records (NaN -> None, dates -> ISO strings)."""
    out = df.copy()
    for c in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            out[c] = out[c].dt.strftime("%Y-%m-%d")
    out = out.astype(object).where(pd.notna(out), None)
    return [
        {k: (str(v) if hasattr(v, "isoformat") else (v.item() if isinstance(v, np.generic) else v))
         for k, v in r.items()}
        for r in out.to_dict(orient="records")
    ]
