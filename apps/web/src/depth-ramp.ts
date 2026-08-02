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

/**
 * Sequential ramp for the per-pixel scene count (story 2.2): a warning red for
 * thin data climbing to a reassuring green for well-supported pixels. A single
 * cloudy-scene artefact is otherwise indistinguishable from a real shallow
 * shelf, so this exists to let the Planner distrust the red areas.
 */
const SCENE_COUNT_RAMP: [number, number, number][] = [
  [211, 47, 47], // thin — one or two scenes, distrust this
  [255, 179, 0],
  [255, 241, 118],
  [129, 199, 132],
  [27, 94, 32], // many scenes — solid
];

function interpolateRamp(ramp: [number, number, number][], t: number): [number, number, number] {
  const scaled = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function rampColour(t: number): [number, number, number] {
  return interpolateRamp(RAMP, t);
}

export function sceneCountRampColour(t: number): [number, number, number] {
  return interpolateRamp(SCENE_COUNT_RAMP, t);
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

/**
 * Scene count range across water pixels only, full min–max rather than a
 * percentile stretch: the thin (low-count) tail is exactly what story 2.2
 * exists to surface, so clipping it away would hide the areas most worth
 * distrusting.
 */
export function sceneCountRange(composite: Composite): Range | null {
  const counts: number[] = [];
  for (let i = 0; i < composite.sceneCount.length; i++) {
    if (composite.sceneCount[i] > 0) counts.push(composite.sceneCount[i]);
  }
  return percentileRange(counts, 0, 100);
}

/** Paints band 2 (scene count) as RGBA bytes, land left fully transparent. */
export function renderSceneCountRgba(composite: Composite, range: Range): Uint8ClampedArray {
  const { width, height, sceneCount } = composite;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let i = 0; i < sceneCount.length; i++) {
    const offset = i * 4;
    if (sceneCount[i] <= 0) {
      rgba[offset + 3] = 0;
      continue;
    }
    const [r, g, b] = sceneCountRampColour(normalise(sceneCount[i], range));
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
    rgba[offset + 3] = 255;
  }

  return rgba;
}

/** Browser-side wrapper: the same pixels, boxed for putImageData. */
export function renderSceneCount(composite: Composite, range: Range): ImageData {
  const image = new ImageData(composite.width, composite.height);
  image.data.set(renderSceneCountRgba(composite, range));
  return image;
}
