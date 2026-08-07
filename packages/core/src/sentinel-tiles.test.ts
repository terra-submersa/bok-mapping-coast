import { describe, expect, it } from "vitest";
import {
  MAX_SENTINEL_TILES,
  MGRS_SQUARE_M,
  SENTINEL_TILE_OVERLAP_M,
  SENTINEL_TILE_SIZE_M,
  type SentinelTile,
  sentinelTileId,
  sentinelTilesCovering,
  sentinelTilesIn,
} from "./sentinel-tiles.js";
import { projectToZone, utmToLonLat } from "./utm.js";

/**
 * The tile designations below are not this module's arithmetic played back. Every one came
 * from querying published Sentinel-2 products — the Element 84 STAC API, `grid:code` on
 * items intersecting the stated point — because the whole risk in computing the grid rather
 * than shipping ESA's KML is being confidently wrong about the anchoring, and a grid that
 * agrees only with itself would not notice.
 *
 * `34SFG`'s footprint metres come from the same source: `S2B_34SFG_20260805_0_L2A` carries
 * `proj:transform [10, 0, 600000, 0, -10, 4200000]` and `proj:shape [10980, 10980]`.
 */

/** Kiladha Bay, the working AOI. */
const KILADHA: [number, number] = [23.1225, 37.4265];

/** The UTM envelope of a tile's drawn ring, back in its own zone's metres. */
function footprintMetres(tile: SentinelTile) {
  let minEasting = Number.POSITIVE_INFINITY;
  let minNorthing = Number.POSITIVE_INFINITY;
  let maxEasting = Number.NEGATIVE_INFINITY;
  let maxNorthing = Number.NEGATIVE_INFINITY;

  for (const [lon, lat] of tile.polygon.coordinates[0]) {
    const utm = projectToZone(lon, lat, tile.zone);
    if (utm.eastingM < minEasting) minEasting = utm.eastingM;
    if (utm.eastingM > maxEasting) maxEasting = utm.eastingM;
    if (utm.northingM < minNorthing) minNorthing = utm.northingM;
    if (utm.northingM > maxNorthing) maxNorthing = utm.northingM;
  }

  return { minEasting, maxEasting, minNorthing, maxNorthing };
}

describe("sentinelTilesIn", () => {
  /**
   * The one measurement everything else rests on. If the anchoring were a half-square out,
   * or the footprint 100 km rather than 109.8, this is where it shows — and every drawn
   * seam would then sit somewhere the data does not change.
   */
  it("puts 34SFG exactly where the published product is", () => {
    const tiles = sentinelTilesIn([23.0, 37.3, 23.3, 37.5]);
    const tile = tiles.find((candidate) => candidate.id === "34SFG");
    expect(tile).toBeDefined();
    if (!tile) return;

    expect(tile.zone).toBe(34);
    expect(tile.band).toBe("S");
    expect(tile.square).toBe("FG");

    const metres = footprintMetres(tile);
    expect(metres.minEasting).toBeCloseTo(600000, 3);
    expect(metres.maxEasting).toBeCloseTo(600000 + SENTINEL_TILE_SIZE_M, 3);
    expect(metres.maxNorthing).toBeCloseTo(4200000, 3);
    expect(metres.minNorthing).toBeCloseTo(4200000 - SENTINEL_TILE_SIZE_M, 3);
  });

  it("closes each ring and densifies its sides", () => {
    const [tile] = sentinelTilesIn([23.1, 37.4, 23.15, 37.45]);
    const ring = tile.polygon.coordinates[0];
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    // Four sides of 109.8 km at a 10 km step, so well past the five points a bare box has.
    expect(ring.length).toBeGreaterThan(40);
  });

  /**
   * A view inside one tile still sees its neighbours, because their footprints overlap it.
   * Kiladha sits in 34SFG's north-west, so the tiles anchored one square west and one north
   * both reach it.
   */
  it("returns every tile that reaches the box, not just the one it is centred on", () => {
    const ids = sentinelTilesIn([23.0, 37.3, 23.3, 37.5]).map((tile) => tile.id);
    expect(ids).toContain("34SFG");
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * Zone 34 spans 18–24°E and zone 35 spans 24–30°E, yet at 23.9°E published products come
   * from both — `34SGG` reaches east of its zone and `35SKB` reaches west of its own. A
   * grid built one zone at a time would draw one edge and leave the other seam unexplained.
   */
  it("draws tiles from the neighbouring zone where they really overlap", () => {
    const ids = sentinelTilesIn([23.85, 37.45, 23.95, 37.55]).map((tile) => tile.id);
    expect(ids).toContain("34SGG");
    expect(ids).toContain("35SKB");
  });

  /**
   * The other half of that: widening by a zone must not invent squares. No `34SHG` and no
   * `35SJB` are published, because each square lies wholly outside its own zone's span.
   */
  it("does not invent squares outside their zone's span", () => {
    const ids = sentinelTilesIn([22.5, 36.5, 25.5, 38.5]).map((tile) => tile.id);
    expect(ids).toContain("34SGG");
    expect(ids).toContain("35SKB");
    expect(ids).not.toContain("34SHG");
    expect(ids).not.toContain("35SJB");
  });

  it("draws nothing rather than a truncated grid past the cap", () => {
    expect(sentinelTilesIn([22, 36, 26, 40], { maxTiles: 2 })).toEqual([]);
    // The default is generous enough that a whole-country view still draws.
    expect(MAX_SENTINEL_TILES).toBeGreaterThan(50);
    expect(sentinelTilesIn([20, 35, 27, 42]).length).toBeGreaterThan(10);
  });

  it("gives nothing for an empty or inverted box, or outside UTM's range", () => {
    expect(sentinelTilesIn([23.3, 37.5, 23.0, 37.3])).toEqual([]);
    expect(sentinelTilesIn([0, 85, 1, 86])).toEqual([]);
    expect(sentinelTilesIn([0, -90, 1, -85])).toEqual([]);
  });
});

describe("sentinelTileId", () => {
  it("agrees with the published grid code over Kiladha", () => {
    expect(sentinelTileId(...KILADHA)).toBe("34SFG");
    expect(sentinelTileId(23.152, 37.316)).toBe("34SFG");
  });

  /**
   * Each of these was read off a real product's `grid:code` at 37.5°N. They walk across the
   * zone 34/35 boundary, which is where a lettering mistake would first show.
   */
  it("matches published grid codes across a zone boundary", () => {
    expect(sentinelTileId(22.1, 37.5)).toBe("34SEG");
    expect(sentinelTileId(23.2, 37.5)).toBe("34SFG");
    expect(sentinelTileId(23.5, 37.5)).toBe("34SGG");
    expect(sentinelTileId(24.5, 37.5)).toBe("35SKB");
    expect(sentinelTileId(24.9, 37.5)).toBe("35SLB");
  });

  /**
   * The row letters run odd/even out of step by five so that squares meeting across a zone
   * boundary cannot share a designation — 34SFG and 35SKB are the same 100 km band of
   * northing, and they letter G and B.
   */
  it("offsets the row lettering in even zones", () => {
    expect(sentinelTileId(23.2, 37.5)?.endsWith("G")).toBe(true);
    expect(sentinelTileId(24.5, 37.5)?.endsWith("B")).toBe(true);
  });

  it("is null outside UTM's range", () => {
    expect(sentinelTileId(0, 85)).toBeNull();
    expect(sentinelTileId(0, -81)).toBeNull();
  });

  /** Every point in a square gets the same tile, band edges included. */
  it("agrees with itself across a square", () => {
    const corners: [number, number][] = [
      utmToLonLat(34, "N", 600001, 4100001),
      utmToLonLat(34, "N", 699999, 4199999),
      utmToLonLat(34, "N", 650000, 4150000),
    ];
    for (const [lon, lat] of corners) {
      expect(sentinelTileId(lon, lat)).toBe("34SFG");
    }
  });
});

describe("sentinelTilesCovering", () => {
  it("names both tiles in the overlap strip", () => {
    // 4 195 000 m north is inside 34SFG (which reaches 4 200 000) and inside 34SFH (which
    // hangs 9 800 m below its square, to 4 190 200).
    const [lon, lat] = utmToLonLat(34, "N", 650000, 4195000);
    expect(sentinelTilesCovering(lon, lat)).toEqual(["34SFG", "34SFH"]);
  });

  it("names both zones' tiles where they overlap", () => {
    expect(sentinelTilesCovering(23.9, 37.5)).toEqual(["34SGG", "35SKB"]);
  });

  it("names one tile away from any overlap", () => {
    expect(sentinelTilesCovering(22.1, 37.5)).toEqual(["34SEG"]);
  });

  /** Whatever else covers a point, the primary tile is always among them. */
  it("always includes the primary tile", () => {
    for (const [lon, lat] of [KILADHA, [23.9, 37.5], [24.9, 37.5]] as [number, number][]) {
      const primary = sentinelTileId(lon, lat);
      expect(primary).not.toBeNull();
      expect(sentinelTilesCovering(lon, lat)).toContain(primary);
    }
  });

  it("is empty outside UTM's range", () => {
    expect(sentinelTilesCovering(0, 85)).toEqual([]);
  });
});

describe("the grid's constants", () => {
  it("overlaps by the tile size less one square", () => {
    expect(SENTINEL_TILE_SIZE_M).toBe(109800);
    expect(MGRS_SQUARE_M).toBe(100000);
    expect(SENTINEL_TILE_OVERLAP_M).toBe(9800);
  });
});
