import type { ContourRing } from "@bok/core";
import { CollapsibleSection } from "./CollapsibleSection.js";
import { formatAreaM2 } from "./format.js";

export interface RingPanelProps {
  rings: ContourRing[];
  selectedRing: ContourRing | null;
  onSelect: (ring: ContourRing) => void;
}

/** How many candidates get their own row before the rest are folded away — a
 * raster contour over Kiladha is ~100 rings of mostly offshore triangles. */
const MAX_LISTED = 8;

export function RingPanel({ rings, selectedRing, onSelect }: RingPanelProps) {
  const listed = rings.slice(0, MAX_LISTED);
  const hiddenCount = rings.length - listed.length;

  return (
    <CollapsibleSection id="rings" title="Ring selection">
      <p className="hint">
        A raster contour is many rings — one real survey area plus offshore noise. Pick the one that
        is the flight area; click a ring on the map or a row below.
      </p>

      <ul className="ring-list">
        {listed.map((ring, index) => {
          const active = ring === selectedRing;
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
