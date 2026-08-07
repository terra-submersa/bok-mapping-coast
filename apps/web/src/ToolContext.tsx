import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { loadStoredBoolean, storeBoolean } from "./param-storage.js";

/**
 * Which map interrogation tool has the next click (issue #53).
 *
 * `null` is Off, and Off is the only state in which the map behaves as it always has.
 */
export type ActiveTool = "measure" | "utm" | null;

export interface ToolState {
  activeTool: ActiveTool;
  /** Arms a tool, or disarms with `null`. Switching tools drops the other one's points. */
  setActiveTool: (tool: ActiveTool) => void;

  /** 0, 1 or 2 positions. Two is a complete measurement; a third click starts over. */
  measurePoints: GeoJSON.Position[];
  /** The point whose grid reference is pinned (issue #54), or null. */
  utmPoint: GeoJSON.Position | null;

  /** Where a map click lands. A no-op when no tool is armed. */
  pushToolPoint: (point: GeoJSON.Position) => void;
  /** The card's `×`: empties the points and disarms. */
  clearTool: () => void;

  /**
   * Whether the Sentinel-2 tile grid is drawn (issue #56).
   *
   * Not an `ActiveTool`, deliberately. It steals no clicks, so arming Measure must not turn
   * it off — seeing where a seam is *while measuring across it* is most of the point.
   */
  showSentinelTiles: boolean;
  setShowSentinelTiles: (show: boolean) => void;
}

/** localStorage key for the tile overlay, under `param-storage`'s prefix. */
const SENTINEL_TILES_KEY = "sentinelTiles";

const ToolContext = createContext<ToolState | null>(null);

export function useTool(): ToolState {
  const ctx = useContext(ToolContext);
  if (!ctx) throw new Error("useTool must be called inside a ToolProvider.");
  return ctx;
}

/**
 * The armed tool and whatever it has collected.
 *
 * Its own provider, mounted in `App` above the banner, for the reason the depth contour
 * interval ended up in `ProjectContext`: the menu that arms a tool is in the header, and
 * the map that services it is inside the router, so the state has to sit above both.
 * `MapContext` cannot hold it — that one is created inside `MapSurface` and handed only to
 * the `<Outlet/>`.
 *
 * Not `ProjectContext` either. Everything in that provider is either saved with the project
 * or restored from localStorage, and an armed tool is neither: it is a gesture in progress,
 * and restoring one on reload would silently claim the first click of the next session.
 *
 * The tile overlay (issue #56) *is* restored, and the difference is exactly that — it is a
 * way of looking, like `contourIntervalM`, not a gesture. It takes no clicks, so finding it
 * still on tomorrow costs nothing and having to turn it back on every morning would.
 */
export function ToolProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveToolState] = useState<ActiveTool>(null);
  const [measurePoints, setMeasurePoints] = useState<GeoJSON.Position[]>([]);
  const [utmPoint, setUtmPoint] = useState<GeoJSON.Position | null>(null);
  const [showSentinelTiles, setShowSentinelTilesState] = useState(() =>
    loadStoredBoolean(SENTINEL_TILES_KEY, false),
  );

  const setShowSentinelTiles = useCallback((show: boolean) => {
    setShowSentinelTilesState(show);
    storeBoolean(SENTINEL_TILES_KEY, show);
  }, []);

  const setActiveTool = useCallback((tool: ActiveTool) => {
    // Switching tools clears both, rather than leaving the other one's overlay on the map
    // to be re-revealed later — a stale segment reappearing when you come back to Measure
    // reads as a measurement you just made.
    setMeasurePoints([]);
    setUtmPoint(null);
    setActiveToolState(tool);
  }, []);

  const pushToolPoint = useCallback(
    (point: GeoJSON.Position) => {
      if (activeTool === "utm") {
        setUtmPoint(point);
        return;
      }
      if (activeTool === "measure") {
        // A third click is the start of the next measurement, not an ignored one. That is
        // what makes remeasuring free: no Reset button, no reaching for the menu.
        setMeasurePoints((current) => (current.length >= 2 ? [point] : [...current, point]));
      }
    },
    [activeTool],
  );

  const clearTool = useCallback(() => {
    setMeasurePoints([]);
    setUtmPoint(null);
    setActiveToolState(null);
  }, []);

  const value = useMemo(
    () => ({
      activeTool,
      setActiveTool,
      measurePoints,
      utmPoint,
      pushToolPoint,
      clearTool,
      showSentinelTiles,
      setShowSentinelTiles,
    }),
    [
      activeTool,
      setActiveTool,
      measurePoints,
      utmPoint,
      pushToolPoint,
      clearTool,
      showSentinelTiles,
      setShowSentinelTiles,
    ],
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
}
