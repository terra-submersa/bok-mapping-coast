import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BBox, Sounding } from "@bok/core";

export interface SoundingStore {
  /** Every sounding, or only those inside `bbox`, ordered by name. */
  list(bbox?: BBox): Sounding[];
  get(id: string): Sounding | null;
  put(sounding: Sounding): Sounding;
  /** Bulk upsert in one transaction — a CSV import is all-or-nothing. */
  putMany(soundings: Sounding[]): Sounding[];
  remove(id: string): boolean;
  close(): void;
}

/**
 * Measured depths, on disk, in SQLite.
 *
 * Normalised columns rather than the one-JSON-column trick `projects/store.ts` uses, and
 * the difference is deliberate. A project document is large, irregular, always read
 * whole, and still changing shape. A sounding is four numbers and a name, is uniform,
 * and gets queried *by extent* — which a JSON blob cannot answer without reading every
 * row.
 *
 * This file is the one thing in the system that cannot be recomputed. A composite can be
 * refetched and a boundary re-derived, but these fourteen numbers cost a boat, a sounder
 * and a morning on the water. Hence `readSoundingDbPath` defaults outside `.cache/`,
 * which is documented as safe to delete, and hence the CSV export in issue #48.
 *
 * `:memory:` is accepted, which is what the tests use.
 */
export function createSoundingStore(path: string): SoundingStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS soundings (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      lon         REAL NOT NULL,
      lat         REAL NOT NULL,
      depth_m     REAL NOT NULL,
      measured_at TEXT,
      source      TEXT NOT NULL DEFAULT '',
      note        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS soundings_lonlat ON soundings (lon, lat);
  `);

  const columns = "id, name, lon, lat, depth_m, measured_at, source, note";
  const listStmt = db.prepare(`SELECT ${columns} FROM soundings ORDER BY name`);
  const listInBboxStmt = db.prepare(`
    SELECT ${columns} FROM soundings
    WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?
    ORDER BY name
  `);
  const getStmt = db.prepare(`SELECT ${columns} FROM soundings WHERE id = ?`);
  const putStmt = db.prepare(`
    INSERT INTO soundings (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name        = excluded.name,
                                  lon         = excluded.lon,
                                  lat         = excluded.lat,
                                  depth_m     = excluded.depth_m,
                                  measured_at = excluded.measured_at,
                                  source      = excluded.source,
                                  note        = excluded.note
  `);
  const removeStmt = db.prepare("DELETE FROM soundings WHERE id = ?");

  function write(sounding: Sounding): void {
    putStmt.run(
      sounding.id,
      sounding.name,
      sounding.lon,
      sounding.lat,
      sounding.depthM,
      sounding.measuredAt,
      sounding.source,
      sounding.note,
    );
  }

  return {
    list(bbox) {
      const rows = bbox ? listInBboxStmt.all(bbox[0], bbox[2], bbox[1], bbox[3]) : listStmt.all();
      return rows.map(toSounding);
    },

    get(id) {
      const row = getStmt.get(id);
      return row ? toSounding(row) : null;
    },

    put(sounding) {
      write(sounding);
      return sounding;
    },

    putMany(soundings) {
      // One transaction, so a CSV that goes wrong halfway leaves no half-imported survey
      // behind. The rows are validated before they get here; this guards against a disk
      // or constraint failure mid-batch.
      db.exec("BEGIN");
      try {
        for (const sounding of soundings) write(sounding);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return soundings;
    },

    remove(id) {
      return removeStmt.run(id).changes > 0;
    },

    close() {
      db.close();
    },
  };
}

/**
 * A row back to a `Sounding`. Not run through `parseSounding`: these values were
 * validated on the way in and the column types are enforced by the schema, so the
 * paranoia the project store needs — where a hand-edited JSON blob could be anything —
 * buys nothing here.
 */
function toSounding(row: Record<string, unknown>): Sounding {
  return {
    id: String(row.id),
    name: String(row.name),
    lon: Number(row.lon),
    lat: Number(row.lat),
    depthM: Number(row.depth_m),
    measuredAt: row.measured_at === null ? null : String(row.measured_at),
    source: String(row.source),
    note: String(row.note),
  };
}
