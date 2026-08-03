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

/** One Placemark: a single closed outer ring, altitude clamped to ground. */
function placemark(ring: GeoJSON.Position[], name: string, description?: string): string {
  const coordinates = ring.map(formatCoordinate).join(" ");
  const descriptionTag = description
    ? `\n      <description>${escapeXml(description)}</description>`
    : "";

  return `    <Placemark>
      <name>${escapeXml(name)}</name>${descriptionTag}
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinates}</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>`;
}

/**
 * Serialises a survey boundary as KML for DJI Pilot 2's mapping-mission import.
 *
 * Deliberately minimal: one Polygon per Placemark, one LinearRing each,
 * altitude clamped to ground. Pilot 2 plans the lawnmower lines itself, so
 * there are no waypoints here — see CLAUDE.md.
 *
 * **One Placemark per disjoint piece** (issue #33). A boundary is routinely
 * several separate survey areas — the ribbon along the mainland, the ribbon
 * around an island, a detached shallow patch — and the pipeline no longer
 * collapses them to the largest. Pieces are numbered so Pilot 2's import list
 * is readable.
 *
 * Holes are dropped, per piece: only each piece's outer ring is written. A
 * mapping boundary with an island cut out is not something Pilot 2 handles,
 * and flying over the hole is harmless — the same trade `ContourRing` makes.
 * A piece too degenerate to form a ring is skipped rather than failing the
 * whole export; only a boundary with no usable piece at all throws.
 *
 * NOT YET VALIDATED ON HARDWARE, and the multi-Placemark form especially so:
 * whether Pilot 2 reads several Placemarks as several survey areas, picks the
 * first, or rejects the file outright is unknown. CLAUDE.md is explicit that
 * the reliable approach is to take a mission Pilot 2 exported itself and use
 * its XML as a template. This is standard OGC KML 2.2 written from the spec,
 * which is a starting point, not a guarantee. Story 6.1 stays open until a
 * file round-trips on the RC; if Pilot rejects this, diff it against a
 * Pilot-exported file and fix here.
 */
export function boundaryKml(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { name = "Survey boundary", description }: BoundaryKmlOptions = {},
): string {
  const pieces = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const rings = pieces.map((piece) => closeRing(piece[0] ?? [])).filter((ring) => ring.length >= 4);

  if (rings.length === 0) {
    throw new Error("A boundary needs at least three distinct points.");
  }

  // A single piece keeps the plain name — numbering "1 of 1" would be noise.
  const placemarks = rings
    .map((ring, index) =>
      placemark(
        ring,
        rings.length === 1 ? name : `${name} ${index + 1} of ${rings.length}`,
        description,
      ),
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
${placemarks}
  </Document>
</kml>
`;
}
