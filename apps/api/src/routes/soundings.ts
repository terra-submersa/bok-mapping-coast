import { parseBboxInput, parseSounding, parseSoundings } from "@bok/core";
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

  app.get("/soundings/:id", (c) => {
    const sounding = store().get(c.req.param("id"));
    if (!sounding) return c.json({ error: "No such sounding." }, 404);
    return c.json(sounding);
  });

  /**
   * POST /api/soundings — bulk upsert of a JSON array.
   *
   * Upsert rather than insert, keyed on an id derived from the name, so re-importing the
   * same survey corrects it instead of doubling it. All-or-nothing: a bad row rejects the
   * batch rather than leaving half a survey in the table for someone to reconcile later.
   */
  app.post("/soundings", async (c) => {
    let soundings: ReturnType<typeof parseSoundings>;
    try {
      const body = await c.req.json();
      soundings = parseSoundings(
        Array.isArray(body) ? body : (body as { soundings?: unknown }).soundings,
      );
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Malformed soundings." }, 400);
    }
    return c.json({ soundings: store().putMany(soundings) });
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
