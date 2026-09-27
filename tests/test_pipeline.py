"""End-to-end tests on a tiny synthetic region (built once per session)."""

import numpy as np
import pandas as pd
import pytest

from panchayatcast.variables import MODELLED_VARS


def test_weights_are_normalised(tiny_region):
    from panchayatcast.features.dataset import RegionContext

    w = RegionContext.load(tiny_region).weights
    assert np.allclose(np.asarray(w.W_gp.sum(axis=1)).ravel(), 1)
    assert np.allclose(np.asarray(w.W_block.sum(axis=1)).ravel(), 1)
    assert np.allclose(w.idw.sum(axis=1), 1)
    assert w.n_gp == 18 and w.n_block == 3


def test_models_predict_all_variables(trained):
    from panchayatcast.config import ModelConfig
    from panchayatcast.downscale.engine import downscale
    from panchayatcast.features.dataset import RegionContext
    from panchayatcast.models.registry import ModelBundle
    from panchayatcast.store import RegionStore

    ctx = RegionContext.load("tiny")
    bundle = ModelBundle.load(ctx)
    assert {"M0", "M1", "M2", "M3"} <= set(bundle.models)  # + M3S when there are enough stations
    store = RegionStore("tiny")
    dates = pd.date_range("2023-07-01", periods=4)
    blk = {v: ctx.block_means(store.load_fine_active(v, ctx.weights, "2023-07-01", "2023-07-04")[1])
           for v in MODELLED_VARS}
    cfg = ModelConfig.load()
    for m in bundle.models:
        pred = downscale(ctx, bundle, blk, dates, m, cfg)
        for v in MODELLED_VARS:
            assert pred[v].value.shape == (4, ctx.n_active)
            assert np.isfinite(pred[v].value).all()
        # Block consistency: block means of the downscaled field reproduce the input.
        for v in ("tmax_c", "tmin_c", "rain_mm"):
            back = ctx.block_means(pred[v].value)
            assert np.allclose(back, blk[v], atol=0.15 if v != "rain_mm" else 0.5), (m, v)
        assert (pred["rain_mm"].value >= 0).all()
        assert (pred["tmax_c"].value >= pred["tmin_c"].value).all()


def test_forecast_run_outputs(forecast_run, repo):
    res, block_df = forecast_run
    run = repo.get_run(res.run_id)
    assert run["status"] == "done" and run["model_id"] == "M3"
    gp = repo.gp_forecasts(res.run_id)
    assert len(gp) == 18 * 5 * 8
    assert gp["value"].notna().all()
    rh = gp[gp.variable.isin(["rh_max_pct", "rh_min_pct"])]["value"]
    assert rh.between(0, 100).all()

    # GP values average back (area-weighted) to the block forecast.
    from panchayatcast.features.dataset import RegionContext

    ctx = RegionContext.load("tiny")
    t = gp[gp.variable == "tmax_c"].merge(ctx.panchayats[["gp_lgd", "block_lgd", "area_km2"]])
    wmean = t.groupby(["block_lgd", "valid_date"]).apply(
        lambda g: np.average(g["value"], weights=g["area_km2"]), include_groups=False)
    ref = block_df.assign(valid_date=pd.to_datetime(block_df.valid_date).dt.date).set_index(
        ["block_lgd", "valid_date"])["tmax_c"]
    assert np.allclose(wmean.sort_index().values, ref.sort_index().values, atol=0.2)


def test_advisories_generated_and_translated(forecast_run, repo):
    res, _ = forecast_run
    items = repo.list_advisories(res.run_id)
    assert len(items) == res.n_advisories > 0
    a = items[0]
    assert a["severity"] in {"green", "yellow", "orange", "red"}
    assert "{" not in a["text_en"]
    assert set(a["text_local"]) == {"hi", "kn"}


def test_evaluate_and_report(trained, repo):
    from panchayatcast.store import RegionStore
    from panchayatcast.validate.evaluate import evaluate_region
    from panchayatcast.validate.report import write_report

    df = evaluate_region("tiny", repo=repo, log=lambda *a: None)
    rm = df[(df.metric == "rmse") & (df.level == "gp") & (df.variable == "tmax_c")]
    by = dict(zip(rm.model_id, rm.value))
    assert by["M3"] < by["M0"]  # the learned model must beat copying the block value
    out = write_report("tiny", trained, df, RegionStore("tiny").meta)
    assert (out / "summary.md").exists() and (out / "skill_vs_copy.png").exists()


def test_exports(forecast_run, repo):
    from panchayatcast.exports.bulletin import bulletin_pdf
    from panchayatcast.exports.raster import geotiff_bytes
    from panchayatcast.exports.tabular import gp_forecast_wide, gp_geojson
    from panchayatcast.features.dataset import RegionContext

    res, df = forecast_run
    ctx = RegionContext.load("tiny")
    wide = gp_forecast_wide(ctx, repo, res.run_id)
    assert len(wide) == 18 * 5 and "rain_mm_p90" in wide
    fc = gp_geojson(ctx, repo, res.run_id)
    assert len(fc["features"]) == 18 and "d1_rain_mm" in fc["features"][0]["properties"]
    assert bulletin_pdf(ctx, repo, res.run_id)[:4] == b"%PDF"
    tif = geotiff_bytes(res.run_id, "tmax_c", str(df.valid_date.iloc[0]))
    assert tif[:2] in (b"II", b"MM")


@pytest.fixture(scope="module")
def client(forecast_run, repo):
    from fastapi.testclient import TestClient

    from panchayatcast.api.app import create_app

    return TestClient(create_app(repo))


def test_api_read_endpoints(client, forecast_run):
    res, df = forecast_run
    base = "/api/v1"
    assert client.get(f"{base}/health").json()["status"] == "ok"
    regions = client.get(f"{base}/regions").json()
    assert any(r["region_id"] == "tiny" for r in regions)
    assert len(client.get(f"{base}/regions/tiny/panchayats").json()["features"]) == 18

    m = client.get(f"{base}/runs/{res.run_id}/map", params={"variable": "rain_mm"}).json()
    assert len(m["features"]) == 18 and "block_value" in m["features"][0]["properties"]

    gp = int(m["features"][0]["properties"]["gp_lgd"])
    f = client.get(f"{base}/runs/{res.run_id}/panchayats/{gp}/forecast").json()
    assert len(f["days"]) == 5 and "block" in f["days"][0]["tmax_c"]

    adv = client.get(f"{base}/runs/{res.run_id}/advisories", params={"lang": "hi"}).json()
    assert adv and adv[0]["lang"] == "hi" and adv[0]["machine_translated"] is True

    assert client.get(f"{base}/runs/{res.run_id}/export.csv").status_code == 200
    assert client.get(f"{base}/runs/{res.run_id}/bulletin.pdf").content[:4] == b"%PDF"
    assert client.get(f"{base}/runs/{res.run_id}/compare").status_code == 200
    assert client.get(f"{base}/runs/unknown").status_code == 404


def test_api_edit_advisory_and_upload(client, forecast_run):
    res, df = forecast_run
    base = "/api/v1"
    adv = client.get(f"{base}/runs/{res.run_id}/advisories").json()[0]
    r = client.patch(f"{base}/advisories/{adv['advisory_id']}",
                     json={"status": "approved", "edited_by": "tester"})
    assert r.status_code == 200 and r.json()["status"] == "approved"

    bad = df.drop(columns=["tmin_c"]).to_csv(index=False).encode()
    r = client.post(f"{base}/regions/tiny/runs", files={"file": ("f.csv", bad, "text/csv")})
    assert r.status_code == 422

    good = df.to_csv(index=False).encode()
    r = client.post(f"{base}/regions/tiny/runs", files={"file": ("f.csv", good, "text/csv")})
    assert r.status_code == 202
    run_id = r.json()["run_id"]
    assert client.get(f"{base}/runs/{run_id}").json()["status"] == "done"  # TestClient runs tasks
