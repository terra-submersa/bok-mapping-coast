/**
 * The Sentinel-2 tiling grid (issue #56).
 *
 * The composite does not join up: straight-edged steps run through the ratio field where
 * the set of granules contributing to the median changes. Those edges are tile boundaries,
 * and with nothing on the map to say so a seam is indistinguishable from a substrate
 * change. This module produces the footprints to draw, and the tile identity that the
 * per-tile calibration split will key on.
 *
 * ## What a tile actually is
 *
 * A Sentinel-2 tile is the MGRS 100 km square's **upper-left corner** extended
 * `SENTINEL_TILE_SIZE_M` east and south, in that zone's UTM CRS. It therefore hangs
 * 9 800 m *below* its square, and overlaps its neighbours on the east and south sides.
 *
 * Verified against real product metadata rather than assumed — Element 84 STAC,
 * `S2B_34SFG_20260805_0_L2A`: `proj:epsg` 32634, `proj:transform`
 * `[10, 0, 600000, 0, -10, 4200000]`, `proj:shape` `[10980, 10980]`. The upper-left
 * coordinates are exact multiples of 100 000, and 10980 × 10 m is 109 800.
 *
 * ## Computed, not ESA's KML
 *
 * The authoritative grid is a tiling-grid KML from ESA: hundreds of megabytes to filter
 * once, the repo's first static geojson asset, and still no answer to `sentinelTileId`.
 * Computing it instead costs us the irregularities — ESA hand-edits the grid at the poles
 * and at some zone junctions, and we draw squares that have never had a product because
 * they are open ocean. Neither reaches the Argolic Gulf. If a drawn edge ever disagrees
 * with a seam in the composite, that assumption is the first place to look.
 */

import type { BBox } from "./bbox.js";
import { latitudeBand, projectToZone, utmToLonLat, utmZone } from "./utm.js";

/** The side of a tile footprint: 10 980 px at 10 m. */
export const SENTINEL_TILE_SIZE_M = 109800;

/** The lattice the footprints are anchored on. */
export const MGRS_SQUARE_M = 100000;

/** How much of its neighbour each tile repeats, on the east and south sides. */
export const SENTINEL_TILE_OVERLAP_M = SENTINEL_TILE_SIZE_M - MGRS_SQUARE_M;

/**
 * Above this many tiles in view, draw none.
 *
 * Not a truncation: a partial grid is a lie about coverage, and a grid drawn at world zoom
 * is unreadable anyway. Greece end to end is about twenty tiles, so this is only reached
 * when the answer would be useless.
 */
export const MAX_SENTINEL_TILES = 200;

/**
 * How finely a footprint's edges are sampled before being brought back to lon/lat.
 *
 * The edges are straight in UTM and curved on the globe. Four corners joined by chords
 * would be visibly wrong against the imagery — and wrong in the direction that makes a
 * seam look like it is in the wrong place, which is the one thing this overlay exists to
 * settle.
 */
const DENSIFY_STEP_M = 10000;

/**
 * MGRS 100 km column letters, in three sets of eight. Which set a zone uses cycles with
 * `(zone - 1) mod 3`. `I` and `O` are omitted throughout, as everywhere else in MGRS.
 */
const COLUMN_SETS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];

/** MGRS 100 km row letters, twenty of them, repeating every 2 000 km of northing. */
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUV";

/**
 * Even zones start their row lettering five letters up the alphabet, so that no two
 * squares meeting across a zone boundary carry the same designation.
 */
const EVEN_ZONE_ROW_OFFSET = 5;

/** Column letters only cover eastings 100–900 km, so square origins run 100–800 km. */
const MIN_SQUARE_EASTING_M = 100000;
const MAX_SQUARE_EASTING_M = 800000;

/** Half a zone's nominal width. */
const HALF_ZONE_DEG = 3;

/** Signed longitude offset from a zone's central meridian, wrapped into ±180°. */
function deltaFromCentralMeridian(lon: number, zone: number): number {
  const centralMeridian = (zone - 1) * 6 - 177;
  return ((lon - centralMeridian + 540) % 360) - 180;
}

/**
 * Whether a 100 km square is one the zone actually letters.
 *
 * A footprint runs 9 800 m past its square, which is how tiles overlap across a zone
 * boundary — but the *square* has to belong to the zone, and the eastings alone do not say
 * so: 100–900 km of easting is a wider span than 6° of longitude, so plain column arithmetic
 * invents squares a zone and a half from their central meridian.
 *
 * Checked against published products at 37.5°N. Zone 34 spans 18–24°E and letters columns
 * up to G (easting 700–800 km, reaching 24.2°E — `34SGG` really does cover 24.5°E); it does
 * not letter H, whose square lies wholly east of 24°E, and no `34SHG` exists. Symmetrically
 * zone 35 letters K (its square straddling 24°E) but not J, which lies wholly west of it.
 * Intersecting the square with the zone's span reproduces both edges exactly.
 *
 * Uses the nominal 6° span, so the widened Norway and Svalbard zones are approximated —
 * consistent with this module not reproducing ESA's hand edits there either.
 */
function squareInZone(
  zone: number,
  hemisphere: "N" | "S",
  eastingM: number,
  northingM: number,
): boolean {
  let minDelta = Number.POSITIVE_INFINITY;
  let maxDelta = Number.NEGATIVE_INFINITY;

  // Corners and edge midpoints: a square's east and west sides converge with latitude, so
  // its extreme longitudes sit at corners — but sampling the midpoints costs nothing and
  // survives someone widening the lattice later.
  for (const e of [eastingM, eastingM + MGRS_SQUARE_M / 2, eastingM + MGRS_SQUARE_M]) {
    for (const n of [northingM, northingM + MGRS_SQUARE_M / 2, northingM + MGRS_SQUARE_M]) {
      const delta = deltaFromCentralMeridian(utmToLonLat(zone, hemisphere, e, n)[0], zone);
      if (delta < minDelta) minDelta = delta;
      if (delta > maxDelta) maxDelta = delta;
    }
  }

  return minDelta < HALF_ZONE_DEG && maxDelta > -HALF_ZONE_DEG;
}

export interface SentinelTile {
  /** The tile designation without ESA's leading `T` — `"34SFG"`. */
  id: string;
  zone: number;
  /** MGRS latitude band, taken from the square's centre. */
  band: string;
  /** The 100 km square's two letters — `"FG"`. */
  square: string;
  /** The footprint in lon/lat, edges densified, ring closed and counter-clockwise. */
  polygon: GeoJSON.Polygon;
  /** The footprint's centre in lon/lat, as a label anchor. */
  centre: GeoJSON.Position;
}

export interface SentinelTilesOptions {
  /** Draw nothing rather than a truncated grid past this count. */
  maxTiles?: number;
}

/** Rounds down to the 100 km square origin an easting or northing sits in. */
function squareOrigin(metres: number): number {
  return Math.floor(metres / MGRS_SQUARE_M) * MGRS_SQUARE_M;
}

/**
 * The designation of the tile anchored on the square with this south-west corner, or null
 * where the grid is not lettered.
 *
 * The band comes from the square's centre, not from a caller's position: every point in a
 * square must agree on one tile, or a sounding near a band edge would land in a tile of its
 * own that no product has ever been published for.
 */
function tileIdAt(
  zone: number,
  hemisphere: "N" | "S",
  eastingM: number,
  northingM: number,
): { id: string; square: string; band: string; centre: GeoJSON.Position } | null {
  const column = Math.floor(eastingM / MGRS_SQUARE_M);
  if (column < 1 || column > 8) return null;
  if (!squareInZone(zone, hemisphere, eastingM, northingM)) return null;

  const columnLetter = COLUMN_SETS[(zone - 1) % 3][column - 1];
  const rowIndex =
    (Math.floor(northingM / MGRS_SQUARE_M) + (zone % 2 === 0 ? EVEN_ZONE_ROW_OFFSET : 0)) %
    ROW_LETTERS.length;
  const square = columnLetter + ROW_LETTERS[rowIndex];

  const centre = utmToLonLat(
    zone,
    hemisphere,
    eastingM + MGRS_SQUARE_M / 2,
    northingM + MGRS_SQUARE_M / 2,
  );
  const band = latitudeBand(centre[1]);
  if (band === "") return null;

  return { id: `${zone}${band}${square}`, square, band, centre };
}

/** The tile's footprint in that zone's UTM metres. */
function footprint(eastingM: number, northingM: number) {
  const north = northingM + MGRS_SQUARE_M;
  return {
    west: eastingM,
    east: eastingM + SENTINEL_TILE_SIZE_M,
    north,
    south: north - SENTINEL_TILE_SIZE_M,
  };
}

/** Builds the tile anchored on the square whose south-west corner is (`easting`, `northing`). */
function tileAt(
  zone: number,
  hemisphere: "N" | "S",
  easting: number,
  northing: number,
): SentinelTile | null {
  const named = tileIdAt(zone, hemisphere, easting, northing);
  if (named === null) return null;

  const { west, east, north, south } = footprint(easting, northing);

  const ring: GeoJSON.Position[] = [];
  const push = (e: number, n: number) => ring.push(utmToLonLat(zone, hemisphere, e, n));

  // Counter-clockwise from the south-west corner — GeoJSON's right-hand rule — densifying
  // each side. Each loop stops short of its far corner, which the next loop starts on.
  for (let e = west; e < east; e += DENSIFY_STEP_M) push(e, south);
  for (let n = south; n < north; n += DENSIFY_STEP_M) push(east, n);
  for (let e = east; e > west; e -= DENSIFY_STEP_M) push(e, north);
  for (let n = north; n > south; n -= DENSIFY_STEP_M) push(west, n);
  ring.push(ring[0]);

  return {
    id: named.id,
    zone,
    band: named.band,
    square: named.square,
    polygon: { type: "Polygon", coordinates: [ring] },
    centre: named.centre,
  };
}

/** The lon/lat envelope of a ring, for the cheap intersection test. */
function ringBbox(ring: GeoJSON.Position[]): BBox {
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of ring) {
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function bboxesOverlap(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/** Which false-northing regimes a latitude span touches. Straddling the equator touches both. */
function hemispheresIn(south: number, north: number): ("N" | "S")[] {
  if (north < 0) return ["S"];
  if (south >= 0) return ["N"];
  return ["S", "N"];
}

/**
 * The easting/northing range a lon/lat box occupies in one zone's coordinates.
 *
 * Sampled across the box rather than at its four corners alone: the projection of a box is
 * curved, so its extreme easting is usually partway along a side rather than at an end
 * of it.
 */
function zoneEnvelope(
  bbox: BBox,
  zone: number,
  south: number,
  north: number,
  hemisphere: "N" | "S",
) {
  const [minLon, , maxLon] = bbox;
  const latLo = hemisphere === "S" ? Math.min(south, 0) : Math.max(south, 0);
  const latHi = hemisphere === "S" ? Math.min(north, 0) : Math.max(north, 0);
  if (latLo > latHi) return null;

  const SAMPLES = 8;
  let minEasting = Number.POSITIVE_INFINITY;
  let minNorthing = Number.POSITIVE_INFINITY;
  let maxEasting = Number.NEGATIVE_INFINITY;
  let maxNorthing = Number.NEGATIVE_INFINITY;

  for (let i = 0; i <= SAMPLES; i++) {
    const lon = minLon + ((maxLon - minLon) * i) / SAMPLES;
    for (let j = 0; j <= SAMPLES; j++) {
      const lat = latLo + ((latHi - latLo) * j) / SAMPLES;
      const utm = projectToZone(lon, lat, zone);
      if (!Number.isFinite(utm.eastingM) || !Number.isFinite(utm.northingM)) return null;
      if (utm.eastingM < minEasting) minEasting = utm.eastingM;
      if (utm.eastingM > maxEasting) maxEasting = utm.eastingM;
      if (utm.northingM < minNorthing) minNorthing = utm.northingM;
      if (utm.northingM > maxNorthing) maxNorthing = utm.northingM;
    }
  }

  return { minEasting, maxEasting, minNorthing, maxNorthing };
}

/**
 * Every Sentinel-2 tile whose footprint reaches into a lon/lat box.
 *
 * Zones either side of the box are enumerated too, deliberately: tiles overlap across zone
 * boundaries in the real grid, so a view sitting in zone 34 genuinely has zone 33 and 35
 * tiles lying over it, and omitting them would show seams with no drawn edge to explain
 * them. Square origins outside the lettered easting range fall out on their own, which is
 * what keeps that widening from running away.
 */
export function sentinelTilesIn(bbox: BBox, options: SentinelTilesOptions = {}): SentinelTile[] {
  const maxTiles = options.maxTiles ?? MAX_SENTINEL_TILES;
  const [minLon, minLat, maxLon, maxLat] = bbox;
  if (!(minLon <= maxLon && minLat <= maxLat)) return [];

  // UTM is undefined outside this band, and so is everything below.
  const south = Math.max(minLat, -80);
  const north = Math.min(maxLat, 84);
  if (south > north) return [];

  const zoneLo = Math.max(1, utmZone(minLon, south) - 1);
  const zoneHi = Math.min(60, utmZone(maxLon, south) + 1);
  // A box spanning the antimeridian gives zoneLo > zoneHi. Not a view this app produces,
  // and drawing nothing beats drawing the world's worth of tiles.
  if (zoneLo > zoneHi) return [];

  const byId = new Map<string, SentinelTile>();

  for (let zone = zoneLo; zone <= zoneHi; zone++) {
    for (const hemisphere of hemispheresIn(south, north)) {
      const envelope = zoneEnvelope(bbox, zone, south, north, hemisphere);
      if (envelope === null) continue;

      // A footprint runs east from its square and hangs below it, so the squares that can
      // reach the envelope start a whole tile west of it and only 9 800 m north of it.
      const firstEasting = Math.max(
        MIN_SQUARE_EASTING_M,
        squareOrigin(envelope.minEasting - SENTINEL_TILE_SIZE_M),
      );
      const firstNorthing = squareOrigin(envelope.minNorthing - MGRS_SQUARE_M);
      const lastNorthing = envelope.maxNorthing + SENTINEL_TILE_OVERLAP_M;

      for (
        let easting = firstEasting;
        easting <= MAX_SQUARE_EASTING_M && easting <= envelope.maxEasting;
        easting += MGRS_SQUARE_M
      ) {
        for (let northing = firstNorthing; northing <= lastNorthing; northing += MGRS_SQUARE_M) {
          if (northing < 0) continue;
          const tile = tileAt(zone, hemisphere, easting, northing);
          if (tile === null) continue;
          if (!bboxesOverlap(ringBbox(tile.polygon.coordinates[0]), bbox)) continue;
          if (!byId.has(tile.id)) byId.set(tile.id, tile);
          // One past the cap is enough to know the answer is unusable; stop building rings.
          if (byId.size > maxTiles) return [];
        }
      }
    }
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The tile a position belongs to, or null outside UTM's range.
 *
 * "Belongs to" needs saying, because tiles overlap: up to four footprints cover any given
 * point, and this returns one of them. The one it returns is the tile whose *100 km square*
 * contains the point — and the squares tile the plane without overlap, which is what makes
 * this a partition, and therefore a usable key for splitting the calibration fit.
 *
 * Use `sentinelTilesCovering` where the ambiguity is the point.
 */
export function sentinelTileId(lon: number, lat: number): string | null {
  if (lat < -80 || lat > 84) return null;

  const zone = utmZone(lon, lat);
  const utm = projectToZone(lon, lat, zone);
  return (
    tileIdAt(zone, utm.hemisphere, squareOrigin(utm.eastingM), squareOrigin(utm.northingM))?.id ??
    null
  );
}

/**
 * Every tile whose footprint covers a position — one to four of them, because of the
 * 9 800 m overlap. Sorted, so the result is comparable between calls.
 *
 * Tested in UTM metres rather than against the drawn rings: a ring's lon/lat envelope is
 * larger than the ring, and a point in the corner of the envelope but outside the footprint
 * would be reported as covered by a granule that does not contain it.
 */
export function sentinelTilesCovering(lon: number, lat: number): string[] {
  if (lat < -80 || lat > 84) return [];

  const natural = utmZone(lon, lat);
  const ids = new Set<string>();

  for (let zone = Math.max(1, natural - 1); zone <= Math.min(60, natural + 1); zone++) {
    const utm = projectToZone(lon, lat, zone);
    const hemisphere = utm.hemisphere;

    for (
      let easting = squareOrigin(utm.eastingM - SENTINEL_TILE_SIZE_M);
      easting <= utm.eastingM;
      easting += MGRS_SQUARE_M
    ) {
      if (easting < MIN_SQUARE_EASTING_M || easting > MAX_SQUARE_EASTING_M) continue;
      for (
        let northing = squareOrigin(utm.northingM - MGRS_SQUARE_M);
        northing <= utm.northingM + SENTINEL_TILE_OVERLAP_M;
        northing += MGRS_SQUARE_M
      ) {
        if (northing < 0) continue;
        const box = footprint(easting, northing);
        if (utm.eastingM < box.west || utm.eastingM > box.east) continue;
        if (utm.northingM < box.south || utm.northingM > box.north) continue;
        const named = tileIdAt(zone, hemisphere, easting, northing);
        if (named !== null) ids.add(named.id);
      }
    }
  }

  return [...ids].sort();
}
