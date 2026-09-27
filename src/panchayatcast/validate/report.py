"""Validation report: metrics.csv, summary.md and charts in reports/<region>/<version>/."""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

from ..config import paths  # noqa: E402
from ..variables import OUTPUT_META  # noqa: E402

# Reference categorical slots 1-3 (validated all-pairs) + muted ink for the M0 baseline.
MODEL_COLORS = {"M0": "#898781", "M1": "#2a78d6", "M2": "#eb6834", "M3": "#1baf7a", "M3S": "#eda100",
                "M4": "#e87ba4"}
MODEL_NAMES = {
    "M0": "M0 copy block",
    "M1": "M1 interpolation",
    "M2": "M2 + lapse rate",
    "M3": "M3 LightGBM",
    "M3S": "M3S + stations",
    "M4": "M4 U-Net",
}
LEAD_COLORS = {1: "#2a78d6", 3: "#eb6834", 5: "#1baf7a"}
INK, INK2, GRID, AXIS, SURFACE = "#0b0b0b", "#52514e", "#e1e0d9", "#c3c2b7", "#fcfcfb"
CONT_VARS = ["rain_mm", "tmax_c", "tmin_c", "rh_max_pct", "rh_min_pct", "wind_kmph", "cloud_okta"]


def _style(ax):
    ax.set_facecolor(SURFACE)
    for s in ("top", "right", "left"):
        ax.spines[s].set_visible(False)
    ax.spines["bottom"].set_color(AXIS)
    ax.tick_params(colors=INK2, labelsize=9, length=0)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)


def write_report(region_id: str, version: str | None, frames: dict[str, pd.DataFrame] | pd.DataFrame,
                 meta: dict, split: str = "test") -> Path:
    """Write metrics.csv, summary.md and charts. `frames` maps evaluation name -> metrics."""
    if isinstance(frames, pd.DataFrame):
        frames = {split: frames}
    out = paths().reports / region_id / (version or "untrained")
    out.mkdir(parents=True, exist_ok=True)
    pd.concat([f.assign(split=k) for k, f in frames.items() if not f.empty], ignore_index=True).to_csv(
        out / "metrics.csv", index=False)
    parts: list[str] = []
    df = frames.get("test")
    if df is not None and not df.empty:
        _chart_skill(df, out / "skill_vs_copy.png")
        _chart_csi(df, out / "rain_csi.png")
        parts.append(_summary(region_id, version, df, meta, "test"))
    else:
        parts.append(f"# Validation report: {meta.get('name', region_id)}\n")
    if (f := frames.get("forecast")) is not None and not f.empty:
        _chart_leads(f, out / "forecast_leads.png")
        parts.append(_forecast_section(f))
    if (f := frames.get("spatial_cv")) is not None and not f.empty:
        parts.append(_cv_section(f))
    if (f := frames.get("station_cv")) is not None and not f.empty:
        parts.append(_station_section(f))
    (out / "summary.md").write_text("\n".join(parts), encoding="utf-8")
    return out


def _pick_level(df: pd.DataFrame) -> str:
    return "station" if (df["level"] == "station").any() else "gp"


def _forecast_section(df: pd.DataFrame) -> str:
    level = _pick_level(df)
    sk = df[(df.metric == "skill_vs_M0") & (df.level == level) & (df.model_id == "M3")]
    rm = df[(df.metric == "rmse") & (df.level == level)]
    leads = sorted(int(x) for x in sk["lead_day"].dropna().unique())
    lines = ["## Forecast mode: block forecast with realistic error", "",
             "Block inputs carry forecast error that grows with lead time (as a real 5-day forecast would). "
             f"Truth: {level}s. Table: M3's RMSE reduction vs copying the (imperfect) block forecast.", "",
             "| Variable | " + " | ".join(f"Day {ld}" for ld in leads) + " |", "|---|" + "---:|" * len(leads)]
    for var in CONT_VARS:
        vals = []
        for ld in leads:
            v = sk[(sk.variable == var) & (sk.lead_day == ld)]["value"]
            vals.append(f"{v.iloc[0] * 100:.0f}%" if len(v) and np.isfinite(v.iloc[0]) else "–")
        if any(x != "–" for x in vals):
            lines.append(f"| {OUTPUT_META[var]['label']} | " + " | ".join(vals) + " |")
    lines += ["", "RMSE, M0 → M3 by lead day (max temperature, rain):", ""]
    for var in ("tmax_c", "rain_mm"):
        cells = []
        for ld in leads:
            a = rm[(rm.variable == var) & (rm.lead_day == ld) & (rm.model_id == "M0")]["value"]
            b = rm[(rm.variable == var) & (rm.lead_day == ld) & (rm.model_id == "M3")]["value"]
            if len(a) and len(b):
                cells.append(f"day {ld}: {a.iloc[0]:.2f} → {b.iloc[0]:.2f}")
        lines.append(f"- {OUTPUT_META[var]['label']}: " + "; ".join(cells))
    lines += ["", "_As lead time grows the block forecast's own error dominates, so the relative gain "
              "shrinks, but downscaling keeps adding the local detail._", "",
              "![Forecast mode](forecast_leads.png)", ""]
    return "\n".join(lines)


def _cv_section(df: pd.DataFrame) -> str:
    models = [m for m in ("M0", "M1", "M2", "M3") if m in set(df["model_id"])]
    lines = ["## Spatial cross-validation: unseen places", "",
             "Blocks are split into folds. M3 is retrained without each held-out fold **and without "
             "per-cell climatology**, then scored only on the held-out panchayats and stations. This tests "
             "whether the model transfers to places with no local fine-scale history.", ""]
    for level, title in (("station", "vs stations"), ("gp", "vs panchayat means")):
        if (df["level"] == level).any():
            lines += [f"### Skill vs. copying the block value ({title})", "",
                      _table(df.assign(value=df["value"] * 100), level, "skill_vs_M0", models, ".0f"), ""]
    return "\n".join(lines)


def _station_section(df: pd.DataFrame) -> str:
    sub = df[(df.metric == "rmse") & (df.level == "station")]
    lines = ["## Station correction (M3S): leave-stations-out", "",
             "The station correction is fitted on training-period observations from all but a fold of "
             "stations and scored on the held-out stations in the test period.", "",
             "| Variable | M3 RMSE | M3S RMSE | Change |", "|---|---:|---:|---:|"]
    for var in ("tmax_c", "tmin_c", "rh_max_pct", "rh_min_pct"):
        a = sub[(sub.variable == var) & (sub.model_id == "M3")]["value"]
        b = sub[(sub.variable == var) & (sub.model_id == "M3S")]["value"]
        if len(a) and len(b):
            ch = (1 - b.iloc[0] / a.iloc[0]) * 100
            lines.append(f"| {OUTPUT_META[var]['label']} | {a.iloc[0]:.2f} | {b.iloc[0]:.2f} | "
                         f"{'−' if ch > 0 else '+'}{abs(ch):.0f}% |")
    lines += ["", "_On synthetic data the stations add little beyond the (already fine) gridded truth. "
              "With real data (coarse reanalysis truth) this is where station observations add value._", ""]
    return "\n".join(lines)


def _chart_leads(df: pd.DataFrame, path: Path) -> None:
    level = _pick_level(df)
    sk = df[(df.metric == "skill_vs_M0") & (df.level == level) & (df.model_id == "M3")]
    variables = [v for v in CONT_VARS if (sk.variable == v).any()]
    leads = [ld for ld in (1, 3, 5) if (sk.lead_day == ld).any()]
    if not variables or not leads:
        return
    fig, ax = plt.subplots(figsize=(9, 4.2), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    _style(ax)
    x = np.arange(len(variables))
    w = 0.8 / len(leads)
    for i, ld in enumerate(leads):
        vals = [sk[(sk.variable == v) & (sk.lead_day == ld)]["value"] for v in variables]
        vals = [float(v.iloc[0]) * 100 if len(v) else np.nan for v in vals]
        ax.bar(x + (i - (len(leads) - 1) / 2) * w, vals, w * 0.9, color=LEAD_COLORS[ld],
               label=f"Lead day {ld}", edgecolor=SURFACE, linewidth=1)
    ax.axhline(0, color=AXIS, linewidth=1)
    labels = [OUTPUT_META[v]["label"].replace(" relative ", "\nrelative ").replace(" temp", "\ntemp")
              for v in variables]
    ax.set_xticks(x, labels, fontsize=8)
    ax.set_ylabel("M3 RMSE reduction vs M0 (%)", color=INK2, fontsize=9)
    fig.suptitle(f"Forecast mode: downscaling skill by lead day ({level} level)", color=INK,
                 fontsize=11, x=0.01, ha="left")
    fig.legend(*ax.get_legend_handles_labels(), frameon=False, fontsize=8, ncols=len(leads),
               loc="upper right", bbox_to_anchor=(0.99, 0.99))
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def _table(df: pd.DataFrame, level: str, metric: str, models: list[str], fmt: str) -> str:
    sub = df[(df["level"] == level) & (df["metric"] == metric)]
    if "lead_day" in sub:
        sub = sub[sub["lead_day"].isna()]
    lines = ["| Variable | " + " | ".join(MODEL_NAMES[m] for m in models) + " |",
             "|---|" + "---:|" * len(models)]
    for var in CONT_VARS:
        vals = []
        for m in models:
            v = sub[(sub["variable"] == var) & (sub["model_id"] == m)]["value"]
            vals.append(format(v.iloc[0], fmt) if len(v) and np.isfinite(v.iloc[0]) else "–")
        unit = OUTPUT_META[var]["unit"]
        lines.append(f"| {OUTPUT_META[var]['label']} ({unit}) | " + " | ".join(vals) + " |")
    return "\n".join(lines)


def _summary(region_id, version, df, meta, split) -> str:
    models = [m for m in MODEL_NAMES if m in set(df["model_id"])]
    src = meta.get("data_source", meta.get("source", "unknown"))
    parts = [f"# Validation report: {meta.get('name', region_id)}", ""]
    if src == "synthetic":
        parts += [
            "> **Synthetic data.** This region and its weather are generated. These numbers show",
            "> that the pipeline works and learns local structure; they are NOT evidence of",
            "> real-world skill. Re-run on real data before quoting any figure.", "",
        ]
    parts += [
        f"- Model version: `{version}`",
        f"- Period: `{split}` split {meta.get('splits', {}).get(split)}",
        "- Mode: perfect block forecast (true block means as input), which isolates downscaling error",
        "",
    ]
    for level, title in (("station", "Against weather stations"), ("gp", "Against panchayat means")):
        if not (df["level"] == level).any():
            continue
        parts += [f"## {title}", "", "### RMSE (lower is better)", "",
                  _table(df, level, "rmse", models, ".2f"), "",
                  "### Skill vs. copying the block value (higher is better)", "",
                  _table(df.assign(value=df["value"] * 100), level, "skill_vs_M0", models, ".0f"), "",
                  "_Skill = (1 − RMSE_model / RMSE_M0) × 100%. M0 is 0% by definition._", ""]
        wd = df[(df["level"] == level) & (df["variable"] == "wind_dir_deg")]
        if len(wd):
            parts += ["Wind direction mean absolute error (°): " + ", ".join(
                f"{m} {wd[wd.model_id == m].value.iloc[0]:.0f}" for m in models
                if len(wd[wd.model_id == m])), ""]
    rain = df[(df["variable"] == "rain_mm") & (df["metric"].isin(["csi", "pod", "far"]))]
    lvl = "station" if (rain["level"] == "station").any() else "gp"
    rain = rain[rain["level"] == lvl]
    if len(rain):
        parts += [f"## Rainfall events ({lvl})", "",
                  "| Threshold | Score | " + " | ".join(MODEL_NAMES[m] for m in models) + " |",
                  "|---|---|" + "---:|" * len(models)]
        for thr in sorted(rain["threshold"].dropna().unique()):
            for k in ("csi", "pod", "far"):
                vals = []
                for m in models:
                    v = rain[(rain.threshold == thr) & (rain.metric == k) & (rain.model_id == m)].value
                    vals.append(f"{v.iloc[0]:.2f}" if len(v) and np.isfinite(v.iloc[0]) else "–")
                parts.append(f"| ≥ {thr:g} mm | {k.upper()} | " + " | ".join(vals) + " |")
        parts += ["", "_CSI and POD higher is better; FAR lower is better._", ""]
    parts += ["![Skill](skill_vs_copy.png)", "", "![Rain CSI](rain_csi.png)", ""]
    return "\n".join(parts)


def _chart_skill(df: pd.DataFrame, path: Path) -> None:
    level = "station" if (df["level"] == "station").any() else "gp"
    sk = df[(df["metric"] == "skill_vs_M0") & (df["level"] == level)]
    models = [m for m in ("M1", "M2", "M3") if m in set(sk["model_id"])]
    if not models:
        return
    variables = [v for v in CONT_VARS if (sk.variable == v).any()]  # e.g. no station cloud obs
    fig, ax = plt.subplots(figsize=(9, 4.4), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    _style(ax)
    x = np.arange(len(variables))
    width = 0.8 / len(models)
    top = 0.0
    for i, m in enumerate(models):
        vals = [sk[(sk.variable == v) & (sk.model_id == m)].value for v in variables]
        vals = [float(v.iloc[0]) * 100 if len(v) else np.nan for v in vals]
        top = max(top, np.nanmax(vals))
        bars = ax.bar(x + (i - (len(models) - 1) / 2) * width, vals, width * 0.9,
                      color=MODEL_COLORS[m], label=MODEL_NAMES[m], edgecolor=SURFACE, linewidth=1)
        if m == models[-1]:
            for b, v in zip(bars, vals):
                if np.isfinite(v):
                    ax.annotate(f"{v:.0f}%", (b.get_x() + b.get_width() / 2, max(v, 0)),
                                xytext=(0, 3), textcoords="offset points", ha="center",
                                fontsize=8, color=INK)
    ax.axhline(0, color=AXIS, linewidth=1)
    ax.set_ylim(min(0, ax.get_ylim()[0]), top * 1.12 + 1)
    labels = [OUTPUT_META[v]["label"].replace(" relative ", "\nrelative ").replace(" temp", "\ntemp")
              for v in variables]
    ax.set_xticks(x, labels, rotation=0, fontsize=8)
    ax.set_ylabel("RMSE reduction vs. copying block value (%)", color=INK2, fontsize=9)
    fig.suptitle(f"Downscaling skill by variable ({level} level)", color=INK, fontsize=11,
                 x=0.01, ha="left")
    fig.legend(*ax.get_legend_handles_labels(), frameon=False, fontsize=8, ncols=len(models),
               loc="upper right", bbox_to_anchor=(0.99, 0.99))
    fig.tight_layout(rect=(0, 0, 1, 0.93))
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)


def _chart_csi(df: pd.DataFrame, path: Path) -> None:
    level = "station" if (df["level"] == "station").any() else "gp"
    c = df[(df.variable == "rain_mm") & (df.metric == "csi") & (df.level == level)]
    models = [m for m in MODEL_NAMES if m in set(c["model_id"])]
    thrs = sorted(c["threshold"].dropna().unique())
    if not thrs:
        return
    fig, ax = plt.subplots(figsize=(7, 3.8), dpi=150)
    fig.patch.set_facecolor(SURFACE)
    _style(ax)
    x = np.arange(len(thrs))
    width = 0.8 / len(models)
    for i, m in enumerate(models):
        vals = [c[(c.threshold == t) & (c.model_id == m)].value for t in thrs]
        vals = [float(v.iloc[0]) if len(v) else np.nan for v in vals]
        ax.bar(x + (i - (len(models) - 1) / 2) * width, vals, width * 0.9,
               color=MODEL_COLORS[m], label=MODEL_NAMES[m], edgecolor=SURFACE, linewidth=1)
    ax.set_xticks(x, [f"≥ {t:g} mm" for t in thrs], fontsize=9)
    ax.set_ylim(0, 1)
    ax.set_ylabel("Critical Success Index", color=INK2, fontsize=9)
    ax.set_title(f"Rain event detection ({level} level)", color=INK, fontsize=11, loc="left")
    ax.legend(frameon=False, fontsize=8, loc="upper right")
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE)
    plt.close(fig)
