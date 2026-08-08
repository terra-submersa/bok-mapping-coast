import {
  type DepthFit,
  fitDepth,
  MIN_CALIBRATION_POINTS,
  type RatioSample,
  ratioToDepth,
  type Sounding,
  sampleRatio,
} from "@bok/core";
import { useMemo } from "react";
import { useProject } from "./ProjectContext.js";

export interface CalibrationPoint {
  sounding: Sounding;
  /** What the composite says here, or null when the point is off the raster or over land. */
  sample: RatioSample | null;
  /** Whether the Planner has kept this point out of the fit (issue #13). */
  excluded: boolean;
  /** Measured minus fitted, in metres. Null unless there is a fit *and* a sample. */
  residualM: number | null;
}

export interface CalibrationState {
  points: CalibrationPoint[];
  /** Null until at least three points have both a depth and a ratio. See D3. */
  fit: DepthFit | null;
  /** How many points could contribute — have a sample and are not excluded. */
  usableCount: number;
  /** Points with a depth but no ratio: off the raster, over land, or under cloud. */
  unsampledCount: number;
  /** How many more usable points are needed before metres may be shown at all. */
  shortfall: number;
}

/**
 * Soundings against the composite: what the satellite says where the boat was (issue #12).
 *
 * A hook rather than a component's `useMemo` for the same reason `useBoundary` is one —
 * the map wants it to colour points by residual and the sidebar wants it for the table,
 * and sampling twice would walk the raster twice on every threshold change.
 *
 * Nothing here is stored. The fit is a function of the soundings, the composite and the
 * exclusions, so persisting `m1`/`m0` would let a saved project disagree with the raster
 * sitting beside it — the argument D10 makes about the boundary, applied to the fit.
 */
export function useCalibration(): CalibrationState {
  const { soundings, composite, excludedSoundingIds } = useProject();

  const excluded = useMemo(() => new Set(excludedSoundingIds), [excludedSoundingIds]);

  /**
   * Sampled against the composite as it stands. Recomputed when the raster changes and
   * not when the threshold does: the threshold moves the contour, not the ratios.
   */
  const sampled = useMemo(
    () =>
      soundings.map((sounding) => ({
        sounding,
        sample: composite ? sampleRatio(composite, sounding.lon, sounding.lat) : null,
        excluded: excluded.has(sounding.id),
      })),
    [soundings, composite, excluded],
  );

  const fit = useMemo(() => {
    const points = sampled
      .filter((point) => point.sample && !point.excluded)
      .map((point) => ({
        ratio: (point.sample as RatioSample).ratio,
        depthM: point.sounding.depthM,
      }));
    return fitDepth(points);
  }, [sampled]);

  const points = useMemo<CalibrationPoint[]>(
    () =>
      sampled.map((point) => ({
        ...point,
        // Residuals are shown for excluded points too. A point left out because it looked
        // wrong is exactly the one whose distance from the line you want to see.
        residualM:
          fit && point.sample
            ? point.sounding.depthM - ratioToDepth(fit, point.sample.ratio)
            : null,
      })),
    [sampled, fit],
  );

  const usableCount = sampled.filter((point) => point.sample && !point.excluded).length;

  return {
    points,
    fit,
    usableCount,
    unsampledCount: sampled.filter((point) => !point.sample).length,
    shortfall: Math.max(0, MIN_CALIBRATION_POINTS - usableCount),
  };
}
