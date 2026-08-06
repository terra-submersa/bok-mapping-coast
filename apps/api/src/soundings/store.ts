import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type BBox, type Sounding, soundingId } from "@bok/core";

/** What a bulk import did, so the caller can say it out loud rather than guess (#52). */
export interface ImportResult {
  soundings: Sounding[];
  added: number;
  updated: number;
}

export interface SoundingStore {
  /** Every sounding, or only those inside `bbox`, ordered by name. */
  list(bbox?: BBox): Sounding[];
  get(id: string): Sounding | null;
  put(sounding: Sounding): Sounding;
  /** Bulk upsert in one transaction — a CSV import is all-or-nothing. */
  putMany(soundings: Sounding[]): ImportResult;
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

  rekeyByPosition(db);

  const columns = "id, name, lon, lat, depth_m, measured_at, source, note";
  const listStmt = db.prepare(`SELECT ${columns} FROM soundings ORDER BY name`);
  const listInBboxStmt = db.prepare(`
    SELECT ${columns} FROM soundings
    WHERE lon >= ? AND lon <= ? AND lat >= ? AND lat <= ?
    ORDER BY name
  `);
  const getStmt = db.prepare(`SELECT ${columns} FROM soundings WHERE id = ?`);
  const existsStmt = db.prepare("SELECT 1 FROM soundings WHERE id = ?");
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
      let added = 0;
      try {
        for (const sounding of soundings) {
          // Counted before the write, because after it every row exists. Cheap: the id is
          // the primary key, so this is an index probe.
          if (existsStmt.get(sounding.id) === undefined) added++;
          write(sounding);
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return { soundings, added, updated: soundings.length - added };
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
 * Migration 1 — ids derived from the name alone become ids derived from name and
 * position (#52).
 *
 * Without this, every row already on disk keeps an id no import can ever produce again,
 * so re-importing the survey it came from would insert a complete second copy beside it.
 *
 * Deterministic and collision-free: the old ids were unique per name, and the new id
 * carries strictly more information than the old one did. Guarded by `user_version` so a
 * second open is a no-op.
 *
 * Two things it knowingly does not handle. A row imported with an *explicit* id gets
 * re-keyed like any other — telling the two apart would mean carrying a column that
 * records where the id came from, which is not worth it for a case that has never
 * occurred. And `ProjectDocument.calibration.excludedSoundingIds` holds sounding ids,
 * which a re-key orphans; every saved project's list was empty when this was written, so
 * there was nothing to migrate. If that ever stops being true, a stale exclusion fails
 * quietly — it lets a sounding the planner had rejected back into the fit.
 */
function rekeyByPosition(db: DatabaseSync): void {
  const version = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined;
  if ((version?.user_version ?? 0) >= 1) return;

  const rows = db.prepare("SELECT id, name, lon, lat FROM soundings").all() as {
    id: string;
    name: string;
    lon: number;
    lat: number;
  }[];
  const update = db.prepare("UPDATE soundings SET id = ? WHERE id = ?");

  db.exec("BEGIN");
  try {
    for (const row of rows) {
      const id = soundingId(row.name, row.lon, row.lat);
      if (id !== row.id) update.run(id, row.id);
    }
    db.exec("PRAGMA user_version = 1");
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
