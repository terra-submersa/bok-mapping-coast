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

Pre-implementation. Design settled, nothing built.

The next step is a spike: prove a plausible 4 m contour can be derived for Kiladha Bay
before any application code is written.

## Documentation

| File | What's in it |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Project context, architecture, and the non-obvious domain constraints |
| [`docs/user-stories.md`](docs/user-stories.md) | The backlog — source of truth for intent |
| [`docs/design-decisions.md`](docs/design-decisions.md) | What was decided, why, and what it costs |

## Planned layout

```
packages/core      Pure geometry and mission logic. Zero I/O.
packages/dji       KML serialization for DJI Pilot 2.
apps/api           Copernicus access, raster handling, persistence.
apps/web           MapLibre map, polygon editor, parameters.
```

## Getting started

```bash
./scripts/bootstrap-github.sh   # labels, milestone, Walking Skeleton issues
./scripts/setup-hooks.sh        # wire up local pre-commit / commit-msg hooks
```

`bootstrap-github.sh` requires an authenticated `gh` CLI. Run once — it will create
duplicate issues if re-run.

## DevSecOps

- `.github/workflows/devsecops.yml` runs on every push/PR to `main`: Conventional
  Commits check on PR commits, secret scanning (gitleaks), CodeQL SAST, and
  dependency review.
- `./scripts/setup-hooks.sh` points git at `.githooks/` so the same commit-message
  and secret-scan checks run locally, before a commit is made rather than after
  it's pushed. Run it once per clone.
