import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type ProjectDocument, parseProjectDocument } from "@bok/core";

export interface ProjectSummary {
  id: string;
  name: string;
  /** ISO 8601. */
  updatedAt: string;
}

export interface ProjectStore {
  list(): ProjectSummary[];
  get(id: string): ProjectDocument | null;
  put(id: string, document: ProjectDocument, updatedAt: string): ProjectSummary;
  remove(id: string): boolean;
  close(): void;
}

/**
 * Named projects, on disk, in SQLite.
 *
 * `node:sqlite` is in Node 22's standard library — it prints an ExperimentalWarning
 * and needs no flag — so this adds no dependency at all. See the README.
 *
 * The document is one JSON column rather than normalised geometry tables. It is
 * small, it is always read and written whole, and its shape is still moving;
 * `schemaVersion` inside the JSON is the migration handle, and `parseProjectDocument`
 * is where a row written by an older version gets rejected rather than half-read.
 *
 * `:memory:` is accepted, which is what the tests use.
 */
export function createProjectStore(path: string): ProjectStore {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      document   TEXT NOT NULL
    );
  `);

  const listStmt = db.prepare("SELECT id, name, updated_at FROM projects ORDER BY updated_at DESC");
  const getStmt = db.prepare("SELECT document FROM projects WHERE id = ?");
  const putStmt = db.prepare(`
    INSERT INTO projects (id, name, updated_at, document) VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name,
                                  updated_at = excluded.updated_at,
                                  document = excluded.document
  `);
  const removeStmt = db.prepare("DELETE FROM projects WHERE id = ?");

  return {
    list() {
      return listStmt.all().map((row) => ({
        id: String(row.id),
        name: String(row.name),
        updatedAt: String(row.updated_at),
      }));
    },

    get(id) {
      const row = getStmt.get(id);
      if (!row) return null;
      // Validated on the way out as well as in. A row can predate the current schema,
      // or have been edited by hand in a sqlite shell; failing here names the problem
      // instead of letting malformed geometry reach the pipeline.
      return parseProjectDocument(JSON.parse(String(row.document)));
    },

    put(id, document, updatedAt) {
      putStmt.run(id, document.name, updatedAt, JSON.stringify(document));
      return { id, name: document.name, updatedAt };
    },

    remove(id) {
      return removeStmt.run(id).changes > 0;
    },

    close() {
      db.close();
    },
  };
}
