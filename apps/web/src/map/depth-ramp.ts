import { normalise, percentileRange, type Range } from "@bok/core";
import type { Composite } from "../data/composite.js";

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
  // A non-finite position would make `Math.floor` return NaN, index the ramp out of
  // bounds, and throw — which is how five NaN pixels in 6.8 million blanked the entire
  // depth layer (issue #44). Callers are expected to skip those pixels; this is the
  // belt-and-braces guard so no future source of NaN can take the map down again.
  const position = Number.isFinite(t) ? t : 0;
  const scaled = Math.min(1, Math.max(0, position)) * (ramp.length - 1);
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

/**
 * Longest side of the raster that reaches the canvas. A tiled composite (issue #41) can
 * be 7500 px across, and `paintLayer` would build a canvas that size and then call
 * `toDataURL` on it — a few hundred megabytes of RGBA plus a base64 string of it.
 *
 * Only the *display* is decimated. Contouring, `landMask` and `coastalRibbon` keep
 * reading the full native grid, so nothing about the science is resampled.
 */
export const MAX_DISPLAY_SIDE = 2048;

export interface DisplayGrid {
  /** Sample every nth pixel on both axes. 1 means no decimation at all. */
  stride: number;
  width: number;
  height: number;
}

/** The grid actually painted: the composite itself below the cap, a decimation above it. */
export function displayGrid(
  size: { width: number; height: number },
  maxSide = MAX_DISPLAY_SIDE,
): DisplayGrid {
  const stride = Math.max(1, Math.ceil(Math.max(size.width, size.height) / maxSide));
  return {
    stride,
    width: Math.ceil(size.width / stride),
    height: Math.ceil(size.height / stride),
  };
}

/**
 * Cap on how many values the range functions sort. Beyond this they sample.
 *
 * Sorting every pixel of a 56-megapixel mosaic means a boxed array of hundreds of
 * megabytes; a percentile stretch from a million-pixel systematic sample is
 * indistinguishable at that scale. Below the cap the stride is 1 and nothing changes,
 * which is every AOI that was drawable before tiling.
 */
const MAX_RANGE_SAMPLES = 1_000_000;

function sampleStride(length: number, width: number): number {
  const stride = Math.max(1, Math.ceil(length / MAX_RANGE_SAMPLES));
  // A stride that divides the row width lands on the same column of every row and
  // samples a stripe of the bay rather than the bay. Nudging it breaks the alignment.
  return stride > 1 && width % stride === 0 ? stride + 1 : stride;
}

/** Ratio range across water pixels only — land and cloud would skew the stretch. */
export function waterRange(composite: Composite): Range | null {
  const { ratio, sceneCount, width } = composite;
  const stride = sampleStride(ratio.length, width);
  const sample = new Float64Array(Math.ceil(ratio.length / stride));
  let count = 0;
  for (let i = 0; i < ratio.length; i += stride) {
    // Non-finite ratios are excluded, not clamped. TypedArray sort puts NaN last, so a
    // single one becomes the 98th-percentile maximum and flattens the whole ramp (#44).
    if (sceneCount[i] > 0 && Number.isFinite(ratio[i])) sample[count++] = ratio[i];
  }
  return percentileRange(sample.subarray(0, count));
}

export interface RenderOptions {
  /** Pixels with fewer contributing scenes than this are drawn transparent. */
  minSceneCount?: number;
  /** Which pixels to paint. Defaults to the decimation implied by MAX_DISPLAY_SIDE. */
  display?: DisplayGrid;
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
  { minSceneCount = 1, display = displayGrid(composite) }: RenderOptions = {},
): Uint8ClampedArray {
  const { ratio, sceneCount } = composite;
  const { stride, width, height } = display;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sourceRow = y * stride * composite.width;
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * stride;
      const offset = (y * width + x) * 4;
      // A non-finite ratio is a pixel carrying no depth information — the same thing as
      // no data, and drawn the same way (#44).
      if (sceneCount[source] < minSceneCount || !Number.isFinite(ratio[source])) {
        rgba[offset + 3] = 0;
        continue;
      }
      const [r, g, b] = rampColour(normalise(ratio[source], range));
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }

  return rgba;
}

/**
 * Browser-side wrapper: the same pixels, boxed for putImageData.
 *
 * The ImageData carries the *display* dimensions, which for a tiled composite are
 * smaller than the raster's. Callers must size their canvas from this rather than from
 * `composite.width` — that is the whole point of the decimation.
 */
export function renderComposite(
  composite: Composite,
  range: Range,
  options: RenderOptions = {},
): ImageData {
  const display = options.display ?? displayGrid(composite);
  const image = new ImageData(display.width, display.height);
  image.data.set(renderCompositeRgba(composite, range, { ...options, display }));
  return image;
}

/**
 * Scene count range across water pixels only, full min–max rather than a
 * percentile stretch: the thin (low-count) tail is exactly what story 2.2
 * exists to surface, so clipping it away would hide the areas most worth
 * distrusting.
 */
export function sceneCountRange(composite: Composite): Range | null {
  const { sceneCount, width } = composite;
  const stride = sampleStride(sceneCount.length, width);
  const sample = new Float64Array(Math.ceil(sceneCount.length / stride));
  let count = 0;
  for (let i = 0; i < sceneCount.length; i += stride) {
    if (sceneCount[i] > 0) sample[count++] = sceneCount[i];
  }
  return percentileRange(sample.subarray(0, count), 0, 100);
}

/** Paints band 2 (scene count) as RGBA bytes, land left fully transparent. */
export function renderSceneCountRgba(
  composite: Composite,
  range: Range,
  { display = displayGrid(composite) }: { display?: DisplayGrid } = {},
): Uint8ClampedArray {
  const { sceneCount } = composite;
  const { stride, width, height } = display;
  const rgba = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sourceRow = y * stride * composite.width;
    for (let x = 0; x < width; x++) {
      const source = sourceRow + x * stride;
      const offset = (y * width + x) * 4;
      if (sceneCount[source] <= 0) {
        rgba[offset + 3] = 0;
        continue;
      }
      const [r, g, b] = sceneCountRampColour(normalise(sceneCount[source], range));
      rgba[offset] = r;
      rgba[offset + 1] = g;
      rgba[offset + 2] = b;
      rgba[offset + 3] = 255;
    }
  }

  return rgba;
}

/** Browser-side wrapper: the same pixels, boxed for putImageData. */
export function renderSceneCount(composite: Composite, range: Range): ImageData {
  const display = displayGrid(composite);
  const image = new ImageData(display.width, display.height);
  image.data.set(renderSceneCountRgba(composite, range, { display }));
  return image;
}
