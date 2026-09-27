"""GeoTIFF export of the gridded (~1 km) forecast."""

from __future__ import annotations

import numpy as np
import pandas as pd
import xarray as xr
from rasterio.io import MemoryFile
from rasterio.transform import from_origin

from ..pipeline import run_dir


def grid_dataset(run_id: str) -> xr.Dataset:
    with xr.open_dataset(run_dir(run_id) / "grid.nc") as ds:
        return ds.load()


def geotiff_bytes(run_id: str, variable: str, valid_date: str) -> bytes:
    ds = grid_dataset(run_id)
    if variable not in ds:
        raise KeyError(f"Unknown variable '{variable}'")
    da = ds[variable].sel(valid_date=pd.Timestamp(valid_date))
    lat, lon = ds["lat"].values, ds["lon"].values
    res = float(abs(lon[1] - lon[0]))
    data = da.values.astype(np.float32)
    if lat[0] < lat[-1]:  # ensure north-up
        data = data[::-1]
    transform = from_origin(float(lon.min()) - res / 2, float(lat.max()) + res / 2, res, res)
    profile = dict(driver="GTiff", height=data.shape[0], width=data.shape[1], count=1,
                   dtype="float32", crs="EPSG:4326", transform=transform, nodata=np.nan,
                   compress="deflate")
    with MemoryFile() as mem:
        with mem.open(**profile) as dst:
            dst.write(data, 1)
            dst.update_tags(variable=variable, valid_date=str(valid_date), run_id=run_id,
                            units=da.attrs.get("units", ""))
        return mem.read()
