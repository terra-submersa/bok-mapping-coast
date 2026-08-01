#!/usr/bin/env bash
#
# Bootstrap GitHub labels, the Walking Skeleton milestone, and its issues.
#
# Idempotent-ish: label creation failures are tolerated, but re-running WILL
# create duplicate issues. Run once.
#
# Requires: gh CLI, authenticated, with the repo as origin.
#   gh auth status
#
set -euo pipefail

REPO="terra-submersa/bok-mapping-coast"
MILESTONE="Walking Skeleton"

echo "==> Repo: $REPO"
gh repo view "$REPO" >/dev/null

# ---------------------------------------------------------------- labels ----
echo "==> Labels"
create_label() {
  gh label create "$1" --repo "$REPO" --color "$2" --description "$3" 2>/dev/null \
    && echo "    + $1" \
    || echo "    . $1 (exists)"
}

create_label "epic:aoi"         "1d76db" "Area of interest definition"
create_label "epic:sdb"         "0e8a16" "Satellite-derived bathymetry"
create_label "epic:calibration" "fbca04" "Threshold and depth calibration"
create_label "epic:polygon"     "d93f0b" "Contour to flyable polygon"
create_label "epic:flight"      "c5def5" "Flight parameters (parked)"
create_label "epic:export"      "5319e7" "KML and mission card export"
create_label "spike"            "b60205" "Throwaway investigation, no production code"
create_label "contested"        "e99695" "Design not yet resolved"

# ------------------------------------------------------------- milestone ----
echo "==> Milestone"
if gh api "repos/$REPO/milestones" --jq '.[].title' | grep -qx "$MILESTONE"; then
  echo "    . $MILESTONE (exists)"
else
  gh api "repos/$REPO/milestones" -f title="$MILESTONE" \
    -f description="Thinnest chain from bounding box to a flyable KML at Kiladha." \
    >/dev/null
  echo "    + $MILESTONE"
fi

# ---------------------------------------------------------------- issues ----
echo "==> Issues"
new_issue() {
  local title="$1" labels="$2" body="$3"
  gh issue create --repo "$REPO" \
    --title "$title" --label "$labels" --milestone "$MILESTONE" --body "$body" \
    >/dev/null
  echo "    + $title"
}

new_issue "Spike: can we get a plausible 4 m contour in Kiladha Bay?" \
  "spike,epic:sdb" \
"Throwaway script. No app, no tests, no architecture.

Hit the CDSE Sentinel Hub Processing API for the Kiladha AOI, run a Stumpf ratio
over a temporal median, dump a GeoTIFF, open it in QGIS.

**Done when** we can look at the result and say yes or no. If the contour is
plausible against known features — the Lambayanna structures, visible sand/rock
transitions — everything downstream is ordinary engineering. If it isn't, we've
learned that for the cost of an afternoon.

This blocks everything else. Do not start the app first.

Story 0.1 in \`docs/user-stories.md\`."

new_issue "1.1 Define an AOI bounding box" \
  "epic:aoi" \
"As a Planner, I can define a bounding box for my AOI so the backend knows what to fetch.

- [ ] AOI persists between sessions
- [ ] Area shown in km²
- [ ] Warning if the box exceeds the Processing API single-request limit

Story 1.1 in \`docs/user-stories.md\`."

new_issue "2.1 Request an SDB composite" \
  "epic:sdb" \
"As a Planner, I can request an SDB composite over a date range and get back a
single-band relative-depth raster.

- [ ] Land and cloud masked (NDWI from B03/B08; SCL for cloud, shadow, cirrus)
- [ ] Temporal **median** across all qualifying scenes — not a single scene
- [ ] Response cached; the Processing API is metered

The temporal median is the single largest quality lever in the project. Build it
in from the start rather than adding it later.

Story 2.1 in \`docs/user-stories.md\`."

new_issue "2.3 View depth raster over satellite imagery" \
  "epic:sdb" \
"As a Planner, I can view the depth raster as a colour ramp over satellite imagery,
so I can judge it against features I recognise.

Story 2.3 in \`docs/user-stories.md\`."

new_issue "3.1 Live threshold slider" \
  "epic:calibration" \
"As a Planner, I can drag a threshold slider and watch the contour update live over
imagery, so I can place the boundary by judgement.

- [ ] Contour redraws under ~200 ms
- [ ] Value shown as raw ratio; metres only once calibrated (see 3.2)

Stumpf yields a relative ratio, not metres. Rather than fighting that, the
threshold is a live parameter rather than a constant. See D3 in
\`docs/design-decisions.md\`.

Story 3.1 in \`docs/user-stories.md\`."

new_issue "4.2 Simplify polygon with visible vertex count" \
  "epic:polygon" \
"As a Planner, I can simplify the polygon with a tolerance control and see the
vertex count, so it stays within what Pilot 2 accepts.

- [ ] Live vertex count with warning above a configured ceiling
- [ ] **Non-destructive** — original contour retained

A raster-derived contour has thousands of vertices and many rings with holes.
Pilot 2 wants one simple polygon and the RC chokes on high vertex counts.

Story 4.2 in \`docs/user-stories.md\`."

new_issue "6.1 Export Pilot 2-compatible boundary KML" \
  "epic:export" \
"As a Planner, I can export the polygon as a KML that DJI Pilot 2 imports as a
mapping-mission boundary.

- [ ] Validated against a KML that Pilot 2 itself produced
- [ ] **Round-tripped on the actual RC** — not done until a real import succeeds

Pilot is fussy about KML structure. The reliable approach is to export a dummy
mission from Pilot and use its XML as a template rather than emitting generic KML.

Story 6.1 in \`docs/user-stories.md\`."

echo
echo "Done. Epic 5 (flight parameters) is deliberately parked and has no issues."
