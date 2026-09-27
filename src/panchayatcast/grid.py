"""Regular lat/lon target grid. Rows run north -> south (raster convention)."""

from __future__ import annotations

from dataclasses import dataclass
from functools import cached_property

import numpy as np
from rasterio.transform import Affine, from_origin
from shapely.geometry import box

KM_PER_DEG = 111.32


@dataclass(frozen=True)
class Grid:
    west: float
    north: float
    res: float
    nx: int
    ny: int

    @classmethod
    def from_bbox(cls, bbox: tuple[float, float, float, float], res: float) -> Grid:
        west, south, east, north = bbox
        nx = int(round((east - west) / res))
        ny = int(round((north - south) / res))
        return cls(west=float(west), north=float(north), res=float(res), nx=nx, ny=ny)

    @classmethod
    def from_meta(cls, meta: dict) -> Grid:
        return cls(meta["west"], meta["north"], meta["res"], meta["nx"], meta["ny"])

    def to_meta(self) -> dict:
        return {"west": self.west, "north": self.north, "res": self.res, "nx": self.nx, "ny": self.ny}

    @property
    def east(self) -> float:
        return self.west + self.nx * self.res

    @property
    def south(self) -> float:
        return self.north - self.ny * self.res

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return (self.west, self.south, self.east, self.north)

    @property
    def shape(self) -> tuple[int, int]:
        return (self.ny, self.nx)

    @property
    def n_cells(self) -> int:
        return self.nx * self.ny

    @cached_property
    def lon(self) -> np.ndarray:
        return self.west + self.res * (np.arange(self.nx) + 0.5)

    @cached_property
    def lat(self) -> np.ndarray:
        return self.north - self.res * (np.arange(self.ny) + 0.5)

    @property
    def transform(self) -> Affine:
        return from_origin(self.west, self.north, self.res, self.res)

    def centers(self) -> tuple[np.ndarray, np.ndarray]:
        """Flattened (lon, lat) of cell centres, C-order."""
        lon2, lat2 = np.meshgrid(self.lon, self.lat)
        return lon2.ravel(), lat2.ravel()

    def cell_boxes(self) -> list:
        boxes = []
        for j in range(self.ny):
            top = self.north - j * self.res
            for i in range(self.nx):
                left = self.west + i * self.res
                boxes.append(box(left, top - self.res, left + self.res, top))
        return boxes

    def cell_km(self) -> tuple[float, float]:
        """Approximate (dx, dy) cell size in km at the grid's mid-latitude."""
        mid = np.deg2rad((self.north + self.south) / 2)
        return self.res * KM_PER_DEG * np.cos(mid), self.res * KM_PER_DEG

    def to_2d(self, active_values: np.ndarray, active_cells: np.ndarray) -> np.ndarray:
        """Scatter values for active cells back onto the full (ny, nx) grid (NaN elsewhere)."""
        out = np.full(self.n_cells, np.nan, dtype=np.float32)
        out[active_cells] = active_values
        return out.reshape(self.shape)
