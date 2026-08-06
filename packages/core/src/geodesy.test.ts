import { describe, expect, it } from "vitest";
import { geodesicInverse } from "./geodesy.js";

/**
 * Every expected value below came out of PROJ 9.5.1 via pyproj 3.7.2 — `Geod(ellps=
 * "WGS84").inv` — not out of this file's own arithmetic. That is the point: a geodesic
 * implementation that only agrees with itself is worth nothing, and the failure mode of a
 * mistyped series coefficient is a number that is plausible and wrong.
 *
 * PROJ solves geodesics by Karney's method rather than Vincenty's. They are different
 * algorithms that answer the same question, so agreeing to a tenth of a millimetre over
 * thousands of kilometres is real evidence rather than a tautology.
 */

describe("geodesicInverse", () => {
  it("matches PROJ across Kiladha Bay", () => {
    const line = geodesicInverse([23.1225, 37.4265], [23.149, 37.418]);
    expect(line.distanceM).toBeCloseTo(2528.295374, 4);
    expect(line.initialBearingDeg).toBeCloseTo(111.900596234, 7);
    expect(line.finalBearingDeg).toBeCloseTo(111.916699868, 7);
  });

  /** Lambayanna to the northern cluster — the two sites the survey actually spans. */
  it("matches PROJ over the 18 km between the two survey sites", () => {
    const line = geodesicInverse([23.152003, 37.315727], [23.322, 37.405]);
    expect(line.distanceM).toBeCloseTo(18026.933851, 4);
    expect(line.initialBearingDeg).toBeCloseTo(56.607705097, 7);
    expect(line.finalBearingDeg).toBeCloseTo(56.710863798, 7);
  });

  it("matches PROJ over a 3500 km line, where a spherical answer would be kilometres out", () => {
    const line = geodesicInverse([0, 37], [40, 37]);
    expect(line.distanceM).toBeCloseTo(3533502.944494, 4);
    expect(line.initialBearingDeg).toBeCloseTo(77.643544186, 7);
    expect(line.finalBearingDeg).toBeCloseTo(102.356455814, 7);
  });

  it("matches PROJ in the southern hemisphere", () => {
    const line = geodesicInverse([144.42487, -37.95103], [143.9265, -37.65282]);
    expect(line.distanceM).toBeCloseTo(54971.953966, 4);
    expect(line.initialBearingDeg).toBeCloseTo(306.868079189, 7);
    expect(line.finalBearingDeg).toBeCloseTo(307.173549153, 7);
  });

  it("matches PROJ across the equator", () => {
    const line = geodesicInverse([10, -5], [12, 5]);
    expect(line.distanceM).toBeCloseTo(1127906.178771, 4);
    expect(line.initialBearingDeg).toBeCloseTo(11.399013705, 7);
    expect(line.finalBearingDeg).toBeCloseTo(11.399013705, 7);
  });

  /**
   * 179.5°E to 179.5°W is one degree apart going east. Without wrapping the longitude
   * difference into [-π, π] the iteration is handed 359° and answers with a line most of
   * the way round the world.
   */
  it("crosses the antimeridian the short way", () => {
    const line = geodesicInverse([179.5, 10], [-179.5, 10.5]);
    expect(line.distanceM).toBeCloseTo(122722.09596, 4);
    expect(line.initialBearingDeg).toBeCloseTo(63.126374378, 7);
    expect(line.finalBearingDeg).toBeCloseTo(63.304324027, 7);
  });

  it("is symmetric: the reverse line is the same length", () => {
    const there = geodesicInverse([23.1225, 37.4265], [23.322, 37.405]);
    const back = geodesicInverse([23.322, 37.405], [23.1225, 37.4265]);
    expect(back.distanceM).toBeCloseTo(there.distanceM, 6);
    // And the bearing you steer coming back is the reciprocal of the one you arrived on.
    expect(back.initialBearingDeg).toBeCloseTo((there.finalBearingDeg + 180) % 360, 9);
  });

  /**
   * The reason `finalBearingDeg` exists at all. Leave due east at 37°N and you arrive
   * running nearly 25° south of east, because the meridians crossed on the way are not
   * parallel. A tool that showed `initial + 180` as the way back would be lying by that
   * much.
   */
  it("does not treat the final bearing as the initial plus 180", () => {
    const line = geodesicInverse([0, 37], [40, 37]);
    expect(Math.abs(line.finalBearingDeg - line.initialBearingDeg)).toBeGreaterThan(24);
  });

  it("gives zero for a point measured against itself", () => {
    const line = geodesicInverse([23.1225, 37.4265], [23.1225, 37.4265]);
    expect(line.distanceM).toBe(0);
    expect(line.initialBearingDeg).toBe(0);
    expect(line.finalBearingDeg).toBe(0);
  });

  it("puts bearings in [0, 360) rather than atan2's signed range", () => {
    // Due west: atan2 gives -90, which must not reach a readout.
    const line = geodesicInverse([23.2, 37.4], [23.1, 37.4]);
    expect(line.initialBearingDeg).toBeGreaterThan(269);
    expect(line.initialBearingDeg).toBeLessThan(271);
  });

  /**
   * Antipodal points are where Vincenty's inverse fails to converge. The answer is
   * allowed to be the spherical fallback's — what is not allowed is hanging, or a NaN
   * reaching the card.
   */
  it("returns a finite answer for antipodal points instead of spinning", () => {
    const line = geodesicInverse([0, 0], [180, 0]);
    expect(Number.isFinite(line.distanceM)).toBe(true);
    expect(Number.isFinite(line.initialBearingDeg)).toBe(true);
    expect(line.distanceM).toBeGreaterThan(19_000_000);
  });
});
