"""Region context and feature construction for the downscaling models.

A "block field" `blk[var]` is an array (n_days, n_block): one value per block and
day, i.e. exactly what an official block forecast contains. Every model maps block
fields to cell fields (n_days, n_active).

During training, block fields are built by area-averaging historical fine fields
over each block. This mimics the operational input, so the model sees the same
kind of input in training and in production.
"""

from __future__ import annotations

from dataclasses import dataclass

import geopandas as gpd
import numpy as np
import pandas as pd

from ..geometry import Weights
from ..grid import Grid
from ..store import RegionStore
from ..variables import MODELLED, MODELLED_VARS

STATIC_FEATURES = [
    "elevation",
    "slope",
    "aspect_sin",
    "aspect_cos",
    "dzdx",
    "dzdy",
    "tpi_small",
    "tpi_large",
    "lc_crop",
    "lc_tree",
    "lc_built",
    "lc_water",
    "lc_bare",
    "dist_water_km",
    "lat",
    "lon",
]


@dataclass
class RegionContext:
    region_id: str
    meta: dict
    grid: Grid
    weights: Weights
    static: dict[str, np.ndarray]  # each (n_active,)
    block_elev: np.ndarray  # (n_block,) area-mean elevation
    interp_elev: np.ndarray  # (n_active,) elevation implied by interpolating block_elev
    blocks: gpd.GeoDataFrame
    panchayats: gpd.GeoDataFrame

    @classmethod
    def load(cls, region_id: str) -> RegionContext:
        store = RegionStore(region_id)
        if not store.exists():
            raise FileNotFoundError(
                f"Region '{region_id}' is not built. Run `pcast synth` or `pcast build-region`."
            )
        grid = store.grid
        w = store.weights()
        ds = store.static()
        lon, lat = grid.centers()
        static = {"lon": lon[w.active_cells], "lat": lat[w.active_cells]}
        for name in STATIC_FEATURES:
            if name in static:
                continue
            if name not in ds:
                raise KeyError(f"static.nc is missing layer '{name}'")
            static[name] = ds[name].values.ravel()[w.active_cells].astype(np.float64)
        block_elev = w.W_block @ static["elevation"]
        interp_elev = w.idw @ block_elev
        blocks = store.blocks().set_index("block_lgd").loc[w.block_ids].reset_index()
        gps = store.panchayats().set_index("gp_lgd").loc[w.gp_ids].reset_index()
        return cls(
            region_id=region_id,
            meta=store.meta,
            grid=grid,
            weights=w,
            static=static,
            block_elev=block_elev,
            interp_elev=interp_elev,
            blocks=blocks,
            panchayats=gps,
        )

    @property
    def n_active(self) -> int:
        return self.weights.n_active

    @property
    def n_block(self) -> int:
        return self.weights.n_block

    def block_means(self, cells: np.ndarray) -> np.ndarray:
        """(D, n_active) -> (D, n_block) area-weighted block means (NaN-aware)."""
        return _nan_weighted(self.weights.W_block, cells)

    def gp_means(self, cells: np.ndarray) -> np.ndarray:
        """(D, n_active) -> (D, n_gp) area-weighted panchayat means (NaN-aware)."""
        return _nan_weighted(self.weights.W_gp, cells)

    def interp(self, blk: np.ndarray) -> np.ndarray:
        """(D, n_block) -> (D, n_active) inverse-distance interpolation."""
        return blk @ self.weights.idw.T

    def copy(self, blk: np.ndarray) -> np.ndarray:
        """(D, n_block) -> (D, n_active): each cell takes its block's value."""
        return blk[:, self.weights.cell_block]


def _nan_weighted(W, cells: np.ndarray) -> np.ndarray:
    cells = np.atleast_2d(cells)
    valid = np.isfinite(cells)
    if valid.all():
        return np.asarray(W @ cells.T).T
    filled = np.where(valid, cells, 0.0)
    num = np.asarray(W @ filled.T).T
    den = np.asarray(W @ valid.T.astype(np.float64)).T
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(den > 0.5, num / den, np.nan)


def split_mask(dates: pd.DatetimeIndex, split: tuple[str, str]) -> np.ndarray:
    lo, hi = pd.Timestamp(split[0]), pd.Timestamp(split[1])
    return np.asarray((dates >= lo) & (dates <= hi))


def compute_climatology(
    ctx: RegionContext, var: str, fine: np.ndarray, blk: np.ndarray, dates: pd.DatetimeIndex
) -> np.ndarray:
    """Per-month, per-cell local signature relative to the interpolated block signal.

    additive vars: mean(fine - interp)        rain: (sum fine + 1) / (sum interp + 1)
    Must only be computed from training days (to avoid leaking test information).
    """
    interp = ctx.interp(blk)
    months = dates.month.to_numpy()
    rain = MODELLED[var].kind == "rain"
    out = np.full((12, ctx.n_active), 1.0 if rain else 0.0)
    for m in range(1, 13):
        sel = months == m
        if not sel.any():
            continue
        f, i = fine[sel], interp[sel]
        if rain:
            ok = np.isfinite(f)
            out[m - 1] = (np.where(ok, f, 0).sum(0) + 1.0) / (np.where(ok, i, 0).sum(0) + 1.0)
        else:
            with np.errstate(invalid="ignore"):
                d = np.nanmean(f - i, axis=0)
            out[m - 1] = np.nan_to_num(d, nan=0.0)
    return out


def make_features(
    ctx: RegionContext,
    blk: dict[str, np.ndarray],
    dates: pd.DatetimeIndex,
    day_idx: np.ndarray,
    cell_idx: np.ndarray,
    target: str,
    clim: np.ndarray | None,
) -> tuple[pd.DataFrame, np.ndarray]:
    """Feature table for (day, cell) pairs. Returns (features, interpolated target signal)."""
    w = ctx.weights
    bidx = w.cell_block[cell_idx]
    cols: dict[str, np.ndarray] = {}
    for v in MODELLED_VARS:
        cols[f"blk_{v}"] = blk[v][day_idx, bidx]
    interp = np.einsum("nb,nb->n", w.idw[cell_idx], blk[target][day_idx])
    cols["interp"] = interp
    cols["interp_minus_blk"] = interp - cols[f"blk_{target}"]
    for name in STATIC_FEATURES:
        cols[name] = ctx.static[name][cell_idx]
    cols["dz_block"] = ctx.static["elevation"][cell_idx] - ctx.block_elev[bidx]
    cols["dz_interp"] = ctx.static["elevation"][cell_idx] - ctx.interp_elev[cell_idx]
    cols["upslope"] = (
        cols["blk_wind_u"] * ctx.static["dzdx"][cell_idx]
        + cols["blk_wind_v"] * ctx.static["dzdy"][cell_idx]
    )
    doy = dates.dayofyear.to_numpy()[day_idx]
    cols["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    cols["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    if clim is not None:
        cols["clim"] = clim[dates.month.to_numpy()[day_idx] - 1, cell_idx]
    if MODELLED[target].kind == "rain":
        cols["log_blk"] = np.log1p(np.maximum(cols[f"blk_{target}"], 0))
        cols["log_interp"] = np.log1p(np.maximum(interp, 0))
    return pd.DataFrame(cols, dtype=np.float32), interp


def all_pairs(n_days: int, n_active: int) -> tuple[np.ndarray, np.ndarray]:
    """Every (day, cell) pair, day-major."""
    day_idx = np.repeat(np.arange(n_days), n_active)
    cell_idx = np.tile(np.arange(n_active), n_days)
    return day_idx, cell_idx
