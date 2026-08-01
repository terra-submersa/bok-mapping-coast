/**
 * Evalscript for the SDB composite, run by Sentinel Hub on their side (see
 * CLAUDE.md: "Do not download and process Sentinel-2 tiles in Node").
 *
 * Band 1 = median Stumpf ratio, band 2 = contributing scene count.
 *
 * `mosaicking: "ORBIT"` is what makes the median possible: evaluatePixel receives
 * one sample per orbit across the whole time range instead of a single composite.
 *
 * This is a string executed in a remote sandbox, so it cannot import anything.
 * It is unit tested by evaluating it against synthetic samples — see
 * evalscript.test.ts — which tests the artefact we actually ship rather than a
 * TypeScript re-implementation of it.
 */

/** Bump when the script changes; it is part of the cache key, so old composites are not reused. */
export const SDB_EVALSCRIPT_VERSION = 1;

/** Scalar keeping both logarithms positive for reflectances in [0, 1]. */
export const STUMPF_N = 1000;

export const SDB_EVALSCRIPT = `
//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B02", "B03", "B08", "SCL"] }],
    output: { bands: 2, sampleType: "FLOAT32" },
    mosaicking: "ORBIT"
  };
}

// SCL: 1 saturated/defective, 3 cloud shadow, 8/9 cloud medium/high prob,
// 10 cirrus, 11 snow.
function isCloudOrShadow(scl) {
  return scl === 1 || scl === 3 || scl === 8 || scl === 9 || scl === 10 || scl === 11;
}

// NDWI > 0 keeps water and drops land. Green vs NIR, because water absorbs NIR.
function isWater(sample) {
  var ndwi = (sample.B03 - sample.B08) / (sample.B03 + sample.B08);
  return ndwi > 0;
}

var N = ${STUMPF_N};

function evaluatePixel(samples) {
  var ratios = [];
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (s.B02 <= 0 || s.B03 <= 0) continue;
    if (isCloudOrShadow(s.SCL)) continue;
    if (!isWater(s)) continue;
    ratios.push(Math.log(N * s.B02) / Math.log(N * s.B03));
  }
  var count = ratios.length;
  if (count === 0) return [0, 0];
  ratios.sort(function (a, b) { return a - b; });
  var mid = Math.floor(count / 2);
  var median = count % 2 === 0 ? (ratios[mid - 1] + ratios[mid]) / 2 : ratios[mid];
  // Band 2 is not optional: without a scene count, a two-cloudy-scene artefact
  // looks identical to a real shallow shelf.
  return [median, count];
}
`;
