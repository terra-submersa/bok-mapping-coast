import { describe, expect, it } from "vitest";
import { latitudeBand, lonLatToUtm, utmZone } from "./utm.js";

/**
 * Every easting and northing below came out of PROJ 9.5.1 via pyproj 3.7.2 —
 * `Transformer.from_crs("EPSG:4326", "EPSG:326xx")` — not out of this file's arithmetic.
 *
 * That is the whole justification for hand-rolling the projection instead of taking
 * `proj4`. A transverse Mercator series that agrees only with itself proves nothing: a
 * mistyped coefficient in the fourth term is worth centimetres at the central meridian and
 * metres at a zone edge, which is exactly the kind of wrong that never looks wrong.
 */

/** A millimetre. PROJ's own round-trip noise is well below this. */
const MM = 1e-3;

describe("lonLatToUtm", () => {
  it("matches PROJ at Kiladha Bay", () => {
    const utm = lonLatToUtm(23.1225, 37.4265);
    expect(utm.zone).toBe(34);
    expect(utm.hemisphere).toBe("N");
    expect(utm.epsg).toBe(32634);
    expect(utm.eastingM).toBeCloseTo(687802.998972, 3);
    expect(utm.northingM).toBeCloseTo(4144301.721762, 3);
  });

  /**
   * The one value that is exact by definition rather than by series: on the central
   * meridian the easting is the false easting and nothing else. A sign error in the η
   * summation shows up here and nowhere else.
   */
  it("puts the central meridian at exactly 500 000 m east", () => {
    const utm = lonLatToUtm(21, 37.4265);
    expect(utm.zone).toBe(34);
    expect(Math.abs(utm.eastingM - 500000)).toBeLessThan(MM);
    expect(utm.northingM).toBeCloseTo(4142187.108444, 3);
  });

  it("puts the equator at zero northing in the north", () => {
    const utm = lonLatToUtm(3, 0);
    expect(utm.zone).toBe(31);
    expect(utm.hemisphere).toBe("N");
    expect(Math.abs(utm.eastingM - 500000)).toBeLessThan(MM);
    expect(Math.abs(utm.northingM)).toBeLessThan(MM);
  });

  /** The southern hemisphere's 10 000 km false northing, which north must not get. */
  it("matches PROJ in the southern hemisphere, false northing and all", () => {
    const utm = lonLatToUtm(151.2093, -33.8688);
    expect(utm.zone).toBe(56);
    expect(utm.hemisphere).toBe("S");
    expect(utm.epsg).toBe(32756);
    expect(utm.eastingM).toBeCloseTo(334368.633648, 3);
    expect(utm.northingM).toBeCloseTo(6250948.345385, 3);
  });

  it("matches PROJ near the antimeridian", () => {
    const utm = lonLatToUtm(179, -20);
    expect(utm.zone).toBe(60);
    expect(utm.epsg).toBe(32760);
    expect(utm.eastingM).toBeCloseTo(709243.229845, 3);
    expect(utm.northingM).toBeCloseTo(7787269.284855, 3);
  });

  it("matches PROJ inside the widened Norway zone", () => {
    const utm = lonLatToUtm(5, 60);
    expect(utm.zone).toBe(32);
    expect(utm.eastingM).toBeCloseTo(276979.926401, 3);
    expect(utm.northingM).toBeCloseTo(6658157.202407, 3);
  });

  it("matches PROJ inside a widened Svalbard zone", () => {
    const utm = lonLatToUtm(20, 78);
    expect(utm.zone).toBe(33);
    expect(utm.eastingM).toBeCloseTo(615914.524877, 3);
    expect(utm.northingM).toBeCloseTo(8663320.201404, 3);
  });
});

describe("utmZone", () => {
  it("counts zones east from the antimeridian", () => {
    expect(utmZone(-180, 0)).toBe(1);
    expect(utmZone(-177, 0)).toBe(1);
    expect(utmZone(-174, 0)).toBe(2);
    expect(utmZone(0, 0)).toBe(31);
    expect(utmZone(23.1225, 37.4265)).toBe(34);
    expect(utmZone(179.9, 0)).toBe(60);
  });

  /**
   * Southwest Norway. Zone 32 is widened west to 3°E, so a point that plain arithmetic
   * puts in 31 is really in 32. Unreachable from the Argolic Gulf, which is the reason to
   * test it rather than the reason to skip it.
   */
  it("widens zone 32 over southwest Norway", () => {
    expect(utmZone(5, 60)).toBe(32);
    expect(utmZone(3, 56)).toBe(32);
    expect(utmZone(11.9, 63.9)).toBe(32);
    // Just outside the exception, in all three directions.
    expect(utmZone(5, 55.9)).toBe(31);
    expect(utmZone(5, 64)).toBe(31);
    expect(utmZone(2.9, 60)).toBe(31);
    // The exception widens 32 westward only; its eastern edge is 12°E as usual.
    expect(utmZone(12.1, 60)).toBe(33);
  });

  it("suppresses zones 32, 34 and 36 over Svalbard", () => {
    expect(utmZone(8, 78)).toBe(31);
    expect(utmZone(10, 78)).toBe(33);
    expect(utmZone(20, 78)).toBe(33);
    expect(utmZone(22, 78)).toBe(35);
    expect(utmZone(34, 78)).toBe(37);
    // Below 72°N the ordinary rule resumes.
    expect(utmZone(10, 71.9)).toBe(32);
  });
});

describe("latitudeBand", () => {
  it("skips I and O, which read as 1 and 0", () => {
    expect(latitudeBand(37.4265)).toBe("S");
    expect(latitudeBand(-80)).toBe("C");
    expect(latitudeBand(0)).toBe("N");
    expect(latitudeBand(-0.1)).toBe("M");
    expect(latitudeBand(83)).toBe("X");
    expect(latitudeBand(-33.8688)).toBe("H");
    expect("CDEFGHJKLMNPQRSTUVWX").not.toMatch(/[IO]/);
  });

  /** X is 12° tall, not 8 — the one band that is not a uniform slice. */
  it("stretches X to 84°N and gives nothing beyond UTM's range", () => {
    expect(latitudeBand(72)).toBe("X");
    expect(latitudeBand(84)).toBe("X");
    expect(latitudeBand(84.1)).toBe("");
    expect(latitudeBand(-80.1)).toBe("");
  });

  /**
   * The confusion this field exists to prevent: Kiladha is band S *and* northern
   * hemisphere, so "34S" the grid zone designator and "UTM zone 34S" the CRS name point
   * 4 000 km apart.
   */
  it("does not imply the hemisphere", () => {
    const kiladha = lonLatToUtm(23.1225, 37.4265);
    expect(kiladha.band).toBe("S");
    expect(kiladha.hemisphere).toBe("N");
    expect(kiladha.epsg).toBe(32634);
  });
});
