import { normalise, percentileRange, type Range } from "@bok/core";
import type { Composite } from "./composite.js";

/**
 * Shallow-to-deep ramp. Deliberately not a rainbow: a perceptually ordered
 * sand-to-deep-blue sequence reads as depth, and the Planner is judging it against
 * satellite imagery where a rainbow would fight the underlying scene.
 *
 * A higher Stumpf ratio means deeper water, so t = 0 is shallow.
 */
const RAMP: [number, number, number][] = [
  [255, 246, 213], // shallow — sand
  [126, 214, 200],
  [39, 150, 176],
  [22, 74, 128],
  [10, 26, 62], // deep
];

export function rampColour(t: number): [number, number, number] {
  const scaled = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = RAMP[i];
  const b = RAMP[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

/** Ratio range across water pixels only — land and cloud would skew the stretch. */
export function waterRange(composite: Composite): Range | null {
  const water: number[] = [];
  for (let i = 0; i < composite.ratio.length; i++) {
    if (composite.sceneCount[i] > 0) water.push(composite.ratio[i]);
  }
  return percentileRange(water);
}

export interface RenderOptions {
  /** Pixels with fewer contributing scenes than this are drawn transparent. */
  minSceneCount?: number;
}

/**
 * Paints band 1 as RGBA bytes. Pixels with no contributing scenes stay fully
 * transparent so the satellite imagery shows through on land.
 *
 * Returns raw bytes rather than ImageData so it can be tested without a DOM.
 */
export function renderCompositeRgba(
  composite: Composite,
  range: Range,
  { minSceneCount = 1 }: RenderOptions = {},
): Uint8ClampedArray {
  const { width, height, ratio, sceneCount } = composite;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < ratio.length; i++) {
    const offset = i * 4;
    if (sceneCount[i] < minSceneCount) {
      rgba[offset + 3] = 0;
      continue;
    }
    const [r, g, b] = rampColour(normalise(ratio[i], range));
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }

  return rgba;
}

/** Browser-side wrapper: the same pixels, boxed for putImageData. */
export function renderComposite(
  composite: Composite,
  range: Range,
  options: RenderOptions = {},
): ImageData {
  const image = new ImageData(composite.width, composite.height);
  image.data.set(renderCompositeRgba(composite, range, options));
  return image;
}
