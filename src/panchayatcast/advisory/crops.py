"""Crop calendar: which crops are in the field, and at what stage, on a given date."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

from ..config import load_yaml


@dataclass(frozen=True)
class CropSpec:
    name: str
    label: str
    season: str
    sowing: str  # "MM-DD": start of the sowing window
    stages: tuple[tuple[str, int], ...]  # (stage, duration in days), in order

    @property
    def duration(self) -> int:
        return sum(d for _, d in self.stages)

    def stage_on(self, day: date) -> str | None:
        month, dom = (int(x) for x in self.sowing.split("-"))
        for year in (day.year, day.year - 1):
            start = date(year, month, dom)
            offset = (day - start).days
            if 0 <= offset < self.duration:
                for stage, days in self.stages:
                    if offset < days:
                        return stage
                    offset -= days
        return None


@dataclass
class CropCalendar:
    district: str
    crops: dict[str, CropSpec]

    @classmethod
    def load(cls, path: str | Path) -> CropCalendar:
        raw = load_yaml(path)
        crops = {
            name: CropSpec(
                name=name,
                label=c.get("label", name.title()),
                season=c.get("season", ""),
                sowing=c["sowing"],
                stages=tuple((s["stage"], int(s["days"])) for s in c["stages"]),
            )
            for name, c in raw["crops"].items()
        }
        return cls(raw.get("district", ""), crops)

    def active(self, day: date) -> dict[str, str]:
        """{crop: stage} for crops in the field on `day`."""
        out = {}
        for name, spec in self.crops.items():
            stage = spec.stage_on(day)
            if stage:
                out[name] = stage
        return out

    def stage_window(self, day: date, horizon: int = 5) -> dict[str, str]:
        """Crops active at any point in the forecast window (stage taken at the first active day)."""
        out: dict[str, str] = {}
        for i in range(horizon):
            for crop, stage in self.active(day + timedelta(days=i)).items():
                out.setdefault(crop, stage)
        return out
