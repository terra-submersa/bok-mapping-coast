# CLAUDE.md

Context for Claude Code working in this repository. Read this first, every session.

## What this project is

`bok-mapping-coast` generates a **flight boundary** for a DJI Matrice 350 RTK doing
**aerial** photogrammetry over shallow sea. The target zone is the water shallower
than `max_depth` (default 4 m), derived from Sentinel-2 satellite-derived bathymetry.

The output is a KML polygon that DJI Pilot 2 imports as a mapping-mission boundary.
Pilot 2 plans the lawnmower lines itself; we do **not** generate waypoints.

Part of the Terra Submersa project — documenting submerged archaeology in the
Argolic Gulf, Greece.

**First and only AOI for now: Kiladha Bay, up to and including Lambayanna beach.**
Roughly 3–4 km² of water. Sheltered, mixed sand / *Posidonia* / rock substrate.
The submerged Bronze Age structures off Lambayanna sit in ~1–3 m and are a useful
independent depth reference.

## The one thing to understand about this project

The risk is wildly lopsided. Turning a polygon into a KML is a few hundred lines of
straightforward geometry. Knowing *where the sea is shallower than 4 m* is the hard,
uncertain, possibly-unsolvable part.

Therefore: **the depth pipeline and the mission pipeline must stay separable**, with
a plain GeoJSON polygon as the contract between them. It must always be possible to
hand-draw a polygon in QGIS and run the rest of the chain on it.

Do not entangle them. If you find yourself passing a raster into the KML builder,
stop.

## Architecture (decided)

pnpm monorepo.

```
packages/core      Pure functions. Contour, simplify, buffer, geometry, solar
                   position, GSD/altitude math. ZERO I/O. Fully unit tested.
packages/dji       KML serialization for DJI Pilot 2. Isolated because Pilot is
                   fussy and this will need empirical fixing.
apps/api           Node service. Talks to Copernicus, handles rasters, caches,
                   persists projects. The only place with I/O and secrets.
apps/web           Vite + React. MapLibre GL JS. Polygon editing + parameters.
docs/              design-decisions.md — ADR-lite. The backlog is in GitHub Issues.
scripts/           One-off and bootstrap scripts.
```

`core` exists so the interesting logic is testable without a server or a browser.
Both `api` and `web` consume it.

The monorepo is scaffolded and runnable (Node 22 — see `.nvmrc` — via `corepack`,
pnpm workspaces, Biome, Vitest). From the repo root:

```
pnpm install   # once per clone / after pulling dependency changes
pnpm dev       # apps/api on :8787, apps/web on :5173, in parallel
pnpm test      # vitest across all packages/apps
pnpm build     # tsc + vite build across all packages/apps
pnpm lint      # biome check
```

### Provisional stack choices

These are defaults, not commandments. Push back if you disagree — but say so
explicitly rather than silently substituting.

- Runtime: Node 22+, TypeScript strict, ESM
- API framework: Hono
- Raster reading: `geotiff.js` (pure JS, reads COGs)
- Geometry: `@turf/turf` for buffer and simplify
- Contouring: `d3-contour` or `marchingsquares` — evaluate both
- Frontend: React + Vite + MapLibre GL JS + `terra-draw` for polygon editing
- Tests: Vitest
- Lint/format: Biome

## Domain constraints that are NOT obvious

These have bitten this problem class before. Treat them as requirements, not trivia.

### Do not download and process Sentinel-2 tiles in Node

Use the **Copernicus Data Space Ecosystem Sentinel Hub Processing API**. You POST a
bbox, a date range, and an evalscript; you get back a small GeoTIFF for the AOI only.
Evalscripts are JavaScript, so the science stays in our language.

Doing it the other way — fetching L2A products, decoding JP2, band math locally —
means gigabytes of tiles and a fight with GDAL bindings. Don't.

### Temporal median is not optional

A single scene gives you glint, waves, and boat wakes. The composite must take a
**median across many clear scenes** (target: a summer's worth). This is the single
largest quality lever in the whole project. Build it in from the start.

Also emit a **per-pixel scene count** layer. Without it you cannot distinguish a
real shallow shelf from an artefact built on two cloudy scenes.

### Stumpf gives a ratio, not metres

`ratio = ln(n · B02) / ln(n · B03)` with `n` a fixed scalar (~1000) chosen to keep
the logarithms positive. Depth is then `m1 · ratio - m0`, fitted against known
soundings.

We likely have few or no soundings. So: **`max_depth` is not a constant in the code.**
The threshold is a live UI parameter that the user drags while watching the contour
move over satellite imagery. Metres are only displayed once ≥3 calibration points
have been entered. Below that, show the raw ratio and do not imply metric accuracy.

### Posidonia will lie to you

Seagrass meadows read dark and are classified as *deep*. Bright sand reads shallow.
In Kiladha Bay both are present, which is precisely why it is a good test ground and
precisely why the contour will be wrong in places.

The manual polygon editing feature exists for this reason. It is not a nicety.

### Water has no tie points

Structure-from-motion fails over open water. The exported polygon must be
**buffered landward** (20–50 m) so every flight line catches shoreline features.
The SDB contour is therefore an *input* to the flight area, not the flight area.

### Sun glint dominates image quality

The specular reflection cone blows out a strip of every frame. Since Pilot 2 plans
the lines, we cannot set the azimuth — so we compute solar position for a planned
datetime and **emit a recommended course angle and time window in a mission card**
that the pilot types into Pilot 2 by hand.

### Miscellaneous

- **Refraction**: submerged features are displaced by n≈1.34. Decide and document
  whether `max_depth` means true depth or apparent depth. Currently undecided.
- **Vertical datum**: Argolic Gulf tides are ~20–30 cm, so small, but "4 m" still
  needs a stated reference. Currently undecided.
- **Pilot 2 KML is fussy.** The reliable approach is to export a dummy mission from
  Pilot itself and use its XML as a template, rather than emitting generic KML.
  Do not consider issue #7 done until a file has round-tripped on the actual RC.
- **Vertex count**: a raster-derived contour has thousands of vertices and many
  rings with holes. Pilot 2 wants one simple polygon and the RC chokes on high
  vertex counts. Simplification is mandatory, must be non-destructive (keep the
  original contour), and must show a live vertex count.

## Working agreements

1. **The spike comes before the app.** Before building anything, prove we can get a
   plausible 4 m contour in Kiladha Bay with a throwaway script that dumps a GeoTIFF
   for inspection in QGIS. If SDB doesn't work there, the app is pointless.
   **Status: done.** `scripts/spike-sdb-kiladha.mjs` produced a plausible contour,
   checked against the Lambayanna structures in QGIS — see issue #1. The monorepo
   scaffold above followed from this result.
2. `packages/core` is pure and tested. If a function needs the network, it is in
   the wrong package.
3. Secrets live in `apps/api` env only. Never commit CDSE credentials.
4. Cache Processing API responses aggressively — it is a metered service and the
   composite is expensive.
5. Epic 5 (GSD, flight time, solar) is the most fun to build and the least load
   bearing. It stays parked behind a working chain of Epics 1 → 2 → 3 → 4 → 6.

## Open questions

Flagged rather than guessed. Raise these rather than silently deciding.

- **Manual edits vs recompute** (issue #16). If edits are wiped on recompute the
  tool is infuriating; if they persist blindly they silently override better data.
  Current plan: recompute is explicitly destructive with a confirmation. Revisit
  if it hurts.
- Refraction convention for `max_depth`.
- Vertical datum reference.
- Whether multi-year composite comparison is wanted (potentially interesting for
  coastal change, definitely scope creep for v1).

## Backlog

**GitHub Issues are the single source of truth for stories — intent *and* execution.**
There is no backlog markdown file. `docs/user-stories.md` used to hold it and has
been removed; do not recreate it, and do not mirror stories into any other document.

At the start of a session, read the backlog from GitHub rather than from memory:

```bash
gh issue list --state open --limit 50          # what's outstanding
gh issue list --milestone "Walking Skeleton"   # the active milestone
gh issue view <n>                              # a story, its criteria, its outcome
```

Conventions:

- Titles keep the `<epic>.<story>` prefix (`4.1 Select the contour ring`) — the
  numbering is stable and worth keeping for cross-references.
- Epics are labels: `epic:aoi`, `epic:sdb`, `epic:calibration`, `epic:polygon`,
  `epic:flight`, `epic:export`. Status that isn't open/closed is a label too:
  `spike`, `contested`, `parked`.
- Milestones are for scheduling only. `Walking Skeleton` is the active one;
  everything else carries no milestone.
- Acceptance criteria are checkboxes in the body. When a story is finished, close
  it **and** append the outcome — what was built, what was measured, what is still
  unverified. That closing note is the project's memory; a bare "done" loses it.
- Reference issues by number (`#7`), never by story number, in code and commits.

## Personas

- **Planner** — at a desk, iterating on the shallow-water polygon days before the trip.
- **Pilot** — on the beach at Kiladha with the RC, needing a file that just works.

Both are currently the same person wearing different hats. The split is kept because
it forces the question *"what does the pilot need that the planner can't anticipate?"* —
which is mostly the mission card, and the fact that nothing can be re-run in the field.

## Deliberately out of scope

- Multi-user, authentication, sharing
- Mission history and flight logs
- WPML waypoint generation (Pilot 2 plans the lines; revisit only if glint control
  proves impossible by hand)
- Multi-year composite comparison — arguably interesting for coastal change, but
  scope creep for v1
