# User stories

Source of truth for **intent**. GitHub Issues track **execution**, and only for the
active milestone. When a story is promoted to an issue, the issue wins.

Status legend: `todo` · `spike` · `doing` · `done` · `parked` · `contested`

## Personas

- **Planner** — at a desk, iterating on the shallow-water polygon days before the trip.
- **Pilot** — on the beach at Kiladha with the RC, needing a file that just works.

Both are currently the same person wearing different hats. The split is kept because
it forces the question *"what does the pilot need that the planner can't anticipate?"* —
which is mostly the mission card, and the fact that nothing can be re-run in the field.

---

## Epic 0 — Spike

### 0.1 Can we get a plausible 4 m contour in Kiladha Bay? `spike` · `done`

Throwaway script, no app, no tests, no architecture. Hit the CDSE Processing API for
the Kiladha AOI, run a Stumpf ratio over a temporal median, dump a GeoTIFF, open it
in QGIS.

**Done when:** we can look at the result and say yes or no. If the contour is
plausible against known features — the Lambayanna structures, the visible sand/rock
transitions — everything downstream is ordinary engineering. If it isn't, we've
learned that for the cost of an afternoon instead of a month.

> **Result: yes.** `scripts/spike-sdb-kiladha.mjs` ran against the 2025-06-01 to
> 2025-09-15 composite and produced `scripts/output/kiladha-sdb-2025-06-01_2025-09-15.tif`.
> Checked in QGIS against the Lambayanna structures — plausible. Everything downstream
> is ordinary engineering; proceeding to the Walking Skeleton.

---

## Epic 1 — Define an area of interest `epic:aoi`

### 1.1 Draw or paste a bounding box `done` · **Walking Skeleton**
As a Planner, I can define a bounding box for my AOI so the backend knows what to fetch.

- AOI persists between sessions
- Area shown in km²
- Warning if the box exceeds the Processing API single-request limit

> **Done.** Drag a rectangle with `terra-draw`, or paste `minLon,minLat,maxLon,maxLat`
> or GeoJSON. Persists to `localStorage`. `packages/core` holds the pure parts —
> `parseBboxInput` and `checkProcessingApiLimit`, which flags a bbox wider than
> 2500 px at Sentinel-2's native 10 m (the synchronous Processing API cap).
> Verified in a browser end to end; the Kiladha spike bbox reads 5.84 km².

### 1.2 Name and save a project `todo`
As a Planner, I can save an AOI as a named project, so Kiladha stays separate from later sites.

### 1.3 See scene availability `todo`
As a Planner, I can see recent Sentinel-2 availability and cloud cover for my AOI,
so I can choose a sensible date range.

- List of candidate dates with cloud %
- I pick a *range*, not individual scenes

---

## Epic 2 — Derive relative depth `epic:sdb`

### 2.1 Request an SDB composite `done` · **Walking Skeleton**
As a Planner, I can request an SDB composite over a date range and get back a
single-band relative-depth raster.

- Land and cloud masked out (NDWI from B03/B08; SCL for cloud, shadow, cirrus)
- Temporal **median** across all qualifying scenes
- Result cached — the Processing API is metered

> **Done.** `GET /api/composite?bbox=&from=&to=` returns a two-band FLOAT32 GeoTIFF
> (band 1 median Stumpf ratio, band 2 scene count — 2.2's layer comes free).
> Output is sized at native 10 m rather than the spike's fixed 1024², and the
> request is rejected before it costs anything if it would exceed the 2500 px cap.
>
> The evalscript is unit tested by evaluating it against synthetic samples, so the
> masking and the median are covered rather than assumed. Responses are cached to
> disk keyed on bbox + range + evalscript version; concurrent requests for the same
> composite collapse onto one upstream call.
>
> Verified against real CDSE: Kiladha 2025-06-01→09-15 returned 309×189 px,
> pixel scale ≈10.0 m, in 12 s; the repeat request was a byte-identical cache hit
> in 24 ms. Exactly one metered call.

### 2.2 See per-pixel scene count `todo`
As a Planner, I can see how many scenes contributed to each pixel, so I can distrust
thin areas.

- Toggleable layer
- **Not optional.** Without it, a two-cloudy-scene artefact is indistinguishable
  from a real shallow shelf.

### 2.3 View depth as a colour ramp over imagery `done` · **Walking Skeleton**
As a Planner, I can view the depth raster over satellite imagery, so I can judge it
against features I recognise.

> **Done.** Basemap is now Esri World Imagery, not OSM streets — the whole point is
> judging the ramp against sand, rock and *Posidonia* you recognise. The composite
> is fetched via a Vite dev proxy, decoded with `geotiff.js`, and painted into a
> MapLibre image source pinned to the AOI corners, with an opacity slider.
>
> The ramp is stretched to the 2nd–98th percentile of **water pixels only**
> (`percentileRange` in core): Stumpf ratios sit in a narrow band, so a naive
> min/max stretch renders the whole bay one flat colour. Pixels with no
> contributing scenes are transparent, so land shows through as imagery.
>
> Scene count is surfaced here rather than waiting for 2.2 — it came free in band 2.
> Kiladha over summer 2025 reports a median of **46 scenes per pixel**.

### 2.4 Exclude a date range or sub-area `todo`
As a Planner, I can exclude a date or sub-area from the composite, so I can throw out
a scene ruined by glint or a boat wake.

---

## Epic 3 — Calibrate and threshold `epic:calibration`

### 3.1 Live threshold slider `done` · **Walking Skeleton**
As a Planner, I can drag a threshold slider and watch the contour update live over
imagery, so I can place the boundary by judgement.

- Contour redraws under ~200 ms
- Value shown as raw ratio, and as metres only once calibrated

> **Done.** `shallowWaterContour` in core wraps `d3-contour`. Two things matter:
> the ratio is negated because Stumpf increases with depth while d3 contours
> *above* a value, and land is pushed to a large negative sentinel so a ratio of 0
> is not read as the shallowest possible water and swallow the coastline.
>
> Kiladha contours in **~7 ms**; slider-to-redraw measured 17–59 ms, well inside
> the 200 ms budget. Metres are refused outright until story 3.2 supplies ≥3
> calibration points — the panel says so rather than staying silent.
>
> The contour traces the sand shelf around the islet and along Lambayanna beach,
> which is the first end-to-end sanity check that the whole chain is right.

> **Bug found and fixed here, dating back to 1.1:** no GeoJSON layer had ever
> rendered. Vite's dependency pre-bundler mangles MapLibre's web worker, and
> without that worker GeoJSON sources produce no tiles — while raster layers
> still draw, so the map looked fine. `optimizeDeps.exclude: ["maplibre-gl"]`
> fixes it. Story 1.1 was verified through the accessibility tree and state, not
> pixels, which is exactly how this slipped through.

### 3.2 Drop known-depth reference points `todo`
As a Planner, I can place reference points and enter their depth, so the app can fit
ratio → metres.

- Fit shown with residuals
- **≥3 points required before metres are displayed at all.** The app must refuse to
  claim metric accuracy on fewer.

### 3.3 Persist calibration `todo`
As a Planner, I can save a calibration with the project so I don't redo it.

---

## Epic 4 — Turn contour into a flyable polygon `epic:polygon`

### 4.1 Select the contour ring `todo`
As a Planner, I can choose which ring is my survey area, discarding offshore fragments
and noise.

### 4.2 Simplify with visible vertex count `todo` · **Walking Skeleton**
As a Planner, I can simplify the polygon with a tolerance control and see the vertex
count, so it stays within what Pilot 2 accepts.

- Live vertex count with a warning above a configured ceiling
- **Non-destructive** — the original contour is retained

### 4.3 Landward buffer `todo`
As a Planner, I can apply a landward buffer in metres, so flight lines catch shoreline
features for SfM tie points.

### 4.4 Hand-edit polygon vertices `contested`
As a Planner, I can edit vertices, so I can pull the boundary back over *Posidonia*
where I know SDB lies.

- Edits survive re-running the composite, **or** I am warned explicitly that they won't

> **Unresolved.** Options: (a) edits as a separate corrections layer reapplied as a
> diff; (b) recompute is explicitly destructive with confirmation; (c) version the
> polygon so you can branch. Current plan is (b), building (a) only if it hurts.

### 4.5 Exclusion zones `todo`
As a Planner, I can mark exclusion zones (moorings, harbour, swimming areas) so they
are cut from the survey polygon.

---

## Epic 5 — Flight parameters `epic:flight` · **PARKED**

> Parked behind a working 1 → 2 → 3 → 4 → 6 chain. These are useful, entirely
> independent of the hard part, and the most fun to build — which is exactly why
> they will eat the schedule if let loose early.

### 5.1 GSD → altitude `parked`
As a Planner, I can enter target GSD and see required AGL altitude for the Zenmuse P1.

### 5.2 Solar position for a planned datetime `parked`
As a Planner, I can set a planned survey date and time and see sun azimuth and elevation.

### 5.3 Recommended course angle and time window `parked`
As a Planner, I get a recommended flight-line course angle and best time window, so I
can enter them into Pilot 2.

- The recommendation explains its reasoning in one line rather than emitting a bare number

### 5.4 Flight time and battery estimate `parked`
As a Planner, I can see estimated flight time and battery count, so I know whether it
is a one-morning job.

---

## Epic 6 — Export `epic:export`

### 6.1 Export Pilot 2-compatible boundary KML `todo` · **Walking Skeleton**
As a Planner, I can export the polygon as a KML that DJI Pilot 2 imports as a mapping
boundary.

- Validated against a KML that Pilot 2 itself produced
- **Not done until a file has round-tripped on the actual RC.** Pilot is fussy about
  KML structure; the reliable approach is to use a Pilot-exported mission as template.

### 6.2 Mission card `todo`
As a Pilot, I get a printable mission card with course angle, altitude, overlap, time
window, and takeoff point, so I can set up on the beach without the app.

### 6.3 Offline access `todo`
As a Pilot, I can access the KML and mission card offline, because there is no
reliable signal at Kiladha.

---

## Deliberately out of scope

- Multi-user, authentication, sharing
- Mission history and flight logs
- WPML waypoint generation (Pilot 2 plans the lines; revisit only if glint control
  proves impossible by hand)
- Multi-year composite comparison — arguably interesting for coastal change, but
  scope creep for v1

---

## Walking Skeleton milestone

The thinnest chain that produces a file you can actually fly at Kiladha:

**0.1** (spike, first) → **1.1** → **2.1** → **2.3** → **3.1** → **4.2** → **6.1**

No calibration in metres. No editing. No buffer. Bounding box to KML.
