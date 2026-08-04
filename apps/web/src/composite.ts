import {
  type BBox,
  type CompositeTile,
  type CompositeTilePlan,
  mergeCompositeTiles,
  planCompositeTiles,
  type TileRaster,
} from "@bok/core";
import { fromArrayBuffer } from "geotiff";
import { mapPool, PoolTaskError } from "./pool.js";

export interface Composite {
  width: number;
  height: number;
  /** Band 1: median Stumpf ratio. Meaningless where sceneCount is 0. */
  ratio: Float32Array;
  /** Band 2: how many scenes contributed. 0 means land, cloud, or no data. */
  sceneCount: Float32Array;
  bbox: BBox;
}

export interface CompositeQuery {
  bbox: BBox;
  from: string;
  to: string;
}

export interface OutputSize {
  width: number;
  height: number;
}

/** Tiles done so far. `cached` is the subset that cost nothing, read off the response header. */
export interface CompositeProgress {
  completed: number;
  total: number;
  cached: number;
}

/** Carries the HTTP status so the retry policy can tell a blip from a bad request. */
export class CompositeRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "CompositeRequestError";
    this.status = status;
  }
}

export function compositeUrl({ bbox, from, to }: CompositeQuery, size?: OutputSize): string {
  const params = new URLSearchParams({ bbox: bbox.join(","), from, to });
  if (size) {
    params.set("width", String(size.width));
    params.set("height", String(size.height));
  }
  return `/api/composite?${params}`;
}

export interface FetchedTile {
  raster: TileRaster;
  /** True when the API served this from disk — the difference between 20 ms and 20 s. */
  cached: boolean;
}

/**
 * Fetches one composite GeoTIFF and decodes it into typed arrays.
 *
 * `size` is omitted for a single-tile request, deliberately: that makes the URL, and so
 * the API's cache key, byte-identical to what it was before tiling existed, and every
 * composite already on disk stays reachable.
 */
export async function fetchCompositeTile(
  query: CompositeQuery,
  size?: OutputSize,
  signal?: AbortSignal,
): Promise<FetchedTile> {
  const res = await fetch(compositeUrl(query, size), { signal });
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new CompositeRequestError(
      message ?? `Composite request failed (${res.status}).`,
      res.status,
    );
  }

  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const image = await tiff.getImage();
  const [ratio, sceneCount] = (await image.readRasters()) as unknown as Float32Array[];

  return {
    raster: { width: image.getWidth(), height: image.getHeight(), ratio, sceneCount },
    cached: res.headers.get("X-Composite-Cache") === "hit",
  };
}

/**
 * A blip worth another attempt, or a request that will fail the same way forever?
 *
 * `routes/composite.ts` collapses every upstream failure to a 502, so a CDSE rate limit
 * and a broken evalscript are indistinguishable from here and both get retried. Worth
 * fixing by surfacing the upstream status one day; harmless in the meantime, since the
 * retry budget is small and a permanent failure just fails twice more slowly.
 */
function isWorthRetrying(error: unknown): boolean {
  if (error instanceof CompositeRequestError) {
    return error.status === undefined || error.status >= 500;
  }
  // A TypeError from fetch is a dropped connection, which is exactly what retry is for.
  return true;
}

function describeTile(plan: CompositeTilePlan, index: number): string {
  const tile: CompositeTile = plan.tiles[index];
  if (plan.tiles.length === 1) return "The composite";
  return `Tile ${index + 1} of ${plan.tiles.length} (row ${tile.row}, col ${tile.col})`;
}

export interface TiledCompositeOptions {
  onProgress?: (progress: CompositeProgress) => void;
  concurrency?: number;
  signal?: AbortSignal;
}

/**
 * Builds the composite for an AOI envelope, in as many Processing API requests as its
 * size demands, and stitches them into one raster (issue #41).
 *
 * An envelope that already fits sends exactly one request, without the size parameters —
 * so the common case is unchanged all the way down to the cache key.
 */
export async function fetchTiledComposite(
  query: CompositeQuery,
  { onProgress, concurrency = 3, signal }: TiledCompositeOptions = {},
): Promise<Composite> {
  const plan = planCompositeTiles(query.bbox);
  const single = plan.tiles.length === 1;

  let cached = 0;
  let completed = 0;
  onProgress?.({ completed: 0, total: plan.tiles.length, cached: 0 });

  let tiles: FetchedTile[];
  try {
    tiles = await mapPool(
      plan.tiles,
      (tile) =>
        fetchCompositeTile(
          { ...query, bbox: tile.bbox },
          single ? undefined : { width: tile.width, height: tile.height },
          signal,
        ),
      {
        concurrency,
        shouldRetry: isWorthRetrying,
        onSettled: (_, tile) => {
          completed++;
          if (tile.cached) cached++;
          onProgress?.({ completed, total: plan.tiles.length, cached });
        },
      },
    );
  } catch (error) {
    if (error instanceof PoolTaskError) {
      throw new Error(`${describeTile(plan, error.index)} failed: ${error.message}`);
    }
    throw error;
  }

  return mergeCompositeTiles(
    plan,
    tiles.map((tile) => tile.raster),
  );
}
