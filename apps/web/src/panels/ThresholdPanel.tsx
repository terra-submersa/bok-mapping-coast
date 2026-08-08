import { type DepthFit, depthToRatio, isUsableFit, type Range, ratioToDepth } from "@bok/core";
import { useState } from "react";
import { CollapsibleSection } from "./CollapsibleSection.js";

export interface ThresholdPanelProps {
  range: Range;
  threshold: number;
  onThresholdChange: (value: number) => void;
  vertexCount: number;
  ringCount: number;
  coastMetres: number;
  onCoastMetresChange: (value: number) => void;
  /** The ratio→metres fit, or null while fewer than three points support one (D3). */
  fit: DepthFit | null;
}

export function ThresholdPanel({
  range,
  threshold,
  onThresholdChange,
  vertexCount,
  ringCount,
  coastMetres,
  onCoastMetresChange,
  fit,
}: ThresholdPanelProps) {
  const [targetDepth, setTargetDepth] = useState("");
  const [depthError, setDepthError] = useState<string | null>(null);

  /** The D3 gate — see `isUsableFit`, which is also what gates the depth contour menu. */
  const usableFit = isUsableFit(fit) ? fit : null;

  function applyTargetDepth() {
    if (!usableFit) return;
    const metres = Number(targetDepth.trim());
    if (!Number.isFinite(metres)) {
      setDepthError("Enter a depth in metres.");
      return;
    }
    const ratio = depthToRatio(usableFit, metres);
    if (ratio === null) {
      setDepthError("This fit cannot be inverted.");
      return;
    }
    setDepthError(null);
    // Not clamped to the slider's range: a target outside it is a real answer — that
    // depth is not present in this composite — and silently snapping to the end would
    // show a contour and imply it was the one asked for.
    if (ratio < range.min || ratio > range.max) {
      setDepthError(
        `${metres} m falls outside this composite's range. The contour shown is at the nearest end.`,
      );
    }
    onThresholdChange(Math.min(Math.max(ratio, range.min), range.max));
  }

  return (
    <CollapsibleSection id="threshold" title="Thresholds">
      <div className="field">
        <label htmlFor="shallow-threshold">Shallow-water threshold</label>
        <input
          id="shallow-threshold"
          type="range"
          min={range.min}
          max={range.max}
          step={(range.max - range.min) / 200}
          value={threshold}
          onChange={(e) => onThresholdChange(Number(e.target.value))}
          aria-label="Shallow-water threshold"
        />
      </div>

      <div className="stat">
        {usableFit ? (
          <>
            <div>
              Depth: <strong>{ratioToDepth(usableFit, threshold).toFixed(2)} m</strong>
            </div>
            <div className="hint">
              Stumpf ratio {threshold.toFixed(4)} · fit RMSE ±{usableFit.rmseM.toFixed(2)} m over{" "}
              {usableFit.n} point{usableFit.n === 1 ? "" : "s"}
            </div>
          </>
        ) : (
          <div>
            Stumpf ratio: <strong>{threshold.toFixed(4)}</strong>
          </div>
        )}
        <div>
          {ringCount} ring{ringCount === 1 ? "" : "s"} · {vertexCount.toLocaleString()} vertices
        </div>

        {usableFit ? (
          <p className="hint">
            True depth below the sea surface (D13), from the fit on the Calibrate step. The RMSE is
            the fit's own error and says nothing about where the ratio is wrong for another reason —
            a Posidonia meadow still reads deep, however good the line is.
          </p>
        ) : (
          /*
           * D3 gates metres behind >= 3 calibration points. Until then the app must not
           * imply metric accuracy, so it says so rather than staying silent. A fit that
           * exists but slopes the wrong way lands here too, deliberately.
           */
          <p className="hint">
            Not metres. Depth in metres needs at least three known-depth reference points with a
            ratio under them (issue #12); until then this is the raw band ratio. Add them on the
            Calibrate step.
          </p>
        )}
      </div>

      {usableFit && (
        <div className="field">
          <label htmlFor="target-depth">Set the threshold to a depth</label>
          <div className="row">
            <input
              id="target-depth"
              value={targetDepth}
              inputMode="decimal"
              placeholder="4"
              onChange={(e) => setTargetDepth(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyTargetDepth();
              }}
            />
            <button type="button" onClick={applyTargetDepth}>
              Go
            </button>
          </div>
          {depthError && <p className="error">{depthError}</p>}
        </div>
      )}

      <div className="field">
        <label htmlFor="coast-distance">Minimum distance from coast: {coastMetres} m</label>
        <input
          id="coast-distance"
          type="range"
          min={0}
          max={100}
          step={5}
          value={coastMetres}
          onChange={(e) => onCoastMetresChange(Number(e.target.value))}
          aria-label="Minimum distance from coast"
        />
      </div>

      <div className="stat">
        <p className="hint">
          Guarantees a continuous ribbon along the whole coastline out to this distance, unioned
          into the boundary — so a gap in the depth contour (Posidonia misread as deep, glint, a
          cloudy patch) doesn't break coverage right next to shore (issue #27).
        </p>
        <p className="hint">
          The coast here is the composite's land/no-data mask, not a surveyed coastline — it also
          catches permanent cloud as "coast".
        </p>
      </div>
    </CollapsibleSection>
  );
}
