import {
  type DepthContourLine,
  type DepthContourPlan,
  decimateGrid,
  depthContourLines,
  planDepthContours,
} from "@bok/core";
import { useMemo } from "react";
import { useCalibrationState } from "./CalibrationContext.js";
import { useProject } from "./ProjectContext.js";

/**
 * The depth contour stack (issue #51).
 *
 * **This is a read of the seabed, not part of the exported boundary.** Nothing here
 * depends on `threshold`, `tolerance`, `bufferMetres`, `coastMetres`, `exclusions` or
 * `inclusions`, and nothing downstream — `useBoundary`, `packages/dji` — may consume it.
 * That absence is the whole enforcement: the lines cannot drift with a slider the
 * Planner is dragging, and a zone drawn to shape a mission cannot silently redraw the
 * bathymetry it was drawn against.
 *
 * It is a separate hook from `useBoundary` for the same reason. Folded in there, forty
 * contours would be recomputed on every threshold tick.
 */

/** Douglas-Peucker tolerance for the lines. Display smoothing — *not* the export tolerance. */
const CONTOUR_SIMPLIFY_M = 10;

/**
 * Fragments shorter than this are speckle. Noise that is invisible in one contour is
 * forty times more visible in forty of them, and this is the control for it — not a
 * scene-count floor that would disagree with `shallowWaterContour` about where water is.
 */
const MIN_CONTOUR_LENGTH_M = 50;

/**
 * Which depths get a line — pure arithmetic over the fit and the composite's ratio range.
 *
 * Cheap enough for the banner to call on every render, and shared with the map so the
 * two cannot disagree about how many levels there are or whether the cap bit.
 */
export function useContourPlan(): DepthContourPlan {
  const { ratioRange, contourIntervalM } = useProject();
  const { fit } = useCalibrationState();
  return useMemo(
    () => planDepthContours(fit, ratioRange, contourIntervalM),
    [fit, ratioRange, contourIntervalM],
  );
}

export interface DepthContourState {
  plan: DepthContourPlan;
  lines: DepthContourLine[];
}

/** The plan, plus the geometry for it. Expensive — call it once, from the map. */
export function useDepthContours(): DepthContourState {
  const { composite, aoi } = useProject();
  const plan = useContourPlan();

  /**
   * Memoised on `composite` alone. Keyed on anything else, changing the interval would
   * re-walk millions of pixels to produce the grid it already had.
   */
  const grid = useMemo(() => (composite ? decimateGrid(composite) : null), [composite]);

  const lines = useMemo(() => {
    if (!grid || plan.levels.length === 0) return [];
    return depthContourLines(grid, plan.levels, {
      aoi: aoi ?? undefined,
      simplifyMetres: CONTOUR_SIMPLIFY_M,
      minLengthM: MIN_CONTOUR_LENGTH_M,
    });
  }, [grid, plan.levels, aoi]);

  return { plan, lines };
}
