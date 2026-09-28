# DESIGN.md: UI/UX Design

**Version:** 0.2 · **Date:** 2026-09-27 · Implemented in `web/` (see TECHNICAL.md §15)

---

## 1. Design principles

1. **Map first.** Panchayat-level detail is the product, so the map is the hero.
2. **Show the difference.** Always make it easy to compare *block view vs. panchayat view*; that contrast is the whole point.
3. **Action over data.** For farmers, lead with *what to do*, then the numbers.
4. **Trust through transparency.** Show confidence levels, data source, issue time and why an advisory was triggered.
5. **Works everywhere.** Low bandwidth, small screens, Indic scripts, colour-blind safe.
6. **Consistent with IMD conventions.** Colour-coded warnings (Green/Yellow/Orange/Red) and IMD rainfall categories.

---

## 2. Users and their surfaces

| Persona | Surface | Device |
|---|---|---|
| Agromet scientist (DAMU/AMFU) | **Scientist dashboard** (full) | Desktop/laptop |
| Block/district officer | Dashboard (alerts view) | Desktop/tablet |
| Farmer | **Farmer view** (simple) + SMS/WhatsApp text | Low-end Android phone |
| Evaluator / judge | Dashboard + **Validation page** | Desktop/projector |

---

## 3. Information architecture

```
Scientist Dashboard
├── 1. Forecast Map (home)
├── 2. Compare (Block vs Panchayat)
├── 3. Panchayat Detail (side panel / page)
├── 4. Advisories (review → edit → approve → export)
├── 5. Validation (accuracy metrics)
└── 6. Data & Runs (upload forecast, run status, exports)

Farmer View
├── Select panchayat (search / GPS)
└── 5-day forecast + today's advice
```

---

## 4. Screens

### 4.1 Forecast Map (home)

```
┌──────────────────────────────────────────────────────────────────────┐
│ PanchayatCast   District: [Dharwad ▾]  Issued: 26 Sep 2026 (Tue)  🌐 EN▾│
├───────────────┬──────────────────────────────────────────────────────┤
│ VARIABLE      │                                                      │
│ ● Rainfall    │                                                      │
│ ○ Max Temp    │               MAP (panchayat polygons,               │
│ ○ Min Temp    │               coloured by selected variable)         │
│ ○ Humidity    │                                                      │
│ ○ Wind        │                block outlines drawn on top           │
│ ○ Cloud       │                                                      │
│               │                                           [legend]   │
│ VIEW          │                                                      │
│ [Block|Panch.]│                                                      │
│               ├──────────────────────────────────────────────────────┤
│ ALERTS (12)   │  Day:  [D1 27 Sep]─[D2]─[D3]─[D4]─[D5]   ▶ animate   │
│ 🔴 3  🟠 4 🟡 5│                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
```
- Hovering a panchayat shows a tooltip: name, value, block value, difference, confidence.
- Clicking a panchayat opens the **Panchayat Detail** side panel.
- The day slider can animate through D1–D5.

### 4.2 Compare view
- **Swipe slider:** left side shows the block forecast (flat colour per block), right side shows the panchayat forecast.
- Optional **difference map** (panchayat − block) with a diverging colour scale.
- This is the headline visual for the demo and pitch.

### 4.3 Panchayat Detail
```
┌─────────────────────────────────────────┐
│ Hebballi GP  ·  Block: Dharwad  · LGD …  │
│ Elevation 690 m · Confidence: ● High     │
├─────────────────────────────────────────┤
│ D1   D2   D3   D4   D5                   │
│ 🌧   🌦   ☀    ☀    🌧                   │
│ 18mm 4mm  0    0    32mm                 │
│ 31°/21° …                                │
├─────────────────────────────────────────┤
│ [Line chart: Tmax/Tmin; bars: rain]      │
│  shaded band = uncertainty (p10–p90)     │
├─────────────────────────────────────────┤
│ ADVISORIES                    Crop: [▾]  │
│ 🟠 Postpone pesticide spraying (D1–D2)   │
│    Why: rain 18 mm on D1 > 10 mm rule    │
│ 🟡 Ensure drainage in fields (D5)        │
├─────────────────────────────────────────┤
│ Block forecast vs this panchayat (table) │
└─────────────────────────────────────────┘
```

### 4.4 Advisories
- A table of panchayats × crops with the auto-drafted advisory, severity and triggering rule.
- Filter by severity, crop and block.
- Inline edit → **Approve** → **Export PDF bulletin / send**.
- Language toggle previews translated text.

### 4.5 Validation
- Metric cards: RMSE/MAE per variable, **% improvement vs. baseline** (large and prominent).
- Chart: RMSE by lead day (M0 vs M1 vs M3).
- Scatter plot: predicted vs. observed.
- Rainfall contingency table and CSI/POD/FAR.
- Station map: stations coloured by error.

### 4.6 Data & Runs
- Upload a block forecast (CSV) with drag-and-drop and validation feedback.
- Run history: issue date, source (official/emulated), model version, status, duration.
- Download exports (CSV, GeoJSON, GeoTIFF, PDF).

### 4.7 Farmer view (mobile)
```
┌──────────────────────┐
│ 📍 Hebballi GP    ▾  │
│ ಕನ್ನಡ | हिंदी | EN     │
├──────────────────────┤
│ TODAY                │
│ 🌧 Heavy rain likely  │
│ 18 mm · 31° / 21°    │
├──────────────────────┤
│ 🟠 WHAT TO DO        │
│ Do not spray today.  │
│ Clear field drains.  │
│ 🔊 Listen            │
├──────────────────────┤
│ Next days            │
│ Sat 🌦 Sun ☀ Mon ☀ … │
└──────────────────────┘
```
- Large icons, minimal numbers, advice first.
- The Listen button reads the forecast and advice aloud (browser text-to-speech).
- Pages must stay light (< 200 KB); there is no map on the farmer view.

---

## 5. Visual design system

Direction: a calm, precise forecasting console. Surfaces stay neutral so the weather data carries the colour; one green accent marks selection and primary actions. No emoji anywhere in the UI (they render differently on every device); all icons are inline SVG. Tokens live in `web/src/styles.css`.

### 5.1 Colour: UI tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F6F8` | `#0C0F13` | Page background |
| `--surface` / `--surface-2` | `#FFFFFF` / `#F0F2F5` | `#14181E` / `#1A1F26` | Cards, panels / insets, segmented controls |
| `--text` / `--text-2` / `--text-3` | `#11151A` / `#4F5866` / `#858D99` | `#E8ECF1` / `#A5AEBB` / `#6E7784` | Primary / secondary / tertiary text |
| `--accent` | `#116149` | `#3CBF8F` | Brand, selection, primary buttons |
| `--border` | `#E2E5EA` | `#252B34` | Dividers |
| `--warm` / `--cool` | `#D9622B` / `#2F6FB5` | `#FF8A52` / `#6AA7FF` | Max/min temperature, warmer/wetter deltas |

### 5.2 Colour: severity (IMD impact-based convention)

| Level | Colour | Shape | Label |
|---|---|---|---|
| Red | `#CF2E2E` | Octagon with bar | Take action |
| Orange | `#E36D0E` | Triangle | Be prepared |
| Yellow | `#D9A400` | Circle | Be aware |
| Green | `#2F8A45` | Tick | No risk |

Severity is always shape + colour + label (`SeverityIcon`), so it never depends on colour alone.

### 5.3 Colour: map scales

| Variable | Scale type | Palette |
|---|---|---|
| Rainfall | Sequential, **binned by IMD categories** (0, 0.1–2.4, 2.5–15.5, 15.6–64.4, 64.5–115.5, 115.6–204.4, ≥204.5 mm) | Pale grey → light blue → deep blue → violet |
| Tmax / Tmin | Sequential, 7 steps | Cream → orange → brick |
| RH | Sequential, 7 steps | Light teal → dark teal |
| Wind | Sequential, 7 steps | Light violet → dark violet |
| Cloud (okta 0–8) | Sequential, 7 steps | Light grey → slate |
| Difference (panchayat − block) | **Diverging**, labelled with words at both ends (drier/wetter, cooler/warmer…) | Blue ← neutral → red (flipped for rain and RH so wetter is blue) |
| Confidence | Dashed outline (toggle) | Low-confidence panchayats outlined |

### 5.4 Typography
- **IBM Plex Sans** (UI), **IBM Plex Mono** (IDs, rule codes, model versions), **IBM Plex Sans Devanagari** and **Noto Sans Kannada** for Indic text. PDFs use Noto (bundled).
- Scale: 11.5 / 12.5 / 13.5 (UI body) / 15 / 20 / 26 px; big numbers 34–54 px. The farmer view uses 16–17 px body text.
- All numbers use tabular figures.

### 5.5 Iconography
- One line-icon set (24 px grid, 1.75 stroke) in `web/src/components/Icon.tsx`: UI actions, weather variables (drop, thermometer ↑/↓, droplets, wind, cloud) and weather glyphs (clear, partly cloudy, cloudy, drizzle, rain, storm) chosen from rain and cloud amounts.

### 5.6 Layout
- Top bar (56 px): brand, district, text tabs with an underline, data-source chip ("Demo data" / "Not an IMD bulletin"), bulletin picker with a source-coloured dot, farmer-view link, theme toggle.
- Forecast page: full-bleed map. Floating left panel (variable, Panchayat/Block/Difference, stepped legend, "largest spread inside one block" callout, variable tiles, layers). Top-right: panchayats on alert. Bottom: 5-day timeline with the district average per day and play button. Clicking a panchayat opens a 440 px detail column on the right (the map shrinks rather than being covered).
- Breakpoints: ≥1180 px full layout; <1180 px the left panel stops above the timeline; <760 px the panel collapses to title + legend ("Variables and layers" expands it) and the detail column becomes full-screen.

---

## 6. Accessibility and localisation
- WCAG 2.1 AA contrast for text.
- Colour-blind-safe palettes; severity always has an icon and label.
- Touch targets ≥ 44 px on mobile.
- UI strings live in i18n files (`en`, `hi`, plus the pilot state language). Translations need human review.
- Units displayed with every number; dates in local format.

---

## 7. Map styling
- Basemap: OpenStreetMap raster tiles, desaturated (and darkened in dark mode) so the data colours stand out; can be switched off. (CARTO basemaps now need an API key.)
- Panchayat borders: 0.5 px, semi-transparent. Block borders: 2 px dark. District border: 3 px.
- Selected panchayat: 3 px accent outline.
- Use simplified geometries per zoom level for performance.

---

## 8. Demo / pitch visuals checklist
- [ ] Compare swipe: block (flat) vs. panchayat (detailed) rainfall map
- [ ] Terrain overlay showing why temperatures differ (hills cooler)
- [ ] "X% more accurate" validation card
- [ ] One panchayat story: forecast → advisory → farmer phone screen
- [ ] National scalability slide (map of India with block/GP counts)
