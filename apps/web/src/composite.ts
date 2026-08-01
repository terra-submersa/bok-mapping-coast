import type { BBox } from "@bok/core";
import { fromArrayBuffer } from "geotiff";

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

export function compositeUrl({ bbox, from, to }: CompositeQuery): string {
  const params = new URLSearchParams({ bbox: bbox.join(","), from, to });
  return `/api/composite?${params}`;
}

/** Fetches the two-band composite GeoTIFF and decodes it into typed arrays. */
export async function fetchComposite(query: CompositeQuery): Promise<Composite> {
  const res = await fetch(compositeUrl(query));
  if (!res.ok) {
    const message = await res
      .json()
      .then((body: { error?: string }) => body.error)
      .catch(() => undefined);
    throw new Error(message ?? `Composite request failed (${res.status}).`);
  }

  const tiff = await fromArrayBuffer(await res.arrayBuffer());
  const image = await tiff.getImage();
  const [ratio, sceneCount] = (await image.readRasters()) as unknown as Float32Array[];

  return {
    width: image.getWidth(),
    height: image.getHeight(),
    ratio,
    sceneCount,
    bbox: query.bbox,
  };
}
