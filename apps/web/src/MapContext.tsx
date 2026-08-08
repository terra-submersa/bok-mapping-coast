import { createContext, useContext } from "react";

/** What a new polygon becomes when the Planner finishes drawing it. */
export type DrawTarget = "aoi" | "exclusion" | "inclusion";

/** The drawing controls a sidebar panel needs. The map instance itself stays private. */
export interface MapContextValue {
  startDraw: (target: DrawTarget) => void;
  drawTarget: DrawTarget | null;
  stopDraw: () => void;
  /** Reshaping mode: drag a corner, click a midpoint to insert, shift-click to delete. */
  isEditing: boolean;
  startEdit: () => void;
  stopEdit: () => void;
  /** Why the last gesture was refused, e.g. deleting the third-from-last corner. */
  editError: string | null;

  /**
   * Dropping a known-depth reference point (issue #12). Deliberately not a terra-draw
   * mode: this is one click producing one position, not a polygon, and terra-draw's
   * point mode would put a feature in its own store that then has to be reconciled with
   * the soundings the API owns.
   */
  isDroppingSounding: boolean;
  startDropSounding: () => void;
  stopDropSounding: () => void;
  /** Where the last drop landed, awaiting a depth. Cleared by the panel once saved. */
  droppedPoint: { lon: number; lat: number } | null;
  clearDroppedPoint: () => void;
}

/**
 * Kept out of `MapLayout` so that a page wanting the controls does not have to import
 * the whole map. The provider still lives in `MapLayout` — this is only the handle.
 *
 * There must be exactly one `createContext` call for this value. Duplicating it rather
 * than moving it would publish into one context and read from another, and every page
 * would throw below; no test would catch it, since none of them render.
 */
const MapContext = createContext<MapContextValue | null>(null);

export const MapControlsProvider = MapContext.Provider;

export function useMapControls(): MapContextValue {
  const ctx = useContext(MapContext);
  if (!ctx) throw new Error("useMapControls must be called inside MapLayout.");
  return ctx;
}
