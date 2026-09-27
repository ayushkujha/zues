# DEMO_SCRIPT.md: 7-minute finale demo

**Goal:** show judges that PanchayatCast does exactly what SIH 26074 asks (block → panchayat downscaling, plots/data/information, multiple variables, agromet advisories) and that it measurably beats today's practice.

---

## Before you go on stage (checklist)

- [ ] `pcast serve` running; open `http://127.0.0.1:8000` in a full-screen browser.
- [ ] Region selector on **Dharwad District** (real pilot). Keep the synthetic demo as a backup.
- [ ] A run selected with interesting rain (a monsoon day). If internet works, fetch a live one on stage (step 6); otherwise use a prepared run.
- [ ] Second tab: farmer view on a phone-sized window (`#/farmer/<gp>`), language **ಕನ್ನಡ**.
- [ ] Downloaded in advance: PDF bulletin (Kannada) and SMS CSV, in case the network is slow.
- [ ] Laptop set to not sleep; the dashboard works offline except the basemap and live fetch.

---

## Script

### 0:00 · The problem (30 s)
> "IMD issues farm weather forecasts per **block**. Dharwad has 8 blocks but **145 Gram Panchayats**. Today every panchayat in a block gets the same forecast and the same advice, even when rain falls on one side of the block and not the other."

Show: **Compare** page, Rainfall, drag the divider slowly from left to right.
> "Left: what farmers get today. Right: what PanchayatCast gives."

### 0:30 · How it works (60 s)
> "We learn each place's local weather signature from years of data (terrain, land cover, water bodies, season) and apply it to every new block forecast. The model is gradient boosting (LightGBM); it's fast and explainable. Crucially, the panchayat values **average back exactly to the official block forecast**: we refine IMD's forecast, we never contradict it."

Show: **Forecast map** → switch Panchayat / Block / Difference views. Point at the "Largest spread inside one block" card.

### 1:30 · One panchayat, all variables (60 s)
Click a panchayat on the map.
> "Five days, all eight variables SIH asks for, with the likely range (p10–p90) and a confidence level. The dashed line is the block value: this panchayat is cooler because it is higher, and wetter because it is on the windward side."

Show the temperature chart, the rain chart, then the panchayat-vs-block table.

### 2:30 · Proof: does it work? (75 s)
Open **Validation**.
> "We checked four ways, always against the baseline of copying the block value:"
1. **Held-out year:** error reduction per variable (show the tiles).
2. **Forecast mode:** "Real forecasts have errors. With realistic errors the gain shrinks with lead time but stays positive." (Switch lead day 1 → 5.)
3. **Unseen places:** "We retrained without whole blocks and without any local history; it still works. So it can scale to districts where we have no fine data."
4. **Station correction:** "When station data is available, M3S learns from it, and it is only switched on where cross-validation shows it helps."
> Be honest: "The Dharwad pilot is validated against satellite/reanalysis grids; the next step is IMD/KSNDMC station data."

### 3:45 · Advisories for the scientist (60 s)
Open **Advisories**.
> "Every panchayat forecast becomes crop- and stage-specific advice using 13 transparent rules (no black box), in English, Hindi and Kannada. The agromet scientist reviews, edits and approves."

Approve one, edit one. Click **PDF bulletin** in Kannada. Show **SMS list**.

### 4:45 · For the farmer (60 s)
Switch to the phone-sized farmer view.
> "The farmer picks their panchayat by name or GPS, and sees today's weather and **what to do**, in their language. They can tap Listen."

Tap 🔊 **ಕೇಳಿ** (Listen). Switch language to हिंदी.

### 5:45 · Live and scalable (45 s)
Open **Runs** → **Fetch live forecast**.
> "This just pulled today's numerical weather forecast for Dharwad's 8 blocks and downscaled it to 145 panchayats in seconds. With IMD's official block forecast as the input, this runs twice a week, automatically."
> "Scale: India has about 7,000 blocks and 2.5 lakh panchayats. The heavy work is training once per district; each forecast run is a few seconds per district on a laptop CPU."

### 6:30 · Close (30 s)
> "PanchayatCast: block forecasts in, panchayat forecasts and advice out: maps, data and farmer-ready information. It is open source, it works on existing forecasts, and it is honest about its accuracy. Next: IMD archives and station data for a full operational pilot."

---

## Likely questions and short answers

| Question | Answer |
|---|---|
| Where does the fine-resolution "truth" come from? | For the pilot: CHIRPS rain (5 km), ERA5-Land temperature/humidity (9 km), ERA5 wind/cloud (25 km). The model's panchayat detail beyond that comes from 30 m terrain and 10 m land cover. Station data is the next step and M3S is ready for it. |
| Does it contradict IMD? | No. The area-weighted average over each block equals the official block value (block consistency). |
| What if a block forecast is wrong? | Downscaling can't fix a wrong block forecast; forecast-mode validation shows the gain shrinks with lead time but stays useful. |
| Why LightGBM and not deep learning? | It's fast, explainable and strong with this data. We also built a U-Net (M4); it is only used if it beats LightGBM on validation. |
| How do advisories get made? | Transparent YAML rules (e.g. rain > 10 mm in 2 days → postpone spraying) × crop calendar × panchayat forecast. Scientists review them before sending. Rules and translations need expert review. |
| Offline / low bandwidth? | The farmer view is light (no map); SMS export covers feature phones; the PDF bulletin prints. |
| Cost to run? | Open-source stack; one laptop handles a district; a small server handles a state. |
| Data licences? | LGD boundaries CC0; Copernicus DEM, WorldCover, ERA5 (CC BY 4.0); CHIRPS public domain; OSM basemap ODbL (attributed). |
