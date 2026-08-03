import { type Aoi, type BBox, rectangleAoi } from "@bok/core";

const STORAGE_KEY = "bok:aoi:polygon";

/**
 * The key this used to write, when an AOI was four numbers. Read once, on the
 * way past, so that a Planner who had Kiladha saved before D10 does not open
 * the app to an empty map.
 */
const LEGACY_BBOX_KEY = "bok:aoi:bbox";

/** Loads the AOI persisted from a previous session, or null if there isn't one. */
export function loadStoredAoi(): Aoi | null {
  const stored = readPolygon();
  if (stored) return stored;

  const legacy = readLegacyBbox();
  if (!legacy) return null;

  const migrated = rectangleAoi(legacy);
  storeAoi(migrated);
  localStorage.removeItem(LEGACY_BBOX_KEY);
  return migrated;
}

function readPolygon(): Aoi | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.type === "Polygon" &&
      Array.isArray(parsed.coordinates) &&
      Array.isArray(parsed.coordinates[0]) &&
      parsed.coordinates[0].length >= 4
    ) {
      return parsed as Aoi;
    }
  } catch {
    // Corrupt/foreign value — treat as no stored AOI.
  }
  return null;
}

function readLegacyBbox(): BBox | null {
  const raw = localStorage.getItem(LEGACY_BBOX_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((n) => typeof n === "number")
    ) {
      return parsed as BBox;
    }
  } catch {
    // Corrupt/foreign value — treat as no stored AOI.
  }
  return null;
}

export function storeAoi(aoi: Aoi): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(aoi));
}

export function clearStoredAoi(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_BBOX_KEY);
}
