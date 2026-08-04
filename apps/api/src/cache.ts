import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { SDB_EVALSCRIPT_VERSION } from "./cdse/evalscript.js";
import type { CompositeRequest } from "./cdse/process.js";

/**
 * The Processing API is metered and a summer-long median is expensive, so this
 * cache is load-bearing rather than an optimisation (CLAUDE.md working agreement 4).
 *
 * The evalscript version is part of the key: changing the science must not silently
 * serve composites built by the old script.
 */
export function compositeCacheKey(request: CompositeRequest): string {
  const canonical = JSON.stringify({
    bbox: request.bbox,
    from: request.from,
    to: request.to,
    evalscript: SDB_EVALSCRIPT_VERSION,
    // Only when the caller dictated a size (issue #41). Folding `width: undefined` in
    // unconditionally would be a no-op for JSON.stringify today, but writing it this way
    // makes the intent explicit: a request without an explicit size must hash exactly as
    // it did before tiling existed, or every composite already on disk is orphaned.
    ...(request.width !== undefined && request.height !== undefined
      ? { width: request.width, height: request.height }
      : {}),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}

export interface CompositeCache {
  get(request: CompositeRequest): Promise<Uint8Array | null>;
  set(request: CompositeRequest, bytes: Uint8Array): Promise<void>;
  pathFor(request: CompositeRequest): string;
}

export function createCompositeCache(cacheDir: string): CompositeCache {
  const pathFor = (request: CompositeRequest) =>
    join(cacheDir, `${compositeCacheKey(request)}.tif`);

  return {
    pathFor,

    async get(request) {
      try {
        return new Uint8Array(await readFile(pathFor(request)));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },

    async set(request, bytes) {
      const path = pathFor(request);
      await mkdir(dirname(path), { recursive: true });
      // Write then rename, so an interrupted write cannot leave a truncated tiff
      // that later looks like a valid cache hit.
      const temp = `${path}.${process.pid}.tmp`;
      await writeFile(temp, bytes);
      await rename(temp, path);
    },
  };
}
