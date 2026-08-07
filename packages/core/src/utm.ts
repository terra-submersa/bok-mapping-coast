/**
 * WGS 84 longitude/latitude to UTM and back (issues #54, #56).
 *
 * Transverse Mercator by Krüger's series, to sixth order in the third flattening. That is
 * good to well under a millimetre anywhere inside a zone, which is four orders of
 * magnitude finer than the mouse click that produces the input — the accuracy is
 * deliberate overkill so that the *reference check* against PROJ is meaningful.
 *
 * Hand-rolled rather than pulling in `proj4`, because core carries two dependencies and
 * exists to be a pile of pure tested functions. That trade is only honest because
 * `utm.test.ts` pins every value to PROJ 9.5.1: hand-rolled geodesy that agrees only with
 * itself would be the wrong call at any dependency count.
 */

/** WGS 84 defining parameters. */
const SEMI_MAJOR_M = 6378137;
const FLATTENING = 1 / 298.257223563;

/** UTM's scale factor on the central meridian, by definition. */
const SCALE_FACTOR = 0.9996;
/** Pushed east so a zone's westernmost ground has a positive easting. */
const FALSE_EASTING_M = 500000;
/** Added in the southern hemisphere so northings there are positive too. */
const FALSE_NORTHING_M = 10000000;

const DEG = Math.PI / 180;

/**
 * Third flattening. Krüger's series is in powers of this rather than of e², which is what
 * makes six terms enough.
 */
const N = FLATTENING / (2 - FLATTENING);
const N2 = N * N;
const N3 = N2 * N;
const N4 = N3 * N;
const N5 = N4 * N;
const N6 = N5 * N;

/** Rectifying radius: the radius of a sphere with the same meridian length. */
const RECTIFYING_RADIUS_M = (SEMI_MAJOR_M / (1 + N)) * (1 + N2 / 4 + N4 / 64 + N6 / 256);

/** First eccentricity, for the isometric latitude. */
const ECCENTRICITY = Math.sqrt(FLATTENING * (2 - FLATTENING));

/** Krüger's α coefficients, geodetic → projected. */
const ALPHA = [
  N / 2 - (2 / 3) * N2 + (5 / 16) * N3 + (41 / 180) * N4 - (127 / 288) * N5 + (7891 / 37800) * N6,
  (13 / 48) * N2 - (3 / 5) * N3 + (557 / 1440) * N4 + (281 / 630) * N5 - (1983433 / 1935360) * N6,
  (61 / 240) * N3 - (103 / 140) * N4 + (15061 / 26880) * N5 + (167603 / 181440) * N6,
  (49561 / 161280) * N4 - (179 / 168) * N5 + (6601661 / 7257600) * N6,
  (34729 / 80640) * N5 - (3418889 / 1995840) * N6,
  (212378941 / 319334400) * N6,
];

/**
 * Krüger's β coefficients, projected → geodetic. Not the negated α: the series is not its
 * own inverse, and using −α would be right to first order and wrong by metres at a zone
 * edge — the same failure mode the `atanh`/`asinh` comment below describes.
 */
const BETA = [
  N / 2 - (2 / 3) * N2 + (37 / 96) * N3 - (1 / 360) * N4 - (81 / 512) * N5 + (96199 / 604800) * N6,
  (1 / 48) * N2 + (1 / 15) * N3 - (437 / 1440) * N4 + (46 / 105) * N5 - (1118711 / 3870720) * N6,
  (17 / 480) * N3 - (37 / 840) * N4 - (209 / 4480) * N5 + (5569 / 90720) * N6,
  (4397 / 161280) * N4 - (11 / 504) * N5 - (830251 / 7257600) * N6,
  (4583 / 161280) * N5 - (108847 / 3991680) * N6,
  (20648693 / 638668800) * N6,
];

/** Krüger's δ coefficients, conformal latitude → geodetic latitude. */
const DELTA = [
  2 * N - (2 / 3) * N2 - 2 * N3 + (116 / 45) * N4 + (26 / 45) * N5 - (2854 / 675) * N6,
  (7 / 3) * N2 - (8 / 5) * N3 - (227 / 45) * N4 + (2704 / 315) * N5 + (2323 / 945) * N6,
  (56 / 15) * N3 - (136 / 35) * N4 - (1262 / 105) * N5 + (73814 / 2835) * N6,
  (4279 / 630) * N4 - (332 / 35) * N5 - (399572 / 14175) * N6,
  (4174 / 315) * N5 - (144838 / 6237) * N6,
  (601676 / 22275) * N6,
];

/**
 * MGRS latitude bands: 8° each from 80°S, with `I` and `O` omitted because they read as
 * 1 and 0. `X` is the exception, 12° tall, covering 72–84°N.
 */
const BANDS = "CDEFGHJKLMNPQRSTUVWX";

export interface UtmCoordinate {
  /** 1–60, counting east from the antimeridian. */
  zone: number;
  hemisphere: "N" | "S";
  /**
   * MGRS latitude band, C–X.
   *
   * Carried alongside `hemisphere` because the two are routinely confused and the
   * confusion is 10 000 km wide. Kiladha at 37.4°N is band **S**, and is in the
   * *northern* hemisphere: "34S" as a grid zone designator and "UTM 34S" as a CRS name
   * mean different things.
   */
  band: string;
  eastingM: number;
  northingM: number;
  /** EPSG code for the corresponding CRS: 326xx north, 327xx south. */
  epsg: number;
}

/** Longitude into (-180, 180], so a zone number cannot fall off either end. */
function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * The band letter for a latitude, or `""` outside UTM's 80°S–84°N range where the
 * projection is not defined and UPS takes over.
 */
export function latitudeBand(lat: number): string {
  if (lat < -80 || lat > 84) return "";
  // 84°N is the top of X, not the bottom of a band that does not exist.
  return BANDS[Math.min(Math.floor((lat + 80) / 8), BANDS.length - 1)];
}

/**
 * The zone a position falls in, including the two conventional irregularities.
 *
 * Both exist in the real grid and neither can be reached from Kiladha, which is precisely
 * why they are here: an exception that the working AOI never exercises is one that stays
 * silently wrong forever.
 */
export function utmZone(lon: number, lat: number): number {
  const wrapped = wrapLongitude(lon);

  // Southwest Norway: zone 32 is widened west to 3°E so that Bergen and the coast south
  // of it are not split down the middle.
  if (lat >= 56 && lat < 64 && wrapped >= 3 && wrapped < 12) return 32;

  // Svalbard: zones 32, 34 and 36 are suppressed and their neighbours widened, so the
  // archipelago's islands stay whole.
  if (lat >= 72 && lat < 84) {
    if (wrapped >= 0 && wrapped < 9) return 31;
    if (wrapped >= 9 && wrapped < 21) return 33;
    if (wrapped >= 21 && wrapped < 33) return 35;
    if (wrapped >= 33 && wrapped < 42) return 37;
  }

  return Math.floor((wrapped + 180) / 6) + 1;
}

/** The central meridian a zone is projected about. */
function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/**
 * Projects a WGS 84 position onto a *named* UTM zone, whichever zone it really falls in.
 *
 * Almost every caller wants `lonLatToUtm`, which picks the zone for them. This one exists
 * for the Sentinel-2 tile grid (issue #56), which has to ask "where would this corner land
 * in zone 33?" about ground that is in zone 34 — because tiles overlap across the zone
 * boundary, and enumerating zone 33's tiles means working in zone 33's coordinates
 * throughout. The series stretches gracefully a zone or so either side of its central
 * meridian, which is all that overlap needs.
 */
export function projectToZone(lon: number, lat: number, zone: number): UtmCoordinate {
  const hemisphere = lat >= 0 ? "N" : "S";

  const phi = lat * DEG;
  const deltaLambda = wrapLongitude(lon - centralMeridian(zone)) * DEG;

  // Conformal latitude, via the isometric latitude.
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - ECCENTRICITY * Math.atanh(ECCENTRICITY * sinPhi));

  const xi = Math.atan2(t, Math.cos(deltaLambda));
  // `atanh`, not `asinh`. The two agree to first order, so substituting one for the other
  // gives northings that are right and eastings that drift with distance from the central
  // meridian — 80 m at Kiladha's 2°, and nothing at all wrong-looking about it. Caught
  // only by the comparison against PROJ.
  const eta = Math.atanh(Math.sin(deltaLambda) / Math.sqrt(1 + t * t));

  let xiSum = xi;
  let etaSum = eta;
  for (let j = 1; j <= 6; j++) {
    xiSum += ALPHA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaSum += ALPHA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  const scaled = SCALE_FACTOR * RECTIFYING_RADIUS_M;

  return {
    zone,
    hemisphere,
    band: latitudeBand(lat),
    eastingM: scaled * etaSum + FALSE_EASTING_M,
    northingM: scaled * xiSum + (hemisphere === "S" ? FALSE_NORTHING_M : 0),
    epsg: (hemisphere === "N" ? 32600 : 32700) + zone,
  };
}

/**
 * Projects a WGS 84 position onto its UTM zone.
 *
 * The zone is derived from the position, never assumed — a grid reference computed against
 * the wrong central meridian is plausible, precise and hundreds of kilometres out.
 */
export function lonLatToUtm(lon: number, lat: number): UtmCoordinate {
  return projectToZone(lon, lat, utmZone(lon, lat));
}

/**
 * The inverse: a grid reference back to WGS 84 longitude and latitude, as `[lon, lat]`.
 *
 * The zone and hemisphere have to be supplied because a UTM easting/northing pair does not
 * carry them — the same numbers name sixty different places, twice over.
 *
 * Note the asymmetry with `lonLatToUtm`: that one refuses to be told a zone precisely
 * because the zone is derivable, and this one insists on being told because it is not.
 */
export function utmToLonLat(
  zone: number,
  hemisphere: "N" | "S",
  eastingM: number,
  northingM: number,
): [lon: number, lat: number] {
  const scaled = SCALE_FACTOR * RECTIFYING_RADIUS_M;

  const xi = (northingM - (hemisphere === "S" ? FALSE_NORTHING_M : 0)) / scaled;
  const eta = (eastingM - FALSE_EASTING_M) / scaled;

  let xiPrime = xi;
  let etaPrime = eta;
  for (let j = 1; j <= 6; j++) {
    xiPrime -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaPrime -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  // Conformal latitude, then the δ series lifts it back to the geodetic one.
  const chi = Math.asin(Math.sin(xiPrime) / Math.cosh(etaPrime));
  let phi = chi;
  for (let j = 1; j <= 6; j++) {
    phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  }

  const lambda = Math.atan2(Math.sinh(etaPrime), Math.cos(xiPrime));

  return [wrapLongitude(centralMeridian(zone) + lambda / DEG), phi / DEG];
}
