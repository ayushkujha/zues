"""Shared fixtures: a tiny synthetic region, built once per test session in a temp dir."""

from __future__ import annotations

import os
import shutil
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def project(tmp_path_factory) -> Path:
    """A throwaway project root (configs copied from the repo) set as PCAST_ROOT."""
    root = tmp_path_factory.mktemp("pcast")
    shutil.copytree(REPO / "configs", root / "configs")
    (root / "pyproject.toml").write_text("[project]\nname='t'\n")
    region = {
        "region_id": "tiny",
        "name": "Tiny Test District",
        "source": "synthetic",
        "bbox": [75.0, 15.0, 75.25, 15.25],
        "grid_res_deg": 0.01,
        "splits": {
            "train": ["2022-01-01", "2022-12-31"],
            "val": ["2023-01-01", "2023-06-30"],
            "test": ["2023-07-01", "2023-12-31"],
        },
        "languages": ["en", "hi", "kn"],
        "crop_calendar": "configs/crop_calendar/demo.yaml",
        "synthetic": {"seed": 3, "n_blocks": 3, "n_gps": 18, "n_stations": 8,
                      "start_date": "2022-01-01", "end_date": "2023-12-31"},
    }
    (root / "configs" / "region.tiny.yaml").write_text(yaml.safe_dump(region))
    models = yaml.safe_load((root / "configs" / "models.yaml").read_text())
    models["training"].update(train_rows=15000, val_rows=4000)
    models["rounds"] = {"mean": 60, "quantile": 30, "early_stopping": 10}
    (root / "configs" / "models.yaml").write_text(yaml.safe_dump(models))
    old = os.environ.get("PCAST_ROOT")
    os.environ["PCAST_ROOT"] = str(root)
    yield root
    if old is None:
        os.environ.pop("PCAST_ROOT", None)
    else:
        os.environ["PCAST_ROOT"] = old


@pytest.fixture(scope="session")
def tiny_region(project) -> str:
    from panchayatcast.config import RegionConfig
    from panchayatcast.ingest.synthetic import generate

    generate(RegionConfig.from_yaml(project / "configs" / "region.tiny.yaml"), log=lambda *a: None)
    return "tiny"


@pytest.fixture(scope="session")
def trained(tiny_region) -> str:
    from panchayatcast.models.train import train_region

    return train_region(tiny_region, log=lambda *a: None)


@pytest.fixture(scope="session")
def repo(project):
    from panchayatcast.storage.db import Repository

    return Repository(f"sqlite:///{(project / 'test.db').as_posix()}")


@pytest.fixture(scope="session")
def forecast_run(trained, repo):
    from panchayatcast.pipeline import emulate_block_forecast, run_forecast

    df = emulate_block_forecast("tiny", "2023-07-10", seed=2)
    return run_forecast("tiny", df, source="emulated", repo=repo), df
