import type { ContourRing } from "@bok/core";
import { formatAreaM2 } from "../lib/format.js";
import { CollapsibleSection } from "./CollapsibleSection.js";

export interface RingPanelProps {
  rings: ContourRing[];
  selectedRing: ContourRing | null;
  allSelected: boolean;
  onSelect: (ring: ContourRing) => void;
  onSelectAll: () => void;
}

/** How many candidates get their own row before the rest are folded away — a
 * raster contour over Kiladha is ~100 rings of mostly offshore triangles. */
const MAX_LISTED = 8;

export function RingPanel({
  rings,
  selectedRing,
  allSelected,
  onSelect,
  onSelectAll,
}: RingPanelProps) {
  const listed = rings.slice(0, MAX_LISTED);
  const hiddenCount = rings.length - listed.length;
  const totalAreaM2 = rings.reduce((sum, ring) => sum + ring.areaM2, 0);

  return (
    <CollapsibleSection id="rings" title="Ring selection">
      <p className="hint">
        A raster contour is many rings — one real survey area plus offshore noise. Pick the one that
        is the flight area, or combine them all; click a ring on the map or a row below.
      </p>

      <ul className="ring-list">
        <li>
          <button
            type="button"
            className={allSelected ? "ring-item active" : "ring-item"}
            onClick={onSelectAll}
          >
            <span>{allSelected ? "●" : "○"} All rings</span>
            <span>
              {formatAreaM2(totalAreaM2)} · {rings.length} ring{rings.length === 1 ? "" : "s"}
            </span>
          </button>
        </li>
        {listed.map((ring, index) => {
          const active = !allSelected && ring === selectedRing;
          return (
            <li key={ring.anchor.join(",")}>
              <button
                type="button"
                className={active ? "ring-item active" : "ring-item"}
                onClick={() => onSelect(ring)}
              >
                <span>
                  {active ? "●" : "○"} Ring {index + 1}
                </span>
                <span>
                  {formatAreaM2(ring.areaM2)} · {ring.vertexCount}v
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {hiddenCount > 0 && (
        <p className="hint">
          + {hiddenCount} smaller ring{hiddenCount === 1 ? "" : "s"} not listed — click on the map
          to select one of those instead.
        </p>
      )}
    </CollapsibleSection>
  );
}
