"""On-disk layout of a processed region (data/processed/<region_id>/).

    region.json          region metadata + grid definition + data source
    blocks.geojson       block polygons (block_lgd, block_name)
    panchayats.geojson   GP polygons (gp_lgd, gp_name, block_lgd, block_name, area_km2)
    static.nc            static 2-D layers on the grid (elevation, land cover, ...)
    fine/<var>.nc        daily fine-resolution fields (time, lat, lon) for MODELLED_VARS
    weights.npz          cell / GP / block weights (see geometry.py)
    stations.csv         station_id, name, lon, lat, elev_m, source
    observations.parquet station_id, date, variable, value
"""

from __future__ import annotations

import json
from functools import cached_property
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import xarray as xr

from .config import paths
from .geometry import Weights
from .grid import Grid


class RegionStore:
    def __init__(self, region_id: str, root: Path | None = None):
        self.region_id = region_id
        self.dir = (root or paths().processed) / region_id

    # ---- metadata -------------------------------------------------------
    @property
    def meta_path(self) -> Path:
        return self.dir / "region.json"

    def exists(self) -> bool:
        return self.meta_path.exists() and self.weights_path.exists()

    def write_meta(self, meta: dict) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        self.meta_path.write_text(json.dumps(meta, indent=2, default=str), encoding="utf-8")
        self.__dict__.pop("meta", None)

    @cached_property
    def meta(self) -> dict:
        return json.loads(self.meta_path.read_text(encoding="utf-8"))

    @property
    def grid(self) -> Grid:
        return Grid.from_meta(self.meta["grid"])

    # ---- boundaries -----------------------------------------------------
    def save_boundaries(self, blocks: gpd.GeoDataFrame, gps: gpd.GeoDataFrame) -> None:
        self.dir.mkdir(parents=True, exist_ok=True)
        blocks.to_crs("EPSG:4326").to_file(self.dir / "blocks.geojson", driver="GeoJSON")
        gps.to_crs("EPSG:4326").to_file(self.dir / "panchayats.geojson", driver="GeoJSON")

    def blocks(self) -> gpd.GeoDataFrame:
        return gpd.read_file(self.dir / "blocks.geojson")

    def panchayats(self) -> gpd.GeoDataFrame:
        return gpd.read_file(self.dir / "panchayats.geojson")

    # ---- static layers ----------------------------------------------------
    def save_static(self, layers: dict[str, np.ndarray]) -> None:
        g = self.grid
        ds = xr.Dataset(
            {k: (("lat", "lon"), np.asarray(v, dtype=np.float32)) for k, v in layers.items()},
            coords={"lat": g.lat, "lon": g.lon},
        )
        ds.to_netcdf(self.dir / "static.nc")

    def static(self) -> xr.Dataset:
        with xr.open_dataset(self.dir / "static.nc") as ds:
            return ds.load()

    # ---- fine daily fields -----------------------------------------------
    def fine_path(self, var: str) -> Path:
        return self.dir / "fine" / f"{var}.nc"

    def save_fine(self, var: str, dates: pd.DatetimeIndex, data: np.ndarray) -> None:
        """data: (time, ny, nx) on the region grid."""
        g = self.grid
        self.fine_path(var).parent.mkdir(parents=True, exist_ok=True)
        da = xr.DataArray(
            data.astype(np.float32),
            dims=("time", "lat", "lon"),
            coords={"time": dates, "lat": g.lat, "lon": g.lon},
            name=var,
        )
        da.to_netcdf(self.fine_path(var), encoding={var: {"zlib": True, "complevel": 4}})

    def load_fine_active(
        self,
        var: str,
        weights: Weights,
        start: str | None = None,
        end: str | None = None,
    ) -> tuple[pd.DatetimeIndex, np.ndarray]:
        """Daily fine field restricted to active cells: (dates, array[time, n_active])."""
        with xr.open_dataarray(self.fine_path(var)) as da:
            da = da.sel(time=slice(start, end))
            values = da.values.reshape(da.sizes["time"], -1)[:, weights.active_cells]
            dates = pd.DatetimeIndex(da["time"].values)
        return dates, values.astype(np.float64)

    def fine_dates(self, var: str = "tmax_c") -> pd.DatetimeIndex:
        with xr.open_dataarray(self.fine_path(var)) as da:
            return pd.DatetimeIndex(da["time"].values)

    # ---- weights --------------------------------------------------------
    @property
    def weights_path(self) -> Path:
        return self.dir / "weights.npz"

    def save_weights(self, w: Weights) -> None:
        w.save(self.weights_path)

    def weights(self) -> Weights:
        return Weights.load(self.weights_path)

    # ---- stations -------------------------------------------------------
    def save_stations(self, stations: pd.DataFrame, observations: pd.DataFrame) -> None:
        stations.to_csv(self.dir / "stations.csv", index=False)
        obs = observations.copy()
        obs["date"] = pd.to_datetime(obs["date"])
        obs.to_parquet(self.dir / "observations.parquet", index=False)

    def stations(self) -> pd.DataFrame:
        p = self.dir / "stations.csv"
        return pd.read_csv(p) if p.exists() else pd.DataFrame(
            columns=["station_id", "name", "lon", "lat", "elev_m", "source"]
        )

    def observations(self) -> pd.DataFrame:
        p = self.dir / "observations.parquet"
        return pd.read_parquet(p) if p.exists() else pd.DataFrame(
            columns=["station_id", "date", "variable", "value"]
        )


def list_regions() -> list[str]:
    root = paths().processed
    if not root.exists():
        return []
    return sorted(p.name for p in root.iterdir() if (p / "region.json").exists())
