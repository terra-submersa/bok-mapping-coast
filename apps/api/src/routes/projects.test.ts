import { parseProjectDocument, projectSlug, rectangleAoi } from "@bok/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createProjectStore, type ProjectStore } from "../projects/store.js";
import { createProjectRoutes } from "./projects.js";

/** `Response.json()` is `unknown` under strict TS; assert the shape at the boundary. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function document(name = "Kiladha") {
  return parseProjectDocument({
    schemaVersion: 1,
    name,
    aoi: rectangleAoi([23.1, 37.4, 23.14, 37.44]),
    exclusions: [],
    inclusions: [],
    dateRange: { from: "2025-06-01", to: "2025-09-15" },
    params: {
      threshold: 0.42,
      tolerance: 0,
      bufferMetres: 30,
      coastMetres: 30,
      minRingAreaM2: 5000,
    },
  });
}

describe("project routes", () => {
  let store: ProjectStore;
  let app: ReturnType<typeof createProjectRoutes>;

  beforeEach(() => {
    store = createProjectStore(":memory:");
    app = createProjectRoutes(
      () => store,
      () => "2026-08-03T12:00:00.000Z",
    );
  });

  function put(id: string, body: unknown) {
    return app.request(`/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("round-trips a project through save and load", async () => {
    expect((await put("kiladha", document())).status).toBe(200);

    const res = await app.request("/projects/kiladha");
    expect(res.status).toBe(200);
    const loaded = await json<{ name: string; aoi: { coordinates: number[][][] } }>(res);
    expect(loaded.name).toBe("Kiladha");
    // The AOI's shape survives, not just its presence — the point of D10.
    expect(loaded.aoi.coordinates[0]).toHaveLength(5);
  });

  it("lists summaries without the documents, which can be large", async () => {
    await put("kiladha", document());
    const { projects } = await json<{ projects: unknown[] }>(await app.request("/projects"));
    expect(projects).toEqual([
      { id: "kiladha", name: "Kiladha", updatedAt: "2026-08-03T12:00:00.000Z" },
    ]);
  });

  it("replaces rather than duplicating on a second save", async () => {
    await put("kiladha", document());
    await put("kiladha", document("Kiladha Bay"));

    const { projects } = await json<{ projects: unknown[] }>(await app.request("/projects"));
    expect(projects).toHaveLength(1);
    expect((projects[0] as { name: string }).name).toBe("Kiladha Bay");
  });

  it("404s for a project that was never saved", async () => {
    expect((await app.request("/projects/nowhere")).status).toBe(404);
  });

  it("400s on a malformed document rather than storing it", async () => {
    const res = await put("kiladha", { ...document(), schemaVersion: 99 });
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/schema version/);

    const { projects } = await json<{ projects: unknown[] }>(await app.request("/projects"));
    expect(projects).toEqual([]);
  });

  it("400s on an id that is not a slug, and says what to use", async () => {
    const res = await put("Kiladha Bay", document());
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toContain(projectSlug("Kiladha Bay"));
  });

  it("deletes, then 404s on the second attempt", async () => {
    await put("kiladha", document());
    expect((await app.request("/projects/kiladha", { method: "DELETE" })).status).toBe(204);
    expect((await app.request("/projects/kiladha", { method: "DELETE" })).status).toBe(404);
  });
});
