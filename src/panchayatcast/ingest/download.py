"""Downloaders for open datasets.

DEM (Copernicus GLO-30) and ESA WorldCover are Cloud-Optimized GeoTIFFs on public
S3 buckets: only the window covering the region is read, at reduced resolution.
ERA5-Land needs a free Copernicus CDS account and `pip install cdsapi` with a
~/.cdsapirc key. CHIRPS daily files are read one day at a time over HTTPS.
"""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from rasterio.enums import Resampling
from rasterio.merge import merge
from rasterio.windows import from_bounds

COP_DEM_URL = (
    "https://copernicus-dem-30m.s3.amazonaws.com/"
    "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM/"
    "Copernicus_DSM_COG_10_{ns}{lat:02d}_00_{ew}{lon:03d}_00_DEM.tif"
)
WORLDCOVER_URL = (
    "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
    "ESA_WorldCover_10m_2021_v200_{ns}{lat:02d}{ew}{lon:03d}_Map.tif"
)
# Daily Cloud-Optimized GeoTIFFs: a windowed read fetches only the region (a few KB).
CHIRPS_COG_URL = (
    "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/cogs/p05/"
    "{y}/chirps-v2.0.{y}.{m:02d}.{d:02d}.cog"
)
CHIRPS_URL = (
    "https://data.chc.ucsb.edu/products/CHIRPS-2.0/global_daily/tifs/p05/"
    "{y}/chirps-v2.0.{y}.{m:02d}.{d:02d}.tif.gz"
)

GDAL_ENV = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.gz",
                GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2")


def _tiles(bbox, step: int) -> list[tuple[int, int]]:
    w, s, e, n = bbox
    lats = range(math.floor(s / step) * step, math.ceil(n / step) * step, step)
    lons = range(math.floor(w / step) * step, math.ceil(e / step) * step, step)
    return [(la, lo) for la in lats for lo in lons]


def _fmt(url: str, lat: int, lon: int) -> str:
    return url.format(ns="N" if lat >= 0 else "S", lat=abs(lat), ew="E" if lon >= 0 else "W", lon=abs(lon))


def _mosaic(urls: list[str], bbox, res: float, out: Path, resampling: Resampling, dtype: str,
            nodata, log=print) -> Path:
    out.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.Env(**GDAL_ENV):
        srcs = []
        for u in urls:
            try:
                srcs.append(rasterio.open("/vsicurl/" + u))
            except rasterio.errors.RasterioIOError:
                log(f"  (no tile at {u}, skipping)")
        if not srcs:
            raise RuntimeError("No tiles could be opened; check the bbox and network access.")
        arr, transform = merge(srcs, bounds=bbox, res=res, resampling=resampling, nodata=nodata)
        profile = dict(driver="GTiff", height=arr.shape[1], width=arr.shape[2], count=1,
                       dtype=dtype, crs="EPSG:4326", transform=transform, nodata=nodata,
                       compress="deflate")
        for s in srcs:
            s.close()
    with rasterio.open(out, "w", **profile) as dst:
        dst.write(arr[0].astype(dtype), 1)
    return out


def download_dem(bbox, out: Path, res_deg: float = 1 / 1200, log=print) -> Path:
    """Copernicus GLO-30 DEM mosaic for bbox, resampled to ~90 m (default)."""
    urls = [_fmt(COP_DEM_URL, la, lo) for la, lo in _tiles(bbox, 1)]
    log(f"[dem] reading {len(urls)} Copernicus DEM tile(s)")
    return _mosaic(urls, bbox, res_deg, out, Resampling.bilinear, "float32", -9999.0, log)


def download_worldcover(bbox, out: Path, res_deg: float = 1 / 1200, log=print) -> Path:
    """ESA WorldCover 2021 class map for bbox at ~90 m (nearest-neighbour sampling)."""
    urls = [_fmt(WORLDCOVER_URL, la, lo) for la, lo in _tiles(bbox, 3)]
    log(f"[worldcover] reading {len(urls)} tile(s)")
    return _mosaic(urls, bbox, res_deg, out, Resampling.nearest, "uint8", 0, log)


def download_chirps(bbox, start: str, end: str, out: Path, log=print) -> Path:
    """CHIRPS v2 daily rainfall (0.05°) for bbox and date range -> NetCDF variable rain_mm."""
    from concurrent.futures import ThreadPoolExecutor

    w, s, e, n = bbox
    days = pd.date_range(start, end, freq="D")
    env = {**GDAL_ENV, "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.gz,.cog"}

    def read_day(d):
        with rasterio.Env(**env):  # GDAL config is per thread
            for url in ("/vsicurl/" + CHIRPS_COG_URL.format(y=d.year, m=d.month, d=d.day),
                        "/vsigzip//vsicurl/" + CHIRPS_URL.format(y=d.year, m=d.month, d=d.day)):
                try:
                    with rasterio.open(url) as src:
                        win = from_bounds(w, s, e, n, src.transform).round_offsets().round_lengths()
                        a = src.read(1, window=win).astype(np.float32)
                        a[a < 0] = np.nan
                        return a, src.window_transform(win)
                except rasterio.errors.RasterioIOError:
                    continue
        return None, None

    arrays, lat, lon = [], None, None
    with ThreadPoolExecutor(max_workers=8) as pool:
        for i, (a, t) in enumerate(pool.map(read_day, days)):
            arrays.append(a)
            if a is not None and lat is None:
                lon = t.c + t.a * (np.arange(a.shape[1]) + 0.5)
                lat = t.f + t.e * (np.arange(a.shape[0]) + 0.5)
            if i % 200 == 0:
                log(f"[chirps] {days[i].date()} ({i + 1}/{len(days)})")
    missing = sum(a is None for a in arrays)
    if missing:
        log(f"[chirps] {missing} day(s) could not be read (left as missing)")
    if lat is None:
        raise RuntimeError("No CHIRPS files could be read.")
    shape = (len(lat), len(lon))
    cube = np.stack([a if a is not None and a.shape == shape else np.full(shape, np.nan, np.float32)
                     for a in arrays])
    da = xr.DataArray(cube, dims=("time", "lat", "lon"),
                      coords={"time": days, "lat": lat, "lon": lon}, name="rain_mm")
    out.parent.mkdir(parents=True, exist_ok=True)
    da.to_netcdf(out, encoding={"rain_mm": {"zlib": True, "complevel": 4}})
    return out


# ---------------------------------------------------------------------------
# ERA5-Land (hourly) -> daily PanchayatCast variables
# ---------------------------------------------------------------------------

ERA5_LAND_VARS = [
    "2m_temperature",
    "2m_dewpoint_temperature",
    "10m_u_component_of_wind",
    "10m_v_component_of_wind",
]


def download_era5land(bbox, start_year: int, end_year: int, out_dir: Path, log=print) -> list[Path]:
    """Monthly hourly ERA5-Land files. Requires `pip install cdsapi` and a CDS API key."""
    try:
        import cdsapi
    except ImportError as e:
        raise RuntimeError("Install cdsapi (`pip install cdsapi`) and set up ~/.cdsapirc") from e
    w, s, e, n = bbox
    client = cdsapi.Client()
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for y in range(start_year, end_year + 1):
        for m in range(1, 13):
            target = out_dir / f"era5land_{y}{m:02d}.nc"
            files.append(target)
            if target.exists():
                continue
            log(f"[era5land] requesting {y}-{m:02d}")
            client.retrieve("reanalysis-era5-land", {
                "variable": ERA5_LAND_VARS,
                "year": str(y), "month": f"{m:02d}",
                "day": [f"{d:02d}" for d in range(1, 32)],
                "time": [f"{h:02d}:00" for h in range(24)],
                "area": [n + 0.1, w - 0.1, s - 0.1, e + 0.1],
                "data_format": "netcdf", "download_format": "unarchived",
            }, str(target))
    return files


def download_era5_cloud(bbox, start_year: int, end_year: int, out_dir: Path, log=print) -> list[Path]:
    """Hourly ERA5 total cloud cover (0.25°); ERA5-Land has no cloud variable."""
    import cdsapi

    w, s, e, n = bbox
    client = cdsapi.Client()
    out_dir.mkdir(parents=True, exist_ok=True)
    files = []
    for y in range(start_year, end_year + 1):
        target = out_dir / f"era5_tcc_{y}.nc"
        files.append(target)
        if target.exists():
            continue
        log(f"[era5] cloud {y}")
        client.retrieve("reanalysis-era5-single-levels", {
            "product_type": ["reanalysis"], "variable": ["total_cloud_cover"],
            "year": str(y), "month": [f"{m:02d}" for m in range(1, 13)],
            "day": [f"{d:02d}" for d in range(1, 32)],
            "time": [f"{h:02d}:00" for h in range(0, 24, 3)],
            "area": [n + 0.25, w - 0.25, s - 0.25, e + 0.25],
            "data_format": "netcdf", "download_format": "unarchived",
        }, str(target))
    return files


def _standardize(ds: xr.Dataset) -> xr.Dataset:
    ren = {k: v for k, v in {"valid_time": "time", "latitude": "lat", "longitude": "lon"}.items()
           if k in ds.dims or k in ds.coords}
    ds = ds.rename(ren)
    for extra in ("number", "expver"):
        if extra in ds.coords and extra not in ds.dims:
            ds = ds.drop_vars(extra)
    return ds.sortby("time")


def _ist_daily(da: xr.DataArray, how: str) -> xr.DataArray:
    """Aggregate hourly UTC data to IST calendar days (IST = UTC + 5:30)."""
    shifted = da.assign_coords(time=da["time"] + np.timedelta64(330, "m"))
    r = shifted.resample(time="1D")
    return getattr(r, how)()


def process_era5land(files: list[Path], out_dir: Path, log=print) -> dict[str, Path]:
    ds = xr.concat([_standardize(xr.open_dataset(f)) for f in sorted(files)], dim="time")
    t = ds["t2m"] - 273.15
    td = ds["d2m"] - 273.15
    rh = 100 * np.exp(17.625 * td / (243.04 + td)) / np.exp(17.625 * t / (243.04 + t))
    rh = rh.clip(0, 100)
    out = {
        "tmax_c": _ist_daily(t, "max"),
        "tmin_c": _ist_daily(t, "min"),
        "rh_max_pct": _ist_daily(rh, "max"),
        "rh_min_pct": _ist_daily(rh, "min"),
        "wind_u": _ist_daily(ds["u10"] * 3.6, "mean"),
        "wind_v": _ist_daily(ds["v10"] * 3.6, "mean"),
    }
    paths = {}
    out_dir.mkdir(parents=True, exist_ok=True)
    for name, da in out.items():
        p = out_dir / f"{name}.nc"
        da.rename(name).astype("float32").to_netcdf(p)
        paths[name] = p
        log(f"[era5land] wrote {p}")
    return paths


def process_era5_cloud(files: list[Path], out: Path) -> Path:
    ds = xr.concat([_standardize(xr.open_dataset(f)) for f in sorted(files)], dim="time")
    okta = _ist_daily(ds["tcc"] * 8.0, "mean").rename("cloud_okta").astype("float32")
    out.parent.mkdir(parents=True, exist_ok=True)
    okta.to_netcdf(out)
    return out
