import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

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
}

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
 * Not `ProjectContext` either, and not persisted. Everything in that provider is either
 * saved with the project or restored from localStorage, and a tool is neither: it is a
 * gesture in progress. Restoring an armed tool on reload would silently claim the first
 * click of the next session.
 */
export function ToolProvider({ children }: { children: ReactNode }) {
  const [activeTool, setActiveToolState] = useState<ActiveTool>(null);
  const [measurePoints, setMeasurePoints] = useState<GeoJSON.Position[]>([]);
  const [utmPoint, setUtmPoint] = useState<GeoJSON.Position | null>(null);

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
    () => ({ activeTool, setActiveTool, measurePoints, utmPoint, pushToolPoint, clearTool }),
    [activeTool, setActiveTool, measurePoints, utmPoint, pushToolPoint, clearTool],
  );

  return <ToolContext.Provider value={value}>{children}</ToolContext.Provider>;
}
