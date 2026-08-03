import { countVertices } from "@bok/core";
import { boundaryKml } from "@bok/dji";
import { CollapsibleSection } from "./CollapsibleSection.js";

export interface ExportPanelProps {
  /** Final flight boundary: selected ring(s) unioned with the coastal ribbon,
   * buffered, clipped, then simplified. Several disjoint pieces is the normal
   * case — one per coastline or shallow patch (issue #33). Null if everything
   * collapsed under simplification. */
  boundary: GeoJSON.MultiPolygon | null;
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
            {countVertices(boundary).toLocaleString()} vertices ·{" "}
            {boundary.coordinates.length.toLocaleString()} piece
            {boundary.coordinates.length === 1 ? "" : "s"}
            {otherRingCount > 0 &&
              ` · ${otherRingCount} other ring${otherRingCount === 1 ? "" : "s"} not exported`}
          </div>
        ) : (
          <p className="error">
            The selected ring collapsed under simplification — lower the tolerance.
          </p>
        )}

        <p className="hint">
          The ring(s) chosen above unioned with the coastal ribbon, buffered, then simplified. Each
          disjoint piece — a separate stretch of coast, an island, a detached shallow patch — is
          exported as its own Placemark.
        </p>
        <p className="error">
          Not yet flown. This KML is written from the OGC spec, not from a Pilot 2 export — it must
          be round-tripped on the actual RC before you rely on it in the field.
          {boundary && boundary.coordinates.length > 1 && (
            <>
              {" "}
              This export has several Placemarks, which is especially unproven: whether Pilot 2
              reads them as several survey areas, takes the first, or rejects the file is unknown.
            </>
          )}
        </p>
      </div>
    </CollapsibleSection>
  );
}
