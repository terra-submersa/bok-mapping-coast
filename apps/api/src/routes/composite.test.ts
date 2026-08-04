import { describe, expect, it, vi } from "vitest";
import { createCompositeRoutes } from "./composite.js";
import { parseCompositeParams } from "./composite-params.js";

const VALID = {
  bbox: "23.105,37.418,23.14,37.435",
  from: "2025-06-01",
  to: "2025-09-15",
};

describe("parseCompositeParams", () => {
  it("accepts a valid AOI and date range", () => {
    const result = parseCompositeParams(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.bbox).toEqual([23.105, 37.418, 23.14, 37.435]);
    expect(result.request.from).toBe("2025-06-01T00:00:00.000Z");
  });

  it("rejects a missing or malformed bbox", () => {
    expect(parseCompositeParams({ ...VALID, bbox: undefined }).ok).toBe(false);
    expect(parseCompositeParams({ ...VALID, bbox: "1,2,3" }).ok).toBe(false);
  });

  it("rejects an AOI beyond the Processing API single-request limit", () => {
    const result = parseCompositeParams({ ...VALID, bbox: "23.0,37.4,23.35,37.42" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/2500x2500/);
  });

  it("leaves a size-less request with no size keys at all", () => {
    const result = parseCompositeParams(VALID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Not merely undefined — absent, so the cache key stays byte-identical (issue #41).
    expect(result.request).not.toHaveProperty("width");
    expect(result.request).not.toHaveProperty("height");
  });

  it("accepts an explicit tile size", () => {
    const result = parseCompositeParams({ ...VALID, width: "1250", height: "900" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.request.width).toBe(1250);
    expect(result.request.height).toBe(900);
  });

  /** The point of the whole change: an oversized box IS allowed, as a sized tile. */
  it("accepts an oversized bbox when the size is explicit", () => {
    const result = parseCompositeParams({
      ...VALID,
      bbox: "23.0,37.4,23.35,37.42",
      width: "2500",
      height: "220",
    });
    expect(result.ok).toBe(true);
  });

  it("still rejects an oversized bbox without a size, and says what to do", () => {
    const result = parseCompositeParams({ ...VALID, bbox: "23.0,37.4,23.35,37.42" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/explicit width and height/i);
  });

  it("rejects a size over the cap, below one pixel, or not a whole number", () => {
    expect(parseCompositeParams({ ...VALID, width: "2501", height: "10" }).ok).toBe(false);
    expect(parseCompositeParams({ ...VALID, width: "10", height: "0" }).ok).toBe(false);
    expect(parseCompositeParams({ ...VALID, width: "10.5", height: "10" }).ok).toBe(false);
    expect(parseCompositeParams({ ...VALID, width: "wide", height: "10" }).ok).toBe(false);
  });

  it("refuses half a size rather than guessing the other side", () => {
    const result = parseCompositeParams({ ...VALID, width: "1250" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/together/);
  });

  it("rejects missing, malformed, or inverted dates", () => {
    expect(parseCompositeParams({ ...VALID, from: undefined }).ok).toBe(false);
    expect(parseCompositeParams({ ...VALID, to: "not-a-date" }).ok).toBe(false);
    expect(parseCompositeParams({ ...VALID, from: "2025-09-15", to: "2025-06-01" }).ok).toBe(false);
  });
});

describe("GET /composite", () => {
  const query = `bbox=${VALID.bbox}&from=${VALID.from}&to=${VALID.to}`;

  it("serves the tiff and reports whether it came from cache", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const app = createCompositeRoutes({
      get: vi.fn().mockResolvedValue({ bytes, cached: false }),
    });

    const res = await app.request(`/composite?${query}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/tiff");
    expect(res.headers.get("X-Composite-Cache")).toBe("miss");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("marks a cache hit", async () => {
    const app = createCompositeRoutes({
      get: vi.fn().mockResolvedValue({ bytes: new Uint8Array([1]), cached: true }),
    });
    const res = await app.request(`/composite?${query}`);
    expect(res.headers.get("X-Composite-Cache")).toBe("hit");
  });

  it("returns 400 with a usable message on bad input, without calling upstream", async () => {
    const get = vi.fn();
    const app = createCompositeRoutes({ get });

    const res = await app.request("/composite?bbox=nope&from=2025-06-01&to=2025-09-15");

    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/four numbers/);
    expect(get).not.toHaveBeenCalled();
  });

  it("returns 502 when the Processing API fails", async () => {
    const app = createCompositeRoutes({
      get: vi.fn().mockRejectedValue(new Error("CDSE quota exceeded")),
    });

    const res = await app.request(`/composite?${query}`);

    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toMatch(/quota exceeded/);
  });
});
