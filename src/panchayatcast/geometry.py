"""Spatial weights linking grid cells, panchayats and blocks.

Everything downstream is matrix algebra on "active" cells (cells that overlap at
least one panchayat):

    panchayat values = W_gp    @ cell values      (area-weighted mean)
    block means      = W_block @ cell values
    interpolated     = idw     @ block values     (smooth coarse signal on cells)

Blocks are defined as the union of their panchayats, so W_block is exactly the
area-weighted combination of W_gp rows. This keeps panchayat and block values
mutually consistent.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from scipy import sparse

from .grid import Grid

EQUAL_AREA_CRS = "EPSG:7755"  # WGS 84 / India NSF LCC


@dataclass
class Weights:
    active_cells: np.ndarray  # (n_active,) flat indices into the grid
    gp_ids: np.ndarray  # (n_gp,) LGD codes, row order of W_gp
    block_ids: np.ndarray  # (n_block,) LGD codes, row order of W_block
    gp_block_idx: np.ndarray  # (n_gp,) index into block_ids
    W_gp: sparse.csr_matrix  # (n_gp, n_active), rows sum to 1
    W_block: sparse.csr_matrix  # (n_block, n_active), rows sum to 1
    cell_block: np.ndarray  # (n_active,) index of the block covering most of the cell
    idw: np.ndarray  # (n_active, n_block), rows sum to 1
    gp_area_km2: np.ndarray
    block_area_km2: np.ndarray

    @property
    def n_active(self) -> int:
        return len(self.active_cells)

    @property
    def n_gp(self) -> int:
        return len(self.gp_ids)

    @property
    def n_block(self) -> int:
        return len(self.block_ids)

    def save(self, path: Path) -> None:
        np.savez_compressed(
            path,
            active_cells=self.active_cells,
            gp_ids=self.gp_ids,
            block_ids=self.block_ids,
            gp_block_idx=self.gp_block_idx,
            cell_block=self.cell_block,
            idw=self.idw,
            gp_area_km2=self.gp_area_km2,
            block_area_km2=self.block_area_km2,
            **_csr_parts("W_gp", self.W_gp),
            **_csr_parts("W_block", self.W_block),
        )

    @classmethod
    def load(cls, path: Path) -> Weights:
        z = np.load(path)
        return cls(
            active_cells=z["active_cells"],
            gp_ids=z["gp_ids"],
            block_ids=z["block_ids"],
            gp_block_idx=z["gp_block_idx"],
            W_gp=_csr_from(z, "W_gp"),
            W_block=_csr_from(z, "W_block"),
            cell_block=z["cell_block"],
            idw=z["idw"],
            gp_area_km2=z["gp_area_km2"],
            block_area_km2=z["block_area_km2"],
        )


def _csr_parts(name: str, m: sparse.csr_matrix) -> dict[str, np.ndarray]:
    return {
        f"{name}_data": m.data,
        f"{name}_indices": m.indices,
        f"{name}_indptr": m.indptr,
        f"{name}_shape": np.array(m.shape),
    }


def _csr_from(z, name: str) -> sparse.csr_matrix:
    return sparse.csr_matrix(
        (z[f"{name}_data"], z[f"{name}_indices"], z[f"{name}_indptr"]),
        shape=tuple(z[f"{name}_shape"]),
    )


def _row_normalize(m: sparse.csr_matrix) -> sparse.csr_matrix:
    sums = np.asarray(m.sum(axis=1)).ravel()
    inv = np.divide(1.0, sums, out=np.zeros_like(sums), where=sums > 0)
    return sparse.diags(inv) @ m


def compute_weights(
    grid: Grid,
    gps: gpd.GeoDataFrame,
    idw_power: float = 2.0,
    min_distance_km: float = 1.0,
) -> Weights:
    """Build all cell/panchayat/block weights. `gps` needs gp_lgd, block_lgd, geometry."""
    gps = gps.sort_values("gp_lgd").reset_index(drop=True)
    gp_ids = gps["gp_lgd"].to_numpy()
    block_ids = np.sort(gps["block_lgd"].unique())
    block_index = {b: i for i, b in enumerate(block_ids)}
    gp_block_idx = gps["block_lgd"].map(block_index).to_numpy()

    cells = gpd.GeoDataFrame(
        {"cell": np.arange(grid.n_cells)}, geometry=grid.cell_boxes(), crs="EPSG:4326"
    )
    region = gps.to_crs("EPSG:4326").union_all()
    hit = cells.sindex.query(region, predicate="intersects")
    cells = cells.iloc[np.sort(hit)]

    cells_p = cells.to_crs(EQUAL_AREA_CRS)
    gps_p = gps[["gp_lgd", "block_lgd", "geometry"]].to_crs(EQUAL_AREA_CRS)
    inter = gpd.overlay(cells_p, gps_p, how="intersection", keep_geom_type=True)
    inter["area_km2"] = inter.geometry.area / 1e6
    inter = inter[inter["area_km2"] > 1e-6]

    active_cells = np.unique(inter["cell"].to_numpy())
    cell_pos = pd.Series(np.arange(len(active_cells)), index=active_cells)
    gp_pos = pd.Series(np.arange(len(gp_ids)), index=gp_ids)

    rows = gp_pos.loc[inter["gp_lgd"]].to_numpy()
    cols = cell_pos.loc[inter["cell"]].to_numpy()
    area = inter["area_km2"].to_numpy()
    n_active, n_gp, n_block = len(active_cells), len(gp_ids), len(block_ids)

    A_gp = sparse.coo_matrix((area, (rows, cols)), shape=(n_gp, n_active)).tocsr()
    A_block = sparse.coo_matrix(
        (area, (gp_block_idx[rows], cols)), shape=(n_block, n_active)
    ).tocsr()
    gp_area = np.asarray(A_gp.sum(axis=1)).ravel()
    block_area = np.asarray(A_block.sum(axis=1)).ravel()
    cell_block = np.asarray(A_block.argmax(axis=0)).ravel()

    # Inverse-distance weights from cell centres to block centroids (km, equal-area CRS).
    lon, lat = grid.centers()
    pts = gpd.GeoSeries(
        gpd.points_from_xy(lon[active_cells], lat[active_cells]), crs="EPSG:4326"
    ).to_crs(EQUAL_AREA_CRS)
    blocks_p = gps_p.dissolve(by="block_lgd").loc[block_ids]
    cent = blocks_p.geometry.centroid
    dx = pts.x.to_numpy()[:, None] - cent.x.to_numpy()[None, :]
    dy = pts.y.to_numpy()[:, None] - cent.y.to_numpy()[None, :]
    dist_km = np.maximum(np.hypot(dx, dy) / 1000.0, min_distance_km)
    idw = 1.0 / dist_km**idw_power
    idw /= idw.sum(axis=1, keepdims=True)

    return Weights(
        active_cells=active_cells,
        gp_ids=gp_ids,
        block_ids=block_ids,
        gp_block_idx=gp_block_idx,
        W_gp=_row_normalize(A_gp),
        W_block=_row_normalize(A_block),
        cell_block=cell_block,
        idw=idw.astype(np.float64),
        gp_area_km2=gp_area,
        block_area_km2=block_area,
    )


def nearest_active_cell(grid: Grid, w: Weights, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Index (into active cells) of the active cell nearest to each point."""
    from scipy.spatial import cKDTree

    clon, clat = grid.centers()
    coslat = np.cos(np.deg2rad(np.mean(clat)))
    tree = cKDTree(np.c_[clon[w.active_cells] * coslat, clat[w.active_cells]])
    _, idx = tree.query(np.c_[np.asarray(lon) * coslat, np.asarray(lat)])
    return idx
