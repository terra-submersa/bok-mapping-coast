import type { CompositeCache } from "./cache.js";
import type { CompositeRequest, ProcessClient } from "./cdse/process.js";

export interface CompositeResult {
  bytes: Uint8Array;
  /** True when served from disk without touching the metered Processing API. */
  cached: boolean;
}

export interface CompositeService {
  get(request: CompositeRequest): Promise<CompositeResult>;
}

/**
 * Cache-first access to SDB composites. Concurrent requests for the same composite
 * are collapsed onto one upstream call — two browser tabs asking at once must not
 * bill us twice.
 */
export function createCompositeService(
  cache: CompositeCache,
  client: ProcessClient,
): CompositeService {
  const inFlight = new Map<string, Promise<Uint8Array>>();

  return {
    async get(request) {
      const hit = await cache.get(request);
      if (hit) return { bytes: hit, cached: true };

      const key = cache.pathFor(request);
      let pending = inFlight.get(key);
      if (pending) return { bytes: await pending, cached: false };

      pending = client
        .fetchComposite(request)
        .then(async (bytes) => {
          await cache.set(request, bytes);
          return bytes;
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, pending);

      return { bytes: await pending, cached: false };
    },
  };
}
