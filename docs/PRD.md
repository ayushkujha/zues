# PRD: PanchayatCast

**Product:** PanchayatCast: Block-to-Panchayat weather forecast downscaling for agromet advisories
**SIH PS ID:** 26074
**Version:** 0.1 (draft) · **Date:** 2026-09-26 · **Owner:** Team (TBD)

---

## 1. Problem

India's Agromet Advisory Service (GKMS) issues weather forecasts and crop advisories at **block level**. A block holds roughly 30–100 Gram Panchayats spread over hundreds of km², and weather inside it varies with terrain, land cover and local rainfall patterns. Every farmer in the block gets the same forecast, so advisories often don't fit a given village. For example, one village may be told to irrigate on the day it receives heavy rain.

**SIH asks:** Downscale block-level forecasts to panchayat level by inferring high-resolution plots, data and information from low-resolution inputs, for agromet advisory services.

## 2. Goals

| ID | Goal |
|---|---|
| G1 | Produce **panchayat-level forecasts** for all standard agromet variables from block-level forecasts |
| G2 | **Beat the current practice** (same block value for every panchayat), measured against station observations |
| G3 | Deliver output as **plots** (maps/charts), **data** (files/API) and **information** (advisory text) |
| G4 | Generate **panchayat-specific agromet advisories** |
| G5 | Show a clear path to **national scale** (~2.5 lakh GPs) using existing forecasts and modest compute |

### Non-goals (for the hackathon)
- Building a new numerical weather prediction model
- Replacing IMD's official forecast (we refine it and stay consistent with it)
- Nationwide deployment (pilot district plus a scalability demonstration)
- Hardware such as new weather stations

## 3. Users

| Persona | Who | Needs |
|---|---|---|
| **P1: Agromet scientist** (primary) | DAMU/AMFU nodal officer who prepares advisories | Panchayat forecasts, quick advisory drafting, export bulletins |
| **P2: Farmer** (end beneficiary) | Smallholder in a Gram Panchayat | Simple local forecast plus actionable advice in their language |
| **P3: Agriculture / block officer** | Block or district officials, KVK staff | See which panchayats face risk (heavy rain, heat) |
| **P4: IMD / ministry evaluator** (and SIH judges) | Technical reviewers | Evidence of accuracy, method transparency, scalability |

## 4. User stories

| ID | As a… | I want to… | So that… | Priority |
|---|---|---|---|---|
| US-1 | Agromet scientist | upload or fetch the latest block forecast and get panchayat forecasts automatically | I don't have to do manual work | P0 |
| US-2 | Agromet scientist | view a map of any variable at panchayat level for each forecast day | I can spot local differences | P0 |
| US-3 | Agromet scientist | compare block and panchayat views side by side | I understand what downscaling changed | P0 |
| US-4 | Agromet scientist | get auto-drafted advisories per panchayat and crop, then edit and approve them | I can issue bulletins faster | P0 |
| US-5 | Evaluator | see validation metrics against stations and the baseline | I trust the model | P0 |
| US-6 | Agromet scientist | export results as CSV, GeoJSON, GeoTIFF and a PDF bulletin | I can share them through existing channels | P0 |
| US-7 | Any user | see how confident the forecast is for each panchayat | I know when to be cautious | P1 |
| US-8 | Farmer | select my panchayat and see a 5-day forecast and advice in my language | I can plan farm work | P1 |
| US-9 | Block officer | see a list of panchayats with high-severity alerts | I can prioritise outreach | P1 |
| US-10 | Farmer | receive the advisory by SMS/WhatsApp/voice | I don't need a smartphone app | P2 |
| US-11 | Developer / IMD | access everything through a REST API | it can plug into existing systems | P1 |

## 5. Functional requirements

### 5.1 Input and data
- **FR-1 (P0):** Accept block forecasts as CSV/JSON: `block_lgd, issue_date, valid_date, rain_mm, tmax_c, tmin_c, rh_max_pct, rh_min_pct, wind_kmph, wind_dir_deg, cloud_okta`.
- **FR-2 (P0):** Validate input (missing values, units, valid ranges, known LGD codes) and report errors clearly.
- **FR-3 (P1):** Emulated mode: build block forecasts from gridded NWP (GFS/NCUM) or reanalysis when official forecasts aren't available. Label the output as emulated.
- **FR-4 (P0):** Maintain static layers per panchayat: boundary, area, elevation stats, land cover, distance to water.

### 5.2 Downscaling
- **FR-5 (P0):** Downscale every variable in FR-1 to every panchayat for lead days 1–5.
- **FR-6 (P0):** Provide baselines M0 (copy) and M1 (interpolation) plus the default learned model (M3).
- **FR-7 (P1):** Enforce **block consistency** (configurable): the area-weighted panchayat mean equals the block value.
- **FR-8 (P1):** Output an uncertainty range (p10–p90) and a confidence level (High/Medium/Low) per value.
- **FR-9 (P2):** Deep-learning super-resolution model (M4) as an experimental option.

### 5.3 Validation
- **FR-10 (P0):** Compute metrics per variable and lead day against stations: RMSE, MAE, bias, correlation; for rainfall, POD, FAR, CSI, HSS by IMD rainfall category.
- **FR-11 (P0):** Report skill relative to baselines: `Skill = 1 − RMSE_model / RMSE_baseline`.
- **FR-12 (P1):** Spatial cross-validation (leave stations out) to show performance at ungauged panchayats.

### 5.4 Advisory
- **FR-13 (P0):** A rule engine produces advisories from the panchayat forecast, crop and crop stage (rules in YAML).
- **FR-14 (P0):** Each advisory has a severity (Green/Yellow/Orange/Red), the triggering rule, and English text.
- **FR-15 (P1):** Translate advisories into Hindi and one regional language of the pilot state.
- **FR-16 (P1):** The scientist can review, edit and approve advisories before export.

### 5.5 Output and delivery
- **FR-17 (P0):** Web dashboard: map, day slider, variable selector, block/panchayat toggle, panchayat detail panel.
- **FR-18 (P0):** Export CSV, GeoJSON, GeoTIFF (grid) and a PDF bulletin (per block, listing panchayats).
- **FR-19 (P1):** REST API for all data (see TECHNICAL.md §7).
- **FR-20 (P1):** Mobile-friendly farmer view.
- **FR-21 (P2):** SMS/WhatsApp/IVR delivery hooks.

## 6. Non-functional requirements

| ID | Requirement |
|---|---|
| NFR-1 | Downscale one district (all variables, 5 days) in **< 2 minutes** on a laptop CPU |
| NFR-2 | Design scales nationally: all ~2.5 lakh GPs in **< 1 hour** on a single server (target) |
| NFR-3 | API p95 latency **< 500 ms** for panchayat queries |
| NFR-4 | Dashboard usable on 3G/low bandwidth (vector tiles or simplified geometries, lazy loading) |
| NFR-5 | Reproducible: versioned configs, data manifests and model versions |
| NFR-6 | Transparent: every advisory traceable to its rule and forecast values |
| NFR-7 | Built on open-source software and open or government data |
| NFR-8 | Accessible: colour-blind-safe palettes, Indic font support, large touch targets |

## 7. Success metrics

| Metric | Target (pilot) |
|---|---|
| Tmax/Tmin RMSE reduction vs. M0 (copy) | **≥ 15%** |
| RH RMSE reduction vs. M0 | ≥ 10% |
| Rainfall CSI (≥ 2.5 mm/day) vs. M0 | Improvement (any positive, reported per lead day) |
| Coverage | 100% of GPs in pilot district, all variables, 5 lead days |
| End-to-end demo | Upload block forecast → maps + advisories + exports in < 5 min |

> These are targets to validate, not claims. Report actual numbers honestly, including cases where the model does not help.

## 8. Scope and release plan

| Phase | Deliverable |
|---|---|
| **Phase 0: Docs** (now) | BRAIN, PRD, DESIGN, SYSTEM_ARCHITECTURE, TECHNICAL, CLAUDE |
| **Phase 1: Data** | Pilot district boundaries, static layers, historical coarse/fine data, station data |
| **Phase 2: Baselines + validation** | M0, M1, M2 and a validation harness with metrics |
| **Phase 3: ML model** | M3 (LightGBM residual model), uncertainty, block consistency |
| **Phase 4: Advisory** | Rule engine, crop calendar, translations |
| **Phase 5: Product** | API, dashboard, exports, PDF bulletin |
| **Phase 6: Polish** | Farmer view, demo script, pitch deck, stretch goals (U-Net, SMS) |

Dates to be set once the SIH finale schedule is confirmed.

## 9. Dependencies

- Pilot district choice and panchayat boundary polygons
- Historical gridded data (IMD, ERA5/ERA5-Land, CHIRPS) and station observations
- Block forecast samples from IMD/DAMU (preferred) or emulation
- Crop calendar for the pilot district

## 10. Open questions

See [BRAIN.md §7](BRAIN.md).
