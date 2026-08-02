# bok-mapping-coast

Generates a **flight boundary** for a DJI Matrice 350 RTK doing aerial photogrammetry
over shallow sea — the water shallower than a chosen depth, derived from Sentinel-2
satellite-derived bathymetry.

Output is a KML polygon that DJI Pilot 2 imports as a mapping-mission boundary.
Pilot 2 plans the flight lines itself.

Part of [Terra Submersa](https://github.com/terra-submersa) — documenting submerged
archaeology in the Argolic Gulf, Greece. First test ground: **Kiladha Bay**, from the
bay mouth to Lambayanna beach.

## Status

Spike passed: `scripts/spike-sdb-kiladha.mjs` produced a plausible 4 m contour for
Kiladha Bay, checked against the Lambayanna structures in QGIS
([#1](https://github.com/terra-submersa/bok-mapping-coast/issues/1)).

The Walking Skeleton now runs end to end: draw a bounding box → request an SDB
composite → see it over satellite imagery → drag the threshold → simplify →
download a KML. One thing stands between that and a file you can actually fly —
the KML has **not** been round-tripped on the real RC
([#7](https://github.com/terra-submersa/bok-mapping-coast/issues/7)).

The backlog lives in
[GitHub Issues](https://github.com/terra-submersa/bok-mapping-coast/issues).

## Documentation

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project context, architecture, and the non-obvious domain constraints |
| [`docs/design-decisions.md`](docs/design-decisions.md) | What was decided, why, and what it costs |
| [GitHub Issues](https://github.com/terra-submersa/bok-mapping-coast/issues) | The backlog — single source of truth for stories |

## Layout

```
packages/core      Pure geometry and mission logic. Zero I/O.
packages/dji       KML serialization for DJI Pilot 2.
apps/api           Copernicus access, raster handling, persistence.
apps/web           MapLibre map, polygon editor, parameters.
```

## Getting started

Requires Node 22+ (see `.nvmrc`) and `pnpm` (via `corepack enable`).

```bash
pnpm install
pnpm dev     # apps/api on :8787, apps/web on :5173
pnpm test
pnpm build
pnpm lint
```

```bash
./scripts/setup-hooks.sh        # wire up local pre-commit / commit-msg hooks
```

`scripts/bootstrap-github.sh` created the initial labels, milestone and Walking
Skeleton issues. It has already been run and is kept for reference only — the
backlog has since moved on in GitHub, and re-running it would create duplicates.

## DevSecOps

- `.github/workflows/devsecops.yml` runs on every push/PR to `main`: Conventional
  Commits check on PR commits, secret scanning (gitleaks), CodeQL SAST, and
  dependency review.
- `./scripts/setup-hooks.sh` points git at `.githooks/` so the same commit-message
  and secret-scan checks run locally, before a commit is made rather than after
  it's pushed. Run it once per clone.
