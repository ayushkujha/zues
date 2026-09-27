"""Live block forecasts from numerical weather prediction via Open-Meteo.

Open-Meteo (https://open-meteo.com) serves GFS / ECMWF / ICON forecasts free for
non-commercial use, with no API key. We request hourly forecasts at each block's
centroid and aggregate them to IST calendar days, giving a block forecast table in
the same format as an official IMD block forecast (source="nwp").

This is a stand-in for the official IMD feed: point forecasts at block centroids,
not IMD's block products. Rain is summed over the IST calendar day, not IMD's
08:30-08:30 rain day.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import requests

from ..features.dataset import RegionContext
from ..geometry import EQUAL_AREA_CRS
from ..variables import INPUT_RANGES, INPUT_VARS, uv_to_wind, wind_to_uv

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY = [
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "wind_speed_10m",
    "wind_direction_10m",
    "cloud_cover",
]


def block_centroids(ctx: RegionContext) -> pd.DataFrame:
    """Area centroid of each block (lon/lat), in the region's block order."""
    cent = ctx.blocks.to_crs(EQUAL_AREA_CRS).geometry.centroid.to_crs("EPSG:4326")
    return pd.DataFrame({"block_lgd": ctx.blocks["block_lgd"].astype(int), "lon": cent.x, "lat": cent.y})


def fetch_open_meteo(lats, lons, forecast_days: int = 7, model: str | None = None,
                     timeout: int = 30) -> list[dict]:
    params = {
        "latitude": ",".join(f"{x:.4f}" for x in lats),
        "longitude": ",".join(f"{x:.4f}" for x in lons),
        "hourly": ",".join(HOURLY),
        "timezone": "Asia/Kolkata",
        "forecast_days": forecast_days,
        "wind_speed_unit": "kmh",
    }
    if model:
        params["models"] = model
    r = requests.get(OPEN_METEO_URL, params=params, timeout=timeout)
    r.raise_for_status()
    data = r.json()
    return data if isinstance(data, list) else [data]


def daily_from_hourly(hourly: dict) -> pd.DataFrame:
    h = pd.DataFrame(hourly)
    h["time"] = pd.to_datetime(h["time"])
    h["date"] = h["time"].dt.normalize()
    u, v = wind_to_uv(h["wind_speed_10m"].to_numpy(), h["wind_direction_10m"].to_numpy())
    h["u"], h["v"] = u, v
    g = h.groupby("date")
    daily = pd.DataFrame({
        "rain_mm": g["precipitation"].sum(min_count=1),
        "tmax_c": g["temperature_2m"].max(),
        "tmin_c": g["temperature_2m"].min(),
        "rh_max_pct": g["relative_humidity_2m"].max(),
        "rh_min_pct": g["relative_humidity_2m"].min(),
        "u": g["u"].mean(),
        "v": g["v"].mean(),
        "cloud_okta": g["cloud_cover"].mean() / 100.0 * 8.0,
        "hours": g["temperature_2m"].count(),
    })
    daily = daily[daily["hours"] >= 20]  # drop incomplete days
    speed, direction = uv_to_wind(daily["u"].to_numpy(), daily["v"].to_numpy())
    daily["wind_kmph"], daily["wind_dir_deg"] = speed, direction
    return daily.drop(columns=["u", "v", "hours"])


def nwp_block_forecast(ctx: RegionContext, issue_date: str | pd.Timestamp | None = None,
                       lead_days: int = 5, model: str | None = None) -> pd.DataFrame:
    """Block forecast table (official input format) from a live NWP forecast."""
    issue = pd.Timestamp(issue_date or pd.Timestamp.now(tz="Asia/Kolkata").date()).normalize()
    cent = block_centroids(ctx)
    locations = fetch_open_meteo(cent["lat"], cent["lon"], forecast_days=lead_days + 2, model=model)
    if len(locations) != len(cent):
        raise RuntimeError(f"Open-Meteo returned {len(locations)} locations for {len(cent)} blocks")
    valid = pd.date_range(issue + pd.Timedelta(days=1), periods=lead_days, freq="D")
    rows = []
    for (_, c), loc in zip(cent.iterrows(), locations, strict=True):
        daily = daily_from_hourly(loc["hourly"]).reindex(valid)
        if daily.isna().any().any():
            raise RuntimeError(f"Forecast for block {c.block_lgd} does not cover {valid[0].date()}..{valid[-1].date()}")
        for day, r in daily.iterrows():
            row = {"block_lgd": int(c.block_lgd), "issue_date": issue.date(), "valid_date": day.date()}
            for var in INPUT_VARS:
                lo, hi = INPUT_RANGES[var]
                row[var] = float(np.clip(r[var], lo, min(hi, 359.9) if var == "wind_dir_deg" else hi))
            rows.append(row)
    df = pd.DataFrame(rows)
    df["tmin_c"] = np.minimum(df["tmin_c"], df["tmax_c"] - 0.5)
    df["rh_min_pct"] = np.minimum(df["rh_min_pct"], df["rh_max_pct"])
    return df.round(1)
