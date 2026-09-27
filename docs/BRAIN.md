# BRAIN.md: Project Knowledge Base

> This file holds the team's shared understanding of the project. Read it first.
> Record every important decision, assumption, and open question here.

**Project working name:** PanchayatCast (rename freely)
**SIH Problem Statement ID:** 26074
**Doc status:** v0.2 (2026-09-27). Core backend implemented and tested; frontend is next.

---

## 1. The problem statement (verbatim)

> **Downscaling of weather forecast from Block level to Panchayat level: Inferring high-resolution plots/ data/ information from low-resolution plot /data /information /variables for agro-meteorological advisory services.**

The official description repeats the title and adds no detail. Everything beyond the title is **our interpretation**, and this file labels it as such.

---

## 2. What SIH is literally asking for

We break the title into clauses. Every clause is a hard requirement.

| # | Clause in the statement | What it requires | How we satisfy it |
|---|---|---|---|
| R1 | "Downscaling of weather forecast" | Take an existing **forecast** (not historical data only) and make it finer | Downscaling engine that runs on each new block forecast |
| R2 | "from Block level to Panchayat level" | Input unit = **Block**, output unit = **Gram Panchayat** | Input: block forecast table. Output: one value per panchayat (LGD-coded) |
| R3 | "Inferring high-resolution … from low-resolution" | Must **infer/learn** fine detail, not just copy the block value | Terrain-aware statistical/ML model plus a validated improvement over naive copy |
| R4 | "plots / data / information" | Output in three forms: **plots** (maps/charts), **data** (numbers/files), **information** (human-readable) | Maps + charts, CSV/GeoJSON/GeoTIFF exports, text advisories |
| R5 | "… / variables" | Handle **multiple weather variables**, not only rainfall | All standard agromet forecast variables (rain, Tmax, Tmin, RH max/min, wind speed/dir, cloud cover) |
| R6 | "for agro-meteorological advisory services" | Output must feed **farm advisories** | Advisory generator that turns panchayat forecasts into crop-specific advice |

**Minimum winning submission = R1–R6 working end-to-end for a pilot region, plus proof (validation) that R3 beats the naive approach.**

---

## 3. Must-have vs. our additions

| Item | Source | Priority |
|---|---|---|
| Block → Panchayat downscaling engine | SIH (R1–R3) | **Must** |
| Multiple variables | SIH (R5) | **Must** |
| Maps, data exports, readable info | SIH (R4) | **Must** |
| Agro-advisory output | SIH (R6) | **Must** |
| Validation against station observations | Ours; needed to prove R3 | **Must (in practice)** |
| Block-consistency (panchayat values average back to the official block forecast) | Ours | Should |
| Uncertainty / confidence per panchayat | Ours | Should |
| Web dashboard for agromet scientists (DAMU/AMFU) | Ours | Should |
| Regional-language advisories | Ours | Should |
| Farmer mobile view, SMS/WhatsApp/IVR | Ours | Could (stretch) |
| Deep-learning super-resolution (U-Net) | Ours | Could (stretch) |

---

## 4. Core idea in five lines

1. Weather differs inside a block because of **terrain, land cover, water bodies and location**.
2. These effects are **stable over time**, so we can **learn them from years of historical data**, comparing coarse (block-like) values with fine (panchayat-scale) values.
3. When a new block forecast arrives, we **apply the learned local corrections** to every panchayat.
4. We **validate** against weather stations and show the gain over "copy the block value".
5. We turn the result into **crop advisories** and deliver them as maps, data and text.

---

## 5. Decision log

| ID | Date | Decision | Why | Status |
|---|---|---|---|---|
| D-001 | 2026-09-26 | Deliver a working pilot for **one district** first, designed to scale nationally | Hackathon time limits; depth beats breadth | Accepted |
| D-002 | 2026-09-26 | Compute on a **~1 km grid**, then aggregate to panchayat polygons | Panchayat shapes vary widely; a grid is easier for ML and maps | Accepted |
| D-003 | 2026-09-26 | Build models in **layers**: M0 copy → M1 interpolation → M2 +lapse rate → M3 gradient boosting → M4 U-Net (stretch) | Each layer is a fallback and makes improvement measurable | Accepted |
| D-004 | 2026-09-26 | Use **LGD codes** as the primary key for blocks and panchayats | Official Govt. of India identifiers | Accepted |
| D-005 | 2026-09-26 | Default to **block-consistent** output (area-weighted panchayat mean equals the block forecast) | Respects the official IMD forecast; avoids contradicting it | Proposed (confirm with mentor) |
| D-006 | 2026-09-26 | Rule-based advisory engine with rules in YAML; LLM only for translation/wording | Advisories must be traceable and auditable | Accepted |
| D-007 | 2026-09-26 | Stack: Python (xarray, geopandas, LightGBM), FastAPI, React + MapLibre | Standard, open-source, team-friendly | Accepted (backend built) |
| D-008 | 2026-09-26 | Build a clearly-labelled **synthetic demo district** (known local weather effects) so the whole pipeline runs and is tested before real data arrives | Real data access (IMD archives, GP boundaries, CDS account) is not in hand yet | Accepted |
| D-009 | 2026-09-26 | **SQLite by default**, PostgreSQL via `PCAST_DATABASE_URL`; geometries kept in GeoJSON files, not the DB | Zero-setup on a laptop (no Docker available); same schema on both backends | Accepted |
| D-010 | 2026-09-26 | Blocks are **derived as the union of their GPs** | Guarantees GPs nest exactly inside blocks, so block consistency is exact | Accepted |
| D-011 | 2026-09-26 | Rain block consistency: scale down freely, scale up at most 3×, spread any remaining deficit evenly | Pure multiplicative scaling piles a wet block's rain onto a few cells | Accepted |
| D-012 | 2026-09-26 | Train on **emulated block inputs** (block means of historical fine fields) | Mimics the operational input exactly; works without a forecast archive | Accepted (replace/augment with real forecast archives if IMD provides them) |
| D-013 | 2026-09-26 | Virtual environment lives outside OneDrive (`%USERPROFILE%\.venvs\panchayatcast`) | OneDrive sync locks venv files and breaks installs | Accepted |
| D-014 | 2026-09-27 | Real pilot = **Dharwad district, Karnataka**, built from open data only: LGD GP polygons (CC0), Copernicus DEM, WorldCover, CHIRPS rain, ERA5-Land/ERA5 via Open-Meteo | No CDS account, IMD archive or station access yet; Karnataka has dense AWS networks for later validation | Accepted |
| D-015 | 2026-09-27 | Live block forecasts from **Open-Meteo NWP at block centroids** (`source=nwp`) as a stand-in for the IMD feed | Demonstrates the operational chain today; clearly labelled as not official | Accepted |
| D-016 | 2026-09-27 | Four validation modes (held-out year, forecast mode by lead, spatial CV without climatology, station CV) | Each answers a question judges will ask; forecast mode and spatial CV guard against over-claiming | Accepted |
| D-017 | 2026-09-27 | Station correction (M3S) and rain quantile mapping are **switched on only when cross-validation shows a gain** | Avoid adding complexity that does not help | Accepted |
| D-018 | 2026-09-27 | M4 U-Net kept optional/experimental | Needs torch and more data; LightGBM (M3) is strong, fast and explainable | Accepted |
| D-019 | 2026-09-27 | Basemap: muted OpenStreetMap raster tiles | CARTO basemaps now require an API key | Accepted |

---

## 6. Assumptions (verify each one)

- A1. The input is IMD/DAMU **block-level forecasts** for 5 days with the variables: rainfall, Tmax, Tmin, RH max, RH min, wind speed, wind direction, cloud cover.
- A2. If the real archive of block forecasts is unavailable, we can **emulate block forecasts** by averaging gridded model/reanalysis data over block polygons (for training and demo).
- A3. Gram Panchayat boundary polygons with LGD codes are obtainable for the pilot district.
- A4. Enough ground stations (IMD AWS/ARG, state networks) exist in the pilot district for validation.
- A5. Judges expect a **software** solution (dashboard + model), not hardware.
- A6. Advisories follow current agromet practice: issued twice weekly (Tue/Fri) and crop-stage specific.

---

## 7. Open questions for the mentor / problem-statement owner

1. Which variables matter most: all of them, or rainfall and temperature first?
2. Will IMD provide **historical block-level forecasts** and matching **station observations**?
3. Is there a **preferred pilot state/district**?
4. Required **output format**: maps, API, tables, bulletins? Should it plug into an existing IMD/GKMS system?
5. Must panchayat values **stay consistent** with the official block forecast?
6. Is a farmer-facing channel (app/SMS/WhatsApp) expected, or only the downscaling and advisory data?
7. Lead time: 5-day only, or also extended range (2 weeks)?
8. Are there compute or deployment constraints (IMD servers, offline use)?

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| No archive of real block forecasts | Cannot train on true forecast-to-observation pairs | Emulate block forecasts from reanalysis (A2); use GFS/NCUM hindcasts |
| Sparse stations → weak validation | Cannot prove improvement | Use gridded fine datasets (ERA5-Land, CHIRPS) plus the stations we have; spatial cross-validation |
| Rainfall is patchy and hard to downscale | Low skill for rain | Two-stage model (occurrence + amount), categorical metrics, probabilistic output |
| Panchayat boundaries unavailable | Cannot aggregate | Fall back to village points or a grid, then map to LGD codes |
| Scope creep (apps, SMS, etc.) | Core not polished | Core R1–R6 first; stretch items only after validation is done |
| Real "fine" truth is coarse (ERA5-Land ~9 km, CHIRPS ~5 km) | The model can only learn detail present in its training truth; judges may ask | Be upfront about it; validate against stations (point truth); add station data / IMD high-res products to training next |
| Synthetic-demo numbers quoted as real skill | Credibility loss | Every synthetic output is labelled; report and bulletin carry warnings; quote only real-data numbers as skill |

---

## 9. Glossary

| Term | Meaning |
|---|---|
| **Downscaling** | Estimating high-resolution values from low-resolution ones |
| **Block** | Sub-district administrative unit (also called Tehsil/Taluk/Mandal/CD Block by state) |
| **Gram Panchayat (GP)** | Village-level local government unit; one block has roughly 30–100 GPs |
| **LGD** | Local Government Directory: official codes for every admin unit |
| **IMD** | India Meteorological Department |
| **GKMS / AAS** | Gramin Krishi Mausam Sewa, the Agromet Advisory Service |
| **DAMU / AMFU** | District Agromet Unit / Agromet Field Unit: they issue advisories |
| **Lapse rate** | Temperature drop with height (about 6.5 °C per km) |
| **Reanalysis** | Gridded best estimate of past weather (e.g. ERA5) |
| **AWS / ARG** | Automatic Weather Station / Automatic Rain Gauge |
| **Bias correction** | Removing systematic over/under-prediction |
| **CSI / POD / FAR** | Critical Success Index / Probability of Detection / False Alarm Ratio (rain yes/no skill) |

---

## 10. Status and next steps

**Done (2026-09-27):**
- Core docs.
- Core backend (all of R1–R6 on the data side): region building (synthetic + real), models M0–M3, block-consistent downscaling with uncertainty, validation + report, advisory engine (13 rules, en/hi/kn), SQLite storage, CSV/GeoJSON/GeoTIFF/PDF exports, REST API, CLI. 39 tests pass.
- Synthetic-demo result (held-out 2024, stations, perfect block forecast), **synthetic data, so not real skill**: M3 cuts RMSE vs. copying the block value by 36% (Tmax), 22% (Tmin), 37% (rain), 41% (wind), 10–13% (RH); heavy-rain CSI 0.06 → 0.40.

**Next:**
1. Frontend dashboard (waiting for team instruction).
2. Get real data for the pilot district: GP boundaries with LGD codes, CDS account for ERA5-Land, station data (questions in §7).
3. Real-data run and honest validation; spatial CV; forecast-mode test.
4. Expert review of advisory rules and Hindi/Kannada text.

---

## 11. Pitch narrative

- **Hook:** "Two villages in the same block, 20 km apart: one gets a downpour, the other stays dry. Today both farmers get the same forecast."
- **Solution:** Learn each panchayat's local weather signature from 10+ years of data and apply it to every official block forecast.
- **Proof:** Show error reduction against weather stations, compared with the current practice.
- **Impact:** Village-specific advice on irrigation, spraying, sowing and harvesting, in the farmer's language.
- **Scale:** Cheap to run (no new weather model needed); covers ~2.5 lakh panchayats from existing forecasts.
