const EXCLUSIONS_KEY = "bok:zones:exclusions";

/**
 * Hand-drawn zones, persisted between sessions.
 *
 * Deliberately the same shape as the AOI's storage and just as thin: issue #8 moves
 * all of it into a named project on the API, at which point this file goes away. It
 * exists so that zones are not silently lost on a reload in the meantime — they are
 * inputs the Planner drew by hand (D10), not derived state that can be recomputed.
 */
export function loadStoredExclusions(): GeoJSON.Polygon[] {
  return readPolygons(EXCLUSIONS_KEY);
}

export function storeExclusions(zones: GeoJSON.Polygon[]): void {
  localStorage.setItem(EXCLUSIONS_KEY, JSON.stringify(zones));
}

function readPolygons(key: string): GeoJSON.Polygon[] {
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (zone): zone is GeoJSON.Polygon =>
        zone?.type === "Polygon" &&
        Array.isArray(zone.coordinates) &&
        Array.isArray(zone.coordinates[0]) &&
        zone.coordinates[0].length >= 4,
    );
  } catch {
    // Corrupt/foreign value — treat as no stored zones.
    return [];
  }
}
