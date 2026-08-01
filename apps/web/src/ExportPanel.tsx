import { countVertices, largestRing } from "@bok/core";
import { boundaryKml } from "@bok/dji";

export interface ExportPanelProps {
  contour: GeoJSON.MultiPolygon;
  /** Provenance to write into the KML description. */
  threshold: number;
  tolerance: number;
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

export function ExportPanel({ contour, threshold, tolerance, from, to }: ExportPanelProps) {
  const boundary = largestRing(contour);
  const droppedRings = contour.coordinates.length - (boundary ? 1 : 0);

  function handleExport() {
    if (!boundary) return;
    downloadKml(
      `kiladha-boundary-${from}_${to}.kml`,
      boundaryKml(boundary, {
        name: "Kiladha survey boundary",
        description:
          `Sentinel-2 SDB composite ${from} to ${to}; ` +
          `Stumpf ratio threshold ${threshold.toFixed(4)}; ` +
          `simplified at ${tolerance} m. Relative depth, not calibrated to metres.`,
      }),
    );
  }

  return (
    <section className="panel">
      <h2>Export</h2>

      <button type="button" onClick={handleExport} disabled={!boundary}>
        Download boundary KML
      </button>

      <div className="stat">
        {boundary ? (
          <div>
            Largest ring: {countVertices(boundary).toLocaleString()} vertices
            {droppedRings > 0 &&
              ` · ${droppedRings} smaller ring${droppedRings === 1 ? "" : "s"} dropped`}
          </div>
        ) : (
          <p className="error">No ring large enough to export.</p>
        )}

        <p className="hint">
          Pilot 2 takes one simple polygon, so only the largest ring is exported and holes are
          dropped. Choosing a different ring is story 4.1.
        </p>
        <p className="error">
          Not yet flown. This KML is written from the OGC spec, not from a Pilot 2 export — it must
          be round-tripped on the actual RC before you rely on it in the field.
        </p>
      </div>
    </section>
  );
}
