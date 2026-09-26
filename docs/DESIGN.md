# DESIGN.md: UI/UX Design

**Version:** 0.1 · **Date:** 2026-09-26

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
- The 🔊 button reads the advisory aloud (text-to-speech, stretch goal).
- Pages must stay light (< 200 KB); there is no map on the farmer view.

---

## 5. Visual design system

### 5.1 Colour: UI tokens

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F7F8F5` | `#12151A` | Page background |
| `--surface` | `#FFFFFF` | `#1B2028` | Cards, panels |
| `--text` | `#1C2321` | `#E8ECEF` | Primary text |
| `--text-muted` | `#5B6660` | `#9AA4AD` | Secondary text |
| `--primary` | `#2E7D32` | `#66BB6A` | Brand (agriculture green) |
| `--accent` | `#1565C0` | `#64B5F6` | Links, selection (weather blue) |
| `--border` | `#DDE2DC` | `#2C333D` | Dividers |

### 5.2 Colour: severity (IMD impact-based convention)

| Level | Colour | Meaning |
|---|---|---|
| 🟢 Green | `#2E7D32` | No action needed |
| 🟡 Yellow | `#F9A825` | Be aware / watch |
| 🟠 Orange | `#EF6C00` | Be prepared |
| 🔴 Red | `#C62828` | Take action |

Always pair colour with an icon and label so the meaning never depends on colour alone.

### 5.3 Colour: map scales

| Variable | Scale type | Palette |
|---|---|---|
| Rainfall | Sequential, **binned by IMD categories** (0, 0.1–2.4, 2.5–15.5, 15.6–64.4, 64.5–115.5, 115.6–204.4, ≥204.5 mm) | White → light blue → deep blue → purple |
| Tmax / Tmin | Sequential | Viridis-style or yellow → orange → red (colour-blind safe) |
| RH | Sequential | Light teal → dark teal |
| Wind | Sequential + arrows | Grey-green scale with direction arrows at panchayat centroids |
| Cloud (okta 0–8) | Sequential | White → grey |
| Difference (panchayat − block) | **Diverging** | Blue ← white → red |
| Confidence | Hatch/opacity overlay | Low-confidence areas hatched |

### 5.4 Typography
- **Noto Sans** + **Noto Sans Devanagari / Kannada / Telugu / Tamil…** (supports all Indic scripts consistently).
- Scale: 12 / 14 / 16 (body) / 20 / 24 / 32 px. The farmer view uses 18 px minimum body text.
- Numbers in tables use tabular figures.

### 5.5 Iconography
- Weather icons: sun, partly cloudy, cloudy, light/moderate/heavy rain, thunderstorm, wind, heat.
- Farm action icons: spray, irrigate, sow, harvest, drainage, livestock shelter.
- Use an open-source icon set (e.g. Material Symbols + Meteocons, check licenses).

### 5.6 Layout
- Dashboard: left control panel (280 px), map fills the rest, detail panel slides in from the right (400 px).
- Breakpoints: ≥1200 px full layout; 768–1199 px collapsible panels; <768 px stacked, map on top.

---

## 6. Accessibility and localisation
- WCAG 2.1 AA contrast for text.
- Colour-blind-safe palettes; severity always has an icon and label.
- Touch targets ≥ 44 px on mobile.
- UI strings live in i18n files (`en`, `hi`, plus the pilot state language). Translations need human review.
- Units displayed with every number; dates in local format.

---

## 7. Map styling
- Basemap: light, low-detail (roads and place names muted) so the data colours stand out.
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
