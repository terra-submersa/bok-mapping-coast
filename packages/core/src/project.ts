import type { Aoi } from "./aoi.js";

/**
 * The one place a project's shape is defined. `apps/web` writes it, `apps/api`
 * validates and stores it, and neither owns it — which is the whole reason it lives
 * in `core` rather than in either of them.
 */
export const PROJECT_SCHEMA_VERSION = 1;

export interface ProjectParams {
  /** Null until a composite has been loaded and a range is known. */
  threshold: number | null;
  tolerance: number;
  bufferMetres: number;
  coastMetres: number;
  minRingAreaM2: number;
}

export interface ProjectDocument {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  name: string;
  /**
   * Everything hand-drawn. These are the *inputs* the project exists to keep
   * (D10) — the boundary itself is derived and deliberately not stored, because
   * storing it would let a saved file disagree with the parameters beside it.
   */
  aoi: Aoi | null;
  exclusions: GeoJSON.Polygon[];
  inclusions: GeoJSON.Polygon[];
  dateRange: { from: string; to: string };
  params: ProjectParams;
}

/** A stable id from a name: lowercase, dashes, no surprises in a URL. */
export function projectSlug(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  // A name of nothing but punctuation would otherwise produce an empty id, and an
  // empty id is a route that matches the collection rather than a member.
  return slug || "project";
}

/**
 * Validates an untrusted value — a request body, or a row read back from a database
 * written by an older version — and returns it typed. Throws with a message meant to
 * be shown to the user.
 *
 * Deliberately strict about structure and lenient about content: it checks that a
 * ring is a ring, not that the polygon is somewhere sensible. Geometry that is
 * geographically silly is the Planner's business; geometry that is malformed would
 * crash the pipeline several steps later, where the cause is unrecoverable.
 */
export function parseProjectDocument(value: unknown): ProjectDocument {
  const doc = asRecord(value, "A project must be an object.");

  if (doc.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported project schema version ${String(doc.schemaVersion)} — expected ${PROJECT_SCHEMA_VERSION}.`,
    );
  }

  const name = doc.name;
  if (typeof name !== "string" || name.trim() === "") {
    throw new Error("A project needs a name.");
  }

  const dateRange = asRecord(doc.dateRange, "A project needs a date range.");
  if (typeof dateRange.from !== "string" || typeof dateRange.to !== "string") {
    throw new Error("The date range needs a from and a to.");
  }

  const params = asRecord(doc.params, "A project needs its parameters.");
  const numericParams = ["tolerance", "bufferMetres", "coastMetres", "minRingAreaM2"] as const;
  for (const key of numericParams) {
    if (typeof params[key] !== "number" || !Number.isFinite(params[key])) {
      throw new Error(`Parameter "${key}" must be a finite number.`);
    }
  }
  if (params.threshold !== null && typeof params.threshold !== "number") {
    throw new Error('Parameter "threshold" must be a number or null.');
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: name.trim(),
    aoi: doc.aoi === null || doc.aoi === undefined ? null : parsePolygon(doc.aoi, "AOI"),
    exclusions: parsePolygonList(doc.exclusions, "exclusion"),
    inclusions: parsePolygonList(doc.inclusions, "inclusion"),
    dateRange: { from: dateRange.from, to: dateRange.to },
    params: {
      threshold: (params.threshold as number | null) ?? null,
      tolerance: params.tolerance as number,
      bufferMetres: params.bufferMetres as number,
      coastMetres: params.coastMetres as number,
      minRingAreaM2: params.minRingAreaM2 as number,
    },
  };
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function parsePolygonList(value: unknown, label: string): GeoJSON.Polygon[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`The ${label} zones must be a list.`);
  return value.map((zone, index) => parsePolygon(zone, `${label} zone ${index + 1}`));
}

function parsePolygon(value: unknown, label: string): Aoi {
  const geometry = asRecord(value, `The ${label} must be a GeoJSON Polygon.`);
  if (geometry.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
    throw new Error(`The ${label} must be a GeoJSON Polygon.`);
  }

  const coordinates = geometry.coordinates.map((ring) => {
    if (!Array.isArray(ring) || ring.length < 4) {
      throw new Error(`The ${label} has a ring with fewer than four positions.`);
    }
    return ring.map((position) => {
      if (
        !Array.isArray(position) ||
        position.length < 2 ||
        !position.slice(0, 2).every((n) => typeof n === "number" && Number.isFinite(n))
      ) {
        throw new Error(`The ${label} has a position that is not a lon/lat pair.`);
      }
      return [position[0], position[1]] as GeoJSON.Position;
    });
  });

  if (coordinates.length === 0) throw new Error(`The ${label} has no rings.`);
  return { type: "Polygon", coordinates };
}
