"""Build a region from real data (boundaries, DEM, land cover, daily fields, stations).

Everything is regridded to the region's target grid so the rest of the pipeline is
identical for real and synthetic regions.

Note on resolution: the "fine" truth used for training is only as fine as the
source data (ERA5-Land ~9 km, CHIRPS ~5 km). Terrain and land-cover features are
~90 m -> 1 km, and station observations provide true point-scale validation.
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from rasterio.enums import Resampling
from rasterio.warp import reproject

from ..config import ModelConfig, RegionConfig, paths
from ..features.static import distance_to_water_km, terrain_features
from ..grid import Grid
from ..store import RegionStore
from ..variables import MODELLED_VARS
from . import download
from .common import write_region

# ESA WorldCover classes -> PanchayatCast land-cover groups
WORLDCOVER_GROUPS = {
    "lc_tree": [10, 95],
    "lc_crop": [20, 30, 40, 90],  # cropland + open vegetation (shrub, grass, wetland)
    "lc_built": [50],
    "lc_water": [80],
    "lc_bare": [60, 70, 100],
}


def _to_grid(src_path, grid: Grid, resampling: Resampling, band_fn=None) -> np.ndarray:
    dst = np.full(grid.shape, np.nan, dtype=np.float32)
    with rasterio.open(src_path) as src:
        data = src.read(1)
        if band_fn is not None:
            data = band_fn(data).astype(np.float32)
            src_nodata = None
        else:
            data = data.astype(np.float32)
            src_nodata = src.nodata
        reproject(data, dst, src_transform=src.transform, src_crs=src.crs, src_nodata=src_nodata,
                  dst_transform=grid.transform, dst_crs="EPSG:4326", dst_nodata=np.nan,
                  resampling=resampling)
    return dst


def load_panchayats(cfg: RegionConfig) -> gpd.GeoDataFrame:
    b = cfg.real["boundaries"]["panchayats"]
    gdf = gpd.read_file(paths().resolve(b["path"]))
    rename = {
        b.get("gp_lgd_col", "gp_lgd"): "gp_lgd",
        b.get("gp_name_col", "gp_name"): "gp_name",
        b.get("block_lgd_col", "block_lgd"): "block_lgd",
        b.get("block_name_col", "block_name"): "block_name",
    }
    missing = [c for c in rename if c not in gdf.columns]
    if missing:
        raise KeyError(f"Boundary file is missing columns {missing}; have {list(gdf.columns)}")
    if b.get("district_lgd") is not None and b.get("district_lgd_col"):
        gdf = gdf[gdf[b["district_lgd_col"]] == b["district_lgd"]]
    gdf = gdf.rename(columns=rename)[["gp_lgd", "gp_name", "block_lgd", "block_name", "geometry"]]
    gdf = gdf[gdf.geometry.notna() & ~gdf.geometry.is_empty].copy()
    gdf["geometry"] = gdf.geometry.make_valid()
    gdf["gp_lgd"] = gdf["gp_lgd"].astype(np.int64)
    gdf["block_lgd"] = gdf["block_lgd"].astype(np.int64)
    dup = gdf["gp_lgd"].duplicated()
    if dup.any():
        # Multi-part panchayats stored as several rows: merge them.
        gdf = gdf.dissolve(by="gp_lgd", aggfunc="first").reset_index()
    return gdf.to_crs("EPSG:4326")


def _regrid_daily(path, grid: Grid, var: str, start: str, end: str) -> xr.DataArray:
    with xr.open_dataset(path) as ds:
        ds = download._standardize(ds)
        da = ds[var] if var in ds else ds[list(ds.data_vars)[0]]
        da = da.sel(time=slice(start, end)).load()
    da = da.sortby("lat").sortby("lon")
    out = da.interp(lat=np.sort(grid.lat), lon=grid.lon, method="linear")
    # Fill edge cells the linear interpolation cannot reach.
    near = da.interp(lat=np.sort(grid.lat), lon=grid.lon, method="nearest")
    out = out.fillna(near)
    out = out.sortby("lat", ascending=False)  # north -> south, like the grid
    out["time"] = pd.DatetimeIndex(out["time"].values).normalize()
    return out


def build_real_region(cfg: RegionConfig, model_cfg: ModelConfig | None = None, log=print) -> RegionStore:
    model_cfg = model_cfg or ModelConfig.load()
    p = paths()
    r = cfg.real
    grid = Grid.from_bbox(cfg.bbox, cfg.grid_res_deg)

    log("[real] boundaries")
    gps = load_panchayats(cfg)
    minx, miny, maxx, maxy = gps.total_bounds
    w, s, e, n = grid.bbox
    if minx < w or miny < s or maxx > e or maxy > n:
        raise ValueError(f"Panchayats extend beyond bbox {grid.bbox}; enlarge the bbox in the config.")

    log("[real] static layers")
    st = r.get("static", {})
    dem_path = p.resolve(st.get("dem", "data/raw/static/dem.tif"))
    if not dem_path.exists():
        download.download_dem(grid.bbox, dem_path, log=log)
    wc_path = p.resolve(st.get("worldcover", "data/raw/static/worldcover.tif"))
    if not wc_path.exists():
        download.download_worldcover(grid.bbox, wc_path, log=log)

    dem = _to_grid(dem_path, grid, Resampling.average)
    static = terrain_features(dem, grid)
    for name, classes in WORLDCOVER_GROUPS.items():
        static[name] = _to_grid(wc_path, grid, Resampling.average,
                                band_fn=lambda a, c=classes: np.isin(a, c))
    total = sum(static[k] for k in WORLDCOVER_GROUPS)
    for k in WORLDCOVER_GROUPS:
        static[k] = np.nan_to_num(np.where(total > 0, static[k] / total, 0.0))
    static["dist_water_km"] = distance_to_water_km(static["lc_water"], grid)

    store = write_region(cfg, grid, gps, static, model_cfg, extra_meta={"data_source": "real"})

    log("[real] daily fields")
    start, end = r.get("period", [cfg.splits["train"][0], cfg.splits["test"][1]])
    fields = {}
    for var in MODELLED_VARS:
        path = r.get("fine", {}).get(var)
        if not path or not p.resolve(path).exists():
            raise FileNotFoundError(f"Missing fine data for {var}: {path}")
        fields[var] = _regrid_daily(p.resolve(path), grid, var, start, end)
        log(f"  {var}: {fields[var].sizes['time']} days")
    common = sorted(set.intersection(*(set(pd.DatetimeIndex(f["time"].values)) for f in fields.values())))
    dates = pd.DatetimeIndex(common)
    if len(dates) == 0:
        raise ValueError("The fine datasets have no dates in common.")
    for var, da in fields.items():
        store.save_fine(var, dates, da.sel(time=dates).values)

    stn = r.get("stations", {})
    meta_p, obs_p = stn.get("meta"), stn.get("observations")
    if meta_p and obs_p and p.resolve(meta_p).exists() and p.resolve(obs_p).exists():
        log("[real] stations")
        stations = pd.read_csv(p.resolve(meta_p))
        obs = pd.read_csv(p.resolve(obs_p), parse_dates=["date"])
        store.save_stations(stations, obs)
    else:
        log("[real] no station files found; validation will use panchayat means only")
    log(f"[real] done -> {store.dir}")
    return store
