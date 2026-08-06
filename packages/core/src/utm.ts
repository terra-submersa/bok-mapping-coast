/**
 * WGS 84 longitude/latitude to UTM (issue #54).
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
 * Projects a WGS 84 position onto its UTM zone.
 *
 * The zone is derived from the position, never assumed — a grid reference computed against
 * the wrong central meridian is plausible, precise and hundreds of kilometres out.
 */
export function lonLatToUtm(lon: number, lat: number): UtmCoordinate {
  const zone = utmZone(lon, lat);
  const hemisphere = lat >= 0 ? "N" : "S";

  // Third flattening. Krüger's series is in powers of this rather than of e², which is
  // what makes six terms enough.
  const n = FLATTENING / (2 - FLATTENING);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n3 * n;
  const n5 = n4 * n;
  const n6 = n5 * n;

  // Rectifying radius: the radius of a sphere with the same meridian length.
  const A = (SEMI_MAJOR_M / (1 + n)) * (1 + n2 / 4 + n4 / 64 + n6 / 256);

  // Krüger's α coefficients, geodetic → projected.
  const alpha = [
    n / 2 - (2 / 3) * n2 + (5 / 16) * n3 + (41 / 180) * n4 - (127 / 288) * n5 + (7891 / 37800) * n6,
    (13 / 48) * n2 - (3 / 5) * n3 + (557 / 1440) * n4 + (281 / 630) * n5 - (1983433 / 1935360) * n6,
    (61 / 240) * n3 - (103 / 140) * n4 + (15061 / 26880) * n5 + (167603 / 181440) * n6,
    (49561 / 161280) * n4 - (179 / 168) * n5 + (6601661 / 7257600) * n6,
    (34729 / 80640) * n5 - (3418889 / 1995840) * n6,
    (212378941 / 319334400) * n6,
  ];

  const phi = lat * DEG;
  const deltaLambda = wrapLongitude(lon - centralMeridian(zone)) * DEG;

  // Conformal latitude, via the isometric latitude.
  const sinPhi = Math.sin(phi);
  const e = Math.sqrt(FLATTENING * (2 - FLATTENING));
  const t = Math.sinh(Math.atanh(sinPhi) - e * Math.atanh(e * sinPhi));

  const xi = Math.atan2(t, Math.cos(deltaLambda));
  // `atanh`, not `asinh`. The two agree to first order, so substituting one for the other
  // gives northings that are right and eastings that drift with distance from the central
  // meridian — 80 m at Kiladha's 2°, and nothing at all wrong-looking about it. Caught
  // only by the comparison against PROJ.
  const eta = Math.atanh(Math.sin(deltaLambda) / Math.sqrt(1 + t * t));

  let xiSum = xi;
  let etaSum = eta;
  for (let j = 1; j <= 6; j++) {
    xiSum += alpha[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaSum += alpha[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }

  const northingM = SCALE_FACTOR * A * xiSum + (hemisphere === "S" ? FALSE_NORTHING_M : 0);

  return {
    zone,
    hemisphere,
    band: latitudeBand(lat),
    eastingM: SCALE_FACTOR * A * etaSum + FALSE_EASTING_M,
    northingM,
    epsg: (hemisphere === "N" ? 32600 : 32700) + zone,
  };
}
