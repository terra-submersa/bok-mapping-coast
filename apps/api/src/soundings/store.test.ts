import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { soundingId } from "@bok/core";
import { afterEach, describe, expect, it } from "vitest";
import { createSoundingStore } from "./store.js";

/**
 * The migration needs a database that survives being closed and reopened, so these use a
 * real file rather than `:memory:` — which the route tests use and which would lose the
 * whole point.
 */
const dirs: string[] = [];
function tempDbPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "bok-soundings-"));
  dirs.push(dir);
  return join(dir, "soundings.sqlite");
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A pre-#52 table: ids are a slug of the name alone, `user_version` never set. */
function seedOldSchema(path: string, rows: [string, string, number, number, number][]): void {
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
  `);
  const insert = db.prepare(
    "INSERT INTO soundings (id, name, lon, lat, depth_m, measured_at, source, note) " +
      "VALUES (?, ?, ?, ?, ?, NULL, 'echo-sounder', '')",
  );
  for (const row of rows) insert.run(...row);
  db.close();
}

function idsOf(path: string): string[] {
  const db = new DatabaseSync(path);
  const rows = db.prepare("SELECT id FROM soundings ORDER BY name").all() as { id: string }[];
  db.close();
  return rows.map((r) => r.id);
}

describe("createSoundingStore — re-keying old rows (issue #52)", () => {
  it("rewrites name-only ids to name-and-position ids", () => {
    const path = tempDbPath();
    seedOldSchema(path, [["bathy-0001", "Bathy 0001", 23.15200319, 37.31572657, 0.6]]);

    // Without this, the row on disk keeps an id no import can produce again, so
    // re-importing the survey it came from would insert a second copy beside it.
    const store = createSoundingStore(path);
    expect(store.list().map((s) => s.id)).toEqual([
      soundingId("Bathy 0001", 23.15200319, 37.31572657),
    ]);
    store.close();
  });

  it("leaves the readings themselves alone — only the key changes", () => {
    const path = tempDbPath();
    seedOldSchema(path, [["bathy-0001", "Bathy 0001", 23.15200319, 37.31572657, 0.6]]);

    const store = createSoundingStore(path);
    expect(store.list()[0]).toMatchObject({
      name: "Bathy 0001",
      lon: 23.15200319,
      lat: 37.31572657,
      depthM: 0.6,
      source: "echo-sounder",
    });
    store.close();
  });

  it("makes a re-import of the same survey an update, not a duplicate", () => {
    const path = tempDbPath();
    seedOldSchema(path, [["bathy-0001", "Bathy 0001", 23.15200319, 37.31572657, 0.6]]);

    const store = createSoundingStore(path);
    const { added, updated } = store.putMany([
      {
        id: soundingId("Bathy 0001", 23.15200319, 37.31572657),
        name: "Bathy 0001",
        lon: 23.15200319,
        lat: 37.31572657,
        depthM: 0.6,
        measuredAt: null,
        source: "echo-sounder",
        note: "",
      },
    ]);
    expect({ added, updated }).toEqual({ added: 0, updated: 1 });
    expect(store.list()).toHaveLength(1);
    store.close();
  });

  it("is a no-op on the second open, since user_version records that it ran", () => {
    const path = tempDbPath();
    seedOldSchema(path, [["bathy-0001", "Bathy 0001", 23.15200319, 37.31572657, 0.6]]);

    createSoundingStore(path).close();
    const after = idsOf(path);

    // An id supplied explicitly after the migration must survive a reopen — otherwise the
    // migration is not a migration, it is a rule enforced forever.
    const store = createSoundingStore(path);
    store.put({
      id: "lambayanna-1",
      name: "Lambayanna 1",
      lon: 23.152,
      lat: 37.3157,
      depthM: 1.2,
      measuredAt: null,
      source: "hand",
      note: "",
    });
    store.close();

    createSoundingStore(path).close();
    expect(idsOf(path)).toEqual([...after, "lambayanna-1"]);
  });

  it("re-keys a whole two-site survey without collisions", () => {
    const path = tempDbPath();
    seedOldSchema(path, [
      ["bathy-0001", "Bathy 0001", 23.15200319, 37.31572657, 0.6],
      ["bathy-0002", "Bathy 0002", 23.15213252, 37.31587627, 1],
      ["bathy-0015", "Bathy 0015", 23.13234628, 37.42865578, 4.6],
    ]);

    const store = createSoundingStore(path);
    const ids = store.list().map((s) => s.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => /^bathy-\d{4}-[ns]\d+-[ew]\d+$/.test(id))).toBe(true);
    store.close();
  });
});
