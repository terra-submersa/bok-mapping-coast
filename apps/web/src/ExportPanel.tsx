import { countVertices } from "@bok/core";
import { boundaryKml } from "@bok/dji";
import { CollapsibleSection } from "./CollapsibleSection.js";

export interface ExportPanelProps {
  /** Final flight boundary: selected ring, buffered, then simplified. Null if
   * the selected ring collapsed under simplification. */
  boundary: GeoJSON.Polygon | null;
  /** Other candidate rings not exported — see the ring selection panel. */
  otherRingCount: number;
  threshold: number;
  tolerance: number;
  bufferMetres: number;
  coastMetres: number;
  from: string;
  to: string;
}

function downloadKml(filename: string, kml: string) {
  const url = URL.createObjectURL(
    new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function ExportPanel({
  boundary,
  otherRingCount,
  threshold,
  tolerance,
  bufferMetres,
  coastMetres,
  from,
  to,
}: ExportPanelProps) {
  function handleExport() {
    if (!boundary) return;
    downloadKml(
      `kiladha-boundary-${from}_${to}.kml`,
      boundaryKml(boundary, {
        name: "Kiladha survey boundary",
        description:
          `Sentinel-2 SDB composite ${from} to ${to}; ` +
          `Stumpf ratio threshold ${threshold.toFixed(4)}; ` +
          `buffered ${bufferMetres} m landward; ` +
          `unioned with a ${coastMetres} m coastal ribbon; ` +
          `simplified at ${tolerance} m. Relative depth, not calibrated to metres.`,
      }),
    );
  }

  return (
    <CollapsibleSection id="export" title="Export">
      <button type="button" onClick={handleExport} disabled={!boundary}>
        Download boundary KML
      </button>

      <div className="stat">
        {boundary ? (
          <div>
            {countVertices(boundary).toLocaleString()} vertices
            {otherRingCount > 0 &&
              ` · ${otherRingCount} other ring${otherRingCount === 1 ? "" : "s"} not exported`}
          </div>
        ) : (
          <p className="error">
            The selected ring collapsed under simplification — lower the tolerance.
          </p>
        )}

        <p className="hint">
          Pilot 2 takes one simple polygon: the ring(s) chosen above, buffered, then simplified.
        </p>
        <p className="error">
          Not yet flown. This KML is written from the OGC spec, not from a Pilot 2 export — it must
          be round-tripped on the actual RC before you rely on it in the field.
        </p>
      </div>
    </CollapsibleSection>
  );
}
