"""Parse and validate an official block-level forecast.

Expected long format (one row per block per valid date), CSV or DataFrame:

    block_lgd,issue_date,valid_date,rain_mm,tmax_c,tmin_c,rh_max_pct,rh_min_pct,
    wind_kmph,wind_dir_deg,cloud_okta
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from ..variables import INPUT_RANGES, INPUT_VARS, MODELLED_VARS, wind_to_uv

REQUIRED_COLUMNS = ["block_lgd", "issue_date", "valid_date", *INPUT_VARS]
MAX_LEAD_DAYS = 10


class ForecastValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("Invalid block forecast: " + "; ".join(errors[:8]))


@dataclass
class BlockForecast:
    issue_date: pd.Timestamp
    dates: pd.DatetimeIndex
    lead_days: np.ndarray
    table: pd.DataFrame  # cleaned rows for the region's blocks, sorted
    warnings: list[str] = field(default_factory=list)

    def to_blk(self, block_ids: np.ndarray) -> dict[str, np.ndarray]:
        """Block fields for the model: {modelled var: (n_days, n_block)} in `block_ids` order."""
        out: dict[str, np.ndarray] = {}
        for var in INPUT_VARS:
            wide = self.table.pivot(index="valid_date", columns="block_lgd", values=var)
            out[var] = wide.reindex(index=self.dates, columns=block_ids).to_numpy(dtype=np.float64)
        out["wind_u"], out["wind_v"] = wind_to_uv(out.pop("wind_kmph"), out.pop("wind_dir_deg"))
        return {v: out[v] for v in MODELLED_VARS}


def read_table(src: str | Path | bytes | pd.DataFrame) -> pd.DataFrame:
    if isinstance(src, pd.DataFrame):
        return src.copy()
    if isinstance(src, bytes):
        return pd.read_csv(io.BytesIO(src))
    p = Path(src)
    if p.suffix.lower() == ".json":
        return pd.read_json(p)
    return pd.read_csv(p)


def parse_block_forecast(
    src: str | Path | bytes | pd.DataFrame, region_block_ids: np.ndarray
) -> BlockForecast:
    errors: list[str] = []
    warnings: list[str] = []
    try:
        df = read_table(src)
    except Exception as e:  # noqa: BLE001
        raise ForecastValidationError([f"Could not read file: {e}"]) from e

    df.columns = [str(c).strip().lower() for c in df.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ForecastValidationError([f"Missing columns: {', '.join(missing)}"])
    df = df[REQUIRED_COLUMNS].copy()
    if df.empty:
        raise ForecastValidationError(["File has no rows"])

    df["block_lgd"] = pd.to_numeric(df["block_lgd"], errors="coerce")
    if df["block_lgd"].isna().any():
        errors.append(f"{int(df['block_lgd'].isna().sum())} rows have a non-numeric block_lgd")
    for c in ("issue_date", "valid_date"):
        df[c] = pd.to_datetime(df[c], errors="coerce").dt.normalize()
        if df[c].isna().any():
            errors.append(f"{int(df[c].isna().sum())} rows have an invalid {c} (use YYYY-MM-DD)")
    for v in INPUT_VARS:
        df[v] = pd.to_numeric(df[v], errors="coerce")
        n_bad = int(df[v].isna().sum())
        if n_bad:
            errors.append(f"{v}: {n_bad} missing/non-numeric values")
    if errors:
        raise ForecastValidationError(errors)

    df["block_lgd"] = df["block_lgd"].astype(np.int64)
    issues = df["issue_date"].unique()
    if len(issues) != 1:
        raise ForecastValidationError([f"Expected one issue_date, found {len(issues)}"])
    issue = pd.Timestamp(issues[0])
    df["lead_day"] = (df["valid_date"] - issue).dt.days
    bad_lead = df[(df["lead_day"] < 1) | (df["lead_day"] > MAX_LEAD_DAYS)]
    if len(bad_lead):
        errors.append(f"{len(bad_lead)} rows have valid_date outside issue_date+1..+{MAX_LEAD_DAYS}")

    df.loc[df["wind_dir_deg"] == 360, "wind_dir_deg"] = 0.0
    for v, (lo, hi) in INPUT_RANGES.items():
        bad = df[(df[v] < lo) | (df[v] > hi)]
        if len(bad):
            errors.append(f"{v}: {len(bad)} values outside [{lo}, {hi}]")
    bad_t = df[df["tmin_c"] > df["tmax_c"]]
    if len(bad_t):
        errors.append(f"{len(bad_t)} rows have tmin_c > tmax_c")

    known = set(int(b) for b in region_block_ids)
    present = set(df["block_lgd"].unique())
    extra = present - known
    if extra:
        warnings.append(f"Ignored {len(extra)} blocks not in this region: {sorted(extra)[:10]}")
        df = df[df["block_lgd"].isin(known)]
    absent = known - present
    if absent:
        errors.append(f"Forecast is missing {len(absent)} of the region's blocks: {sorted(absent)[:10]}")

    dup = df.duplicated(["block_lgd", "valid_date"])
    if dup.any():
        errors.append(f"{int(dup.sum())} duplicate (block_lgd, valid_date) rows")
    if errors:
        raise ForecastValidationError(errors)

    dates = pd.DatetimeIndex(sorted(df["valid_date"].unique()))
    counts = df.groupby("block_lgd")["valid_date"].nunique()
    incomplete = counts[counts != len(dates)]
    if len(incomplete):
        raise ForecastValidationError(
            [f"{len(incomplete)} blocks do not have all {len(dates)} valid dates"]
        )

    df = df.sort_values(["valid_date", "block_lgd"]).reset_index(drop=True)
    lead_days = np.array([(d - issue).days for d in dates])
    return BlockForecast(issue, dates, lead_days, df, warnings)
