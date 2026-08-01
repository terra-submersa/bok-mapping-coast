# Design decisions

ADR-lite. Each entry records what was decided, why, and what it costs.
Add to the bottom; don't rewrite history — supersede it.

---

## D1 — Depth comes from Sentinel-2 SDB computed in-app

**Decided.** Not a supplied raster, not hand-drawn.

**Why.** For a 4 m contour the alternatives fail. EMODnet and GEBCO have grid spacing
far too coarse near shore — the 4 m contour would be pure interpolation artefact.
Nautical charts (HNHS for Greek waters) are sparse, generalized, and deliberately
datum-shifted shallow for safety of navigation. Sentinel-2 at 10 m is the right scale.

**Cost.** SDB is the project's main technical risk. It needs calibration data we may
not have, and it degrades badly over seagrass. Mitigated by D3 and D4.

---

## D2 — Use the Copernicus Processing API, not local raster processing

**Decided.** POST a bbox, date range, and evalscript to the CDSE Sentinel Hub
Processing API; receive a small GeoTIFF for the AOI only.

**Why.** The obvious route — download L2A products, decode JP2, band math in Node —
means gigabyte tiles and a fight with GDAL bindings for a few km² of coast. Evalscripts
are JavaScript, so the scientifically interesting code stays in the project's language.
The backend then only handles a few-megabyte single-band raster, which `geotiff.js`
reads in pure TypeScript.

**Cost.** A metered external dependency and an OAuth flow. Requires aggressive caching.

---

## D3 — The threshold is a UI parameter, not a constant

**Decided.** `max_depth` is derived, not input. The user drags a threshold over the
ratio raster while watching the contour move against imagery.

**Why.** Stumpf yields a relative ratio; converting to metres requires fitting against
known soundings, which we probably lack for Kiladha. Rather than fighting that, the
weakest technical link becomes an interaction-design problem — a much better place for
it to live. It also aligns exactly with the decision to make the frontend an editor.

**Cost.** The output is only as good as the operator's judgement. Guardrail: metres are
not displayed at all until ≥3 calibration points are entered.

---

## D4 — The frontend is an editor, not a viewer

**Decided.** Editable polygon plus parameters.

**Why.** SDB will be wrong over *Posidonia* — seagrass reads dark and is classified as
deep, so the contour will bite inward over meadows. Kiladha Bay has exactly this
substrate mix. Treating the SDB contour as a *draft* to be corrected, rather than as
ground truth, is the only honest design.

**Cost.** Raises the unresolved question of what happens to manual edits when the
composite is recomputed. See story 4.4.

---

## D5 — Output is a boundary KML; Pilot 2 plans the lines

**Decided.** No WPML waypoint generation.

**Why.** DJI Pilot 2 imports a KML boundary and generates its own lawnmower path.
Building a full WPML generator is substantially more work and only buys control over
line azimuth.

**Cost.** We lose azimuth control, which is what determines sun glint — the dominant
image-quality factor over water. Mitigated by emitting a *recommended course angle* in
a mission card that the pilot types into Pilot 2 by hand. Ten seconds of manual work
instead of a waypoint engine.

**Revisit if.** Manual azimuth entry proves unreliable in the field.

---

## D6 — Monorepo with a pure `core` package

**Decided.** `packages/core` holds geometry and mission logic with zero I/O; both
`apps/api` and `apps/web` consume it.

**Why.** Everything downstream of the raster is pure geometry and could run in either
place. Keeping it I/O-free makes the interesting logic unit-testable without a server
or a browser.

**Cost.** Monorepo tooling overhead for what is currently a solo project.

---

## D7 — Stories in markdown, issues for execution only

**Decided.** `docs/user-stories.md` is the source of truth for intent. GitHub Issues
are created only for the active milestone.

**Why.** The backlog is still churning — story 4.4 is unresolved and Epic 2 will change
shape once the first Kiladha composite comes back. Editing twenty-five GitHub issues is
miserable: no diff, no bulk edit, no review, no way to see what changed in the backlog
this week. Markdown gives all of that, and can be read whole at the start of a session.

**Cost.** Two places where a story can live. Avoided by a one-directional rule: markdown
describes intent, issues track execution, and once promoted the issue wins.

---

## D8 — Kiladha Bay as the test ground

**Decided.** AOI runs from the bay mouth to Lambayanna beach inclusive, ~3–4 km².

**Why.** Small and enclosed rather than a 15 km open coastline, so one Processing API
request covers it and a survey is a one- or two-battery job. Sheltered, so the surface
is often calm. Contains the full substrate mix — sand, *Posidonia*, rock near Franchthi —
which stress-tests SDB properly. And the submerged structures off Lambayanna sit in a
couple of metres with published positions, giving a free independent depth reference.

---

## Undecided

- **Refraction convention.** Submerged features are displaced by n≈1.34. Does
  `max_depth` mean true depth or apparent depth?
- **Vertical datum.** Argolic Gulf tides are ~20–30 cm so the error is small, but "4 m"
  still needs a stated reference (MSL vs. instantaneous surface at acquisition).
- **Manual edits vs recompute.** See story 4.4.
