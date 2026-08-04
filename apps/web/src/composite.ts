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

/**
 * The bytes arrived but would not decode. Separate from `CompositeRequestError` because
 * the two want opposite treatment: a request can be retried, whereas the same bytes
 * decode to the same failure however many times you ask.
 */
export class CompositeDecodeError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "CompositeDecodeError";
    this.cause = cause;
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

  return {
    raster: await decodeTile(await res.arrayBuffer()),
    cached: res.headers.get("X-Composite-Cache") === "hit",
  };
}

/**
 * Decodes one composite GeoTIFF, and guarantees that a failure arrives as an `Error`.
 *
 * That guarantee is the whole point of the wrapper. geotiff's deflate path re-throws
 * whatever pako threw, and pako throws a bare **string** (`throw inflator.msg`), so
 * `name`, `message` and `stack` are all undefined at the catch. Issue #45 surfaced in
 * the panel as the two words "buffer error" and nothing else — no tile, no file, no
 * hint that it was a decode rather than a download.
 */
async function decodeTile(bytes: ArrayBuffer): Promise<TileRaster> {
  try {
    const tiff = await fromArrayBuffer(bytes);
    const image = await tiff.getImage();
    const [ratio, sceneCount] = (await image.readRasters()) as unknown as Float32Array[];
    return { width: image.getWidth(), height: image.getHeight(), ratio, sceneCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CompositeDecodeError(`the GeoTIFF could not be decoded (${detail})`, error);
  }
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
  // Undecodable bytes are undecodable a second later too, and each attempt is a paid
  // Processing API request on a cache miss.
  if (error instanceof CompositeDecodeError) return false;
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

  // Let the last tile's progress paint before the merge, which is a synchronous copy of
  // the whole raster — several hundred milliseconds at nine tiles. Without the yield the
  // final update, the merge and the caller's teardown all land in one React tick, so the
  // bar freezes one tile short and reads as a stalled request rather than a busy merge.
  await new Promise((resolve) => setTimeout(resolve, 0));

  return mergeCompositeTiles(
    plan,
    tiles.map((tile) => tile.raster),
  );
}
