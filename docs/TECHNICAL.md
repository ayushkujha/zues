# TECHNICAL.md: Technical Specification

**Version:** 0.1 · **Date:** 2026-09-26

---

## 1. Problem formulation

Given a block-level forecast $y_b(v, d)$ for block $b$, variable $v$ and lead day $d$, estimate the panchayat-level value $\hat{y}_p(v, d)$ for every Gram Panchayat $p \in b$.

We estimate on a fine grid (~1 km, cells $i$) and aggregate:

$$
\hat{y}_i = \underbrace{I(y_{b}, y_{b'} \dots)_i}_{\text{interpolated coarse signal}} + \underbrace{f_v(\mathbf{x}_i, t)}_{\text{learned local correction}}
\qquad
\hat{y}_p = \sum_{i \in p} w_{i,p}\, \hat{y}_i
$$

- $I$: interpolation of block values (so values change smoothly across block borders)
- $\mathbf{x}_i$: static and seasonal features of cell $i$ (elevation, land cover, climatology…)
- $f_v$: model trained on historical data
- $w_{i,p}$: area fraction of cell $i$ inside panchayat $p$ (sums to 1)

---

## 2. Variables

| Name | Unit | Aggregation grid→GP | Notes |
|---|---|---|---|
| `rain_mm` | mm/day | area-weighted mean (+ max as extra field) | 08:30–08:30 IST rain day |
| `tmax_c` | °C | area-weighted mean | Lapse-rate sensitive |
| `tmin_c` | °C | area-weighted mean | Lapse-rate + valley cold-pooling |
| `rh_max_pct` | % | mean, clip 0–100 | Morning RH |
| `rh_min_pct` | % | mean, clip 0–100 | Afternoon RH |
| `wind_kmph` | km/h | via u/v mean | Terrain exposure |
| `wind_dir_deg` | ° (from) | via u/v mean | Meteorological convention |
| `cloud_okta` | okta 0–8 | mean, round to int for display | Mostly interpolated |

---

## 3. Data sources

| Dataset | Resolution | Period | Use | Access |
|---|---|---|---|---|
| **IMD block-level forecasts** | Block | Recent | Operational input; training pairs if an archive is provided | IMD / DAMU (via mentor) |
| **IMD gridded rainfall** | 0.25° daily | 1901– | Coarse/fine rainfall, bias reference | IMD Pune; `imdlib` Python package |
| **IMD gridded Tmax/Tmin** | 1.0° daily | 1951– | Coarse temperature reference | IMD Pune; `imdlib` |
| **ERA5** | 0.25° hourly | 1940– | Coarse fields (all variables) | Copernicus CDS (`cdsapi`) |
| **ERA5-Land** | 0.1° hourly | 1950– | Fine target for temp, RH (via dewpoint), wind | Copernicus CDS |
| **CHIRPS v2** | 0.05° daily | 1981– | Fine rainfall target | UCSB CHC |
| **GPM IMERG** | 0.1° | 2000– | Rainfall cross-check | NASA GES DISC |
| **GFS** | 0.25° | Live | Emulated block forecasts for live demo | NOAA NOMADS |
| **NCUM (NCMRWF)** | ~12 km | Live | Indian NWP alternative | NCMRWF (on request) |
| **Station data** | Point | Varies | **Validation ground truth** | IMD AWS/ARG; KSNDMC (Karnataka); TSDPS (Telangana); others |
| **SRTM / CartoDEM** | 30 m | Static | Elevation, slope, aspect, TPI | USGS / Bhuvan |
| **ESA WorldCover** | 10 m | 2020/21 | Land-cover fractions | ESA |
| **MODIS / Sentinel-2 NDVI** | 250 m / 10 m | 2000– | Vegetation state (monthly climatology) | NASA / Copernicus |
| **Water bodies** | Vector/raster | Static | Distance to water | JRC Global Surface Water / OSM |
| **Admin boundaries** | Polygons | Current | Blocks, GPs with **LGD codes** | LGD (codes) + Bhuvan / state GIS (polygons); confirm with mentor |

> Record the licence and citation of every dataset in `data/manifest.json`.

### 3.1 Derived quantities
- RH from ERA5-Land: from 2 m temperature and 2 m dewpoint (Magnus formula). RH max ≈ max of hourly RH over the day; RH min ≈ min.
- Tmax/Tmin: daily max/min of hourly 2 m temperature over the IST day.
- Wind: daily mean of 10 m u/v → speed (km/h) and direction.
- Rain: daily sum aligned to the 08:30 IST rain day.

---

## 4. Preprocessing

1. **Region setup** (`configs/region.yaml`): state, district LGD, bounding box + 0.5° buffer.
2. **Target grid:** 0.01° (~1.1 km) regular lat/lon grid over the region.
3. **Regrid fine datasets** to the target grid: bilinear for continuous fields, conservative for rainfall.
4. **Static layers** → target grid: elevation mean/std, slope, aspect (sin/cos), TPI (at 1 km and 5 km), land-cover fractions, distance to water, distance to coast, monthly NDVI climatology.
5. **Emulated block inputs:** for each day, area-average the fine (or coarse) field over each block polygon → $y_b$. This mimics the operational block forecast.
6. **Cell → GP weights:** compute $w_{i,p}$ with exact polygon/cell intersection (`exactextract`), in EPSG:7755.
7. **Station QC:** remove duplicates, range checks, IMD QC flags, drop stations with < 70% completeness.

---

## 5. Models

### 5.1 Model ladder

| ID | Name | Description | Role |
|---|---|---|---|
| **M0** | Copy | $\hat{y}_p = y_b$ (current practice) | Baseline to beat |
| **M1** | Interpolation | IDW / bilinear from block centroids (smooth across borders) | Baseline 2 |
| **M2** | Physics-adjusted | M1 + lapse-rate correction for temperature: $\hat T_i = T_{I,i} + \Gamma (\bar z_b - z_i)$, $\Gamma$ = 6.5 °C/km default, fitted per month | Cheap physics |
| **M3** | **Residual GBM** (default) | LightGBM learns $f_v(\mathbf{x}_i,t) = y_i - I(y_b)_i$ | Main model |
| **M4** | U-Net SR (stretch) | CNN maps coarse field + static channels → fine field | Showpiece |

### 5.2 M3 features

| Group | Features |
|---|---|
| Coarse signal | block value $y_b$, interpolated value $I_i$, neighbour-block gradient (dx, dy), block std across neighbours |
| Terrain | elevation, $z_i - \bar z_b$, slope, aspect sin/cos, TPI 1 km/5 km |
| Surface | land-cover fractions (crop, tree, built, water, bare), distance to water, NDVI (monthly clim.) |
| Location | lat, lon, distance to coast |
| Season | day-of-year sin/cos, month |
| Climatology | fine/coarse climatological ratio (rain) or difference (temp, RH) for the cell and month; **usually the strongest feature** |

### 5.3 Rainfall (special handling)
Rain is zero-inflated and patchy, so we use:
1. **Occurrence model:** LightGBM classifier $P(\text{rain}_i > 0.1\text{ mm})$.
2. **Amount model:** LightGBM regressor on $\log(1 + \text{rain})$ for wet cells.
3. Combine: $\hat r_i = \mathbb{1}[P_i > \tau] \cdot \exp(\hat a_i) - 1$, where $\tau$ is tuned on validation to maximise CSI.
4. **Quantile mapping** to the fine climatology to fix distribution bias.
5. If the block forecast is 0 mm, output 0 in strict mode, or allow light rain at low probability in soft mode (configurable).

### 5.4 Wind
Model $u$ and $v$ separately (residual GBM), then compute $\text{speed} = \sqrt{u^2+v^2}$ and $\text{dir} = (270° - \operatorname{atan2}(v,u)) \bmod 360°$.

### 5.5 Post-processing
- **Physical limits:** rain ≥ 0; RH ∈ [0, 100]; Tmax ≥ Tmin (swap/adjust if violated); cloud ∈ [0, 8].
- **Block consistency** (configurable, default on). With area weights $W_p$ of GPs in block $b$:
  - Additive (temperature, RH, wind u/v): $\hat y'_p = \hat y_p - (\sum_p W_p \hat y_p - y_b)$
  - Multiplicative (rain): $\hat r'_p = \hat r_p \cdot y_b / \sum_p W_p \hat r_p$ (when the denominator is > 0)
- **Uncertainty:** LightGBM quantile models (α = 0.1, 0.9) → p10/p90. Confidence: High if the (p90−p10) range is below the variable's threshold, Medium, or Low (thresholds in config).

### 5.6 M4 U-Net (stretch)
- Input channels: coarse field upsampled to 1 km, elevation, slope, land cover, climatology, DOY sin/cos.
- Output: fine field (residual).
- Loss: MSE (temperature/RH); weighted MSE + BCE on occurrence (rain).
- Trained on ERA5 (coarsened) → ERA5-Land / CHIRPS patches of 64×64.

---

## 6. Database schema (PostGIS)

```sql
CREATE TABLE blocks (
  block_lgd       INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  district_lgd    INTEGER NOT NULL,
  state_lgd       INTEGER NOT NULL,
  geom            geometry(MultiPolygon, 4326) NOT NULL
);

CREATE TABLE panchayats (
  gp_lgd          INTEGER PRIMARY KEY,
  name            TEXT NOT NULL,
  name_local      TEXT,
  block_lgd       INTEGER NOT NULL REFERENCES blocks,
  area_km2        REAL NOT NULL,
  elev_mean_m     REAL,
  geom            geometry(MultiPolygon, 4326) NOT NULL,
  centroid        geometry(Point, 4326) NOT NULL
);

CREATE TABLE forecast_runs (
  run_id          UUID PRIMARY KEY,
  issue_date      DATE NOT NULL,
  source          TEXT NOT NULL CHECK (source IN ('official','emulated_gfs','emulated_reanalysis','upload')),
  model_version   TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  finished_at     TIMESTAMPTZ,
  notes           TEXT
);

CREATE TABLE block_forecasts (
  run_id          UUID REFERENCES forecast_runs,
  block_lgd       INTEGER REFERENCES blocks,
  valid_date      DATE,
  lead_day        SMALLINT CHECK (lead_day BETWEEN 1 AND 5),
  variable        TEXT,
  value           REAL,
  PRIMARY KEY (run_id, block_lgd, valid_date, variable)
);

CREATE TABLE panchayat_forecasts (
  run_id          UUID REFERENCES forecast_runs,
  gp_lgd          INTEGER REFERENCES panchayats,
  valid_date      DATE,
  lead_day        SMALLINT,
  variable        TEXT,
  value           REAL,
  p10             REAL,
  p90             REAL,
  confidence      TEXT CHECK (confidence IN ('high','medium','low')),
  model_id        TEXT,          -- M0..M4 actually used (fallback visible)
  PRIMARY KEY (run_id, gp_lgd, valid_date, variable)
);

CREATE TABLE advisories (
  advisory_id     UUID PRIMARY KEY,
  run_id          UUID REFERENCES forecast_runs,
  gp_lgd          INTEGER REFERENCES panchayats,
  crop            TEXT,
  crop_stage      TEXT,
  valid_from      DATE,
  valid_to        DATE,
  rule_id         TEXT NOT NULL,
  severity        TEXT CHECK (severity IN ('green','yellow','orange','red')),
  text_en         TEXT NOT NULL,
  text_local      JSONB,         -- {"hi": "...", "kn": "..."}
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected')),
  edited_by       TEXT,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE stations (
  station_id      TEXT PRIMARY KEY,
  source          TEXT,
  name            TEXT,
  elev_m          REAL,
  geom            geometry(Point, 4326)
);

CREATE TABLE observations (
  station_id      TEXT REFERENCES stations,
  obs_date        DATE,
  variable        TEXT,
  value           REAL,
  qc_flag         SMALLINT DEFAULT 0,
  PRIMARY KEY (station_id, obs_date, variable)
);

CREATE TABLE validation_metrics (
  model_version   TEXT,
  model_id        TEXT,
  variable        TEXT,
  lead_day        SMALLINT,
  split           TEXT,          -- test / spatial_cv
  metric          TEXT,          -- rmse, mae, bias, r, pod, far, csi, hss
  value           REAL,
  n               INTEGER,
  PRIMARY KEY (model_version, model_id, variable, lead_day, split, metric)
);

CREATE INDEX ON panchayats USING GIST (geom);
CREATE INDEX ON blocks USING GIST (geom);
CREATE INDEX ON panchayat_forecasts (gp_lgd, valid_date);
```

---

## 7. REST API (FastAPI)

Base: `/api/v1`

| Method | Path | Description |
|---|---|---|
| GET | `/health` | Liveness |
| GET | `/regions/districts` | Available districts |
| GET | `/blocks?district_lgd=` | Blocks (GeoJSON) |
| GET | `/panchayats?block_lgd=&district_lgd=` | GPs (GeoJSON, simplified geometry) |
| GET | `/panchayats/search?q=` | Name search (English + local) |
| POST | `/runs` | Upload block forecast (CSV/JSON) → creates run (auth) |
| GET | `/runs` / `/runs/{run_id}` | Run list / status |
| GET | `/map?run_id=&variable=&valid_date=&level=gp\|block` | GeoJSON FeatureCollection with values |
| GET | `/panchayats/{gp_lgd}/forecast?run_id=` | 5-day forecast, all variables, with p10/p90/confidence and block values |
| GET | `/panchayats/{gp_lgd}/advisories?run_id=&crop=&lang=` | Advisories for a GP |
| GET | `/advisories?run_id=&block_lgd=&severity=` | Advisory list (dashboard) |
| PATCH | `/advisories/{id}` | Edit text / approve / reject (auth) |
| GET | `/validation/metrics?variable=&lead_day=` | Metrics table |
| GET | `/exports/{run_id}.{csv\|geojson\|pdf}` | Downloads |
| GET | `/rasters/{run_id}/{variable}/{valid_date}.tif` | COG GeoTIFF |

`run_id` defaults to the latest successful run when omitted.

**Example:** `GET /api/v1/panchayats/123456/forecast`
```json
{
  "gp_lgd": 123456,
  "name": "Hebballi",
  "block_lgd": 5678,
  "run": {"run_id": "…", "issue_date": "2026-09-29", "source": "official", "model_version": "m3-2026.10.01"},
  "days": [
    {
      "valid_date": "2026-09-30",
      "lead_day": 1,
      "rain_mm":  {"value": 18.2, "p10": 6.0, "p90": 31.5, "block": 11.0, "confidence": "medium"},
      "tmax_c":   {"value": 30.8, "p10": 29.9, "p90": 31.6, "block": 31.9, "confidence": "high"}
    }
  ]
}
```

---

## 8. Advisory engine

### 8.1 Inputs
- Panchayat forecast (5 days)
- Crop calendar per district: crop → sowing window → stage by date (`configs/crop_calendar/{district}.yaml`)
- Rules (`configs/advisory_rules.yaml`)

### 8.2 IMD rainfall categories (24 h)
| Category | mm |
|---|---|
| Very light | 0.1 – 2.4 |
| Light | 2.5 – 15.5 |
| Moderate | 15.6 – 64.4 |
| Heavy | 64.5 – 115.5 |
| Very heavy | 115.6 – 204.4 |
| Extremely heavy | ≥ 204.5 |

### 8.3 Rule format (example)
```yaml
- id: RAIN_SPRAY_POSTPONE
  when: "rain_mm[d1] > 10 or rain_mm[d2] > 10"
  crops: ["*"]
  stages: ["*"]
  severity: orange
  text_en: "Rain expected ({rain_mm_max} mm). Postpone pesticide/fertiliser spraying until {dry_day}."

- id: HEAT_FLOWERING
  when: "max(tmax_c[d1:d3]) >= 38"
  crops: ["paddy", "cotton", "soybean"]
  stages: ["flowering"]
  severity: red
  text_en: "High temperature ({tmax_max}°C) during flowering. Apply light irrigation in the evening."

- id: FUNGAL_RISK
  when: "mean(rh_max_pct[d1:d3]) > 85 and mean(tmax_c[d1:d3]) between 22 and 30"
  crops: ["paddy", "tomato", "groundnut"]
  stages: ["vegetative", "flowering"]
  severity: yellow
  text_en: "Humid, warm weather favours fungal disease. Monitor crops and consider preventive spray on a dry day."

- id: IRRIGATION_SKIP
  when: "sum(rain_mm[d1:d3]) >= 25"
  crops: ["*"]
  stages: ["*"]
  severity: green
  text_en: "Sufficient rain expected ({rain_sum} mm in 3 days). Skip irrigation."
```
- Rules are evaluated safely (a small expression parser, **no `eval`**).
- Final rules must be reviewed against official agromet advisory guidance / the mentor's inputs.

### 8.4 Translation
- Templates are pre-translated per language where possible (reliable).
- The free-text parts can be machine-translated (LLM/MT) and are marked "machine translated" until a human reviews them.

---

## 9. Repository layout (planned)

```
.
├── README.md
├── docs/
│   └── CLAUDE.md  BRAIN.md  PRD.md  DESIGN.md  SYSTEM_ARCHITECTURE.md  TECHNICAL.md
├── configs/
│   ├── region.yaml
│   ├── variables.yaml
│   ├── models.yaml
│   ├── advisory_rules.yaml
│   └── crop_calendar/
├── data/                     # git-ignored
│   ├── raw/  interim/  processed/  static/
│   └── manifest.json
├── models/                   # git-ignored (trained artifacts)
├── src/panchayatcast/
│   ├── ingest/               # downloaders, loaders, validators
│   ├── preprocess/           # regrid, block means, weights
│   ├── features/             # static + climatology features
│   ├── models/               # m0..m4, training
│   ├── downscale/            # engine, postprocess, aggregate
│   ├── validate/             # metrics, reports
│   ├── advisory/             # rules, crop calendar, translate
│   ├── db/                   # SQLAlchemy models, migrations
│   └── api/                  # FastAPI app
├── web/                      # React + TS + Vite
├── notebooks/                # exploration only
├── tests/
├── docker-compose.yml
├── pyproject.toml
└── Makefile
```

---

## 10. Validation protocol

- **Splits (example):** train 2010–2020, validation 2021–2022, test 2023–2025. Adjust to data availability.
- **Spatial CV:** k-fold leave-stations-out (grouped by station clusters, ≥ 10 km apart) to test ungauged panchayats.
- **Truth sources:** (a) stations, which are the most credible; (b) fine gridded data for full spatial coverage.
- **Continuous metrics:** RMSE, MAE, bias, Pearson r, and skill vs. M0/M1.
- **Rainfall categorical:** POD, FAR, CSI, HSS at thresholds 2.5, 15.6, 64.5 mm.
- **Forecast-mode test:** if real block forecast archives exist, evaluate the full chain (official block forecast → our GP forecast → observed). Otherwise use GFS hindcasts as the emulated block forecast.
- **Report:** auto-generated HTML/PDF with tables and charts in `reports/`.

---

## 11. Performance notes
- The 1 km grid for a district is about 5k–10k cells, so inference takes milliseconds per variable and day.
- National: ~3.3 M cells × 8 variables × 5 days. LightGBM batch inference takes minutes on a multi-core CPU.
- Zonal weights are precomputed once, so aggregation is a sparse matrix multiply: $\hat{\mathbf{y}}_{GP} = W \hat{\mathbf{y}}_{grid}$.

---

## 12. Key libraries

| Purpose | Library |
|---|---|
| Arrays / rasters | numpy, xarray, rioxarray, rasterio, zarr, netCDF4 |
| Vector | geopandas, shapely, pyproj |
| Zonal stats | exactextract (or rasterstats) |
| Regridding | xESMF (optional), xarray interp |
| Data access | cdsapi, imdlib, requests |
| ML | scikit-learn, lightgbm, torch (stretch) |
| API | fastapi, pydantic, sqlalchemy, geoalchemy2, uvicorn |
| Jobs | apscheduler (simple) or celery + redis |
| Reports / PDF | matplotlib, jinja2, weasyprint |
| Frontend | react, typescript, vite, maplibre-gl, recharts, i18next |
| Quality | ruff, pytest, mypy (optional) |
