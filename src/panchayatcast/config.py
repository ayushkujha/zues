"""Project paths and configuration loading."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any

import yaml


def project_root() -> Path:
    """Repo root: $PCAST_ROOT, else the nearest parent of cwd that has configs/ + pyproject.toml."""
    env = os.environ.get("PCAST_ROOT")
    if env:
        return Path(env).resolve()
    cwd = Path.cwd().resolve()
    for p in (cwd, *cwd.parents):
        if (p / "configs").is_dir() and (p / "pyproject.toml").exists():
            return p
    return cwd


@dataclass(frozen=True)
class Paths:
    root: Path

    @property
    def configs(self) -> Path:
        return self.root / "configs"

    @property
    def data(self) -> Path:
        return self.root / "data"

    @property
    def raw(self) -> Path:
        return self.data / "raw"

    @property
    def processed(self) -> Path:
        return self.data / "processed"

    @property
    def runs(self) -> Path:
        return self.data / "runs"

    @property
    def models(self) -> Path:
        return self.root / "models"

    @property
    def reports(self) -> Path:
        return self.root / "reports"

    def resolve(self, p: str | Path) -> Path:
        p = Path(p)
        return p if p.is_absolute() else self.root / p


def paths() -> Paths:
    return Paths(project_root())


def load_yaml(path: str | Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def database_url() -> str:
    url = os.environ.get("PCAST_DATABASE_URL")
    if url:
        return url
    db = paths().data / "panchayatcast.db"
    db.parent.mkdir(parents=True, exist_ok=True)
    return f"sqlite:///{db.as_posix()}"


@dataclass
class RegionConfig:
    region_id: str
    name: str
    source: str  # "synthetic" | "real"
    bbox: tuple[float, float, float, float]
    grid_res_deg: float
    splits: dict[str, tuple[str, str]]
    languages: list[str] = field(default_factory=lambda: ["en"])
    crop_calendar: str | None = None
    synthetic: dict[str, Any] = field(default_factory=dict)
    real: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_yaml(cls, path: str | Path) -> RegionConfig:
        raw = load_yaml(path)
        return cls(
            region_id=raw["region_id"],
            name=raw["name"],
            source=raw.get("source", "real"),
            bbox=tuple(raw["bbox"]),
            grid_res_deg=float(raw["grid_res_deg"]),
            splits={k: tuple(v) for k, v in raw["splits"].items()},
            languages=list(raw.get("languages", ["en"])),
            crop_calendar=raw.get("crop_calendar"),
            synthetic=raw.get("synthetic", {}) or {},
            real=raw.get("real", {}) or {},
        )

    def to_meta(self) -> dict[str, Any]:
        return {
            "region_id": self.region_id,
            "name": self.name,
            "source": self.source,
            "bbox": list(self.bbox),
            "grid_res_deg": self.grid_res_deg,
            "splits": {k: list(v) for k, v in self.splits.items()},
            "languages": self.languages,
            "crop_calendar": self.crop_calendar,
        }


@dataclass
class ModelConfig:
    raw: dict[str, Any]

    @classmethod
    def load(cls, path: str | Path | None = None) -> ModelConfig:
        path = path or paths().configs / "models.yaml"
        return cls(load_yaml(path))

    @cached_property
    def seed(self) -> int:
        return int(self.raw.get("seed", 7))

    @cached_property
    def default_model(self) -> str:
        return self.raw.get("default_model", "M3")

    @cached_property
    def idw_power(self) -> float:
        return float(self.raw.get("interpolation", {}).get("idw_power", 2.0))

    @cached_property
    def idw_min_distance_km(self) -> float:
        return float(self.raw.get("interpolation", {}).get("min_distance_km", 1.0))

    @cached_property
    def training(self) -> dict[str, Any]:
        return self.raw.get("training", {})

    @cached_property
    def lightgbm(self) -> dict[str, Any]:
        return self.raw.get("lightgbm", {})

    @cached_property
    def rounds(self) -> dict[str, int]:
        return self.raw.get("rounds", {"mean": 800, "quantile": 400, "early_stopping": 50})

    @cached_property
    def quantiles(self) -> tuple[float, float]:
        q = self.raw.get("quantiles", [0.1, 0.9])
        return float(q[0]), float(q[1])

    @cached_property
    def consistency(self) -> dict[str, Any]:
        return self.raw.get(
            "consistency",
            {"enabled": True, "rain_mode": "strict", "rain_max_scale": 3.0, "iterations": 3},
        )

    @cached_property
    def wet_threshold(self) -> float:
        return float(self.training.get("rain_wet_threshold_mm", 0.1))
