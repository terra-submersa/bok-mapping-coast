import type { BBox } from "@bok/core";
import { describe, expect, it, vi } from "vitest";
import {
  buildProcessBody,
  type CompositeRequest,
  createProcessClient,
  nativeOutputSize,
  outputSize,
} from "./process.js";

const KILADHA: BBox = [23.105, 37.418, 23.14, 37.435];
/** ~1000 km across — far past the 2500 px cap on both axes. */
const HUGE: BBox = [20, 35, 31, 43];

const request = (extra: Partial<CompositeRequest> = {}): CompositeRequest => ({
  bbox: KILADHA,
  from: "2025-06-01T00:00:00.000Z",
  to: "2025-09-15T00:00:00.000Z",
  ...extra,
});

const tokens = { getAccessToken: async () => "token-123" };

describe("nativeOutputSize", () => {
  it("sizes to Sentinel-2's native 10 m", () => {
    const size = nativeOutputSize(KILADHA);
    // ~3.1 km by ~1.9 km, so a few hundred pixels each way and distinctly non-square.
    expect(size.width).toBeGreaterThan(200);
    expect(size.height).toBeGreaterThan(100);
    expect(size.width).not.toBe(size.height);
  });

  it("clamps to the Processing API cap rather than asking for the impossible", () => {
    const size = nativeOutputSize(HUGE);
    expect(size.width).toBe(2500);
    expect(size.height).toBe(2500);
  });

  it("never asks for zero pixels", () => {
    const size = nativeOutputSize([23.1, 37.42, 23.100001, 37.420001]);
    expect(size.width).toBeGreaterThanOrEqual(1);
    expect(size.height).toBeGreaterThanOrEqual(1);
  });
});

describe("outputSize", () => {
  it("derives from the bbox when the caller said nothing", () => {
    expect(outputSize(request())).toEqual(nativeOutputSize(KILADHA));
  });

  /** The property tiling depends on: the caller's grid wins over a re-derivation. */
  it("uses the explicit size when given, whatever the bbox implies", () => {
    expect(outputSize(request({ width: 640, height: 480 }))).toEqual({
      width: 640,
      height: 480,
    });
  });

  it("takes an explicit size on a bbox that would otherwise be clamped", () => {
    expect(outputSize(request({ bbox: HUGE, width: 1200, height: 900 }))).toEqual({
      width: 1200,
      height: 900,
    });
  });

  it("still clamps an explicit size to the cap", () => {
    expect(outputSize(request({ width: 9000, height: 0 }))).toEqual({
      width: 2500,
      height: 1,
    });
  });

  it("ignores a half-specified size rather than guessing the other side", () => {
    expect(outputSize(request({ width: 640 }))).toEqual(nativeOutputSize(KILADHA));
  });
});

describe("buildProcessBody", () => {
  it("sends the size it was handed", () => {
    const body = buildProcessBody(request(), { width: 640, height: 480 });
    expect(body.output.width).toBe(640);
    expect(body.output.height).toBe(480);
  });

  /**
   * The #27/#34 guard. Masked pixels come back as no-data, `landMask` reads no-data as
   * land, and every AOI grows a spurious coastal ribbon along its own edge. Tiling makes
   * this more tempting, not less — a tile is still a rectangle.
   */
  it("bounds by bbox and never by geometry", () => {
    const body = buildProcessBody(request(), { width: 10, height: 10 });
    expect(body.input.bounds.bbox).toEqual(KILADHA);
    expect(body.input.bounds).not.toHaveProperty("geometry");
  });

  it("carries the date range through to the data filter", () => {
    const body = buildProcessBody(request(), { width: 10, height: 10 });
    expect(body.input.data[0].dataFilter.timeRange).toEqual({
      from: "2025-06-01T00:00:00.000Z",
      to: "2025-09-15T00:00:00.000Z",
    });
  });

  it("asks for a tiff", () => {
    const body = buildProcessBody(request(), { width: 10, height: 10 });
    expect(body.output.responses[0].format.type).toBe("image/tiff");
  });
});

describe("createProcessClient", () => {
  it("posts the explicit size when the request carries one", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const client = createProcessClient(tokens, { fetchFn: fetchFn as unknown as typeof fetch });

    await client.fetchComposite(request({ width: 1234, height: 567 }));

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.output.width).toBe(1234);
    expect(body.output.height).toBe(567);
  });

  it("authorises with the token source", async () => {
    const fetchFn = vi.fn(async () => new Response(new Uint8Array([1]), { status: 200 }));
    const client = createProcessClient(tokens, { fetchFn: fetchFn as unknown as typeof fetch });

    await client.fetchComposite(request());

    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer token-123");
  });

  it("surfaces the upstream body, which carries the actual reason", async () => {
    const fetchFn = vi.fn(
      async () => new Response("evalscript blew up", { status: 400, statusText: "Bad Request" }),
    );
    const client = createProcessClient(tokens, { fetchFn: fetchFn as unknown as typeof fetch });

    await expect(client.fetchComposite(request())).rejects.toThrow(/evalscript blew up/);
  });
});
