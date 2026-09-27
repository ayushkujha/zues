"""Verification metrics (continuous, categorical and circular)."""

from __future__ import annotations

import numpy as np

RAIN_THRESHOLDS = (2.5, 15.6, 64.5)  # IMD light / moderate / heavy boundaries (mm)


def _pair(pred, obs) -> tuple[np.ndarray, np.ndarray]:
    p, o = np.asarray(pred, dtype=float).ravel(), np.asarray(obs, dtype=float).ravel()
    ok = np.isfinite(p) & np.isfinite(o)
    return p[ok], o[ok]


def continuous(pred, obs) -> dict[str, float]:
    p, o = _pair(pred, obs)
    n = len(p)
    if n == 0:
        return {"rmse": np.nan, "mae": np.nan, "bias": np.nan, "r": np.nan, "n": 0}
    e = p - o
    r = np.corrcoef(p, o)[0, 1] if n > 2 and p.std() > 0 and o.std() > 0 else np.nan
    return {
        "rmse": float(np.sqrt(np.mean(e**2))),
        "mae": float(np.mean(np.abs(e))),
        "bias": float(np.mean(e)),
        "r": float(r),
        "n": n,
    }


def categorical(pred, obs, threshold: float) -> dict[str, float]:
    """Contingency scores for the event value >= threshold."""
    p, o = _pair(pred, obs)
    pe, oe = p >= threshold, o >= threshold
    hits = float(np.sum(pe & oe))
    fa = float(np.sum(pe & ~oe))
    miss = float(np.sum(~pe & oe))
    cn = float(np.sum(~pe & ~oe))
    n = hits + fa + miss + cn
    pod = hits / (hits + miss) if hits + miss else np.nan
    far = fa / (hits + fa) if hits + fa else np.nan
    csi = hits / (hits + fa + miss) if hits + fa + miss else np.nan
    expected = ((hits + miss) * (hits + fa) + (cn + miss) * (cn + fa)) / n if n else np.nan
    denom = n - expected if n else np.nan
    hss = (hits + cn - expected) / denom if n and denom else np.nan
    return {"pod": pod, "far": far, "csi": csi, "hss": hss, "n": int(n)}


def angular(pred_deg, obs_deg) -> dict[str, float]:
    p, o = _pair(pred_deg, obs_deg)
    if len(p) == 0:
        return {"mae": np.nan, "n": 0}
    d = np.abs((p - o + 180.0) % 360.0 - 180.0)
    return {"mae": float(np.mean(d)), "n": int(len(p))}
