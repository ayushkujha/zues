"""Advisory rules loaded from YAML (configs/advisory_rules.yaml)."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from ..config import load_yaml
from .expr import ExprError, parse

SEVERITIES = ["green", "yellow", "orange", "red"]
SEVERITY_RANK = {s: i for i, s in enumerate(SEVERITIES)}


@dataclass(frozen=True)
class Rule:
    id: str
    when: str
    severity: str
    text_en: str
    category: str = "general"
    crops: tuple[str, ...] = ("*",)
    stages: tuple[str, ...] = ("*",)
    window: tuple[str, str] = ("d1", "d5")
    params: dict[str, str] = field(default_factory=dict)

    @property
    def crop_agnostic(self) -> bool:
        return self.crops == ("*",)


def load_rules(path: str | Path) -> list[Rule]:
    raw = load_yaml(path)
    rules = []
    seen = set()
    for r in raw.get("rules", []):
        rule = Rule(
            id=r["id"],
            when=r["when"],
            severity=r["severity"],
            text_en=r["text_en"],
            category=r.get("category", "general"),
            crops=tuple(r.get("crops", ["*"])),
            stages=tuple(r.get("stages", ["*"])),
            window=tuple(r.get("window", ["d1", "d5"])),
            params=dict(r.get("params", {}) or {}),
        )
        _validate(rule, seen)
        seen.add(rule.id)
        rules.append(rule)
    return rules


def _validate(rule: Rule, seen: set[str]) -> None:
    if rule.id in seen:
        raise ValueError(f"Duplicate rule id {rule.id}")
    if rule.severity not in SEVERITY_RANK:
        raise ValueError(f"{rule.id}: severity must be one of {SEVERITIES}")
    if rule.crop_agnostic and rule.stages != ("*",):
        raise ValueError(f"{rule.id}: stage filters need a crop list")
    try:
        parse(rule.when)
        for expr in rule.params.values():
            parse(expr)
    except ExprError as e:
        raise ValueError(f"{rule.id}: {e}") from e
