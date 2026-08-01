import { Hono } from "hono";
import type { CompositeService } from "../composite.js";
import { parseCompositeParams } from "./composite-params.js";

export function createCompositeRoutes(service: CompositeService) {
  const app = new Hono();

  /**
   * GET /api/composite?bbox=minLon,minLat,maxLon,maxLat&from=...&to=...
   *
   * Returns a two-band FLOAT32 GeoTIFF: band 1 median Stumpf ratio, band 2 scene count.
   * GET rather than POST so the browser and geotiff.js can treat it as a plain,
   * cacheable resource.
   */
  app.get("/composite", async (c) => {
    const parsed = parseCompositeParams({
      bbox: c.req.query("bbox"),
      from: c.req.query("from"),
      to: c.req.query("to"),
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
