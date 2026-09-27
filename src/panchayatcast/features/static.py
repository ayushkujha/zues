"""Static (time-invariant) layers derived on the target grid.

Shared by the synthetic generator and the real-data builder so both produce the
same feature set.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from ..grid import Grid

LANDCOVER_CLASSES = ["lc_crop", "lc_tree", "lc_built", "lc_water", "lc_bare"]


def _odd_window(km: float, cell_km: float) -> int:
    n = max(3, int(round(km / cell_km)))
    return n if n % 2 == 1 else n + 1


def terrain_features(dem: np.ndarray, grid: Grid) -> dict[str, np.ndarray]:
    """Slope, aspect, gradients and topographic position from a DEM (metres) on `grid`."""
    dem = np.asarray(dem, dtype=np.float64)
    if np.isnan(dem).any():
        dem = np.where(np.isnan(dem), np.nanmean(dem), dem)
    dx_km, dy_km = grid.cell_km()
    # Rows run north -> south, so d/d(north) is the negative row gradient.
    d_row, d_col = np.gradient(dem, dy_km, dx_km)
    dzdx = d_col  # m per km, towards east
    dzdy = -d_row  # m per km, towards north
    grad = np.hypot(dzdx, dzdy)
    slope_deg = np.rad2deg(np.arctan(grad / 1000.0))
    # Aspect = compass direction the slope faces (downhill), clockwise from north.
    aspect = np.arctan2(-dzdx, -dzdy)
    flat = grad < 1e-3
    aspect_sin = np.where(flat, 0.0, np.sin(aspect))
    aspect_cos = np.where(flat, 0.0, np.cos(aspect))

    cell_km = (dx_km + dy_km) / 2
    tpi_small = dem - ndimage.uniform_filter(dem, _odd_window(3.0, cell_km), mode="nearest")
    tpi_large = dem - ndimage.uniform_filter(dem, _odd_window(15.0, cell_km), mode="nearest")

    return {
        "elevation": dem,
        "slope": slope_deg,
        "aspect_sin": aspect_sin,
        "aspect_cos": aspect_cos,
        "dzdx": dzdx,
        "dzdy": dzdy,
        "tpi_small": tpi_small,
        "tpi_large": tpi_large,
    }


def distance_to_water_km(water_fraction: np.ndarray, grid: Grid, threshold: float = 0.3) -> np.ndarray:
    water = np.asarray(water_fraction) >= threshold
    dx_km, dy_km = grid.cell_km()
    if not water.any():
        return np.full(water.shape, 50.0)
    return ndimage.distance_transform_edt(~water, sampling=(dy_km, dx_km))
