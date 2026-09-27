"""Fast unit tests (no region needed)."""

from datetime import date

import numpy as np
import pandas as pd
import pytest

from panchayatcast.advisory.crops import CropSpec
from panchayatcast.advisory.expr import Evaluator, ExprError, parse, render
from panchayatcast.ingest.block_forecast import ForecastValidationError, parse_block_forecast
from panchayatcast.validate.metrics import angular, categorical, continuous
from panchayatcast.variables import rain_category, uv_to_wind, wind_to_uv

# ---- variables ---------------------------------------------------------------


@pytest.mark.parametrize("direction", [0, 45, 90, 180, 270, 359])
def test_wind_roundtrip(direction):
    u, v = wind_to_uv(10.0, direction)
    s, d = uv_to_wind(u, v)
    assert s == pytest.approx(10.0)
    assert (d - direction + 180) % 360 - 180 == pytest.approx(0, abs=1e-9)


def test_wind_from_west_blows_east():
    u, v = wind_to_uv(10.0, 270)
    assert u == pytest.approx(10.0) and v == pytest.approx(0, abs=1e-9)


@pytest.mark.parametrize("mm,cat", [(0, "No rain"), (2.4, "Very light"), (2.5, "Light"),
                                    (64.4, "Moderate"), (64.5, "Heavy"), (250, "Extremely heavy")])
def test_rain_category(mm, cat):
    assert rain_category(mm) == cat


# ---- advisory expressions --------------------------------------------------------


def _ev():
    dates = [date(2024, 7, d) for d in range(11, 16)]
    return Evaluator({"rain_mm": [0, 12, 70, 1, 0], "tmax_c": [30, 31, 36, 38, 33]}, dates,
                     {"stage": "flowering"})


def test_expr_basic_and_inclusive_slices():
    ev = _ev()
    assert ev.eval("rain_mm[d2]") == 12
    assert ev.eval("sum(rain_mm[d1:d3])") == 82  # d1:d3 includes d3
    assert ev.truthy("max(rain_mm[d1:d3]) >= 64.5")
    assert ev.truthy("30 <= mean(tmax_c[d1:d2]) <= 31")
    assert ev.truthy("stage in ['flowering', 'maturity']")
    assert ev.truthy("any(rain_mm[d1:d5] > 50) and not all(rain_mm > 0)")


def test_expr_date_functions():
    ev = _ev()
    assert ev.eval("date_of_max(rain_mm, d1, d3)") == "13 Jul"
    assert ev.eval("first_date_below(rain_mm, 2.5, d2, d5)") == "14 Jul"


@pytest.mark.parametrize("bad", [
    "__import__('os')", "rain_mm.__class__", "open('x')", "(lambda: 1)()",
    "[x for x in rain_mm]", "rain_mm[d1] if True else 0",
])
def test_expr_rejects_unsafe(bad):
    with pytest.raises(ExprError):
        parse(bad)


def test_expr_unknown_name_and_out_of_range_day():
    ev = _ev()
    with pytest.raises(ExprError):
        ev.eval("humidity[d1] > 3")
    with pytest.raises(ExprError):
        ev.eval("rain_mm[d9]")


def test_render_blocks_attribute_access():
    assert render("{x:.0f} mm", {"x": 12.4}) == "12 mm"
    with pytest.raises(ExprError):
        render("{x.__class__}", {"x": 1})


# ---- crop calendar ---------------------------------------------------------------


def test_crop_stage_across_year_boundary():
    c = CropSpec("chickpea", "Chickpea", "rabi", "10-20",
                 (("sowing", 15), ("vegetative", 35), ("flowering", 30), ("maturity", 30)))
    assert c.stage_on(date(2024, 10, 25)) == "sowing"
    assert c.stage_on(date(2024, 12, 20)) == "flowering"
    assert c.stage_on(date(2025, 1, 20)) == "maturity"
    assert c.stage_on(date(2025, 3, 1)) is None


# ---- metrics ---------------------------------------------------------------------


def test_continuous_metrics_ignore_nan():
    s = continuous([1, 2, 3, np.nan], [1, 2, 5, 4])
    assert s["n"] == 3
    assert s["bias"] == pytest.approx(-2 / 3)
    assert s["rmse"] == pytest.approx(np.sqrt(4 / 3))


def test_categorical_metrics():
    c = categorical([10, 10, 0, 0], [10, 0, 10, 0], threshold=5)
    assert (c["pod"], c["far"], c["csi"]) == (0.5, 0.5, pytest.approx(1 / 3))


def test_angular_wraps():
    assert angular([355], [5])["mae"] == pytest.approx(10)


# ---- block forecast validation ---------------------------------------------------------


def _forecast(blocks=(1, 2), days=3):
    rows = []
    for b in blocks:
        for d in range(1, days + 1):
            rows.append(dict(block_lgd=b, issue_date="2024-07-10",
                             valid_date=str(pd.Timestamp("2024-07-10") + pd.Timedelta(days=d))[:10],
                             rain_mm=5, tmax_c=30, tmin_c=21, rh_max_pct=90, rh_min_pct=60,
                             wind_kmph=10, wind_dir_deg=270, cloud_okta=6))
    return pd.DataFrame(rows)


def test_block_forecast_valid():
    fc = parse_block_forecast(_forecast(), np.array([1, 2]))
    assert list(fc.lead_days) == [1, 2, 3]
    blk = fc.to_blk(np.array([1, 2]))
    assert blk["rain_mm"].shape == (3, 2)
    assert blk["wind_u"][0, 0] == pytest.approx(10)  # westerly -> positive u


def test_block_forecast_missing_block_and_bad_values():
    df = _forecast(blocks=(1,))
    df.loc[0, "rh_max_pct"] = 140
    with pytest.raises(ForecastValidationError) as e:
        parse_block_forecast(df, np.array([1, 2]))
    msg = " ".join(e.value.errors)
    assert "rh_max_pct" in msg and "missing 1 of the region's blocks" in msg


def test_block_forecast_ignores_extra_blocks():
    fc = parse_block_forecast(_forecast(blocks=(1, 2, 3)), np.array([1, 2]))
    assert fc.warnings and set(fc.table["block_lgd"]) == {1, 2}


def test_block_forecast_missing_columns():
    with pytest.raises(ForecastValidationError):
        parse_block_forecast(_forecast().drop(columns=["tmin_c"]), np.array([1, 2]))
