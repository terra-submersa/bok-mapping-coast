import { projectSlug } from "./project.js";

/**
 * A measured depth at a point — the ground truth the whole of Epic 3 hangs on.
 *
 * Lives in `core` for the same reason `ProjectDocument` does: `apps/web` writes one,
 * `apps/api` stores it, and neither owns its shape.
 *
 * A sounding is *not* part of a project. It measures the seabed, which does not care
 * which flight someone is planning, so the same reading serves every project covering
 * that water. What a project owns is the judgement about a sounding — whether to let it
 * into the fit — and that lives in `ProjectDocument.calibration`.
 */
export interface Sounding {
  /** Stable across a re-import: a slug of the name, so the same CSV twice is idempotent. */
  id: string;
  name: string;
  lon: number;
  lat: number;
  /**
   * Metres of water. **True depth below the instantaneous sea surface at the moment of
   * measurement** — see D13. An acoustic sounder measures the ping's travel, so
   * refraction at n≈1.34 does not enter: it displaces the optical apparent position of a
   * feature, not the echo. Fitting the Stumpf ratio against these therefore produces a
   * model that already yields true depth, and no refraction correction is applied
   * anywhere downstream.
   */
  depthM: number;
  /**
   * ISO 8601, or null when unknown. Kept so a tide correction remains possible later:
   * Argolic tides are 20-30 cm, small enough to state as residual error rather than
   * correct for, but only if the timestamp survives.
   */
  measuredAt: string | null;
  /** How it was obtained — "echo-sounder", "chart", "hand". Free text on purpose. */
  source: string;
  note: string;
}

/** What a caller may leave out: everything that has a sensible empty value. */
export interface SoundingInput {
  id?: string;
  name: string;
  lon: number;
  lat: number;
  depthM: number;
  measuredAt?: string | null;
  source?: string;
  note?: string;
}

/**
 * Depths beyond this are not soundings of shallow water, they are typos — a decimal
 * point in the wrong place, or metres confused with feet on a sounder set to imperial.
 * Generous by design: the project cares about 0-5 m, but a 40 m reading off the
 * headland is a legitimate thing to record.
 */
const MAX_PLAUSIBLE_DEPTH_M = 200;

/**
 * Validates an untrusted value — a CSV row, a request body, a table row written by an
 * older version — and returns it typed. Throws with a message meant for the user.
 *
 * Strict about the numbers, lenient about the prose. A lon/lat outside its legal range
 * or a negative depth is a mistake that would put a calibration point in the Atlantic
 * or above the waterline; a blank `note` is nobody's business.
 */
export function parseSounding(value: unknown): Sounding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("A sounding must be an object.");
  }
  const row = value as Record<string, unknown>;

  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (name === "") throw new Error("A sounding needs a name.");

  const lon = finite(row.lon, `Sounding "${name}" has no longitude.`);
  const lat = finite(row.lat, `Sounding "${name}" has no latitude.`);
  if (lon < -180 || lon > 180) throw new Error(`Sounding "${name}" has a longitude off Earth.`);
  if (lat < -90 || lat > 90) throw new Error(`Sounding "${name}" has a latitude off Earth.`);

  const depthM = finite(row.depthM, `Sounding "${name}" has no depth.`);
  if (depthM < 0) {
    throw new Error(`Sounding "${name}" has a negative depth — depth is measured downwards.`);
  }
  if (depthM > MAX_PLAUSIBLE_DEPTH_M) {
    throw new Error(
      `Sounding "${name}" reads ${depthM} m, past the ${MAX_PLAUSIBLE_DEPTH_M} m sanity limit — ` +
        "check the units on the sounder.",
    );
  }

  const measuredAt = row.measuredAt;
  if (measuredAt !== null && measuredAt !== undefined && typeof measuredAt !== "string") {
    throw new Error(`Sounding "${name}" has a measurement time that is not a string.`);
  }

  const id = typeof row.id === "string" && row.id.trim() !== "" ? row.id.trim() : projectSlug(name);

  return {
    id,
    name,
    lon,
    lat,
    depthM,
    measuredAt: measuredAt ?? null,
    source: typeof row.source === "string" ? row.source.trim() : "",
    note: typeof row.note === "string" ? row.note.trim() : "",
  };
}

/** Every sounding in a list, or a throw naming the row that failed. */
export function parseSoundings(value: unknown): Sounding[] {
  if (!Array.isArray(value)) throw new Error("Soundings must be a list.");
  return value.map((row, index) => {
    try {
      return parseSounding(row);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Sounding ${index + 1}: ${detail}`);
    }
  });
}

function finite(value: unknown, message: string): number {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Error(message);
  return n;
}
