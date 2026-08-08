import type { UtmCoordinate } from "@bok/core";

/** Square metres as km² above 1 hectare, metres² below — matches the scale a
 * Planner is actually judging (a whole bay vs. a offshore noise fragment). */
export function formatAreaM2(areaM2: number): string {
  return areaM2 >= 10_000 ? `${(areaM2 / 1_000_000).toFixed(2)} km²` : `${Math.round(areaM2)} m²`;
}

/** A contour depth as a label: "1 m", "0.5 m". No trailing zeros — these go on the map. */
export function formatDepthM(depthM: number): string {
  return `${Number(depthM.toFixed(2))} m`;
}

/**
 * A measured distance (issue #53). Metres below a kilometre, kilometres above.
 *
 * Whole metres under 1 km: the geodesic is good to a millimetre but the *click* is good to
 * a few metres, and printing "412.37 m" would be quoting the algorithm's precision rather
 * than the measurement's.
 */
export function formatDistanceM(distanceM: number): string {
  return distanceM >= 1000 ? `${(distanceM / 1000).toFixed(2)} km` : `${Math.round(distanceM)} m`;
}

/**
 * A true bearing, one decimal — about 17 m of cross-track over a kilometre, which is
 * finer than the click and coarser than the false precision below it.
 */
export function formatBearingDeg(bearingDeg: number): string {
  return `${bearingDeg.toFixed(1)}°`;
}

/**
 * A position as lon/lat, five decimals — roughly a metre, which is the same order as the
 * click that produced it. Lat first, because that is the order a coordinate is spoken in
 * even though GeoJSON stores it the other way round.
 */
export function formatLonLat(position: GeoJSON.Position): string {
  const [lon, lat] = position;
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * A UTM grid zone designator: zone number and latitude band, as MGRS writes it (issue #54).
 *
 * The band, not the hemisphere. "34S" here means band S, which is 32–40°**N** — the same
 * string a CRS name would use for zone 34 *south*. That is exactly why `formatUtmMetres`
 * prints the EPSG code beside it rather than leaving the reader to guess.
 */
export function formatUtmZone(utm: UtmCoordinate): string {
  return `${utm.zone}${utm.band}`;
}

/**
 * An easting or a northing, to the whole metre, space-grouped in thousands.
 *
 * Whole metres because one screen pixel at the working zoom is several metres wide, so a
 * decimal would be quoting the projection's precision rather than the click's. Spaces
 * rather than commas, so a copied northing does not become two fields in a CSV.
 *
 * Grouped by hand rather than with `toLocaleString`, which yields a narrow no-break space
 * under some ICU versions and a comma under others — the separator would otherwise depend
 * on which Node or browser happened to run it.
 */
export function formatUtmMetres(metres: number): string {
  return `${String(Math.round(metres)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} m`;
}
