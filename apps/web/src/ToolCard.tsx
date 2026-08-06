import { geodesicInverse } from "@bok/core";
import { formatBearingDeg, formatDistanceM, formatLonLat } from "./format.js";
import { type ActiveTool, useTool } from "./ToolContext.js";

/**
 * What the card says while a tool is waiting for clicks, or null once it has what it
 * needs. Pure, so it is testable in node — `apps/web` has no DOM test environment, the
 * same constraint that put `contourMenuNote` outside its component.
 */
export function toolPrompt(
  tool: ActiveTool,
  measurePoints: readonly GeoJSON.Position[],
  utmPoint: GeoJSON.Position | null,
): string | null {
  if (tool === "measure") {
    if (measurePoints.length === 0) return "Click the first point on the map.";
    if (measurePoints.length === 1) return "Click the second point.";
    return null;
  }
  if (tool === "utm") return utmPoint ? null : "Click a point on the map.";
  return null;
}

/**
 * The floating readout for whatever tool is armed (issue #53).
 *
 * Over the map rather than in the sidebar, because the tools work identically on Area,
 * Boundary and Calibrate and the sidebar belongs to the step. Bottom-right: the sidebar
 * owns the left, MapLibre's navigation control owns the top-right, and the offset clears
 * the attribution bar.
 */
export function ToolCard() {
  const { activeTool, measurePoints, utmPoint, clearTool } = useTool();
  if (!activeTool) return null;

  const prompt = toolPrompt(activeTool, measurePoints, utmPoint);
  const [a, b] = measurePoints;
  const line = activeTool === "measure" && a && b ? geodesicInverse(a, b) : null;

  return (
    <div className="map-card">
      <div className="map-card-header">
        <h3>{activeTool === "measure" ? "Measure" : "UTM coordinates"}</h3>
        <button type="button" onClick={clearTool} aria-label="Close the tool">
          ×
        </button>
      </div>
      <div className="map-card-body">
        {prompt && <p className="map-card-prompt">{prompt}</p>}

        {line && a && b && (
          <>
            <p className="map-card-figure">{formatDistanceM(line.distanceM)}</p>
            <dl>
              <dt>A → B</dt>
              <dd>{formatBearingDeg(line.initialBearingDeg)} true</dd>
              {/*
               * The bearing to steer coming back, which is the reciprocal of the bearing
               * the line is still running when it arrives — not A→B plus 180. Over a few
               * hundred metres the two agree; over the 18 km between the survey sites they
               * differ by a tenth of a degree, and over a long east-west line by degrees.
               */}
              <dt>B → A</dt>
              <dd>{formatBearingDeg((line.finalBearingDeg + 180) % 360)} true</dd>
              <dt>A</dt>
              <dd>{formatLonLat(a)}</dd>
              <dt>B</dt>
              <dd>{formatLonLat(b)}</dd>
            </dl>
            <p className="map-card-hint">
              WGS 84 geodesic. Bearings are true, from geographic north — the same convention as
              Pilot 2's course angle.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
