import { lonLatToUtm } from "@bok/core";
import { describe, expect, it } from "vitest";
import {
  formatBearingDeg,
  formatDistanceM,
  formatLonLat,
  formatUtmMetres,
  formatUtmZone,
} from "./format.js";
import { toolPrompt } from "./ToolCard.js";

describe("toolPrompt", () => {
  it("walks the measure tool through its two clicks", () => {
    expect(toolPrompt("measure", [], null)).toMatch(/first point/);
    expect(toolPrompt("measure", [[23.1, 37.4]], null)).toMatch(/second point/);
  });

  it("goes quiet once the measurement is complete", () => {
    expect(
      toolPrompt(
        "measure",
        [
          [23.1, 37.4],
          [23.2, 37.3],
        ],
        null,
      ),
    ).toBeNull();
  });

  it("asks for one click for a grid reference, then stops asking", () => {
    expect(toolPrompt("utm", [], null)).toMatch(/Click a point/);
    expect(toolPrompt("utm", [], [23.1, 37.4])).toBeNull();
  });

  it("says nothing when no tool is armed", () => {
    expect(toolPrompt(null, [], null)).toBeNull();
  });

  /** Each tool reads only its own points, so switching does not inherit the other's state. */
  it("ignores the other tool's collected point", () => {
    expect(toolPrompt("utm", [[23.1, 37.4]], null)).toMatch(/Click a point/);
    expect(toolPrompt("measure", [], [23.1, 37.4])).toMatch(/first point/);
  });
});

describe("formatDistanceM", () => {
  it("uses whole metres below a kilometre — the click is not millimetre-accurate", () => {
    expect(formatDistanceM(412.37)).toBe("412 m");
    expect(formatDistanceM(0)).toBe("0 m");
    expect(formatDistanceM(999.4)).toBe("999 m");
  });

  it("switches to kilometres at 1000 m", () => {
    expect(formatDistanceM(1000)).toBe("1.00 km");
    expect(formatDistanceM(2528.295)).toBe("2.53 km");
    expect(formatDistanceM(18026.93)).toBe("18.03 km");
  });
});

describe("formatBearingDeg", () => {
  it("keeps one decimal, which is finer than the click and no finer", () => {
    expect(formatBearingDeg(111.900596)).toBe("111.9°");
    expect(formatBearingDeg(0)).toBe("0.0°");
    expect(formatBearingDeg(359.96)).toBe("360.0°");
  });
});

describe("formatLonLat", () => {
  /** Lat first, as a coordinate is spoken, though GeoJSON stores lon first. */
  it("prints latitude before longitude, at about a metre", () => {
    expect(formatLonLat([23.1225, 37.4265])).toBe("37.42650, 23.12250");
    expect(formatLonLat([-179.5, -33.8688])).toBe("-33.86880, -179.50000");
  });
});

describe("formatUtmZone", () => {
  it("writes the grid zone designator as MGRS does", () => {
    expect(formatUtmZone(lonLatToUtm(23.1225, 37.4265))).toBe("34S");
    expect(formatUtmZone(lonLatToUtm(151.2093, -33.8688))).toBe("56H");
  });

  /**
   * Kiladha is "34S" and northern. The card prints the EPSG code beside this string for
   * exactly that reason — the designator alone cannot say which hemisphere it means.
   */
  it("is a band letter, not a hemisphere", () => {
    const kiladha = lonLatToUtm(23.1225, 37.4265);
    expect(formatUtmZone(kiladha)).toBe("34S");
    expect(kiladha.hemisphere).toBe("N");
  });
});

describe("formatUtmMetres", () => {
  it("rounds to the metre and groups thousands without a comma", () => {
    expect(formatUtmMetres(687802.998972)).toBe("687 803 m");
    expect(formatUtmMetres(4144301.721762)).toBe("4 144 302 m");
    expect(formatUtmMetres(0)).toBe("0 m");
    expect(formatUtmMetres(500000)).toBe("500 000 m");
  });

  /** No comma, so a copied northing does not become two CSV fields. */
  it("never emits a comma", () => {
    expect(formatUtmMetres(8663320.2)).not.toMatch(/,/);
  });
});
