import { type BBox, planCompositeTiles, rectangleAoi } from "@bok/core";
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

/**
 * 4x300 px — narrow enough to hand-build byte by byte, tall enough that at one row per
 * strip the strip table outgrows the slice geotiff reads eagerly. See issue #45 and
 * `bigEndianTiffBytes`.
 */
const TALL: BBox = [23.105, 37.418, 23.1055, 37.445];

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

/**
 * A hand-rolled **big-endian** two-band FLOAT32 GeoTIFF, one row per strip, for issue #45.
 *
 * `writeArrayBuffer` cannot produce this fixture: it writes little-endian, and the bug
 * only exists on the other byte order. Sentinel Hub returns big-endian ("MM"), and
 * geotiff 3.0.5's `DeferredArray` reads lazily-loaded IFD arrays as little-endian
 * unconditionally — so `StripOffsets` comes back byte-swapped and every strip is read
 * from a nonsense offset. `patches/geotiff@3.0.5.patch` fixes it.
 *
 * An array is only deferred when it falls outside the 1024-byte slice already fetched at
 * the IFD, which is why the failure appears abruptly at a height of roughly 1600 px on
 * the real 8-rows-per-strip composites. Here one row per strip reaches the same state at
 * a size a unit test can hold: `height` above ~250 pushes the array past the slice.
 *
 * Uncompressed on purpose. The real composites are deflate, where a wrong offset feeds
 * pako non-deflate bytes and it throws the string "buffer error"; uncompressed, the same
 * wrong offset yields the wrong *pixels*, which is the failure this asserts on directly.
 */
function bigEndianTiffBytes(width: number, height: number, base: number): ArrayBuffer {
  const entries: Array<[tag: number, type: number, count: number, value: number | number[]]> = [];
  const stripBytes = width * 2 * 4;
  const headerBytes = 8;
  const ifdBytes = 2 + 10 * 12 + 4;
  const offsetsAt = headerBytes + ifdBytes;
  const countsAt = offsetsAt + height * 4;
  const pixelsAt = countsAt + height * 4;

  const buffer = new ArrayBuffer(pixelsAt + height * stripBytes);
  const view = new DataView(buffer);

  view.setUint8(0, 0x4d); // "MM" — big-endian, the byte order the bug needs
  view.setUint8(1, 0x4d);
  view.setUint16(2, 42, false);
  view.setUint32(4, headerBytes, false);

  const SHORT = 3;
  const LONG = 4;
  entries.push([256, LONG, 1, width]); // ImageWidth
  entries.push([257, LONG, 1, height]); // ImageLength
  entries.push([258, SHORT, 2, [32, 32]]); // BitsPerSample
  entries.push([259, SHORT, 1, 1]); // Compression: none
  entries.push([262, SHORT, 1, 1]); // PhotometricInterpretation: black is zero
  entries.push([273, LONG, height, offsetsAt]); // StripOffsets — the deferred array
  entries.push([277, SHORT, 1, 2]); // SamplesPerPixel
  entries.push([278, LONG, 1, 1]); // RowsPerStrip
  entries.push([279, LONG, height, countsAt]); // StripByteCounts
  entries.push([339, SHORT, 2, [3, 3]]); // SampleFormat: IEEE float

  view.setUint16(headerBytes, entries.length, false);
  entries.forEach(([tag, type, count, value], i) => {
    const at = headerBytes + 2 + i * 12;
    view.setUint16(at, tag, false);
    view.setUint16(at + 2, type, false);
    view.setUint32(at + 4, count, false);
    // Values of four bytes or fewer live in the value field itself, left-justified, so a
    // pair of SHORTs is two uint16s and a lone SHORT leaves the low half unused.
    if (type === SHORT) {
      const shorts = Array.isArray(value) ? value : [value];
      shorts.forEach((v, k) => {
        view.setUint16(at + 8 + k * 2, v, false);
      });
    } else {
      view.setUint32(at + 8, value as number, false);
    }
  });
  view.setUint32(headerBytes + 2 + entries.length * 12, 0, false); // no next IFD

  for (let row = 0; row < height; row++) {
    view.setUint32(offsetsAt + row * 4, pixelsAt + row * stripBytes, false);
    view.setUint32(countsAt + row * 4, stripBytes, false);
  }
  for (let i = 0; i < width * height; i++) {
    view.setFloat32(pixelsAt + i * 8, base + i, false);
    view.setFloat32(pixelsAt + i * 8 + 4, 1, false);
  }
  return buffer;
}

/** A TIFF that claims deflate but carries junk, so the decoder fails the way #45 did. */
function undecodableTiffBytes(width: number, height: number): ArrayBuffer {
  const buffer = bigEndianTiffBytes(width, height, 0);
  const view = new DataView(buffer);
  view.setUint16(8 + 2 + 3 * 12 + 8, 8, false); // Compression: Adobe deflate
  return buffer;
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

    await fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url] = urlsOf(fetchFn);
    expect(url).not.toContain("width=");
    expect(url).not.toContain("height=");
    expect(url).toContain("bbox=23.105%2C37.418%2C23.14%2C37.435");
  });

  it("decodes the bands and keeps the AOI bbox", async () => {
    const plan = planCompositeTiles(KILADHA);
    stubFetch(() => tiffResponse(plan.width, plan.height, 0));

    const composite = await fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY });

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
    await fetchTiledComposite(
      { aoi: rectangleAoi(KILADHA), ...QUERY },
      { onProgress: (p) => seen.push(p) },
    );

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

    await fetchTiledComposite({ aoi: rectangleAoi(TWO_TILES), ...QUERY });

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

    const composite = await fetchTiledComposite({ aoi: rectangleAoi(TWO_TILES), ...QUERY });

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
      { aoi: rectangleAoi(TWO_TILES), ...QUERY },
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
      fetchTiledComposite({ aoi: rectangleAoi(TWO_TILES), ...QUERY }, { concurrency: 1 }),
    ).rejects.toThrow(/Tile 2 of 2 \(row 0, col 1\) failed: AOI is nonsense/);
  });

  it("does not dress a single-tile failure up as a tile", async () => {
    stubFetch(() => errorResponse(400, "AOI is nonsense"));

    await expect(fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY })).rejects.toThrow(
      /^The composite failed: AOI is nonsense/,
    );
  });

  /** A 400 will fail the same way forever; paying for it three times is pure waste. */
  it("does not retry a 400", async () => {
    const fetchFn = stubFetch(() => errorResponse(400, "bad bbox"));
    await expect(fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY })).rejects.toThrow();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  /**
   * Issue #45. Big-endian with enough strips to push `StripOffsets` out of the slice
   * geotiff reads eagerly — the exact shape every Sentinel Hub composite over ~1600 px
   * tall has. Unpatched, geotiff byte-swaps every strip offset and the pixels are junk.
   */
  it("decodes a big-endian composite whose strip table is loaded lazily", async () => {
    const { width, height } = planCompositeTiles(TALL);
    expect(height).toBeGreaterThan(250);
    stubFetch(
      () =>
        new Response(bigEndianTiffBytes(width, height, 0), {
          status: 200,
          headers: { "Content-Type": "image/tiff" },
        }),
    );

    const composite = await fetchTiledComposite({ aoi: rectangleAoi(TALL), ...QUERY });

    expect(composite.width).toBe(width);
    expect(composite.height).toBe(height);
    // The last rows are the ones whose offsets sit furthest into the deferred array.
    expect(composite.ratio[0]).toBe(0);
    expect(composite.ratio[width * (height - 1)]).toBe(width * (height - 1));
    expect(composite.ratio.at(-1)).toBe(width * height - 1);
    expect(composite.sceneCount.at(-1)).toBe(1);
  });

  /** pako throws a bare string, which loses name, message and stack. Wrap it. */
  it("reports an undecodable GeoTIFF as an Error naming the tile", async () => {
    stubFetch(
      () =>
        new Response(undecodableTiffBytes(4, 300), {
          status: 200,
          headers: { "Content-Type": "image/tiff" },
        }),
    );

    const failure = await fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY }).catch(
      (e) => e,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toMatch(/^The composite failed: the GeoTIFF could not be decoded \(/);
  });

  /** Same bytes, same failure — and on a cache miss each attempt is a metered request. */
  it("does not retry a GeoTIFF that will not decode", async () => {
    const fetchFn = stubFetch(
      () =>
        new Response(undecodableTiffBytes(4, 300), {
          status: 200,
          headers: { "Content-Type": "image/tiff" },
        }),
    );

    await expect(fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY })).rejects.toThrow();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("retries a 502 and succeeds if the blip passes", async () => {
    const plan = planCompositeTiles(KILADHA);
    const fetchFn = stubFetch((_, call) =>
      call === 0 ? errorResponse(502, "CDSE hiccup") : tiffResponse(plan.width, plan.height, 0),
    );

    const composite = await fetchTiledComposite({ aoi: rectangleAoi(KILADHA), ...QUERY });

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(composite.width).toBe(plan.width);
  }, 10_000);
});
