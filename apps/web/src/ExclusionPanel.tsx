import { polygonAreaKm2 } from "@bok/core";
import { CollapsibleSection } from "./CollapsibleSection.js";

interface ExclusionPanelProps {
  zones: GeoJSON.Polygon[];
  isDrawing: boolean;
  onStartDraw: () => void;
  onRemove: (index: number) => void;
  onClearAll: () => void;
}

/**
 * Areas cut out of the survey polygon: the harbour, moorings, a swimming beach
 * (issue #17).
 *
 * A zone is an *input*, like the AOI — drawn by hand, stored with the project, and
 * re-applied to whatever boundary the current parameters produce (D10). Changing the
 * threshold does not disturb it.
 */
export function ExclusionPanel({
  zones,
  isDrawing,
  onStartDraw,
  onRemove,
  onClearAll,
}: ExclusionPanelProps) {
  return (
    <CollapsibleSection id="exclusions" title={`Exclusion zones (${zones.length})`}>
      <div className="row">
        <button type="button" onClick={onStartDraw} disabled={isDrawing}>
          {isDrawing ? "Drawing… click each corner, then close" : "Draw exclusion"}
        </button>
        <button type="button" onClick={onClearAll} disabled={zones.length === 0}>
          Clear all
        </button>
      </div>

      {zones.length === 0 ? (
        <p className="hint">
          Nothing excluded. Draw over anything the survey must not cover — moorings, the harbour
          mouth, a swimming area.
        </p>
      ) : (
        <ul className="stat">
          {zones.map((zone, index) => (
            <li
              // Zones have no identity of their own and are only ever appended or
              // removed whole, so their position is a stable enough key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              className="row"
              style={{ justifyContent: "space-between", alignItems: "baseline" }}
            >
              <span>
                Zone {index + 1} · {(polygonAreaKm2(zone) * 100).toFixed(1)} ha
              </span>
              <button type="button" onClick={() => onRemove(index)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        Zones are cut from the exported KML, not merely drawn over it. A zone in the middle of the
        survey area becomes a hole — which reaches Pilot 2 as an inner boundary, and is the part of
        the export least proven on the RC (issue #39).
      </p>
    </CollapsibleSection>
  );
}
