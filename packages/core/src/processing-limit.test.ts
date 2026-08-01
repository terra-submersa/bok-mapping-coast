import { describe, expect, it } from "vitest";
import { checkProcessingApiLimit, PROCESSING_API_MAX_SIDE_PX } from "./processing-limit.js";

describe("checkProcessingApiLimit", () => {
  it("does not flag the Kiladha Bay spike AOI", () => {
    const kiladhaBay: [number, number, number, number] = [23.105, 37.418, 23.14, 37.435];
    const result = checkProcessingApiLimit(kiladhaBay);
    expect(result.exceeds).toBe(false);
    expect(result.widthPx).toBeLessThan(PROCESSING_API_MAX_SIDE_PX);
    expect(result.heightPx).toBeLessThan(PROCESSING_API_MAX_SIDE_PX);
  });

  it("flags a bbox wider than 2500 px at 10 m resolution", () => {
    // ~30 km wide at this latitude, well past the 25 km (2500 px * 10 m) cap.
    const result = checkProcessingApiLimit([23.0, 37.4, 23.35, 37.42]);
    expect(result.exceeds).toBe(true);
  });

  it("does not flag a bbox just under the cap", () => {
    // ~24 km wide at this latitude.
    const result = checkProcessingApiLimit([23.0, 37.4, 23.27, 37.41]);
    expect(result.exceeds).toBe(false);
  });
});
