import type { Range } from "@bok/core";
import { CollapsibleSection } from "./CollapsibleSection.js";

export interface ThresholdPanelProps {
  range: Range;
  threshold: number;
  onThresholdChange: (value: number) => void;
  vertexCount: number;
  ringCount: number;
  coastMetres: number;
  onCoastMetresChange: (value: number) => void;
}

export function ThresholdPanel({
  range,
  threshold,
  onThresholdChange,
  vertexCount,
  ringCount,
  coastMetres,
  onCoastMetresChange,
}: ThresholdPanelProps) {
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
        <div>
          Stumpf ratio: <strong>{threshold.toFixed(4)}</strong>
        </div>
        <div>
          {ringCount} ring{ringCount === 1 ? "" : "s"} · {vertexCount.toLocaleString()} vertices
        </div>
        {/*
          Story 3.2 gates metres behind >= 3 calibration points. Until then the app
          must not imply metric accuracy, so it says so rather than staying silent.
        */}
        <p className="hint">
          Not metres. Depth in metres needs at least three known-depth reference points (story 3.2);
          until then this is the raw band ratio.
        </p>
      </div>

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
