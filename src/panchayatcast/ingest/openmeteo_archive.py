"""Historical daily weather from the Open-Meteo archive API (no account needed).

Used to build real "fine" training fields when a Copernicus CDS account is not
available:
  ERA5-Land (0.1°):  Tmax, Tmin, RH max, RH min
  ERA5 (0.25°):      wind (mean speed + dominant direction -> u/v), cloud cover
Rainfall comes from CHIRPS (0.05°) instead (see download.download_chirps).

Data: Copernicus ERA5 / ERA5-Land via Open-Meteo (CC BY 4.0). Free-tier fair use is
600 calls/min, 5,000/hour, 10,000/day; a request counts roughly one call per
location per 14 days. Requests are paced below those limits and every response
is cached, so an interrupted download resumes where it stopped.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
import xarray as xr
from shapely.geometry import Point

from ..variables import wind_to_uv

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

SOURCES = {
    "era5_land": {
        "res": 0.1,
        "daily": ["temperature_2m_max", "temperature_2m_min", "relative_humidity_2m_max",
                  "relative_humidity_2m_min"],
    },
    "era5": {
        "res": 0.25,
        "daily": ["wind_speed_10m_mean", "wind_direction_10m_dominant", "cloud_cover_mean"],
    },
}


def model_grid_points(boundary: gpd.GeoSeries | None, bbox, res: float, buffer_deg: float) -> pd.DataFrame:
    """Model grid points (multiples of `res`) inside the buffered boundary (or the bbox)."""
    w, s, e, n = bbox
    lons = np.arange(math.floor((w - buffer_deg) / res), math.ceil((e + buffer_deg) / res) + 1) * res
    lats = np.arange(math.floor((s - buffer_deg) / res), math.ceil((n + buffer_deg) / res) + 1) * res
    pts = pd.DataFrame([(round(la, 4), round(lo, 4)) for la in lats for lo in lons], columns=["lat", "lon"])
    if boundary is not None:
        area = boundary.to_crs("EPSG:4326").union_all().buffer(buffer_deg)
        pts = pts[[area.contains(Point(lo, la)) for la, lo in zip(pts.lat, pts.lon, strict=True)]]
    return pts.reset_index(drop=True)


class _Pacer:
    """Keeps estimated usage below per-minute and per-hour budgets."""

    def __init__(self, per_minute: int = 500, per_hour: int = 4500):
        self.per_minute, self.per_hour = per_minute, per_hour
        self.events: list[tuple[float, float]] = []

    def wait(self, units: float, log) -> None:
        while True:
            now = time.time()
            self.events = [(t, u) for t, u in self.events if now - t < 3600]
            minute = sum(u for t, u in self.events if now - t < 60)
            hour = sum(u for _, u in self.events)
            if minute + units <= self.per_minute and hour + units <= self.per_hour:
                self.events.append((now, units))
                return
            pause = 20 if hour + units > self.per_hour else 5
            if hour + units > self.per_hour:
                log(f"[open-meteo] hourly budget reached ({hour:.0f} calls); pausing")
            time.sleep(pause)


def fetch_archive(points: pd.DataFrame, start: str, end: str, model: str, cache_dir: Path,
                  batch: int = 10, pacer: _Pacer | None = None, log=print) -> dict[tuple, pd.DataFrame]:
    """Daily series per (lat, lon) point for one Open-Meteo model; cached per request."""
    daily = SOURCES[model]["daily"]
    pacer = pacer or _Pacer()
    cache_dir.mkdir(parents=True, exist_ok=True)
    years = pd.date_range(start, end, freq="YS").union([pd.Timestamp(start)])
    chunks = []
    for y0 in years:
        c0 = max(pd.Timestamp(start), y0)
        c1 = min(pd.Timestamp(end), pd.Timestamp(year=c0.year, month=12, day=31))
        if c0 <= c1:
            chunks.append((c0, c1))
    chunks = sorted(set(chunks))
    out: dict[tuple, list[pd.DataFrame]] = {}
    total = len(chunks) * math.ceil(len(points) / batch)
    done = 0
    for c0, c1 in chunks:
        n_days = (c1 - c0).days + 1
        for i in range(0, len(points), batch):
            p = points.iloc[i:i + batch]
            params = {
                "latitude": ",".join(f"{x:.4f}" for x in p.lat),
                "longitude": ",".join(f"{x:.4f}" for x in p.lon),
                "start_date": str(c0.date()), "end_date": str(c1.date()),
                "daily": ",".join(daily), "models": model, "timezone": "Asia/Kolkata",
                "wind_speed_unit": "kmh",
            }
            key = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()[:16]
            f = cache_dir / f"{model}_{c0.date()}_{key}.json"
            if f.exists():
                data = json.loads(f.read_text())
            else:
                units = len(p) * math.ceil(n_days / 14)
                for attempt in range(8):
                    pacer.wait(units, log)
                    try:
                        r = requests.get(ARCHIVE_URL, params=params, timeout=120)
                    except (requests.ConnectionError, requests.Timeout) as e:
                        log(f"[open-meteo] network error ({type(e).__name__}); retrying in {30 * (attempt + 1)} s")
                        time.sleep(30 * (attempt + 1))
                        continue
                    if r.status_code == 429:
                        log("[open-meteo] rate limited (429); waiting 60 s")
                        time.sleep(60 * (attempt + 1))
                        continue
                    r.raise_for_status()
                    break
                else:
                    raise RuntimeError("Open-Meteo kept rate-limiting; re-run later to resume")
                data = r.json()
                f.write_text(json.dumps(data))
            locs = data if isinstance(data, list) else [data]
            for (la, lo), loc in zip(zip(p.lat, p.lon, strict=True), locs, strict=True):
                df = pd.DataFrame(loc["daily"]).rename(columns={"time": "date"})
                df["date"] = pd.to_datetime(df["date"])
                out.setdefault((la, lo), []).append(df.set_index("date"))
            done += 1
            if done % 10 == 0 or done == total:
                log(f"[open-meteo] {model}: {done}/{total} requests")
    return {k: pd.concat(v).sort_index() for k, v in out.items()}


def to_grid_dataset(series: dict[tuple, pd.DataFrame], res: float) -> xr.Dataset:
    """Point series on a regular model grid -> Dataset(time, lat, lon); missing points are NaN."""
    lats = sorted({k[0] for k in series})
    lons = sorted({k[1] for k in series})
    lat_all = np.round(np.arange(lats[0], lats[-1] + res / 2, res), 4)
    lon_all = np.round(np.arange(lons[0], lons[-1] + res / 2, res), 4)
    times = sorted(set().union(*(df.index for df in series.values())))
    cols = next(iter(series.values())).columns
    data = {c: np.full((len(times), len(lat_all), len(lon_all)), np.nan, np.float32) for c in cols}
    t_index = pd.DatetimeIndex(times)
    for (la, lo), df in series.items():
        i, j = int(np.argmin(np.abs(lat_all - la))), int(np.argmin(np.abs(lon_all - lo)))
        df = df.reindex(t_index)
        for c in cols:
            data[c][:, i, j] = pd.to_numeric(df[c], errors="coerce").to_numpy(np.float32)
    return xr.Dataset({c: (("time", "lat", "lon"), a) for c, a in data.items()},
                      coords={"time": t_index, "lat": lat_all, "lon": lon_all})


def build_fine_fields(boundary: gpd.GeoSeries, bbox, start: str, end: str, out_dir: Path,
                      cache_dir: Path, log=print) -> dict[str, Path]:
    """Download + convert ERA5-Land / ERA5 daily fields into PanchayatCast NetCDF files."""
    pacer = _Pacer()
    out_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, Path] = {}

    # Buffers keep every district cell inside the interpolation stencil while staying
    # well under the free-tier daily quota.
    pts = model_grid_points(boundary, bbox, SOURCES["era5_land"]["res"], 0.05)
    log(f"[open-meteo] ERA5-Land: {len(pts)} grid points, {start}..{end}")
    ds = to_grid_dataset(fetch_archive(pts, start, end, "era5_land", cache_dir, pacer=pacer, log=log), 0.1)
    for src, name in (("temperature_2m_max", "tmax_c"), ("temperature_2m_min", "tmin_c"),
                      ("relative_humidity_2m_max", "rh_max_pct"), ("relative_humidity_2m_min", "rh_min_pct")):
        p = out_dir / f"{name}.nc"
        ds[src].rename(name).to_netcdf(p)
        paths[name] = p

    pts = model_grid_points(boundary, bbox, SOURCES["era5"]["res"], 0.1)
    log(f"[open-meteo] ERA5: {len(pts)} grid points")
    ds = to_grid_dataset(fetch_archive(pts, start, end, "era5", cache_dir, pacer=pacer, log=log), 0.25)
    u, v = wind_to_uv(ds["wind_speed_10m_mean"], ds["wind_direction_10m_dominant"])
    for arr, name in ((u, "wind_u"), (v, "wind_v"), (ds["cloud_cover_mean"] / 100.0 * 8.0, "cloud_okta")):
        p = out_dir / f"{name}.nc"
        arr.rename(name).astype("float32").to_netcdf(p)
        paths[name] = p
    return paths
