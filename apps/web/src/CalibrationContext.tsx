import { createContext, type ReactNode, useContext } from "react";
import { type CalibrationState, useCalibration } from "./useCalibration.js";

const CalibrationContext = createContext<CalibrationState | null>(null);

export function useCalibrationState(): CalibrationState {
  const ctx = useContext(CalibrationContext);
  if (!ctx) throw new Error("useCalibrationState must be called inside a CalibrationProvider.");
  return ctx;
}

/**
 * Samples the composite at every sounding once, and shares the result.
 *
 * Three places want it and they are not the same place: Calibrate tabulates the
 * residuals, Boundary needs the fit to label the threshold slider in metres (issue #50),
 * and the banner's depth contour menu is disabled until there is one (issue #51). The
 * banner is outside the router, so the provider sits in `App` — calling `useCalibration`
 * in each would walk the raster three times for the same answer.
 */
export function CalibrationProvider({ children }: { children: ReactNode }) {
  const state = useCalibration();
  return <CalibrationContext.Provider value={state}>{children}</CalibrationContext.Provider>;
}
