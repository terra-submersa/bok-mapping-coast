import type { BBox } from "@bok/core";

const STORAGE_KEY = "bok:aoi:bbox";

/** Loads the AOI bbox persisted from a previous session, or null if there isn't one. */
export function loadStoredAoi(): BBox | null {
  const raw = localStorage.getItem(STORAGE_KEY);
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

export function storeAoi(bbox: BBox): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bbox));
}

export function clearStoredAoi(): void {
  localStorage.removeItem(STORAGE_KEY);
}
