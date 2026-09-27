"""Post-processing of cell predictions: block consistency and physical limits.

Block consistency makes the area-weighted mean of the downscaled field over each
block equal the official block forecast, so PanchayatCast refines the official
forecast instead of contradicting it:

  additive vars  shift every cell of the block by the same amount
  rain           scale down if the block total is too high; if too low, scale up
                 (capped at rain_max_scale) and spread any remaining deficit evenly
"""

from __future__ import annotations

import numpy as np

from ..config import ModelConfig
from ..features.dataset import RegionContext
from ..models.base import Prediction
from ..variables import MODELLED


def enforce_consistency(
    ctx: RegionContext, pred: Prediction, blk: dict[str, np.ndarray], cfg: ModelConfig
) -> None:
    cc = cfg.consistency
    iters = int(cc.get("iterations", 3))
    max_scale = float(cc.get("rain_max_scale", 3.0))
    strict = cc.get("rain_mode", "strict") == "strict"
    wet = cfg.wet_threshold
    cb = ctx.weights.cell_block

    for var, vp in pred.items():
        target = blk[var]
        spec = MODELLED[var]
        for _ in range(iters):
            means = ctx.block_means(vp.value)
            if spec.kind == "rain":
                with np.errstate(divide="ignore", invalid="ignore"):
                    scale = np.where(means > 1e-9, target / means, 1.0)
                scale = np.minimum(scale, max_scale)
                deficit = np.maximum(target - means * scale, 0.0)
                if not strict:
                    dry = target < wet
                    scale = np.where(dry, 1.0, scale)
                    deficit = np.where(dry, 0.0, deficit)
                s, add = scale[:, cb], deficit[:, cb]
                vp.value = vp.value * s + add
                if vp.p10 is not None:
                    vp.p10 = vp.p10 * s + add
                if vp.p90 is not None:
                    vp.p90 = vp.p90 * s + add
                if strict:
                    dry_cells = (target < wet)[:, cb]
                    vp.value[dry_cells] = 0.0
                    if vp.p10 is not None:
                        vp.p10[dry_cells] = 0.0
                    if vp.p90 is not None:
                        vp.p90[dry_cells] = 0.0
            else:
                delta = (means - target)[:, cb]
                vp.value = vp.value - delta
                if vp.p10 is not None:
                    vp.p10 = vp.p10 - delta
                if vp.p90 is not None:
                    vp.p90 = vp.p90 - delta


def apply_limits(pred: Prediction) -> None:
    _clip(pred)
    _order(pred, "tmin_c", "tmax_c", gap=0.5)
    _order(pred, "rh_min_pct", "rh_max_pct", gap=1.0)
    _clip(pred)  # ordering can nudge values just past a physical bound (e.g. RH 100.5%)


def _clip(pred: Prediction) -> None:
    for var, vp in pred.items():
        spec = MODELLED[var]
        vp.value = np.clip(vp.value, spec.vmin, spec.vmax)
        if vp.p10 is not None:
            vp.p10 = np.clip(vp.p10, spec.vmin, spec.vmax)
        if vp.p90 is not None:
            vp.p90 = np.clip(vp.p90, spec.vmin, spec.vmax)


def _order(pred: Prediction, lo_var: str, hi_var: str, gap: float) -> None:
    if lo_var not in pred or hi_var not in pred:
        return
    lo, hi = pred[lo_var].value, pred[hi_var].value
    bad = lo > hi - gap
    if bad.any():
        mid = (lo + hi) / 2
        pred[lo_var].value = np.where(bad, mid - gap / 2, lo)
        pred[hi_var].value = np.where(bad, mid + gap / 2, hi)


def postprocess(
    ctx: RegionContext,
    pred: Prediction,
    blk: dict[str, np.ndarray],
    cfg: ModelConfig,
    consistency: bool | None = None,
) -> Prediction:
    out = {v: p.copy() for v, p in pred.items()}
    if consistency is None:
        consistency = bool(cfg.consistency.get("enabled", True))
    if consistency:
        enforce_consistency(ctx, out, blk, cfg)
    apply_limits(out)
    return out
