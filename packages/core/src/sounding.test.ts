import { describe, expect, it } from "vitest";
import { parseSounding, parseSoundings, soundingId } from "./sounding.js";

/** The first row of the real Argolid survey, 2026-08-04. */
function valid() {
  return {
    name: "Bathy 0001",
    lon: 23.15200319,
    lat: 37.31572657,
    depthM: 0.6,
    measuredAt: "2026-08-04T08:25:38Z",
    source: "echo-sounder",
  };
}

describe("parseSounding", () => {
  it("accepts a well-formed sounding", () => {
    const parsed = parseSounding(valid());
    expect(parsed.depthM).toBe(0.6);
    expect(parsed.measuredAt).toBe("2026-08-04T08:25:38Z");
  });

  it("derives a stable id from the name and position, so re-importing a CSV is idempotent", () => {
    expect(parseSounding(valid()).id).toBe("bathy-0001-n37315727-e23152003");
    expect(parseSounding(valid()).id).toBe(parseSounding(valid()).id);
  });

  it("keeps an explicit id rather than overwriting it", () => {
    expect(parseSounding({ ...valid(), id: "kiladha-7" }).id).toBe("kiladha-7");
  });

  it("reads numbers that arrived as strings, which is what a CSV gives you", () => {
    const parsed = parseSounding({ ...valid(), lon: "23.15200319", depthM: "0.6" });
    expect(parsed.lon).toBeCloseTo(23.15200319, 8);
    expect(parsed.depthM).toBe(0.6);
  });

  it("defaults the optional prose rather than demanding it", () => {
    const { measuredAt, source, ...rest } = valid();
    const parsed = parseSounding(rest);
    expect(parsed.measuredAt).toBeNull();
    expect(parsed.source).toBe("");
    expect(parsed.note).toBe("");
  });

  it("rejects a nameless sounding, which would have no id", () => {
    expect(() => parseSounding({ ...valid(), name: "  " })).toThrow(/needs a name/);
  });

  it("rejects a negative depth — depth is measured downwards", () => {
    expect(() => parseSounding({ ...valid(), depthM: -1 })).toThrow(/negative depth/);
  });

  it("rejects a depth past the sanity limit, which is a units error", () => {
    // 15 ft read as 15 m is survivable; 700 is a sounder left in imperial or a stray digit.
    expect(() => parseSounding({ ...valid(), depthM: 700 })).toThrow(/sanity limit/);
  });

  it("rejects coordinates off Earth", () => {
    expect(() => parseSounding({ ...valid(), lat: 137 })).toThrow(/off Earth/);
    expect(() => parseSounding({ ...valid(), lon: -400 })).toThrow(/off Earth/);
  });

  it("rejects a missing depth rather than defaulting it to zero", () => {
    const { depthM, ...rest } = valid();
    expect(() => parseSounding(rest)).toThrow(/no depth/);
  });

  it("names the sounding in every message, since they arrive fourteen at a time", () => {
    expect(() => parseSounding({ ...valid(), depthM: Number.NaN })).toThrow(/Bathy 0001/);
  });
});

describe("soundingId", () => {
  it("separates two surveys that both start at Bathy 0001 (issue #52)", () => {
    // The overwrite that prompted this: Kiladha and the northern cluster, 15 km apart,
    // both numbered from one. Under the old name-only id the second import destroyed the
    // first six readings of the first, silently.
    const kiladha = soundingId("Bathy 0001", 23.15200319, 37.31572657);
    const northern = soundingId("Bathy 0001", 23.3216889, 37.404918);
    expect(kiladha).not.toBe(northern);
  });

  it("gives the same id to the same name at the same place, so a re-import corrects", () => {
    expect(soundingId("Bathy 0001", 23.15200319, 37.31572657)).toBe(
      soundingId("Bathy 0001", 23.15200319, 37.31572657),
    );
  });

  it("ignores float noise below ~0.11 m, so a re-exported CSV does not invent a point", () => {
    expect(soundingId("Bathy 0001", 23.152003191, 37.315726571)).toBe(
      soundingId("Bathy 0001", 23.15200319, 37.31572657),
    );
  });

  it("stays a legal path segment — the id is the :id in /api/soundings/:id", () => {
    // Including for a southern, western position, where a minus sign would have produced
    // a double dash and a leading-dash slug.
    for (const id of [
      soundingId("Bathy 0001", 23.15200319, 37.31572657),
      soundingId("Récif d'Été #3", -70.123456, -33.987654),
    ]) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(encodeURIComponent(id)).toBe(id);
      expect(id).not.toContain("--");
    }
  });

  it("keeps the coordinates legible, which is how the overwrite was diagnosed", () => {
    expect(soundingId("Bathy 0001", 23.15200319, 37.31572657)).toBe(
      "bathy-0001-n37315727-e23152003",
    );
    expect(soundingId("Bathy 0001", -70.123456, -33.987654)).toBe("bathy-0001-s33987654-w70123456");
  });
});

describe("parseSoundings", () => {
  it("parses a list", () => {
    expect(parseSoundings([valid(), { ...valid(), name: "Bathy 0002" }])).toHaveLength(2);
  });

  it("says which row failed, not merely that one did", () => {
    expect(() => parseSoundings([valid(), { ...valid(), depthM: -3 }])).toThrow(/Sounding 2:/);
  });

  it("rejects something that is not a list", () => {
    expect(() => parseSoundings(valid())).toThrow(/must be a list/);
  });
});
