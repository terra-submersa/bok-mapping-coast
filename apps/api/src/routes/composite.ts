import { Hono } from "hono";
import type { CompositeService } from "../composite.js";
import { parseCompositeParams } from "./composite-params.js";

export function createCompositeRoutes(service: CompositeService) {
  const app = new Hono();

  /**
   * GET /api/composite?bbox=minLon,minLat,maxLon,maxLat&from=...&to=...[&width=&height=]
   *
   * Returns a two-band FLOAT32 GeoTIFF: band 1 median Stumpf ratio, band 2 scene count.
   * GET rather than POST so the browser and geotiff.js can treat it as a plain,
   * cacheable resource.
   *
   * `width`/`height` are for tiled clients (issue #41), which cut the pixel grid
   * themselves and need each tile at an exact size. Omit them and the size is derived
   * from the bbox at Sentinel-2's native 10 m, exactly as before.
   */
  app.get("/composite", async (c) => {
    const parsed = parseCompositeParams({
      bbox: c.req.query("bbox"),
      from: c.req.query("from"),
      to: c.req.query("to"),
      width: c.req.query("width"),
      height: c.req.query("height"),
    });
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);

    try {
      const { bytes, cached } = await service.get(parsed.request);
      return c.body(bytes as unknown as ArrayBuffer, 200, {
        "Content-Type": "image/tiff",
        "Cache-Control": "public, max-age=86400",
        "X-Composite-Cache": cached ? "hit" : "miss",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown upstream failure.";
      return c.json({ error: `Could not build composite. ${message}` }, 502);
    }
  });

  return app;
}
