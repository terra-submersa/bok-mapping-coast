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
 * Two routes want it and they are not the same route: Calibrate tabulates the residuals,
 * and Boundary needs the fit to label the threshold slider in metres (issue #50). Both
 * live under `MapLayout`, so the provider goes there — calling `useCalibration` in each
 * would walk the raster twice for the same answer.
 */
export function CalibrationProvider({ children }: { children: ReactNode }) {
  const state = useCalibration();
  return <CalibrationContext.Provider value={state}>{children}</CalibrationContext.Provider>;
}
