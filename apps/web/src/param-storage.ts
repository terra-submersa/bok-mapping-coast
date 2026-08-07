const STORAGE_PREFIX = "bok:param:";

/** Loads a previously persisted numeric parameter, or `fallback` if there isn't one. */
export function loadStoredNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(STORAGE_PREFIX + key);
  if (raw === null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function storeNumber(key: string, value: number): void {
  localStorage.setItem(STORAGE_PREFIX + key, String(value));
}

/**
 * Loads a previously persisted flag, or `fallback` if there isn't one.
 *
 * Anything that is not exactly `"true"` or `"false"` falls back rather than being coerced:
 * `Boolean("false")` is `true`, which would silently turn an overlay on for anyone whose
 * stored value predates this pair.
 */
export function loadStoredBoolean(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(STORAGE_PREFIX + key);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function storeBoolean(key: string, value: boolean): void {
  localStorage.setItem(STORAGE_PREFIX + key, String(value));
}
