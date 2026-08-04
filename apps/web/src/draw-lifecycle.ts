/**
 * The subset of TerraDraw this module needs. Narrow on purpose, so the contract can be
 * tested against a stub without a map, a canvas, or a DOM.
 */
export interface StoppableDraw {
  readonly enabled: boolean;
  clear: () => void;
  stop: () => void;
}

/**
 * Drop terra-draw's copy of whatever it was holding and hand control back to the map.
 *
 * The guard is the whole point. `clear()` runs terra-draw's `checkEnabled()` and
 * *throws* when the instance is stopped — unlike `start()` and `stop()`, which are
 * no-ops when already in that state. And stopped is this app's normal condition:
 * nothing starts terra-draw at mount, and finishing a zone stops it again. Calling
 * `clear()` unguarded therefore threw out of the click handler before `start()` was
 * reached, so the first draw after a page load, and every draw after a completed
 * zone, silently did nothing (issue #40).
 */
export function resetDraw(draw: StoppableDraw | null): void {
  if (!draw?.enabled) return;
  draw.clear();
  draw.stop();
}
