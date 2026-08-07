import { describe, expect, it } from "vitest";
import { chooseScaleBar, scaleLabels } from "./map-scale.js";

/** Every round distance the bar is allowed to land on, over the range a map view spans. */
const ALLOWED = [1, 1.5, 2, 3, 4, 5, 7.5].flatMap((mantissa) =>
  [1, 10, 100, 1000, 10_000, 100_000, 1_000_000].map((decade) => mantissa * decade),
);

describe("chooseScaleBar", () => {
  it("always lands on a round distance and never overflows the target", () => {
    // A pixel from a metre or so (fully zoomed in) up to a couple of kilometres (the whole
    // gulf on screen), at a target width that a real window produces.
    for (let metresPerPixel = 0.5; metresPerPixel < 2000; metresPerPixel *= 1.07) {
      const bar = chooseScaleBar(metresPerPixel, 700);
      if (!bar) throw new Error("no bar");
      expect(ALLOWED.some((d) => Math.abs(d - bar.distanceM) < 1e-6)).toBe(true);
      expect(bar.widthPx).toBeLessThanOrEqual(700);
      // The reason the step set is finer than 1-2-5: no gap exceeds 1.5x, so the bar can
      // never shrink below two-thirds of the space it was given.
      expect(bar.widthPx).toBeGreaterThan(700 / 1.5 - 1e-6);
    }
  });

  it("takes the largest step that fits, exactly at the boundary", () => {
    // 1 m per pixel, so the target width in pixels is the target in metres.
    expect(chooseScaleBar(1, 1000)?.distanceM).toBe(1000);
    expect(chooseScaleBar(1, 999)?.distanceM).toBe(750);
    expect(chooseScaleBar(1, 1499)?.distanceM).toBe(1000);
    expect(chooseScaleBar(1, 1500)?.distanceM).toBe(1500);
  });

  it("scales the width by metres per pixel", () => {
    const bar = chooseScaleBar(10, 500);
    expect(bar?.distanceM).toBe(5000);
    expect(bar?.widthPx).toBe(500);
  });

  it("cuts each step where the divisions stay round", () => {
    expect(chooseScaleBar(1, 1000)?.segments).toBe(4); // 1 km in 250 m
    expect(chooseScaleBar(1, 1500)?.segments).toBe(3); // 1.5 km in 500 m
    expect(chooseScaleBar(1, 5000)?.segments).toBe(5); // 5 km in 1 km
    expect(chooseScaleBar(1, 7500)?.segments).toBe(3); // 7.5 km in 2.5 km
  });

  it("has nothing to draw without a usable pixel size", () => {
    expect(chooseScaleBar(Number.NaN, 700)).toBeNull();
    expect(chooseScaleBar(0, 700)).toBeNull();
    expect(chooseScaleBar(-5, 700)).toBeNull();
    expect(chooseScaleBar(10, 0)).toBeNull();
  });
});

describe("scaleLabels", () => {
  it("labels every division and the unit only once", () => {
    expect(scaleLabels(400, 4)).toEqual(["0", "100", "200", "300", "400 m"]);
    expect(scaleLabels(2000, 4)).toEqual(["0", "0.5", "1", "1.5", "2 km"]);
  });

  it("switches to kilometres at a kilometre, and keeps one unit across the bar", () => {
    expect(scaleLabels(750, 3).at(-1)).toBe("750 m");
    expect(scaleLabels(1000, 4)).toEqual(["0", "0.25", "0.5", "0.75", "1 km"]);
  });

  it("does not leak binary floating point into a tick", () => {
    expect(scaleLabels(3000, 3)).toEqual(["0", "1", "2", "3 km"]);
    expect(scaleLabels(7500, 3)).toEqual(["0", "2.5", "5", "7.5 km"]);
  });
});
