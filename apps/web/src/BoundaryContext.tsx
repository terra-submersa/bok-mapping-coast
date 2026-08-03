import { createContext, type ReactNode, useContext } from "react";
import { type BoundaryState, useBoundary } from "./useBoundary.js";

const BoundaryContext = createContext<BoundaryState | null>(null);

export function useBoundaryState(): BoundaryState {
  const ctx = useContext(BoundaryContext);
  if (!ctx) throw new Error("useBoundaryState must be called inside a BoundaryProvider.");
  return ctx;
}

/**
 * Runs the derived chain once and shares the result.
 *
 * `MapLayout` needs it to paint, and the Boundary sidebar needs it for its vertex and
 * area readouts. Calling `useBoundary` in both would contour the raster twice on every
 * threshold drag, which is exactly the work story 4.2's 200 ms budget is measured on.
 */
export function BoundaryProvider({ children }: { children: ReactNode }) {
  const state = useBoundary();
  return <BoundaryContext.Provider value={state}>{children}</BoundaryContext.Provider>;
}
