import type { Aoi } from "./aoi.js";

/**
 * The one place a project's shape is defined. `apps/web` writes it, `apps/api`
 * validates and stores it, and neither owns it — which is the whole reason it lives
 * in `core` rather than in either of them.
 */
export const PROJECT_SCHEMA_VERSION = 2;

/** Versions that still parse. Anything older than the oldest here is a hard error. */
const SUPPORTED_SCHEMA_VERSIONS = [1, 2] as const;

export interface ProjectCalibration {
  /**
   * Soundings this project keeps out of its ratio→metres fit (issue #13).
   *
   * The soundings themselves are global — they measure the seabed and outlive any plan
   * (issue #47). What belongs to a project is the *judgement*: fourteen readings across
   * two sites 12 km apart, with different clarity and substrate, may fit worse as one
   * model than as two, and which ones to drop is a decision about this survey area.
   *
   * `m1` and `m0` are deliberately absent. The fit is derived from soundings × composite,
   * so storing it would let a saved file disagree with the raster sitting beside it —
   * the same argument D10 makes about the boundary.
   */
  excludedSoundingIds: string[];
}

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
  calibration: ProjectCalibration;
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

  /**
   * Older versions are upgraded, not rejected.
   *
   * The first real project — a 25-vertex diagonal coastal band, 285 km² of water, the
   * only measurement this repo has of how the pipeline behaves at scale — is a v1 row
   * sitting in someone's SQLite file. Refusing it on the version number would have been
   * silent data loss the first time they opened it, in exchange for nothing: v2 adds one
   * field whose empty value is exactly what a v1 document means.
   *
   * A *newer* version is still a hard error. Guessing at a field that has not been
   * invented yet is not something this can do.
   */
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(doc.schemaVersion as 1 | 2)) {
    throw new Error(
      `Unsupported project schema version ${String(doc.schemaVersion)} — expected ${SUPPORTED_SCHEMA_VERSIONS.join(" or ")}.`,
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
    calibration: parseCalibration(doc.calibration),
  };
}

/** Absent on every v1 document, and on a v2 one that has never excluded anything. */
function parseCalibration(value: unknown): ProjectCalibration {
  if (value === undefined || value === null) return { excludedSoundingIds: [] };
  const calibration = asRecord(value, "The calibration must be an object.");

  const ids = calibration.excludedSoundingIds;
  if (ids === undefined || ids === null) return { excludedSoundingIds: [] };
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    throw new Error("The excluded sounding ids must be a list of strings.");
  }
  return { excludedSoundingIds: ids };
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
