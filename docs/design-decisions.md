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
composite is recomputed. See story 4.4. **Settled by D10:** hand-drawn geometry is an
input, so the question dissolves rather than being answered.

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

> **Superseded by D9.** Kept as written; the reasoning below is still worth knowing,
> the conclusion no longer holds.

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

## D9 — GitHub Issues are the only place stories live (supersedes D7)

**Decided.** `docs/user-stories.md` is deleted. Every story — the whole backlog, not
just the active milestone — is a GitHub issue. Intent and execution live together.

**Why.** D7 bet that a churning backlog is easier to edit as markdown than as issues,
and paid for it with two places a story could live. In practice the duplication was
the expensive part: a story was written in markdown, promoted to an issue, then
finished — and the outcome got written back into the markdown, where the issue that
tracked the work said nothing. Anyone reading the issue got half the story, and the
one-directional "the issue wins" rule quietly inverted.

The backlog has also stopped churning in the way D7 anticipated. Epic 2 took the
shape the first Kiladha composite suggested and stayed there; what changes now is
status, not structure — which is exactly what issues are good at. Labels carry the
epics, checkboxes carry the acceptance criteria, and the closing note carries the
outcome, next to the commits that produced it.

**Cost.** No diff, no bulk edit, no reading the whole backlog in one scroll. `gh issue
list` is a poorer instrument than a file. Accepted, because it buys a single place to
look. Non-story context that used to sit in the same file — personas, out-of-scope —
moved to `CLAUDE.md`, which is read at the start of every session anyway.

---

## D10 — Hand-drawn geometry is an input, never an edit to derived geometry

**Decided.** The AOI is a polygon, not a bounding box. Alongside it the Planner draws
*exclusion zones* (cut) and *inclusion zones* (added). All three are inputs, stored with
the project. The flight boundary stays purely derived from those inputs plus the raster,
and nothing hand-made ever enters the derived chain.

**Why.** D4 said the frontend is an editor, and left open what happens to a manual edit
when the composite is recomputed — the question story 4.4 (#16) carried as `contested`
for the whole of Epic 4. Its three candidate answers were (a) a corrections layer
replayed as a diff after recompute, (b) recompute is destructive with a confirmation,
(c) version the polygon so you can branch.

Making corrections *inputs* is (a), obtained by construction rather than by building a
diff-replay engine. Recompute cannot destroy a hand correction because there is nothing
hand-made downstream to destroy: change the threshold and the contour moves, but the
zones you drew are re-applied to the new contour exactly as they were. No diff, no
replay, no destructive-confirmation dialog, and no silent override of better data —
the correction is visible as its own object rather than baked into a vertex list.

It also collapses three problems into one editor. Drawing the AOI, cutting the harbour
out, and pulling the boundary back over a *Posidonia* meadow are the same gesture on
three lists of polygons.

**Cost.** You cannot drag a vertex of the computed boundary. A correction is made by
drawing an area that adds or an area that cuts, not by grabbing the green line — less
direct, and clumsy for a correction that is genuinely one vertex wide.

**Consequences worth knowing.**

- `BBox` survives, demoted to the *raster envelope*. Sentinel Hub and
  `RatioGrid.gridToLonLat` genuinely need a rectangle; the raster does not become
  non-rectangular, and the polygon never crosses the wire to the API.
- Because the composite is fetched and cached on the envelope, reshaping the AOI *inside*
  its existing envelope is free: a re-clip, not a refetch.
- An exclusion zone strictly inside the boundary is a hole, and holes were being dropped
  at export. That made "cut from the polygon" silently false on the RC, which is why
  #39 emits `<innerBoundaryIs>`.
- The invariant that keeps D10 compatible with the #32 fix: the coastal ribbon must be
  bounded by *exactly* the shape the downstream clip uses. Bounding by the composite
  rectangle while clipping by the AOI polygon reproduces #32 — an annulus around the
  landmass whose hole is the land.

**Revisit if.** Correcting by drawn areas proves too blunt after flying Kiladha once.
Then add direct vertex editing as a new story, on top of this, rather than unpicking it.

---

## Undecided

- **Refraction convention.** Submerged features are displaced by n≈1.34. Does
  `max_depth` mean true depth or apparent depth? Blocks #12.
- **Vertical datum.** Argolic Gulf tides are ~20–30 cm so the error is small, but "4 m"
  still needs a stated reference (MSL vs. instantaneous surface at acquisition).
  Blocks #12.
