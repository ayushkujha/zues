"""Relational storage for runs, forecasts, advisories and validation metrics.

SQLite by default (data/panchayatcast.db); set PCAST_DATABASE_URL for PostgreSQL.
Geometries live in the region's GeoJSON files, not in the database, so the same
schema works on both backends.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from typing import Any

import numpy as np
import pandas as pd
from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    MetaData,
    String,
    Table,
    Text,
    and_,
    create_engine,
    delete,
    func,
    insert,
    select,
    update,
)
from sqlalchemy.engine import Engine

from ..config import database_url

metadata = MetaData()

forecast_runs = Table(
    "forecast_runs",
    metadata,
    Column("run_id", String(36), primary_key=True),
    Column("region_id", String(64), nullable=False, index=True),
    Column("issue_date", Date, nullable=False),
    Column("source", String(32), nullable=False),
    Column("model_id", String(8), nullable=False),
    Column("model_version", String(32)),
    Column("status", String(16), nullable=False),
    Column("created_at", DateTime(timezone=True)),
    Column("finished_at", DateTime(timezone=True)),
    Column("notes", Text),
)

block_forecasts = Table(
    "block_forecasts",
    metadata,
    Column("run_id", String(36), ForeignKey("forecast_runs.run_id"), primary_key=True),
    Column("block_lgd", Integer, primary_key=True),
    Column("valid_date", Date, primary_key=True),
    Column("variable", String(16), primary_key=True),
    Column("lead_day", Integer, nullable=False),
    Column("value", Float),
)

panchayat_forecasts = Table(
    "panchayat_forecasts",
    metadata,
    Column("run_id", String(36), ForeignKey("forecast_runs.run_id"), primary_key=True),
    Column("gp_lgd", Integer, primary_key=True),
    Column("valid_date", Date, primary_key=True),
    Column("variable", String(16), primary_key=True),
    Column("lead_day", Integer, nullable=False),
    Column("value", Float),
    Column("p10", Float),
    Column("p90", Float),
    Column("confidence", String(8)),
    Column("model_id", String(8)),
)

advisories = Table(
    "advisories",
    metadata,
    Column("advisory_id", String(36), primary_key=True),
    Column("run_id", String(36), ForeignKey("forecast_runs.run_id"), index=True),
    Column("gp_lgd", Integer, index=True),
    Column("block_lgd", Integer),
    Column("crop", String(32)),
    Column("crop_stage", String(32)),
    Column("valid_from", Date),
    Column("valid_to", Date),
    Column("rule_id", String(64)),
    Column("category", String(32)),
    Column("severity", String(8)),
    Column("text_en", Text, nullable=False),
    Column("text_local", JSON),
    Column("params", JSON),  # numeric/text values the rule filled into its template
    Column("status", String(12), default="draft"),
    Column("edited_by", String(64)),
    Column("updated_at", DateTime(timezone=True)),
)

validation_metrics = Table(
    "validation_metrics",
    metadata,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("region_id", String(64), index=True),
    Column("model_version", String(32)),
    Column("model_id", String(8)),
    Column("variable", String(16)),
    Column("level", String(16)),  # station | gp
    Column("split", String(16)),
    Column("metric", String(16)),
    Column("threshold", Float),
    Column("lead_day", Integer),  # forecast-mode evaluation only
    Column("value", Float),
    Column("n", Integer),
    Column("created_at", DateTime(timezone=True)),
)


def _now() -> datetime:
    return datetime.now(UTC)


def _as_date(x) -> date:
    return pd.Timestamp(x).date()


def _clean(v: Any) -> Any:
    if isinstance(v, (np.floating, float)):
        return None if not np.isfinite(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    return v


class Repository:
    def __init__(self, url: str | None = None, engine: Engine | None = None):
        self.engine = engine or create_engine(url or database_url(), future=True)
        metadata.create_all(self.engine)

    # ---- runs -----------------------------------------------------------
    def create_run(self, run_id: str, region_id: str, issue_date, source: str, model_id: str,
                   model_version: str | None, status: str = "queued", notes: str | None = None) -> None:
        with self.engine.begin() as c:
            c.execute(insert(forecast_runs).values(
                run_id=run_id, region_id=region_id, issue_date=_as_date(issue_date), source=source,
                model_id=model_id, model_version=model_version, status=status,
                created_at=_now(), notes=notes,
            ))

    def update_run(self, run_id: str, **values) -> None:
        if values.get("status") in ("done", "failed") and "finished_at" not in values:
            values["finished_at"] = _now()
        with self.engine.begin() as c:
            c.execute(update(forecast_runs).where(forecast_runs.c.run_id == run_id).values(**values))

    def get_run(self, run_id: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(forecast_runs).where(forecast_runs.c.run_id == run_id)).mappings().first()
        return dict(r) if r else None

    def list_runs(self, region_id: str | None = None, limit: int = 50) -> list[dict]:
        q = select(forecast_runs).order_by(forecast_runs.c.created_at.desc()).limit(limit)
        if region_id:
            q = q.where(forecast_runs.c.region_id == region_id)
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(q).mappings()]

    def latest_run(self, region_id: str) -> dict | None:
        q = (
            select(forecast_runs)
            .where(and_(forecast_runs.c.region_id == region_id, forecast_runs.c.status == "done"))
            .order_by(forecast_runs.c.issue_date.desc(), forecast_runs.c.created_at.desc())
            .limit(1)
        )
        with self.engine.connect() as c:
            r = c.execute(q).mappings().first()
        return dict(r) if r else None

    def delete_run(self, run_id: str) -> None:
        with self.engine.begin() as c:
            for t in (advisories, panchayat_forecasts, block_forecasts):
                c.execute(delete(t).where(t.c.run_id == run_id))
            c.execute(delete(forecast_runs).where(forecast_runs.c.run_id == run_id))

    # ---- forecasts ------------------------------------------------------
    def insert_block_forecasts(self, run_id: str, table: pd.DataFrame, variables: list[str]) -> None:
        long = table.melt(
            id_vars=["block_lgd", "valid_date", "lead_day"], value_vars=variables,
            var_name="variable", value_name="value",
        )
        rows = [
            {"run_id": run_id, "block_lgd": int(r.block_lgd), "valid_date": _as_date(r.valid_date),
             "variable": r.variable, "lead_day": int(r.lead_day), "value": _clean(r.value)}
            for r in long.itertuples(index=False)
        ]
        with self.engine.begin() as c:
            c.execute(insert(block_forecasts), rows)

    def insert_gp_forecasts(self, run_id: str, df: pd.DataFrame) -> None:
        rows = [
            {"run_id": run_id, "gp_lgd": int(r.gp_lgd), "valid_date": _as_date(r.valid_date),
             "variable": r.variable, "lead_day": int(r.lead_day), "value": _clean(r.value),
             "p10": _clean(r.p10), "p90": _clean(r.p90), "confidence": r.confidence,
             "model_id": r.model_id}
            for r in df.itertuples(index=False)
        ]
        with self.engine.begin() as c:
            c.execute(insert(panchayat_forecasts), rows)

    def gp_forecasts(self, run_id: str, gp_lgd: int | None = None) -> pd.DataFrame:
        q = select(panchayat_forecasts).where(panchayat_forecasts.c.run_id == run_id)
        if gp_lgd is not None:
            q = q.where(panchayat_forecasts.c.gp_lgd == gp_lgd)
        with self.engine.connect() as c:
            return pd.DataFrame(c.execute(q).mappings().all())

    def block_forecasts(self, run_id: str, block_lgd: int | None = None) -> pd.DataFrame:
        q = select(block_forecasts).where(block_forecasts.c.run_id == run_id)
        if block_lgd is not None:
            q = q.where(block_forecasts.c.block_lgd == block_lgd)
        with self.engine.connect() as c:
            return pd.DataFrame(c.execute(q).mappings().all())

    def map_values(self, run_id: str, variable: str, valid_date, level: str = "gp") -> pd.DataFrame:
        t = panchayat_forecasts if level == "gp" else block_forecasts
        q = select(t).where(and_(t.c.run_id == run_id, t.c.variable == variable,
                                 t.c.valid_date == _as_date(valid_date)))
        with self.engine.connect() as c:
            return pd.DataFrame(c.execute(q).mappings().all())

    # ---- advisories -----------------------------------------------------
    def insert_advisories(self, run_id: str, items: list[dict]) -> None:
        if not items:
            return
        now = _now()
        rows = [{**a, "run_id": run_id, "updated_at": now} for a in items]
        with self.engine.begin() as c:
            c.execute(insert(advisories), rows)

    def list_advisories(self, run_id: str, gp_lgd: int | None = None, block_lgd: int | None = None,
                        severity: str | None = None, crop: str | None = None,
                        status: str | None = None) -> list[dict]:
        q = select(advisories).where(advisories.c.run_id == run_id)
        if gp_lgd is not None:
            q = q.where(advisories.c.gp_lgd == gp_lgd)
        if block_lgd is not None:
            q = q.where(advisories.c.block_lgd == block_lgd)
        if severity:
            q = q.where(advisories.c.severity == severity)
        if crop:
            q = q.where(advisories.c.crop.in_([crop, "all"]))
        if status:
            q = q.where(advisories.c.status == status)
        with self.engine.connect() as c:
            return [dict(r) for r in c.execute(q).mappings()]

    def get_advisory(self, advisory_id: str) -> dict | None:
        with self.engine.connect() as c:
            r = c.execute(select(advisories).where(advisories.c.advisory_id == advisory_id)).mappings().first()
        return dict(r) if r else None

    def update_advisory(self, advisory_id: str, **values) -> dict | None:
        values["updated_at"] = _now()
        with self.engine.begin() as c:
            c.execute(update(advisories).where(advisories.c.advisory_id == advisory_id).values(**values))
        return self.get_advisory(advisory_id)

    def advisory_counts(self, run_id: str) -> dict[str, int]:
        q = (select(advisories.c.severity, func.count()).where(advisories.c.run_id == run_id)
             .group_by(advisories.c.severity))
        with self.engine.connect() as c:
            return {s: n for s, n in c.execute(q)}

    # ---- validation metrics ---------------------------------------------
    def replace_metrics(self, region_id: str, model_version: str | None, split: str,
                        df: pd.DataFrame) -> None:
        with self.engine.begin() as c:
            c.execute(delete(validation_metrics).where(and_(
                validation_metrics.c.region_id == region_id,
                validation_metrics.c.model_version == model_version,
                validation_metrics.c.split == split,
            )))
            now = _now()
            has_lead = "lead_day" in df.columns
            rows = [
                {"region_id": region_id, "model_version": model_version, "split": split,
                 "model_id": r.model_id, "variable": r.variable, "level": r.level,
                 "metric": r.metric, "threshold": _clean(r.threshold), "value": _clean(r.value),
                 "lead_day": (int(r.lead_day) if has_lead and pd.notna(r.lead_day) else None),
                 "n": int(r.n), "created_at": now}
                for r in df.itertuples(index=False)
            ]
            if rows:
                c.execute(insert(validation_metrics), rows)

    def metrics(self, region_id: str, model_version: str | None = None) -> pd.DataFrame:
        q = select(validation_metrics).where(validation_metrics.c.region_id == region_id)
        if model_version:
            q = q.where(validation_metrics.c.model_version == model_version)
        with self.engine.connect() as c:
            return pd.DataFrame(c.execute(q).mappings().all())
