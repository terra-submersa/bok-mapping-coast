import { bearing as turfBearing, distance as turfDistance } from "@turf/turf";

/**
 * Distance and bearing between two points on the WGS 84 ellipsoid (issue #53).
 *
 * Deliberately *not* turf. Core already imports `distance` for the vertex grab radius
 * (`aoi.ts`) and the Processing API's size check (`processing-limit.ts`), and turf's is
 * spherical haversine on a mean-radius Earth — up to ~0.3% away from the ellipsoid, which
 * at 37°N is metres per kilometre. That is fine for "is the click within 12 px of a
 * corner" and it is not fine for a tool whose entire output is the number it prints.
 *
 * Vincenty's inverse solution instead: iterative, sub-millimetre for anything short of
 * antipodal, and it yields the azimuth at *both* ends, which is what lets the reciprocal
 * bearing be honest rather than `initial + 180`.
 */

/** WGS 84 defining parameters. */
const SEMI_MAJOR_M = 6378137;
const FLATTENING = 1 / 298.257223563;
const SEMI_MINOR_M = SEMI_MAJOR_M * (1 - FLATTENING);

/**
 * Convergence threshold on λ, in radians — a shade under 0.06 mm of arc. Vincenty's own
 * suggestion, and well inside the precision anything here is read at.
 */
const CONVERGENCE = 1e-12;

/**
 * Vincenty's inverse solution converges slowly near antipodal points and, for a band of
 * them, not at all. Two clicks on one map view cannot reach that band — but an unbounded
 * `while` in a click handler is a hung tab, so it is bounded and falls back instead.
 */
const MAX_ITERATIONS = 200;

const DEG = Math.PI / 180;

export interface GeodesicLine {
  /** Length of the geodesic, in metres. */
  distanceM: number;
  /** True bearing a→b at a, degrees clockwise from geographic north, in [0, 360). */
  initialBearingDeg: number;
  /**
   * True bearing a→b *at b* — the direction the line is still running when it arrives.
   *
   * On a sphere or an ellipsoid this is not `initialBearingDeg + 180`: a geodesic that
   * leaves due east at 37°N arrives running east-south-east, because the meridians it
   * crosses are not parallel. The measure tool shows the reciprocal of this, which is the
   * bearing you would steer coming back.
   */
  finalBearingDeg: number;
}

/** Into [0, 360). Vincenty's azimuths come out of `atan2`, so in (-180, 180]. */
function normaliseDeg(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

/**
 * The signed difference in longitude, wrapped into [-π, π].
 *
 * Load-bearing at the antimeridian: 179.5°E to 179.5°W is one degree apart going east,
 * and the raw subtraction says 359 going west.
 */
function wrapLongitude(radians: number): number {
  return radians - 2 * Math.PI * Math.floor((radians + Math.PI) / (2 * Math.PI));
}

/** Turf's spherical answer, used only when Vincenty declines to converge. */
function sphericalFallback(a: GeoJSON.Position, b: GeoJSON.Position): GeodesicLine {
  return {
    distanceM: turfDistance(a, b, { units: "meters" }),
    initialBearingDeg: normaliseDeg(turfBearing(a, b)),
    finalBearingDeg: normaliseDeg(turfBearing(b, a) + 180),
  };
}

/**
 * Solves the inverse geodesic problem: given two points, how far apart and in what
 * direction.
 *
 * Coordinates are `[lon, lat]` in degrees, GeoJSON order.
 *
 * Coincident points return zero distance and zero bearings — there is no direction from a
 * point to itself, and zero is less of a lie than an azimuth manufactured out of float
 * noise.
 */
export function geodesicInverse(a: GeoJSON.Position, b: GeoJSON.Position): GeodesicLine {
  const [lon1, lat1] = a;
  const [lon2, lat2] = b;

  const L = wrapLongitude((lon2 - lon1) * DEG);

  // Reduced latitudes: the ellipsoid's latitudes projected onto the auxiliary sphere the
  // iteration actually runs on.
  const U1 = Math.atan((1 - FLATTENING) * Math.tan(lat1 * DEG));
  const U2 = Math.atan((1 - FLATTENING) * Math.tan(lat2 * DEG));
  const sinU1 = Math.sin(U1);
  const cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2);
  const cosU2 = Math.cos(U2);

  let lambda = L;
  let sinLambda = 0;
  let cosLambda = 1;
  let sinSigma = 0;
  let cosSigma = 1;
  let sigma = 0;
  let cosSqAlpha = 1;
  let cos2SigmaM = 1;
  let converged = false;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    sinLambda = Math.sin(lambda);
    cosLambda = Math.cos(lambda);

    const sinSigmaSq = (cosU2 * sinLambda) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2;
    sinSigma = Math.sqrt(sinSigmaSq);
    // Coincident points. Bailing here rather than dividing by it below.
    if (sinSigma === 0) return { distanceM: 0, initialBearingDeg: 0, finalBearingDeg: 0 };

    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);

    const sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha * sinAlpha;
    // Exactly zero along the equator, where there is no vertex and cos(2σm) is undefined.
    // Vincenty's own convention is to take it as zero, which makes the equatorial line a
    // limiting case of the general one rather than a special case in the caller.
    cos2SigmaM = cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;

    const C = (FLATTENING / 16) * cosSqAlpha * (4 + FLATTENING * (4 - 3 * cosSqAlpha));
    const previous = lambda;
    lambda =
      L +
      (1 - C) *
        FLATTENING *
        sinAlpha *
        (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));

    if (Math.abs(lambda - previous) < CONVERGENCE) {
      converged = true;
      break;
    }
  }

  if (!converged) return sphericalFallback(a, b);

  const uSq =
    (cosSqAlpha * (SEMI_MAJOR_M * SEMI_MAJOR_M - SEMI_MINOR_M * SEMI_MINOR_M)) /
    (SEMI_MINOR_M * SEMI_MINOR_M);
  const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    B *
    sinSigma *
    (cos2SigmaM +
      (B / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
          (B / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma * sinSigma) *
            (-3 + 4 * cos2SigmaM * cos2SigmaM)));

  return {
    distanceM: SEMI_MINOR_M * A * (sigma - deltaSigma),
    initialBearingDeg: normaliseDeg(
      Math.atan2(cosU2 * sinLambda, cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) / DEG,
    ),
    finalBearingDeg: normaliseDeg(
      Math.atan2(cosU1 * sinLambda, -sinU1 * cosU2 + cosU1 * sinU2 * cosLambda) / DEG,
    ),
  };
}
