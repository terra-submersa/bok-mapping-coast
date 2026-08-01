export interface BoundaryKmlOptions {
  /** Placemark name, shown in Pilot 2's import list. */
  name?: string;
  /** Optional provenance line — threshold, date range, tolerance. */
  description?: string;
}

/** XML text escaping. Names come from user input and can contain & or <. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Six decimal places is ~0.1 m — far finer than the boundary is accurate to. */
function formatCoordinate([lon, lat]: GeoJSON.Position): string {
  return `${lon.toFixed(6)},${lat.toFixed(6)},0`;
}

/** Ensures the ring is explicitly closed, which KML requires of a LinearRing. */
function closeRing(ring: GeoJSON.Position[]): GeoJSON.Position[] {
  if (ring.length === 0) return ring;
  const [first] = ring;
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/**
 * Serialises a survey boundary as KML for DJI Pilot 2's mapping-mission import.
 *
 * Deliberately minimal: one Placemark, one Polygon, one LinearRing, altitude
 * clamped to ground. Pilot 2 plans the lawnmower lines itself, so there are no
 * waypoints here — see CLAUDE.md.
 *
 * NOT YET VALIDATED ON HARDWARE. CLAUDE.md is explicit that the reliable approach
 * is to take a mission Pilot 2 exported itself and use its XML as a template.
 * This is standard OGC KML 2.2 written from the spec, which is a starting point,
 * not a guarantee. Story 6.1 stays open until a file round-trips on the RC; if
 * Pilot rejects this, diff it against a Pilot-exported file and fix here.
 */
export function boundaryKml(
  polygon: GeoJSON.Polygon,
  { name = "Survey boundary", description }: BoundaryKmlOptions = {},
): string {
  const ring = closeRing(polygon.coordinates[0] ?? []);
  if (ring.length < 4) {
    throw new Error("A boundary needs at least three distinct points.");
  }

  const coordinates = ring.map(formatCoordinate).join(" ");
  const descriptionTag = description
    ? `\n      <description>${escapeXml(description)}</description>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
    <Placemark>
      <name>${escapeXml(name)}</name>${descriptionTag}
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinates}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>
`;
}
