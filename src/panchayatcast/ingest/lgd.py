"""Real Gram Panchayat boundaries (with LGD codes) for one district.

Source: LGD Gram Panchayat polygons (Local Government Directory), published as
GeoParquet under CC0-1.0 by the open "india-geodata" / bharatlas project
(https://github.com/yashveeeeeeer/india-geodata, https://bharatlas.com).

The national file is ~340 MB. We read it with HTTP range requests, so only the
footer, a few small attribute columns and the geometry of the needed row groups are
downloaded (typically a few tens of MB).
"""

from __future__ import annotations

import io

import geopandas as gpd
import numpy as np
import pandas as pd
import pyarrow.parquet as pq
import requests
import shapely

LGD_PANCHAYATS_URL = (
    "https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/admin/panchayats/LGD_panchayats.parquet"
)


class HTTPRangeFile(io.RawIOBase):
    """Read-only, seekable file over HTTP range requests (with a small block cache)."""

    BLOCK = 1 << 20

    def __init__(self, url: str, timeout: int = 60):
        self.url, self.timeout, self.pos = url, timeout, 0
        self.session = requests.Session()
        self.size = int(self.session.head(url, timeout=timeout, allow_redirects=True).headers["Content-Length"])
        self.cache: dict[int, bytes] = {}
        self.bytes_read = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def _get(self, start: int, end: int) -> bytes:
        r = self.session.get(self.url, headers={"Range": f"bytes={start}-{end - 1}"}, timeout=self.timeout)
        r.raise_for_status()
        self.bytes_read += len(r.content)
        return r.content

    def readinto(self, b):
        n = min(len(b), self.size - self.pos)
        if n <= 0:
            return 0
        if n > 4 * self.BLOCK:  # large column chunks: fetch directly
            data = self._get(self.pos, self.pos + n)
        else:
            first, last = self.pos // self.BLOCK, (self.pos + n - 1) // self.BLOCK
            parts = []
            for k in range(first, last + 1):
                if k not in self.cache:
                    self.cache[k] = self._get(k * self.BLOCK, min(self.size, (k + 1) * self.BLOCK))
                parts.append(self.cache[k])
            blob = b"".join(parts)
            off = self.pos - first * self.BLOCK
            data = blob[off:off + n]
        b[: len(data)] = data
        self.pos += len(data)
        return len(data)


def fetch_district_panchayats(district: str, state: str | None = None,
                              url: str = LGD_PANCHAYATS_URL, log=print) -> gpd.GeoDataFrame:
    """GP polygons of one district, columns: gp_lgd, gp_name, block_lgd, block_name, district_lgd."""
    f = HTTPRangeFile(url)
    pf = pq.ParquetFile(f)
    keys = ["dtname", "stname"]
    hits = []
    for rg in range(pf.metadata.num_row_groups):
        t = pf.read_row_group(rg, columns=keys).to_pandas()
        m = t["dtname"].str.strip().str.lower() == district.strip().lower()
        if state:
            m &= t["stname"].str.strip().str.lower() == state.strip().lower()
        if m.any():
            hits.append((rg, np.where(m.to_numpy())[0]))
    if not hits:
        raise ValueError(f"District '{district}' not found in the LGD panchayat layer")
    cols = ["gpcode", "gpname", "blklgdcode", "blkname", "dt_lgd", "dtname", "stname", "geometry"]
    frames = []
    for rg, rows in hits:
        t = pf.read_row_group(rg, columns=cols).to_pandas().iloc[rows]
        frames.append(t)
    df = pd.concat(frames, ignore_index=True)
    log(f"[lgd] {len(df)} panchayats in {district}; downloaded {f.bytes_read / 1e6:.1f} MB of {f.size / 1e6:.0f} MB")
    geom = shapely.from_wkb(df["geometry"].to_numpy())
    gdf = gpd.GeoDataFrame(
        {
            "gp_lgd": pd.to_numeric(df["gpcode"], errors="coerce"),
            "gp_name": df["gpname"].str.strip().str.title(),
            "block_lgd": pd.to_numeric(df["blklgdcode"], errors="coerce"),
            "block_name": df["blkname"].str.strip().str.title(),
            "district_lgd": df["dt_lgd"],
        },
        geometry=geom,
        crs="EPSG:4326",
    )
    bad = gdf["gp_lgd"].isna() | gdf["block_lgd"].isna() | gdf.geometry.isna()
    if bad.any():
        log(f"[lgd] dropping {int(bad.sum())} rows without LGD codes or geometry")
        gdf = gdf[~bad]
    gdf["gp_lgd"] = gdf["gp_lgd"].astype(np.int64)
    gdf["block_lgd"] = gdf["block_lgd"].astype(np.int64)
    return gdf.reset_index(drop=True)
