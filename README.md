# PanchayatCast

**Block-to-Panchayat weather forecast downscaling for agro-meteorological advisories**

Smart India Hackathon · Problem Statement **26074**

> *Downscaling of weather forecast from Block level to Panchayat level: Inferring high-resolution plots/ data/ information from low-resolution plot /data /information /variables for agro-meteorological advisory services.*

---

## The problem

India's Agromet Advisory Service issues weather forecasts at **block level**. One block can hold 30–100 Gram Panchayats, and weather inside it varies with terrain, land cover and local rain patterns. Today every village in a block gets the **same forecast and the same advice**.

## Our solution

PanchayatCast takes the official block forecast and produces a **forecast for every Gram Panchayat**, then turns it into **crop-specific advisories**.

1. **Learn** each area's local weather signature (terrain, land cover, water bodies, climatology) from 10+ years of historical data.
2. **Downscale** every new block forecast to a ~1 km grid and aggregate it to panchayat boundaries.
3. **Validate** against weather stations and show the improvement over "copy the block value".
4. **Advise:** a rule engine turns panchayat forecasts into crop advisories (in local languages).
5. **Deliver** results as **plots** (maps, charts), **data** (CSV, GeoJSON, GeoTIFF, API) and **information** (advisory text, PDF bulletins).

```
Block forecast ──► Downscaling engine ──► Panchayat forecast ──► Advisory engine ──► Dashboard / exports / farmer view
                   (terrain-aware ML)      (rain, Tmax, Tmin,      (crop + stage rules)
                                            RH, wind, cloud)
```

**Variables:** rainfall, max/min temperature, max/min relative humidity, wind speed and direction, cloud cover · **Lead time:** 5 days

---

## Documentation

| Doc | What's inside |
|---|---|
| [docs/BRAIN.md](docs/BRAIN.md) | **Start here.** Problem breakdown, requirements, decisions, assumptions, open questions |
| [docs/PRD.md](docs/PRD.md) | Product requirements: users, user stories, features, success metrics, phases |
| [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) | Components, data flow, sequence diagrams, deployment |
| [docs/TECHNICAL.md](docs/TECHNICAL.md) | Datasets, models, maths, DB schema, API, advisory rules, validation |
| [docs/DESIGN.md](docs/DESIGN.md) | UI/UX: screens, colours, typography, accessibility |
| [docs/CLAUDE.md](docs/CLAUDE.md) | Conventions and rules for contributors and Claude Code |

---

## Tech stack (planned)

| Layer | Tools |
|---|---|
| Data & ML | Python, xarray, rioxarray, geopandas, scikit-learn, LightGBM, PyTorch |
| Backend | FastAPI, PostgreSQL + PostGIS |
| Frontend | React, TypeScript, Vite, MapLibre GL |
| Deployment | Docker Compose |

## Data sources

IMD block forecasts and gridded data · ERA5 / ERA5-Land · CHIRPS · GFS · IMD and state AWS stations · SRTM / CartoDEM · ESA WorldCover · LGD panchayat boundaries. See [docs/TECHNICAL.md §3](docs/TECHNICAL.md).

---

## Project structure

```
.
├── README.md
├── docs/                 # all project documentation
├── configs/              # region, variables, models, advisory rules (planned)
├── data/                 # datasets, git-ignored (planned)
├── src/panchayatcast/    # pipeline, models, API (planned)
└── web/                  # dashboard (planned)
```

## Status

**Phase 0: Documentation complete.** Implementation has not started yet.

## Team

_TBD_
