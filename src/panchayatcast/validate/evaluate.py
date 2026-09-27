"""Evaluate downscaling models on held-out data.

Four evaluations (the `split` column in the results):

  test        Held-out period, perfect block forecast: block inputs are the true block
              means, so scores isolate the DOWNSCALING error.
  forecast    Held-out period, block inputs carry realistic forecast error growing with
              lead day (1-5): does downscaling still help with an imperfect forecast?
  spatial_cv  Blocks are split into folds; M3 is retrained without the held-out blocks
              AND without per-cell climatology, then scored only there: does the model
              work in places it has never seen?
  station_cv  M3 vs M3S at stations held out from fitting the station correction.

Truths: station observations (at the station's grid cell) and panchayat area-means of
the fine field.
"""

from __future__ import annotations

import copy

import numpy as np
import pandas as pd

from ..config import ModelConfig
from ..downscale.engine import downscale
from ..downscale.postprocess import postprocess
from ..features.dataset import RegionContext, split_mask
from ..models.gbm import train_gbm_and_lapse
from ..models.registry import MODEL_IDS, ModelBundle
from ..models.station import (
    STATION_VARS,
    fit_station_correction,
    station_table,
)
from ..models.train import block_fields
from ..pipeline import add_forecast_error
from ..storage.db import Repository
from ..store import RegionStore
from ..variables import MODELLED_VARS, OUTPUT_VARS, uv_to_wind
from .metrics import RAIN_THRESHOLDS, angular, categorical, continuous


def _outputs(m: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    out = {v: m[v] for v in OUTPUT_VARS if v in m}
    if "wind_u" in m and "wind_v" in m:
        out["wind_kmph"], out["wind_dir_deg"] = uv_to_wind(m["wind_u"], m["wind_v"])
    return out


def _score_rows(model_id: str, level: str, pred: dict, truth: dict, lead: int | None = None,
                mask: np.ndarray | None = None) -> list[dict]:
    """Metric rows for one model at one level. `mask` selects columns (GPs / stations)."""
    rows = []
    for var in OUTPUT_VARS:
        if var not in truth or var not in pred:
            continue
        p, t = pred[var], truth[var]
        if mask is not None:
            p, t = p[:, mask], t[:, mask]
        base = dict(model_id=model_id, variable=var, level=level, threshold=np.nan, lead_day=lead)
        if var == "wind_dir_deg":
            s = angular(p, t)
            rows.append({**base, "metric": "mae", "value": s["mae"], "n": s["n"]})
            continue
        s = continuous(p, t)
        for k in ("rmse", "mae", "bias", "r"):
            rows.append({**base, "metric": k, "value": s[k], "n": s["n"]})
        if var == "rain_mm":
            for thr in RAIN_THRESHOLDS:
                c = categorical(p, t, thr)
                for k in ("pod", "far", "csi", "hss"):
                    rows.append({**base, "metric": k, "threshold": thr, "value": c[k], "n": c["n"]})
    return rows


def _skill_rows(df: pd.DataFrame, reference: str = "M0") -> pd.DataFrame:
    """RMSE skill relative to the reference model: 1 - rmse_model / rmse_ref."""
    rm = df[df["metric"] == "rmse"].assign(lead_key=lambda d: d["lead_day"].fillna(-1).astype(int))
    ref = rm[rm["model_id"] == reference].set_index(["variable", "level", "lead_key"])["value"]
    out = []
    for r in rm.itertuples(index=False):
        b = ref.get((r.variable, r.level, r.lead_key))
        if b is None or not np.isfinite(b) or b == 0:
            continue
        out.append(dict(model_id=r.model_id, variable=r.variable, level=r.level, metric=f"skill_vs_{reference}",
                        threshold=np.nan, lead_day=r.lead_day, value=1 - r.value / b, n=r.n))
    return pd.DataFrame(out)


class _Truth:
    """Held-out truths: panchayat means and station observations for a set of days."""

    def __init__(self, ctx: RegionContext, store: RegionStore, days: pd.DatetimeIndex,
                 fine: dict[str, np.ndarray]):
        self.gp = _outputs({v: ctx.gp_means(fine[v]) for v in MODELLED_VARS})
        stations, self.st_cells = station_table(ctx, store)
        self.stations = stations
        self.st: dict[str, np.ndarray] = {}
        if len(stations):
            obs = store.observations()
            obs = obs[(obs["date"] >= days[0]) & (obs["date"] <= days[-1])]
            for var, g in obs.groupby("variable"):
                wide = g.pivot_table(index="date", columns="station_id", values="value")
                self.st[var] = wide.reindex(index=days, columns=stations["station_id"]).to_numpy()

    def score(self, ctx, cells: dict[str, np.ndarray], model_id: str, lead: int | None = None,
              gp_mask=None, st_mask=None) -> list[dict]:
        rows = _score_rows(model_id, "gp", _outputs({v: ctx.gp_means(cells[v]) for v in MODELLED_VARS}),
                           self.gp, lead, gp_mask)
        if self.st:
            pred_st = _outputs({v: cells[v][:, self.st_cells] for v in MODELLED_VARS})
            rows += _score_rows(model_id, "station", pred_st, self.st, lead, st_mask)
        return rows


def _load_split(ctx, store, split: str):
    all_dates = store.fine_dates()
    sel = split_mask(all_dates, tuple(ctx.meta["splits"][split]))
    if not sel.any():
        raise ValueError(f"No days in split '{split}'")
    days = all_dates[sel]
    start, end = str(days[0].date()), str(days[-1].date())
    fine = {v: store.load_fine_active(v, ctx.weights, start, end)[1] for v in MODELLED_VARS}
    return days, fine


def _predict_cells(ctx, bundle, blk, days, model_id, cfg, chunk_days=61) -> dict[str, np.ndarray]:
    cells = {v: [] for v in MODELLED_VARS}
    for i in range(0, len(days), chunk_days):
        sl = slice(i, i + chunk_days)
        pred = downscale(ctx, bundle, {v: blk[v][sl] for v in MODELLED_VARS}, days[sl], model_id, cfg)
        for v in MODELLED_VARS:
            cells[v].append(pred[v].value)
    return {v: np.concatenate(a) for v, a in cells.items()}


# ---------------------------------------------------------------------------
# 1. Perfect block forecast on the test period
# ---------------------------------------------------------------------------


def evaluate_region(region_id: str, split: str = "test", models: list[str] | None = None,
                    version: str | None = None, cfg: ModelConfig | None = None,
                    repo: Repository | None = None, log=print) -> pd.DataFrame:
    cfg = cfg or ModelConfig.load()
    ctx, store = RegionContext.load(region_id), RegionStore(region_id)
    bundle = ModelBundle.load(ctx, version)
    models = [m for m in (models or MODEL_IDS) if m in bundle.models]
    days, fine = _load_split(ctx, store, split)
    log(f"[eval:{split}] {days[0].date()}..{days[-1].date()} ({len(days)} days), models={models}")
    blk = {v: ctx.block_means(fine[v]) for v in MODELLED_VARS}
    truth = _Truth(ctx, store, days, fine)
    del fine
    rows: list[dict] = []
    for m in models:
        rows += truth.score(ctx, _predict_cells(ctx, bundle, blk, days, m, cfg), m)
        log(f"[eval:{split}] scored {m}")
    df = pd.DataFrame(rows)
    df = pd.concat([df, _skill_rows(df)], ignore_index=True)
    (repo or Repository()).replace_metrics(region_id, bundle.version, split, df)
    return df


# ---------------------------------------------------------------------------
# 2. Forecast mode: block inputs with lead-dependent error
# ---------------------------------------------------------------------------


def evaluate_forecast_mode(region_id: str, leads=(1, 2, 3, 4, 5), models: list[str] | None = None,
                           version: str | None = None, cfg: ModelConfig | None = None,
                           repo: Repository | None = None, seed: int = 11, log=print) -> pd.DataFrame:
    cfg = cfg or ModelConfig.load()
    ctx, store = RegionContext.load(region_id), RegionStore(region_id)
    bundle = ModelBundle.load(ctx, version)
    models = [m for m in (models or ["M0", "M1", "M2", "M3"]) if m in bundle.models]
    days, fine = _load_split(ctx, store, "test")
    blk_true = {v: ctx.block_means(fine[v]) for v in MODELLED_VARS}
    truth = _Truth(ctx, store, days, fine)
    del fine
    rng = np.random.default_rng(seed)
    rows: list[dict] = []
    for lead in leads:
        blk = add_forecast_error(blk_true, np.full(len(days), lead), rng)
        for m in models:
            rows += truth.score(ctx, _predict_cells(ctx, bundle, blk, days, m, cfg), m, lead=lead)
        log(f"[eval:forecast] lead day {lead} scored")
    df = pd.DataFrame(rows)
    df = pd.concat([df, _skill_rows(df)], ignore_index=True)
    (repo or Repository()).replace_metrics(region_id, bundle.version, "forecast", df)
    return df


# ---------------------------------------------------------------------------
# 3. Spatial cross-validation over blocks (no local history)
# ---------------------------------------------------------------------------


def evaluate_spatial_cv(region_id: str, folds: int = 4, version: str | None = None,
                        cfg: ModelConfig | None = None, repo: Repository | None = None,
                        train_rows: int = 80_000, log=print) -> pd.DataFrame:
    base_cfg = cfg or ModelConfig.load()
    cfg = copy.deepcopy(base_cfg)
    cfg.raw.setdefault("training", {})["train_rows"] = train_rows
    cfg.raw["training"]["val_rows"] = train_rows // 5
    cfg.raw["rounds"] = {"mean": 300, "quantile": 100, "early_stopping": 25}
    for k in ("training", "rounds"):
        cfg.__dict__.pop(k, None)  # reset cached_property values

    ctx, store = RegionContext.load(region_id), RegionStore(region_id)
    bundle = ModelBundle.load(ctx, version)
    n_block = ctx.n_block
    folds = max(2, min(folds, n_block))
    rng = np.random.default_rng(base_cfg.seed)
    fold_of_block = rng.permutation(n_block) % folds
    cell_fold = fold_of_block[ctx.weights.cell_block]
    gp_fold = fold_of_block[ctx.weights.gp_block_idx]

    all_dates = store.fine_dates()
    blk_all = block_fields(ctx, store)
    days, fine = _load_split(ctx, store, "test")
    test_sel = split_mask(all_dates, tuple(ctx.meta["splits"]["test"]))
    blk_test = {v: blk_all[v][test_sel] for v in MODELLED_VARS}
    truth = _Truth(ctx, store, days, fine)
    del fine
    st_fold = cell_fold[truth.st_cells] if len(truth.st_cells) else np.array([], int)

    cv_cells = {v: np.full((len(days), ctx.n_active), np.nan) for v in MODELLED_VARS}
    for f in range(folds):
        log(f"[eval:spatial_cv] fold {f + 1}/{folds}: training without "
            f"{int((fold_of_block == f).sum())} block(s) and without climatology")
        gbm, _ = train_gbm_and_lapse(ctx, store, blk_all, all_dates, cfg, log=lambda *a: None,
                                     train_cells=np.where(cell_fold != f)[0], use_clim=False,
                                     with_quantiles=False)
        preds = {v: [] for v in MODELLED_VARS}
        for i in range(0, len(days), 61):
            sl = slice(i, i + 61)
            b = {v: blk_test[v][sl] for v in MODELLED_VARS}
            p = postprocess(ctx, gbm.predict(ctx, b, days[sl]), b, cfg)
            for v in MODELLED_VARS:
                preds[v].append(p[v].value)
        held = cell_fold == f
        for v in MODELLED_VARS:
            cv_cells[v][:, held] = np.concatenate(preds[v])[:, held]

    rows: list[dict] = []
    rows += truth.score(ctx, cv_cells, "M3")
    for m in ("M0", "M1", "M2"):
        rows += truth.score(ctx, _predict_cells(ctx, bundle, blk_test, days, m, base_cfg), m)
    df = pd.DataFrame(rows)
    df = pd.concat([df, _skill_rows(df)], ignore_index=True)
    (repo or Repository()).replace_metrics(region_id, bundle.version, "spatial_cv", df)
    log(f"[eval:spatial_cv] done ({len(gp_fold)} panchayats, {len(st_fold)} stations scored out-of-fold)")
    return df


# ---------------------------------------------------------------------------
# 4. Station correction: leave-stations-out on the test period
# ---------------------------------------------------------------------------


def evaluate_station_cv(region_id: str, folds: int = 5, version: str | None = None,
                        cfg: ModelConfig | None = None, repo: Repository | None = None,
                        log=print) -> pd.DataFrame:
    cfg = cfg or ModelConfig.load()
    ctx, store = RegionContext.load(region_id), RegionStore(region_id)
    bundle = ModelBundle.load(ctx, version)
    if "M3" not in bundle.models:
        raise ValueError("Train the region first (M3 is required).")
    stations, st_cells = station_table(ctx, store)
    if len(stations) < 8:
        log("[eval:station_cv] fewer than 8 stations; skipped")
        return pd.DataFrame()
    all_dates = store.fine_dates()
    blk_all = block_fields(ctx, store)
    train_mask = split_mask(all_dates, tuple(ctx.meta["splits"]["train"]))
    days, fine = _load_split(ctx, store, "test")
    test_sel = split_mask(all_dates, tuple(ctx.meta["splits"]["test"]))
    blk_test = {v: blk_all[v][test_sel] for v in MODELLED_VARS}
    truth = _Truth(ctx, store, days, fine)
    del fine

    m3 = bundle.get("M3")
    base_cells = _predict_cells(ctx, bundle, blk_test, days, "M3", cfg)
    rng = np.random.default_rng(cfg.seed)
    fold_of = rng.permutation(len(stations)) % folds
    corrected = {v: base_cells[v][:, st_cells].copy() for v in MODELLED_VARS}
    D = len(days)
    for f in range(folds):
        corr = fit_station_correction(ctx, store, m3, blk_all, all_dates, train_mask,
                                      station_subset=np.where(fold_of != f)[0], seed=cfg.seed,
                                      log=lambda *a: None)
        if corr is None:
            continue
        held = np.where(fold_of == f)[0]
        # Only the held-out stations' cells are needed: correct M3 there directly.
        d_idx = np.repeat(np.arange(D), len(held))
        c_idx = np.tile(st_cells[held], D)
        for v in STATION_VARS:
            base_val = base_cells[v][d_idx, c_idx]
            delta = corr.delta(ctx, blk_test, days, d_idx, c_idx, v, base_val)
            corrected[v][:, held] = (base_val + delta).reshape(D, len(held))
        log(f"[eval:station_cv] fold {f + 1}/{folds}")

    rows = []
    base_st = _outputs({v: base_cells[v][:, st_cells] for v in MODELLED_VARS})
    corr_st = _outputs(corrected)
    rows += _score_rows("M3", "station", {v: base_st[v] for v in STATION_VARS}, truth.st)
    rows += _score_rows("M3S", "station", {v: corr_st[v] for v in STATION_VARS}, truth.st)
    df = pd.DataFrame(rows)
    df = pd.concat([df, _skill_rows(df, reference="M3")], ignore_index=True)
    (repo or Repository()).replace_metrics(region_id, bundle.version, "station_cv", df)
    return df
