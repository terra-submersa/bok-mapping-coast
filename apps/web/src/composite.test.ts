import { type BBox, planCompositeTiles } from "@bok/core";
import { writeArrayBuffer } from "geotiff";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type CompositeProgress, compositeUrl, fetchTiledComposite } from "./composite.js";

const KILADHA: BBox = [23.105, 37.418, 23.14, 37.435];

/**
 * A long thin strip: 3003x50 px, which is over the 2500 cap on one axis and so plans to
 * two tiles of 1502 and 1501 — an uneven split, on purpose — while staying small enough
 * to encode as a real GeoTIFF in a unit test.
 */
const TWO_TILES: BBox = [23.0, 37.4, 23.34, 37.4045];

const QUERY = { from: "2025-06-01", to: "2025-09-15" };

/**
 * A genuine two-band FLOAT32 GeoTIFF, so the decode path under test is the real one.
 * `ratio` carries `base + pixel index`, which makes misplacement in the mosaic visible.
 */
function tiffBytes(width: number, height: number, base: number): ArrayBuffer {
  const interleaved = new Float32Array(width * height * 2);
  for (let i = 0; i < width * height; i++) {
    interleaved[i * 2] = base + i;
    interleaved[i * 2 + 1] = 1;
  }
  return writeArrayBuffer(interleaved, {
    width,
    height,
    SamplesPerPixel: 2,
    BitsPerSample: [32, 32],
    SampleFormat: [3, 3],
    PhotometricInterpretation: 1,
  }) as ArrayBuffer;
}

function tiffResponse(width: number, height: number, base: number, cached = false): Response {
  return new Response(tiffBytes(width, height, base), {
    status: 200,
    headers: {
      "Content-Type": "image/tiff",
      "X-Composite-Cache": cached ? "hit" : "miss",
    },
  });
}

const errorResponse = (status: number, error: string) =>
  new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function stubFetch(handler: (url: string, call: number) => Response | Promise<Response>) {
  let call = 0;
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => handler(String(input), call++));
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

const urlsOf = (fetchFn: ReturnType<typeof stubFetch>) =>
  fetchFn.mock.calls.map(([input]) => String(input));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("compositeUrl", () => {
  it("omits the size when none is given", () => {
    const url = compositeUrl({ bbox: KILADHA, ...QUERY });
    expect(url).toBe(
      "/api/composite?bbox=23.105%2C37.418%2C23.14%2C37.435&from=2025-06-01&to=2025-09-15",
    );
    expect(url).not.toContain("width");
  });

  it("carries an explicit size when given", () => {
    const url = compositeUrl({ bbox: KILADHA, ...QUERY }, { width: 1502, height: 50 });
    expect(url).toContain("width=1502");
    expect(url).toContain("height=50");
  });
});

describe("fetchTiledComposite — one tile", () => {
  it("sends a single request with no size, so the existing cache still hits", async () => {
    const plan = planCompositeTiles(KILADHA);
    const fetchFn = stubFetch(() => tiffResponse(plan.width, plan.height, 0));

    await fetchTiledComposite({ bbox: KILADHA, ...QUERY });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = urlsOf(fetchFn);
    expect(url).not.toContain("width=");
    expect(url).not.toContain("height=");
    expect(url).toContain("bbox=23.105%2C37.418%2C23.14%2C37.435");
  });

  it("decodes the bands and keeps the AOI bbox", async () => {
    const plan = planCompositeTiles(KILADHA);
    stubFetch(() => tiffResponse(plan.width, plan.height, 0));

    const composite = await fetchTiledComposite({ bbox: KILADHA, ...QUERY });

    expect(composite.width).toBe(plan.width);
    expect(composite.height).toBe(plan.height);
    expect(composite.bbox).toEqual(KILADHA);
    expect(composite.ratio[0]).toBe(0);
    expect(composite.ratio[10]).toBe(10);
    expect(composite.sceneCount[0]).toBe(1);
  });

  it("still reports progress, 0 of 1 then 1 of 1", async () => {
    const plan = planCompositeTiles(KILADHA);
    stubFetch(() => tiffResponse(plan.width, plan.height, 0, true));

    const seen: CompositeProgress[] = [];
    await fetchTiledComposite({ bbox: KILADHA, ...QUERY }, { onProgress: (p) => seen.push(p) });

    expect(seen).toEqual([
      { completed: 0, total: 1, cached: 0 },
      { completed: 1, total: 1, cached: 1 },
    ]);
  });
});

describe("fetchTiledComposite — several tiles", () => {
  const planned = () => planCompositeTiles(TWO_TILES);

  it("requests each tile at the exact size the plan dictates", async () => {
    const plan = planned();
    expect(plan.tiles).toHaveLength(2);

    const fetchFn = stubFetch((_, call) =>
      tiffResponse(plan.tiles[call].width, plan.tiles[call].height, 0),
    );

    await fetchTiledComposite({ bbox: TWO_TILES, ...QUERY });

    const urls = urlsOf(fetchFn);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(`width=${plan.tiles[0].width}`);
    expect(urls[1]).toContain(`width=${plan.tiles[1].width}`);
    // The uneven split is the interesting part — the two must differ.
    expect(plan.tiles[0].width).not.toBe(plan.tiles[1].width);
  });

  it("stitches the tiles into one raster covering the whole envelope", async () => {
    const plan = planned();
    // Each tile's pixels carry `base + local index`, with distinct bases, so the merged
    // raster shows exactly where each tile landed.
    const bases = [0, 1_000_000];
    stubFetch((_, call) =>
      tiffResponse(plan.tiles[call].width, plan.tiles[call].height, bases[call]),
    );

    const composite = await fetchTiledComposite({ bbox: TWO_TILES, ...QUERY });

    expect(composite.width).toBe(plan.width);
    expect(composite.height).toBe(plan.height);
    expect(composite.bbox).toEqual(TWO_TILES);

    const at = (x: number, y: number) => composite.ratio[y * plan.width + x];
    const seam = plan.tiles[1].x;
    // Left of the seam belongs to tile 0, right of it to tile 1 — and both are at the
    // start of their own row, so their local indices are the row offset.
    expect(at(0, 0)).toBe(0);
    expect(at(seam - 1, 0)).toBe(plan.tiles[0].width - 1);
    expect(at(seam, 0)).toBe(1_000_000);
    expect(at(seam, 1)).toBe(1_000_000 + plan.tiles[1].width);
  });

  it("counts cache hits apart from metered fetches", async () => {
    const plan = planned();
    stubFetch((_, call) =>
      tiffResponse(plan.tiles[call].width, plan.tiles[call].height, 0, call === 0),
    );

    const seen: CompositeProgress[] = [];
    await fetchTiledComposite(
      { bbox: TWO_TILES, ...QUERY },
      { onProgress: (p) => seen.push(p), concurrency: 1 },
    );

    expect(seen.at(-1)).toEqual({ completed: 2, total: 2, cached: 1 });
  });
});

describe("fetchTiledComposite — failure", () => {
  it("names the failing tile by row and column", async () => {
    const plan = planCompositeTiles(TWO_TILES);
    stubFetch((_, call) =>
      call === 0
        ? tiffResponse(plan.tiles[0].width, plan.tiles[0].height, 0)
        : errorResponse(400, "AOI is nonsense"),
    );

    await expect(
      fetchTiledComposite({ bbox: TWO_TILES, ...QUERY }, { concurrency: 1 }),
    ).rejects.toThrow(/Tile 2 of 2 \(row 0, col 1\) failed: AOI is nonsense/);
  });

  it("does not dress a single-tile failure up as a tile", async () => {
    stubFetch(() => errorResponse(400, "AOI is nonsense"));

    await expect(fetchTiledComposite({ bbox: KILADHA, ...QUERY })).rejects.toThrow(
      /^The composite failed: AOI is nonsense/,
    );
  });

  /** A 400 will fail the same way forever; paying for it three times is pure waste. */
  it("does not retry a 400", async () => {
    const fetchFn = stubFetch(() => errorResponse(400, "bad bbox"));
    await expect(fetchTiledComposite({ bbox: KILADHA, ...QUERY })).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries a 502 and succeeds if the blip passes", async () => {
    const plan = planCompositeTiles(KILADHA);
    const fetchFn = stubFetch((_, call) =>
      call === 0 ? errorResponse(502, "CDSE hiccup") : tiffResponse(plan.width, plan.height, 0),
    );

    const composite = await fetchTiledComposite({ bbox: KILADHA, ...QUERY });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(composite.width).toBe(plan.width);
  }, 10_000);
});
