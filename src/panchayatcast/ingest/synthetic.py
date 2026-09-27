"""Synthetic demo region: terrain, boundaries, 1 km daily weather and stations.

The generated weather has the same kinds of local structure that real weather has
inside a block: temperature falling with height, cold air pooling in valleys on
clear nights, cooler/more humid air near water, urban warmth, and more rain on
windward slopes during the monsoon. Large-scale day-to-day variability is random.

Because the local structure is known, the synthetic world is useful for testing
that the pipeline learns it. It says NOTHING about real-world skill. Everything
written here is tagged source="synthetic".
"""

from __future__ import annotations

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy import ndimage
from scipy.stats import norm
from shapely.geometry import MultiPoint, Point, Polygon
from shapely.ops import voronoi_diagram

from ..config import ModelConfig, RegionConfig
from ..features.static import distance_to_water_km, terrain_features
from ..geometry import nearest_active_cell
from ..grid import Grid
from ..store import RegionStore
from ..variables import uv_to_wind
from .common import write_region


def generate(cfg: RegionConfig, model_cfg: ModelConfig | None = None, log=print) -> RegionStore:
    model_cfg = model_cfg or ModelConfig.load()
    s = cfg.synthetic
    rng = np.random.default_rng(int(s.get("seed", 42)))
    grid = Grid.from_bbox(cfg.bbox, cfg.grid_res_deg)
    X, Y = _unit_coords(grid)

    log(f"[synth] grid {grid.ny}x{grid.nx} at {grid.res} deg")
    dem = _make_dem(X, Y, rng)
    terrain = terrain_features(dem, grid)
    water = _make_water(X, Y, dem, rng)
    lc = _make_landcover(X, Y, terrain, water, rng)
    static = {**terrain, **lc, "dist_water_km": distance_to_water_km(water, grid)}

    log("[synth] boundaries")
    gps = _make_boundaries(grid, int(s.get("n_blocks", 7)), int(s.get("n_gps", 140)), rng)

    log("[synth] weights + static layers")
    store = write_region(cfg, grid, gps, static, model_cfg, extra_meta={"data_source": "synthetic"})
    w = store.weights()

    dates = pd.date_range(s.get("start_date", "2018-01-01"), s.get("end_date", "2024-12-31"), freq="D")
    log(f"[synth] weather for {len(dates)} days")
    fields = _make_weather(grid, static, water, dates, rng)
    for var, arr in fields.items():
        store.save_fine(var, dates, arr)

    log("[synth] stations")
    stations, obs = _make_stations(grid, w, static, fields, dates, int(s.get("n_stations", 30)), rng)
    store.save_stations(stations, obs)
    log(f"[synth] done -> {store.dir}")
    return store


# ---------------------------------------------------------------------------
# Terrain and land cover
# ---------------------------------------------------------------------------


def _unit_coords(grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    """X: 0 (west) -> 1 (east), Y: 0 (south) -> 1 (north), shape (ny, nx)."""
    x = (grid.lon - grid.west) / (grid.east - grid.west)
    y = (grid.lat - grid.south) / (grid.north - grid.south)
    return np.meshgrid(x, y)


def _smooth_noise(shape, sigma, rng) -> np.ndarray:
    n = ndimage.gaussian_filter(rng.standard_normal(shape), sigma, mode="reflect")
    return n / (n.std() + 1e-9)


def _river_y(X: np.ndarray, phase: float) -> np.ndarray:
    return 0.45 + 0.12 * np.sin(2 * np.pi * 1.3 * X + phase)


def _make_dem(X, Y, rng) -> np.ndarray:
    dem = 520.0 + 90.0 * Y  # gentle south-north tilt
    dem += 420.0 * np.exp(-(((X - 0.06) / 0.13) ** 2)) * (0.8 + 0.3 * np.sin(3 * np.pi * Y))
    for _ in range(6):
        cx, cy = rng.uniform(0.25, 0.95), rng.uniform(0.1, 0.95)
        h, sd = rng.uniform(80, 260), rng.uniform(0.035, 0.09)
        dem += h * np.exp(-((X - cx) ** 2 + (Y - cy) ** 2) / (2 * sd**2))
    dem += 35.0 * _smooth_noise(X.shape, 5, rng) + 10.0 * _smooth_noise(X.shape, 1.5, rng)
    phase = rng.uniform(0, 2 * np.pi)
    dem -= 70.0 * np.exp(-(((Y - _river_y(X, phase)) / 0.05) ** 2))
    dem = np.maximum(dem, 380.0)
    dem.flags.writeable = True
    _make_dem.phase = phase  # reused so the river follows the carved valley
    return dem


def _make_water(X, Y, dem, rng) -> np.ndarray:
    ry = _river_y(X, _make_dem.phase)
    river = 0.7 * np.exp(-(((Y - ry) / 0.012) ** 2))
    lakes = np.zeros_like(X)
    for _ in range(3):
        cx = rng.uniform(0.2, 0.9)
        cy = float(_river_y(np.array(cx), _make_dem.phase)) + rng.uniform(-0.08, 0.08)
        a, b = rng.uniform(0.02, 0.045), rng.uniform(0.015, 0.03)
        lakes = np.maximum(lakes, (((X - cx) / a) ** 2 + ((Y - cy) / b) ** 2 <= 1).astype(float))
    lakes = ndimage.gaussian_filter(lakes, 0.7)
    return np.clip(np.maximum(river, lakes), 0, 1)


def _make_landcover(X, Y, terrain, water, rng) -> dict[str, np.ndarray]:
    slope_n = terrain["slope"] / (terrain["slope"].max() + 1e-9)
    elev = terrain["elevation"]
    elev_n = (elev - elev.min()) / (np.ptp(elev) + 1e-9)
    tree = np.clip(0.05 + 0.55 * slope_n + 0.35 * elev_n + 0.08 * _smooth_noise(X.shape, 3, rng), 0, 0.9)
    built = np.zeros_like(X)
    for _ in range(2):
        cx, cy = rng.uniform(0.35, 0.85), rng.uniform(0.25, 0.75)
        built += 0.85 * np.exp(-((X - cx) ** 2 + (Y - cy) ** 2) / (2 * 0.022**2))
    built = np.clip(built, 0, 0.9)
    bare = np.clip(0.03 + 0.02 * _smooth_noise(X.shape, 4, rng), 0, 0.1)
    total = tree + built + bare + water
    scale = np.where(total > 1, 1 / total, 1.0)
    tree, built, bare, wat = tree * scale, built * scale, bare * scale, water * scale
    crop = np.clip(1 - (tree + built + bare + wat), 0, 1)
    return {"lc_crop": crop, "lc_tree": tree, "lc_built": built, "lc_water": wat, "lc_bare": bare}


# ---------------------------------------------------------------------------
# Boundaries
# ---------------------------------------------------------------------------


def _make_boundaries(grid: Grid, n_blocks: int, n_gps: int, rng) -> gpd.GeoDataFrame:
    cx, cy = (grid.west + grid.east) / 2, (grid.south + grid.north) / 2
    half = min(grid.east - grid.west, grid.north - grid.south) / 2
    theta = np.linspace(0, 2 * np.pi, 90, endpoint=False)
    r = 0.80 + sum(
        rng.uniform(0.02, 0.06) * np.sin(k * theta + rng.uniform(0, 2 * np.pi)) for k in (2, 3, 5)
    )
    r = np.clip(r, 0.6, 0.94) * half
    district = Polygon(np.c_[cx + r * np.cos(theta), cy + r * np.sin(theta)])

    seeds: list[Point] = []
    minx, miny, maxx, maxy = district.bounds
    while len(seeds) < n_gps:
        p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        if district.contains(p):
            seeds.append(p)
    cells = voronoi_diagram(MultiPoint(seeds), envelope=district.buffer(0.1))
    polys = [c.intersection(district) for c in cells.geoms]
    polys = [p for p in polys if not p.is_empty]
    seed_gdf = gpd.GeoDataFrame(geometry=seeds, crs="EPSG:4326")
    poly_gdf = gpd.GeoDataFrame(geometry=polys, crs="EPSG:4326")
    joined = gpd.sjoin(seed_gdf, poly_gdf, predicate="within", how="inner")
    gp_geoms = poly_gdf.geometry.iloc[joined["index_right"].to_numpy()].to_numpy()
    seed_xy = np.array([[p.x, p.y] for p in seed_gdf.geometry.iloc[joined.index]])

    # Block centres: farthest-point sampling over GP seeds => compact, well-spread blocks.
    centres = [seed_xy[rng.integers(len(seed_xy))]]
    for _ in range(n_blocks - 1):
        d = np.min([np.hypot(*(seed_xy - c).T) for c in centres], axis=0)
        centres.append(seed_xy[np.argmax(d)])
    centres = np.array(centres)
    jitter = rng.normal(0, 0.01, size=seed_xy.shape)
    block_of = np.argmin(
        np.hypot(*(seed_xy[:, None, :] + jitter[:, None, :] - centres[None]).transpose(2, 0, 1)),
        axis=1,
    )
    order = np.lexsort((seed_xy[:, 0], -seed_xy[:, 1]))  # number GPs north->south, west->east
    letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    counters = {b: 0 for b in range(n_blocks)}
    rows = []
    for k in order:
        b = int(block_of[k])
        counters[b] += 1
        rows.append(
            {
                "gp_lgd": 99_000_000 + len(rows) + 1,
                "gp_name": f"Demo GP {letters[b]}-{counters[b]:02d}",
                "block_lgd": 990_000 + b + 1,
                "block_name": f"Demo Block {letters[b]}",
                "geometry": gp_geoms[k],
            }
        )
    return gpd.GeoDataFrame(rows, crs="EPSG:4326")


# ---------------------------------------------------------------------------
# Weather
# ---------------------------------------------------------------------------


def _ar1(n: int, phi: float, sigma: float, rng) -> np.ndarray:
    out = np.zeros(n)
    eps = rng.normal(0, sigma * np.sqrt(1 - phi**2), n)
    out[0] = rng.normal(0, sigma)
    for t in range(1, n):
        out[t] = phi * out[t - 1] + eps[t]
    return out


def _make_weather(grid: Grid, st: dict, water, dates: pd.DatetimeIndex, rng) -> dict[str, np.ndarray]:
    T = len(dates)
    ny, nx = grid.shape
    X, Y = _unit_coords(grid)
    doy = dates.dayofyear.to_numpy().astype(float)

    # Static drivers (2-D)
    zn = (st["elevation"] - 600.0) / 1000.0  # km above 600 m
    tpi = st["tpi_large"] / (st["tpi_large"].std() + 1e-9)
    water_prox = np.exp(-st["dist_water_km"] / 2.5)
    built, tree = st["lc_built"], st["lc_tree"]
    south_facing = -st["aspect_cos"] * np.clip(st["slope"] / 3.0, 0, 1)

    # Large-scale daily drivers (1-D)
    mon = np.exp(-(((doy - 210) / 50) ** 2)) + 0.35 * np.exp(-(((doy - 290) / 22) ** 2))
    mon = np.clip(mon, 0, 1)
    tmax_base = 31.5 + 3.5 * np.cos(2 * np.pi * (doy - 120) / 365) - 4.0 * mon
    tmin_base = 19.0 + 3.0 * np.cos(2 * np.pi * (doy - 140) / 365) + 1.5 * mon
    aT, aTn = _ar1(T, 0.8, 1.2, rng), _ar1(T, 0.8, 1.0, rng)
    aRH, acl = _ar1(T, 0.7, 5.0, rng), _ar1(T, 0.6, 1.0, rng)
    gx, gy = _ar1(T, 0.9, 0.6, rng), _ar1(T, 0.9, 0.6, rng)
    U = 14.0 * mon - 5.0 * (1 - mon) + _ar1(T, 0.7, 3.0, rng)
    V = 1.0 + 2.0 * mon + _ar1(T, 0.7, 3.0, rng)
    C = np.clip(1.2 + 5.5 * mon + acl, 0, 8)
    latent = _ar1(T, 0.6, 1.0, rng)
    p_rain = 0.06 + 0.72 * mon
    event = latent > norm.ppf(1 - p_rain)
    coverage = np.clip(0.25 + 0.6 * mon + 0.15 * rng.standard_normal(T), 0.1, 0.98)
    # Area-mean rain on event days (mm); tuned to roughly 900 mm/year.
    area_mean_rain = rng.gamma(0.9, 2.7 + 12.5 * mon)

    wind_factor = np.clip(1 + 0.25 * tpi + 0.6 * zn - 0.3 * tree - 0.35 * built, 0.4, 1.8)
    up_scale = None

    out = {v: np.empty((T, ny, nx), dtype=np.float32) for v in
           ["rain_mm", "tmax_c", "tmin_c", "rh_max_pct", "rh_min_pct", "wind_u", "wind_v", "cloud_okta"]}

    for start in range(0, T, 366):
        sl = slice(start, min(T, start + 366))
        n = sl.stop - sl.start
        c3 = lambda a, sl=sl: a[sl][:, None, None]  # noqa: E731  (1-D daily series -> (n,1,1))

        u = c3(U) * wind_factor + rng.normal(0, 0.8, (n, ny, nx))
        v = c3(V) * wind_factor + rng.normal(0, 0.8, (n, ny, nx))

        upslope = u * st["dzdx"] + v * st["dzdy"]
        if up_scale is None:
            up_scale = upslope.std() + 1e-9
        ls = ndimage.gaussian_filter(rng.standard_normal((n, ny, nx)), (0, 10, 10))
        conv = ndimage.gaussian_filter(rng.standard_normal((n, ny, nx)), (0, 2.5, 2.5))
        ls /= ls.std(axis=(1, 2), keepdims=True)
        conv /= conv.std(axis=(1, 2), keepdims=True)
        field = 0.7 * ls + 0.7 * conv + 0.55 * upslope / up_scale + 0.6 * zn + 0.2 * tpi
        flat = field.reshape(n, -1)
        thr = np.array([np.quantile(flat[i], 1 - coverage[sl][i]) for i in range(n)])
        excess = np.maximum(field - thr[:, None, None], 0) ** 1.3
        shape_norm = excess.mean(axis=(1, 2), keepdims=True) + 1e-9
        rain = c3(area_mean_rain) * excess / shape_norm
        rain = 250.0 * np.tanh(rain / 250.0)  # soft cap on extreme local totals
        rain *= c3(event.astype(float))
        rain = np.where(rain < 0.1, 0.0, rain)
        wet = (rain > 1.0).astype(float)

        cloud = np.clip(c3(C) + 1.5 * wet + 0.8 * zn + rng.normal(0, 0.4, (n, ny, nx)), 0, 8)

        grad = c3(gx) * (X - 0.5) * 2 + c3(gy) * (Y - 0.5) * 2
        lapse_max = 7.0 - 1.5 * c3(mon)
        tmax = (
            c3(tmax_base) + c3(aT) + grad - lapse_max * zn
            - 1.2 * water_prox + 1.0 * built - 0.5 * tree + 0.7 * south_facing
            - 0.07 * np.minimum(rain, 40) - 0.25 * (cloud - c3(C))
            + rng.normal(0, 0.35, (n, ny, nx))
        )
        clear = (8 - c3(C)) / 8
        tmin = (
            c3(tmin_base) + c3(aTn) + 0.7 * grad - 4.5 * zn
            + 0.9 * np.clip(tpi, -3, 3) * clear
            + 1.3 * built + 0.9 * water_prox + 0.4 * tree + 0.03 * np.minimum(rain, 40)
            + rng.normal(0, 0.35, (n, ny, nx))
        )
        tmin = np.minimum(tmin, tmax - 2.0)

        rh_max = np.clip(
            72 + 22 * c3(mon) + 0.6 * c3(aRH) + 7 * water_prox + 5 * tree - 5 * built + 2 * zn
            + 6 * wet + rng.normal(0, 2.5, (n, ny, nx)),
            25, 100,
        )
        tmax_anom = tmax - tmax.mean(axis=(1, 2), keepdims=True)
        rh_min = np.clip(
            32 + 40 * c3(mon) + c3(aRH) + 6 * water_prox + 4 * tree - 5 * built
            - 1.6 * tmax_anom + 10 * wet + rng.normal(0, 3.0, (n, ny, nx)),
            8, None,
        )
        rh_min = np.minimum(rh_min, rh_max - 3)

        out["rain_mm"][sl] = rain
        out["tmax_c"][sl] = tmax
        out["tmin_c"][sl] = tmin
        out["rh_max_pct"][sl] = rh_max
        out["rh_min_pct"][sl] = rh_min
        out["wind_u"][sl] = u
        out["wind_v"][sl] = v
        out["cloud_okta"][sl] = cloud
    return out


# ---------------------------------------------------------------------------
# Stations
# ---------------------------------------------------------------------------


def _make_stations(grid, w, st, fields, dates, n, rng) -> tuple[pd.DataFrame, pd.DataFrame]:
    lon, lat = grid.centers()
    pick = rng.choice(w.n_active, size=min(n, w.n_active), replace=False)
    flat = w.active_cells[pick]
    s_lon = lon[flat] + rng.uniform(-0.3, 0.3, len(flat)) * grid.res
    s_lat = lat[flat] + rng.uniform(-0.3, 0.3, len(flat)) * grid.res
    # Re-derive the cell from the jittered location, as the pipeline will.
    cell = w.active_cells[nearest_active_cell(grid, w, s_lon, s_lat)]
    elev = st["elevation"].ravel()[cell] + rng.normal(0, 20, len(cell))
    stations = pd.DataFrame(
        {
            "station_id": [f"SYN-AWS-{i + 1:02d}" for i in range(len(cell))],
            "name": [f"Synthetic AWS {i + 1:02d}" for i in range(len(cell))],
            "lon": s_lon.round(5),
            "lat": s_lat.round(5),
            "elev_m": elev.round(1),
            "source": "synthetic",
        }
    )

    T = len(dates)
    def at(var):  # noqa: E306
        return fields[var].reshape(T, -1)[:, cell]

    noise = lambda sd: rng.normal(0, sd, (T, len(cell)))  # noqa: E731
    rain = at("rain_mm")
    obs = {
        "rain_mm": np.where(rain < 0.1, 0.0, np.maximum(rain * np.exp(noise(0.15)), 0)),
        "tmax_c": at("tmax_c") + noise(0.4),
        "tmin_c": at("tmin_c") + noise(0.4),
        "rh_max_pct": np.clip(at("rh_max_pct") + noise(3), 0, 100),
        "rh_min_pct": np.clip(at("rh_min_pct") + noise(3), 0, 100),
    }
    spd, direc = uv_to_wind(at("wind_u"), at("wind_v"))
    obs["wind_kmph"] = np.maximum(spd + noise(1.5), 0)
    obs["wind_dir_deg"] = np.mod(direc + noise(15), 360)

    frames = []
    for var, arr in obs.items():
        df = pd.DataFrame(arr, index=dates, columns=stations["station_id"])
        df = df.stack().rename("value").reset_index()
        df.columns = ["date", "station_id", "value"]
        df["variable"] = var
        frames.append(df)
    long = pd.concat(frames, ignore_index=True)
    long = long.sample(frac=0.95, random_state=int(rng.integers(1e9)))  # ~5% missing
    long["value"] = long["value"].round(2)
    return stations, long[["station_id", "date", "variable", "value"]].sort_values(
        ["station_id", "variable", "date"]
    ).reset_index(drop=True)
