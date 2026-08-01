import { type BBox, checkProcessingApiLimit, PROCESSING_API_MAX_SIDE_PX } from "@bok/core";
import { SDB_EVALSCRIPT } from "./evalscript.js";
import type { TokenSource } from "./token.js";

const PROCESS_URL = "https://sh.dataspace.copernicus.eu/process/v1";

export interface CompositeRequest {
  bbox: BBox;
  /** ISO instants bounding the scenes to composite. */
  from: string;
  to: string;
}

export interface OutputSize {
  width: number;
  height: number;
}

/**
 * Output size at Sentinel-2's native 10 m, so we neither throw away resolution nor
 * ask the Processing API to invent it. The spike used a fixed 1024x1024, which
 * distorted non-square AOIs.
 */
export function nativeOutputSize(bbox: BBox): OutputSize {
  const { widthPx, heightPx } = checkProcessingApiLimit(bbox);
  const clamp = (px: number) => Math.max(1, Math.min(PROCESSING_API_MAX_SIDE_PX, Math.round(px)));
  return { width: clamp(widthPx), height: clamp(heightPx) };
}

export function buildProcessBody(request: CompositeRequest, size: OutputSize) {
  return {
    input: {
      bounds: {
        properties: { crs: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
        bbox: request.bbox,
      },
      data: [
        {
          type: "sentinel-2-l2a",
          dataFilter: { timeRange: { from: request.from, to: request.to } },
        },
      ],
    },
    output: {
      width: size.width,
      height: size.height,
      responses: [{ identifier: "default", format: { type: "image/tiff" } }],
    },
    evalscript: SDB_EVALSCRIPT,
  };
}

export interface ProcessClientOptions {
  fetchFn?: typeof fetch;
}

export interface ProcessClient {
  fetchComposite(request: CompositeRequest): Promise<Uint8Array>;
}

export function createProcessClient(
  tokens: TokenSource,
  { fetchFn = fetch }: ProcessClientOptions = {},
): ProcessClient {
  return {
    async fetchComposite(request) {
      const token = await tokens.getAccessToken();
      const size = nativeOutputSize(request.bbox);

      const res = await fetchFn(PROCESS_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "image/tiff",
        },
        body: JSON.stringify(buildProcessBody(request, size)),
      });

      if (!res.ok) {
        // CDSE puts the actual reason (bad evalscript, quota, bounds) in the body,
        // and it contains no secrets — worth surfacing.
        throw new Error(
          `CDSE Processing API failed: ${res.status} ${res.statusText} — ${await res.text()}`,
        );
      }
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}
