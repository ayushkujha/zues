"""Weather variable definitions.

Wind is modelled internally as u/v components (km/h) because speed and direction
cannot be averaged or interpolated directly. It is exposed to users as speed and
meteorological direction (the direction the wind blows FROM, clockwise from north).
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class VarSpec:
    name: str
    label: str
    unit: str
    kind: str  # "rain" (multiplicative, zero-inflated) | "additive"
    vmin: float
    vmax: float
    # (p90 - p10) width at or below conf[0] => high confidence, above conf[1] => low
    conf: tuple[float, float]
    lapse: bool = False


MODELLED: dict[str, VarSpec] = {
    v.name: v
    for v in [
        VarSpec("rain_mm", "Rainfall", "mm/day", "rain", 0.0, 600.0, (5.0, 20.0)),
        VarSpec("tmax_c", "Max temperature", "°C", "additive", -10.0, 55.0, (1.5, 3.0), lapse=True),
        VarSpec("tmin_c", "Min temperature", "°C", "additive", -15.0, 45.0, (1.5, 3.0), lapse=True),
        VarSpec("rh_max_pct", "Max relative humidity", "%", "additive", 0.0, 100.0, (8.0, 15.0)),
        VarSpec("rh_min_pct", "Min relative humidity", "%", "additive", 0.0, 100.0, (8.0, 15.0)),
        VarSpec("wind_u", "Wind (east component)", "km/h", "additive", -150.0, 150.0, (4.0, 8.0)),
        VarSpec("wind_v", "Wind (north component)", "km/h", "additive", -150.0, 150.0, (4.0, 8.0)),
        VarSpec("cloud_okta", "Cloud cover", "okta", "additive", 0.0, 8.0, (1.5, 3.0)),
    ]
}
MODELLED_VARS: list[str] = list(MODELLED)

# Variables in the official block forecast and in all user-facing outputs.
OUTPUT_VARS: list[str] = [
    "rain_mm",
    "tmax_c",
    "tmin_c",
    "rh_max_pct",
    "rh_min_pct",
    "wind_kmph",
    "wind_dir_deg",
    "cloud_okta",
]
INPUT_VARS = OUTPUT_VARS

OUTPUT_META: dict[str, dict[str, str]] = {
    "rain_mm": {"label": "Rainfall", "unit": "mm"},
    "tmax_c": {"label": "Max temperature", "unit": "°C"},
    "tmin_c": {"label": "Min temperature", "unit": "°C"},
    "rh_max_pct": {"label": "Max relative humidity", "unit": "%"},
    "rh_min_pct": {"label": "Min relative humidity", "unit": "%"},
    "wind_kmph": {"label": "Wind speed", "unit": "km/h"},
    "wind_dir_deg": {"label": "Wind direction", "unit": "°"},
    "cloud_okta": {"label": "Cloud cover", "unit": "okta"},
}

# Valid ranges for block forecast input validation.
INPUT_RANGES: dict[str, tuple[float, float]] = {
    "rain_mm": (0.0, 600.0),
    "tmax_c": (-10.0, 55.0),
    "tmin_c": (-15.0, 45.0),
    "rh_max_pct": (0.0, 100.0),
    "rh_min_pct": (0.0, 100.0),
    "wind_kmph": (0.0, 200.0),
    "wind_dir_deg": (0.0, 360.0),
    "cloud_okta": (0.0, 8.0),
}

# IMD 24-hour rainfall categories (mm).
RAIN_CATEGORIES: list[tuple[str, float, float]] = [
    ("No rain", 0.0, 0.1),
    ("Very light", 0.1, 2.5),
    ("Light", 2.5, 15.6),
    ("Moderate", 15.6, 64.5),
    ("Heavy", 64.5, 115.6),
    ("Very heavy", 115.6, 204.5),
    ("Extremely heavy", 204.5, float("inf")),
]


def rain_category(mm: float) -> str:
    for name, lo, hi in RAIN_CATEGORIES:
        if lo <= mm < hi:
            return name
    return "No rain"


def wind_to_uv(speed, direction_deg):
    """Meteorological (from-direction) wind to u (east) / v (north) components."""
    rad = np.deg2rad(direction_deg)
    return -speed * np.sin(rad), -speed * np.cos(rad)


def uv_to_wind(u, v):
    speed = np.hypot(u, v)
    direction = np.mod(np.rad2deg(np.arctan2(-u, -v)), 360.0)
    return speed, direction


def confidence_label(width: np.ndarray, conf: tuple[float, float]) -> np.ndarray:
    out = np.full(np.shape(width), "medium", dtype=object)
    w = np.asarray(width, dtype=float)
    out[w <= conf[0]] = "high"
    out[w > conf[1]] = "low"
    out[~np.isfinite(w)] = "medium"
    return out
