/** Square metres as km² above 1 hectare, metres² below — matches the scale a
 * Planner is actually judging (a whole bay vs. a offshore noise fragment). */
export function formatAreaM2(areaM2: number): string {
  return areaM2 >= 10_000 ? `${(areaM2 / 1_000_000).toFixed(2)} km²` : `${Math.round(areaM2)} m²`;
}

/** A contour depth as a label: "1 m", "0.5 m". No trailing zeros — these go on the map. */
export function formatDepthM(depthM: number): string {
  return `${Number(depthM.toFixed(2))} m`;
}
