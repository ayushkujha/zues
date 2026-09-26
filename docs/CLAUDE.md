# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## Project

**PanchayatCast**, built for SIH Problem Statement **26074**: downscale weather forecasts from **Block level to Gram Panchayat level** and turn them into **agro-meteorological advisories**.

## Read these first

All project docs live in `docs/` (this folder). The project overview is in the root [README.md](../README.md).

| File | Purpose |
|---|---|
| [BRAIN.md](BRAIN.md) | Problem interpretation, decisions, assumptions, open questions. **Start here.** |
| [PRD.md](PRD.md) | What we build and why: requirements, scope, success metrics |
| [SYSTEM_ARCHITECTURE.md](SYSTEM_ARCHITECTURE.md) | Components, data flow, deployment |
| [TECHNICAL.md](TECHNICAL.md) | Datasets, algorithms, schemas, API, repo layout |
| [DESIGN.md](DESIGN.md) | UI/UX, screens, colors, map styling |

## Current status

- **Phase:** Documentation only. No code exists yet.
- **Do not start implementing** until the user gives the next instruction.
- When implementation starts, follow the repo layout in [TECHNICAL.md](TECHNICAL.md) §9.

## Tech stack (planned)

- **Pipeline/ML:** Python 3.11, xarray, rioxarray, rasterio, geopandas, numpy, pandas, scikit-learn, LightGBM, PyTorch (stretch)
- **API:** FastAPI + Pydantic, SQLAlchemy + GeoAlchemy2
- **DB:** PostgreSQL 16 + PostGIS
- **Frontend:** React + TypeScript + Vite, MapLibre GL, Recharts
- **Infra:** Docker Compose (db, api, worker, web)

## Rules

### Data
- `data/` is **git-ignored**. Never commit datasets, rasters, model weights or credentials.
- `data/raw/` is **immutable**. Write derived files to `data/interim/` or `data/processed/`.
- **Never fabricate observations.** Synthetic or emulated data must be labeled as such (in file names and metadata, e.g. `source="emulated"`).
- **LGD codes** are the primary keys for states, districts, blocks and panchayats.

### Units and conventions
- Rainfall: `mm/day`. Temperature: `°C`. RH: `%`. Wind speed: `km/h`. Wind direction: degrees, meteorological (direction wind comes FROM). Cloud: `okta`.
- Variable names: `rain_mm`, `tmax_c`, `tmin_c`, `rh_max_pct`, `rh_min_pct`, `wind_kmph`, `wind_dir_deg`, `cloud_okta`.
- Dates: ISO 8601 (`YYYY-MM-DD`). Time zone: **IST (Asia/Kolkata)**. Rain day = 08:30 IST to 08:30 IST (IMD convention).
- CRS: store in **EPSG:4326**. Use **EPSG:7755** (India NSF LCC) for area/distance calculations.
- Models handle wind as u/v components internally and converts to speed/direction only for output.

### Modelling
- Every new model must be compared with the baseline **M0 (copy block value)** and **M1 (interpolation)** on the **held-out test set** before it becomes the default.
- Use temporal train/val/test splits plus spatial (leave-stations-out) cross-validation. No random shuffling across time.
- Log model version, training data range and metrics for every trained model.

### Code style
- Python: type hints, `ruff` for lint and format, `pytest` for tests. Functions stay small and pure where possible.
- TypeScript: strict mode, ESLint + Prettier.
- Configuration (region, variables, thresholds, advisory rules) lives in `configs/*.yaml`, not in code.
- Comments explain *why*, not *what*.

### Documentation
- Record important decisions in the **BRAIN.md decision log** (D-xxx).
- Keep docs in sync when architecture, schemas or APIs change.
- All docs go in `docs/`. Only `README.md` stays in the repo root.

## Commands

_Not yet available; add them here when the repo is scaffolded._

```bash
# planned
make setup        # create env, install deps
make ingest       # download/prepare data for the configured region
make train        # train downscaling models
make validate     # compute metrics vs. baselines
make run-forecast # downscale latest block forecast
make api          # start FastAPI
make web          # start frontend
docker compose up # full stack
```
