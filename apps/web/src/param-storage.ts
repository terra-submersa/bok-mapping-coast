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
