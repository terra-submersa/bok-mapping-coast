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

function linearRing(ring: GeoJSON.Position[]): string {
  return `<LinearRing>
            <coordinates>${ring.map(formatCoordinate).join(" ")}</coordinates>
          </LinearRing>`;
}

/**
 * One Placemark: a closed outer ring plus any inner rings, altitude clamped to
 * ground. KML 2.2 requires `outerBoundaryIs` before `innerBoundaryIs`.
 */
function placemark(piece: GeoJSON.Position[][], name: string, description?: string): string {
  const [outer, ...inner] = piece;
  const descriptionTag = description
    ? `\n      <description>${escapeXml(description)}</description>`
    : "";
  const innerTags = inner
    .map(
      (ring) => `
        <innerBoundaryIs>
          ${linearRing(ring)}
        </innerBoundaryIs>`,
    )
    .join("");

  return `    <Placemark>
      <name>${escapeXml(name)}</name>${descriptionTag}
      <Polygon>
        <altitudeMode>clampToGround</altitudeMode>
        <outerBoundaryIs>
          ${linearRing(outer)}
        </outerBoundaryIs>${innerTags}
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
 * **Holes are written**, as `<innerBoundaryIs>` (issue #39). They used to be
 * dropped, on the reasoning that a hole was a deep patch inside a shallow
 * contour and flying over it was harmless. Exclusion zones (issue #17) ended
 * that: a zone the Planner cut out of the middle of the survey area *is* a
 * hole, so dropping it meant the map showed the harbour excluded and the
 * drone flew it anyway — silently. A rejected file is loud and a dropped hole
 * is not, which is why emitting is the safer of the two errors.
 *
 * A piece too degenerate to form a ring is skipped rather than failing the
 * whole export; only a boundary with no usable piece at all throws. Degenerate
 * *inner* rings are dropped the same way, per piece.
 *
 * NOT YET VALIDATED ON HARDWARE, and the multi-Placemark and hole forms
 * especially so: whether Pilot 2 reads several Placemarks as several survey
 * areas, honours an inner boundary, picks the first, or rejects the file
 * outright is unknown. CLAUDE.md is explicit that the reliable approach is to
 * take a mission Pilot 2 exported itself and use its XML as a template. This
 * is standard OGC KML 2.2 written from the spec, which is a starting point,
 * not a guarantee. Story 6.1 stays open until a file round-trips on the RC —
 * and its checklist now includes *verify a hole is honoured*.
 */
export function boundaryKml(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon,
  { name = "Survey boundary", description }: BoundaryKmlOptions = {},
): string {
  const source = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const pieces = source
    .map(([outer, ...inner]) => {
      // The outer ring is checked on its own rather than filtering the whole piece:
      // dropping a degenerate outer would otherwise promote the first hole to be the
      // boundary, exporting a survey area of exactly the shape meant to be excluded.
      const closedOuter = closeRing(outer ?? []);
      if (closedOuter.length < 4) return null;
      return [closedOuter, ...inner.map(closeRing).filter((ring) => ring.length >= 4)];
    })
    .filter((piece): piece is GeoJSON.Position[][] => piece !== null);

  if (pieces.length === 0) {
    throw new Error("A boundary needs at least three distinct points.");
  }

  // A single piece keeps the plain name — numbering "1 of 1" would be noise.
  const placemarks = pieces
    .map((piece, index) =>
      placemark(
        piece,
        pieces.length === 1 ? name : `${name} ${index + 1} of ${pieces.length}`,
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
