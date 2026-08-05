import { describe, expect, it } from "vitest";
import { formatSoundingCsv, parseSoundingCsv } from "./sounding-csv.js";

/**
 * `Bathymetry_argolide.csv` verbatim — the 14 real readings taken on 2026-08-04, with
 * the file's own quirks intact: no trailing newline, no Bathy 0005, whole numbers
 * written without a decimal point. If this stops parsing, the survey stops loading.
 */
const ARGOLID = `name,lon,lat,depth
Bathy 0001,23.15200319,37.31572657,0.6
Bathy 0002,23.15213252,37.31587627,1
Bathy 0003,23.15157336,37.31598138,1.3
Bathy 0004,23.15133691,37.31571794,0.9
Bathy 0006,23.15174695,37.31632311,2.1
Bathy 0007,23.15181149,37.31657934,2.6
Bathy 0008,23.15185759,37.3169334,3.1
Bathy 0009,23.15189657,37.3172701,3.5
Bathy 0010,23.13391764,37.428405,0.9
Bathy 0011,23.13367498,37.42847172,2
Bathy 0012,23.13328966,37.42854145,2.4
Bathy 0013,23.13284509,37.42859535,3
Bathy 0014,23.13263956,37.42865243,3.8
Bathy 0015,23.13234628,37.42865578,4.6`;

describe("parseSoundingCsv", () => {
  it("parses the real Argolid survey file unchanged", () => {
    const soundings = parseSoundingCsv(ARGOLID);
    expect(soundings).toHaveLength(14);
    expect(soundings[0]).toMatchObject({
      id: "bathy-0001",
      name: "Bathy 0001",
      depthM: 0.6,
      measuredAt: null,
    });
    expect(soundings[13].depthM).toBe(4.6);
  });

  it("keeps both clusters — the survey covers two sites 12 km apart", () => {
    const soundings = parseSoundingCsv(ARGOLID);
    expect(soundings.filter((s) => s.lat < 37.35)).toHaveLength(8);
    expect(soundings.filter((s) => s.lat > 37.4)).toHaveLength(6);
  });

  it("reads the optional columns when they are there", () => {
    const csv = [
      "name,lon,lat,depth,measured_at,source,note",
      "Bathy 0001,23.152,37.3157,0.6,2026-08-04T08:25:38Z,echo-sounder,over sand",
    ].join("\n");
    expect(parseSoundingCsv(csv)[0]).toMatchObject({
      measuredAt: "2026-08-04T08:25:38Z",
      source: "echo-sounder",
      note: "over sand",
    });
  });

  it("does not care about column order", () => {
    const csv = "depth,name,lat,lon\n0.6,Bathy 0001,37.3157,23.152";
    expect(parseSoundingCsv(csv)[0].depthM).toBe(0.6);
  });

  it("accepts the header spellings the wild produces", () => {
    const csv = "Name,Longitude,Latitude,Depth_m\nBathy 0001,23.152,37.3157,0.6";
    expect(parseSoundingCsv(csv)[0].lon).toBeCloseTo(23.152, 6);
  });

  it("treats a blank optional cell as unknown, not as an empty string", () => {
    const csv = "name,lon,lat,depth,measured_at\nBathy 0001,23.152,37.3157,0.6,";
    expect(parseSoundingCsv(csv)[0].measuredAt).toBeNull();
  });

  it("tolerates a trailing newline and blank lines", () => {
    expect(parseSoundingCsv(`${ARGOLID}\n\n`)).toHaveLength(14);
  });

  it("honours quoted fields with embedded commas", () => {
    const csv = 'name,lon,lat,depth,note\nBathy 0001,23.152,37.3157,0.6,"sand, then weed"';
    expect(parseSoundingCsv(csv)[0].note).toBe("sand, then weed");
  });

  it("names the line that failed, not merely that one did", () => {
    const broken = ARGOLID.replace("Bathy 0003,23.15157336,37.31598138,1.3", "Bathy 0003,x,y,1.3");
    expect(() => parseSoundingCsv(broken)).toThrow(/Line 4:/);
  });

  it("says which required column is missing, and what it did find", () => {
    const csv = "name,lon,lat\nBathy 0001,23.152,37.3157";
    expect(() => parseSoundingCsv(csv)).toThrow(/missing the column depth/);
  });

  it("rejects an empty file rather than returning nothing quietly", () => {
    expect(() => parseSoundingCsv("   ")).toThrow(/empty/);
  });
});

describe("formatSoundingCsv", () => {
  it("round-trips: export, re-import, same soundings", () => {
    const original = parseSoundingCsv(ARGOLID);
    expect(parseSoundingCsv(formatSoundingCsv(original))).toEqual(original);
  });

  it("round-trips every optional field, since this is the backup path", () => {
    const original = parseSoundingCsv(
      [
        "name,lon,lat,depth,measured_at,source,note",
        "Bathy 0001,23.152,37.3157,0.6,2026-08-04T08:25:38Z,echo-sounder,over sand",
      ].join("\n"),
    );
    expect(parseSoundingCsv(formatSoundingCsv(original))).toEqual(original);
  });

  it("quotes a note containing a comma so the row does not gain a column", () => {
    const original = parseSoundingCsv(
      'name,lon,lat,depth,note\nBathy 0001,23.152,37.3157,0.6,"sand, then weed"',
    );
    expect(parseSoundingCsv(formatSoundingCsv(original))[0].note).toBe("sand, then weed");
  });

  it("emits a header even with nothing to export", () => {
    expect(formatSoundingCsv([])).toBe("id,name,lon,lat,depth,measured_at,source,note");
  });
});
