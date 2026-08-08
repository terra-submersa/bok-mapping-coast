import { polygonAreaKm2 } from "@bok/core";
import type { ReactNode } from "react";
import { CollapsibleSection } from "./CollapsibleSection.js";

interface ZonePanelProps {
  /** Accordion id — must be unique across the sidebar it is rendered in. */
  id: string;
  title: string;
  drawLabel: string;
  emptyHint: ReactNode;
  footerHint: ReactNode;
  /** Shown in red, e.g. when a zone falls outside the AOI. */
  warning?: ReactNode;
  zones: GeoJSON.Polygon[];
  isDrawing: boolean;
  onStartDraw: () => void;
  onRemove: (index: number) => void;
  onClearAll: () => void;
}

/**
 * A list of hand-drawn zones, drawn one at a time and removable individually.
 *
 * Shared by exclusions (#17, cut) and inclusions (#16, added) because the two are
 * the same object with opposite signs: a polygon the Planner drew, stored with the
 * project, and re-applied to whatever boundary the current parameters produce (D10).
 * Only the wording and where they sit in the chain differ.
 */
export function ZonePanel({
  id,
  title,
  drawLabel,
  emptyHint,
  footerHint,
  warning,
  zones,
  isDrawing,
  onStartDraw,
  onRemove,
  onClearAll,
}: ZonePanelProps) {
  return (
    <CollapsibleSection id={id} title={`${title} (${zones.length})`}>
      <div className="row">
        <button type="button" onClick={onStartDraw} disabled={isDrawing}>
          {isDrawing ? "Drawing… click each corner, then close" : drawLabel}
        </button>
        <button type="button" onClick={onClearAll} disabled={zones.length === 0}>
          Clear all
        </button>
      </div>

      {zones.length === 0 ? (
        <p className="hint">{emptyHint}</p>
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

      {warning && <p className="error">{warning}</p>}
      <p className="hint">{footerHint}</p>
    </CollapsibleSection>
  );
}
