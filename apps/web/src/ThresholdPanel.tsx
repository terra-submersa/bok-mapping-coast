import type { Range } from "@bok/core";
import { CollapsibleSection } from "./CollapsibleSection.js";

export interface ThresholdPanelProps {
  range: Range;
  threshold: number;
  onThresholdChange: (value: number) => void;
  vertexCount: number;
  ringCount: number;
}

export function ThresholdPanel({
  range,
  threshold,
  onThresholdChange,
  vertexCount,
  ringCount,
}: ThresholdPanelProps) {
  return (
    <CollapsibleSection id="threshold" title="Shallow-water threshold">
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={(range.max - range.min) / 200}
        value={threshold}
        onChange={(e) => onThresholdChange(Number(e.target.value))}
        aria-label="Shallow-water threshold"
      />

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
    </CollapsibleSection>
  );
}
