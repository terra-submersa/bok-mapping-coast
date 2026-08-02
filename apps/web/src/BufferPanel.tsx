import { CollapsibleSection } from "./CollapsibleSection.js";
import { formatAreaM2 } from "./format.js";

export interface BufferPanelProps {
  metres: number;
  onMetresChange: (value: number) => void;
  beforeVertices: number;
  beforeAreaM2: number;
  afterVertices: number;
  afterAreaM2: number;
}

export function BufferPanel({
  metres,
  onMetresChange,
  beforeVertices,
  beforeAreaM2,
  afterVertices,
  afterAreaM2,
}: BufferPanelProps) {
  return (
    <CollapsibleSection id="buffer" title="Landward buffer">
      <div className="field">
        <label htmlFor="buffer">Buffer: {metres} m</label>
        <input
          id="buffer"
          type="range"
          min={0}
          max={60}
          step={5}
          value={metres}
          onChange={(e) => onMetresChange(Number(e.target.value))}
          aria-label="Landward buffer"
        />
      </div>

      <div className="stat">
        <div>
          {afterVertices.toLocaleString()} vertices · {formatAreaM2(afterAreaM2)}
        </div>
        <div>
          from {beforeVertices.toLocaleString()} vertices · {formatAreaM2(beforeAreaM2)} unbuffered
        </div>

        <p className="hint">
          Recommended 20–50 m. Structure-from-motion has no tie points over open water, so flight
          lines must reach past the contour to catch shoreline features.
        </p>
        <p className="hint">
          Non-destructive: the unbuffered ring is kept, so dragging back to 0 m restores it exactly.
        </p>
      </div>
    </CollapsibleSection>
  );
}
