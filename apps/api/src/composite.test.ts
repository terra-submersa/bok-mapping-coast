import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compositeCacheKey, createCompositeCache } from "./cache.js";
import type { CompositeRequest } from "./cdse/process.js";
import { createCompositeService } from "./composite.js";

const KILADHA: CompositeRequest = {
  bbox: [23.105, 37.418, 23.14, 37.435],
  from: "2025-06-01T00:00:00.000Z",
  to: "2025-09-15T00:00:00.000Z",
};

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), "bok-cache-"));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

describe("compositeCacheKey", () => {
  it("is stable for the same request", () => {
    expect(compositeCacheKey(KILADHA)).toBe(compositeCacheKey({ ...KILADHA }));
  });

  it("changes with the bbox and with the date range", () => {
    const key = compositeCacheKey(KILADHA);
    expect(compositeCacheKey({ ...KILADHA, bbox: [23.1, 37.4, 23.2, 37.5] })).not.toBe(key);
    expect(compositeCacheKey({ ...KILADHA, to: "2025-09-16T00:00:00.000Z" })).not.toBe(key);
  });

  /**
   * Pinned literally, not derived. Adding the tile size to the key (issue #41) must not
   * orphan the composites already on disk — this is the assertion that would have caught
   * it, and re-deriving the expectation from the implementation would prove nothing.
   *
   * It changes legitimately when SDB_EVALSCRIPT_VERSION does. That is the point of the
   * evalscript version, and re-pinning it then is correct.
   */
  it("is unchanged for a request without an explicit size", () => {
    expect(compositeCacheKey(KILADHA)).toBe("73c06b383072b6d7bb57c9d097c5be8c");
  });

  it("distinguishes a sized request from an unsized one, and sizes from each other", () => {
    const plain = compositeCacheKey(KILADHA);
    const sized = compositeCacheKey({ ...KILADHA, width: 640, height: 480 });
    expect(sized).not.toBe(plain);
    expect(compositeCacheKey({ ...KILADHA, width: 641, height: 480 })).not.toBe(sized);
  });

  it("ignores a half-specified size, as outputSize does", () => {
    expect(compositeCacheKey({ ...KILADHA, width: 640 })).toBe(compositeCacheKey(KILADHA));
  });
});

describe("createCompositeCache", () => {
  it("returns null for a miss and round-trips bytes on a hit", async () => {
    const cache = createCompositeCache(cacheDir);
    expect(await cache.get(KILADHA)).toBeNull();

    const bytes = new Uint8Array([1, 2, 3, 4]);
    await cache.set(KILADHA, bytes);
    expect(await cache.get(KILADHA)).toEqual(bytes);
  });
});

describe("createCompositeService", () => {
  it("calls the metered API once, then serves from cache", async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    const fetchComposite = vi.fn().mockResolvedValue(bytes);
    const service = createCompositeService(createCompositeCache(cacheDir), { fetchComposite });

    const first = await service.get(KILADHA);
    expect(first.cached).toBe(false);
    expect(first.bytes).toEqual(bytes);

    const second = await service.get(KILADHA);
    expect(second.cached).toBe(true);
    expect(second.bytes).toEqual(bytes);
    expect(fetchComposite).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent requests for the same composite onto one upstream call", async () => {
    const bytes = new Uint8Array([4, 2]);
    const fetchComposite = vi.fn().mockResolvedValue(bytes);
    const service = createCompositeService(createCompositeCache(cacheDir), { fetchComposite });

    const results = await Promise.all([service.get(KILADHA), service.get(KILADHA)]);

    expect(results.map((r) => r.bytes)).toEqual([bytes, bytes]);
    expect(fetchComposite).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failed request", async () => {
    const fetchComposite = vi
      .fn()
      .mockRejectedValueOnce(new Error("CDSE exploded"))
      .mockResolvedValueOnce(new Uint8Array([1]));
    const service = createCompositeService(createCompositeCache(cacheDir), { fetchComposite });

    await expect(service.get(KILADHA)).rejects.toThrow("CDSE exploded");
    expect((await service.get(KILADHA)).bytes).toEqual(new Uint8Array([1]));
  });
});
