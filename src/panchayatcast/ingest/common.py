"""Steps shared by the synthetic and real region builders."""

from __future__ import annotations

from datetime import UTC, datetime

import geopandas as gpd
import numpy as np

from ..config import ModelConfig, RegionConfig
from ..geometry import EQUAL_AREA_CRS, compute_weights
from ..grid import Grid
from ..store import RegionStore


def derive_blocks(gps: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Blocks = dissolved union of their panchayats (guarantees exact nesting)."""
    cols = ["block_lgd", "block_name", "geometry"]
    blocks = gps[cols].dissolve(by="block_lgd", aggfunc={"block_name": "first"}).reset_index()
    blocks["n_gps"] = gps.groupby("block_lgd").size().loc[blocks["block_lgd"]].to_numpy()
    blocks["area_km2"] = blocks.to_crs(EQUAL_AREA_CRS).area.to_numpy() / 1e6
    return blocks


def write_region(
    cfg: RegionConfig,
    grid: Grid,
    gps: gpd.GeoDataFrame,
    static: dict[str, np.ndarray],
    model_cfg: ModelConfig,
    extra_meta: dict | None = None,
) -> RegionStore:
    """Persist metadata, boundaries, static layers and weights for a region."""
    gps = gps.to_crs("EPSG:4326").copy()
    gps["area_km2"] = gps.to_crs(EQUAL_AREA_CRS).area.to_numpy() / 1e6
    blocks = derive_blocks(gps)

    store = RegionStore(cfg.region_id)
    meta = cfg.to_meta()
    meta["grid"] = grid.to_meta()
    meta["built_at"] = datetime.now(UTC).isoformat()
    meta["n_blocks"] = int(len(blocks))
    meta["n_gps"] = int(len(gps))
    meta.update(extra_meta or {})
    store.write_meta(meta)
    store.save_boundaries(blocks, gps)
    store.save_static(static)

    w = compute_weights(
        grid, gps, idw_power=model_cfg.idw_power, min_distance_km=model_cfg.idw_min_distance_km
    )
    store.save_weights(w)
    meta["n_active_cells"] = int(w.n_active)
    store.write_meta(meta)
    return store
