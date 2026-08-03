import { parseProjectDocument, projectSlug } from "@bok/core";
import { Hono } from "hono";
import type { ProjectStore } from "../projects/store.js";

/**
 * Named projects (issue #8). A project bundles the AOI, the exclusion and inclusion
 * zones, the date range and the tuning parameters — that is, every *input* (D10).
 * The derived boundary is not stored: it would let a saved file disagree with the
 * parameters sitting next to it.
 */
export function createProjectRoutes(store: () => ProjectStore, now: () => string = isoNow) {
  const app = new Hono();

  /** GET /api/projects — summaries only; the documents can be large. */
  app.get("/projects", (c) => c.json({ projects: store().list() }));

  app.get("/projects/:id", (c) => {
    const document = store().get(c.req.param("id"));
    if (!document) return c.json({ error: "No such project." }, 404);
    return c.json(document);
  });

  /**
   * PUT /api/projects/:id — create or replace. Idempotent, which suits a Save button:
   * the client owns the id (`projectSlug` of the name) and can retry without
   * accumulating duplicates.
   */
  app.put("/projects/:id", async (c) => {
    let document: ReturnType<typeof parseProjectDocument>;
    try {
      document = parseProjectDocument(await c.req.json());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Malformed project.";
      return c.json({ error: message }, 400);
    }

    const id = c.req.param("id");
    if (id !== projectSlug(id)) {
      return c.json({ error: `Project id must be a slug — try "${projectSlug(id)}".` }, 400);
    }

    return c.json(store().put(id, document, now()));
  });

  app.delete("/projects/:id", (c) => {
    if (!store().remove(c.req.param("id"))) return c.json({ error: "No such project." }, 404);
    return c.body(null, 204);
  });

  return app;
}

function isoNow(): string {
  return new Date().toISOString();
}
