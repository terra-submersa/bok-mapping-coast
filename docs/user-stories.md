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

### 1.1 Draw or paste a bounding box `todo` · **Walking Skeleton**
As a Planner, I can define a bounding box for my AOI so the backend knows what to fetch.

- AOI persists between sessions
- Area shown in km²
- Warning if the box exceeds the Processing API single-request limit

### 1.2 Name and save a project `todo`
As a Planner, I can save an AOI as a named project, so Kiladha stays separate from later sites.

### 1.3 See scene availability `todo`
As a Planner, I can see recent Sentinel-2 availability and cloud cover for my AOI,
so I can choose a sensible date range.

- List of candidate dates with cloud %
- I pick a *range*, not individual scenes

---

## Epic 2 — Derive relative depth `epic:sdb`

### 2.1 Request an SDB composite `todo` · **Walking Skeleton**
As a Planner, I can request an SDB composite over a date range and get back a
single-band relative-depth raster.

- Land and cloud masked out (NDWI from B03/B08; SCL for cloud, shadow, cirrus)
- Temporal **median** across all qualifying scenes
- Result cached — the Processing API is metered

### 2.2 See per-pixel scene count `todo`
As a Planner, I can see how many scenes contributed to each pixel, so I can distrust
thin areas.

- Toggleable layer
- **Not optional.** Without it, a two-cloudy-scene artefact is indistinguishable
  from a real shallow shelf.

### 2.3 View depth as a colour ramp over imagery `todo` · **Walking Skeleton**
As a Planner, I can view the depth raster over satellite imagery, so I can judge it
against features I recognise.

### 2.4 Exclude a date range or sub-area `todo`
As a Planner, I can exclude a date or sub-area from the composite, so I can throw out
a scene ruined by glint or a boat wake.

---

## Epic 3 — Calibrate and threshold `epic:calibration`

### 3.1 Live threshold slider `todo` · **Walking Skeleton**
As a Planner, I can drag a threshold slider and watch the contour update live over
imagery, so I can place the boundary by judgement.

- Contour redraws under ~200 ms
- Value shown as raw ratio, and as metres only once calibrated

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
