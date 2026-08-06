import {
  formatSoundingCsv,
  parseBboxInput,
  parseSounding,
  parseSoundingCsv,
  parseSoundings,
} from "@bok/core";
import { Hono } from "hono";
import type { SoundingStore } from "../soundings/store.js";

/**
 * Measured depths (issue #47). A separate resource from projects on purpose: a sounding
 * measures the seabed, not a plan, so it outlives any one project and is reusable by
 * every project covering that water. What a project stores is which soundings it leaves
 * out of its fit (issue #13), never the readings themselves.
 */
export function createSoundingRoutes(store: () => SoundingStore) {
  const app = new Hono();

  /** GET /api/soundings — all of them, or `?bbox=minLon,minLat,maxLon,maxLat`. */
  app.get("/soundings", (c) => {
    const raw = c.req.query("bbox");
    if (raw === undefined || raw === "") {
      return c.json({ soundings: store().list() });
    }
    try {
      return c.json({ soundings: store().list(parseBboxInput(raw)) });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Invalid bbox." }, 400);
    }
  });

  /**
   * GET /api/soundings.csv — the whole table, as a file (issue #48).
   *
   * The database is the source of truth, which makes this the backup path, so it emits
   * every field rather than the four a Garmin export happens to carry. Registered before
   * `/soundings/:id` reads it as an id — it does not, since that route needs a slash, but
   * the ordering costs nothing and the failure would be baffling.
   */
  app.get("/soundings.csv", (c) => {
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", 'attachment; filename="soundings.csv"');
    return c.body(formatSoundingCsv(store().list()));
  });

  app.get("/soundings/:id", (c) => {
    const sounding = store().get(c.req.param("id"));
    if (!sounding) return c.json({ error: "No such sounding." }, 404);
    return c.json(sounding);
  });

  /**
   * POST /api/soundings — bulk upsert of a JSON array, or of a CSV body (issue #48).
   *
   * Upsert rather than insert, keyed on an id derived from the name *and the position*
   * (issue #52), so re-importing the same survey corrects it instead of doubling it,
   * while a second survey that also starts at "Bathy 0001" lands beside the first rather
   * than on top of it. All-or-nothing: a bad row rejects the batch rather than leaving
   * half a survey in the table for someone to reconcile later.
   *
   * Answers with `added` and `updated` alongside the rows. Which of the two a row was is
   * the thing the caller cannot work out afterwards, and it is what an import needs to be
   * able to say — a survey that silently replaced another is how #52 happened.
   *
   * CSV is accepted directly because that is the shape the data actually has — waypoints
   * exported from a Garmin with the depths typed in beside them. Making the browser or
   * the import script translate it first would just move the parser somewhere with less
   * test coverage.
   */
  app.post("/soundings", async (c) => {
    const isCsv = (c.req.header("Content-Type") ?? "").includes("csv");
    let soundings: ReturnType<typeof parseSoundings>;
    try {
      if (isCsv) {
        soundings = parseSoundingCsv(await c.req.text());
      } else {
        const body = await c.req.json();
        soundings = parseSoundings(
          Array.isArray(body) ? body : (body as { soundings?: unknown }).soundings,
        );
      }
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Malformed soundings." }, 400);
    }
    return c.json(store().putMany(soundings));
  });

  /** PUT /api/soundings/:id — create or replace one. The path id wins over the body's. */
  app.put("/soundings/:id", async (c) => {
    const id = c.req.param("id");
    try {
      const sounding = parseSounding({ ...(await c.req.json()), id });
      return c.json(store().put(sounding));
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Malformed sounding." }, 400);
    }
  });

  app.delete("/soundings/:id", (c) => {
    if (!store().remove(c.req.param("id"))) return c.json({ error: "No such sounding." }, 404);
    return c.body(null, 204);
  });

  return app;
}
