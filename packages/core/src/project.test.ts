import { describe, expect, it } from "vitest";
import { rectangleAoi } from "./aoi.js";
import { parseProjectDocument, projectSlug } from "./project.js";

function valid() {
  return {
    schemaVersion: 2,
    name: "Kiladha",
    aoi: rectangleAoi([23.1, 37.4, 23.14, 37.44]),
    exclusions: [],
    inclusions: [],
    dateRange: { from: "2025-06-01", to: "2025-09-15" },
    params: {
      threshold: 0.42,
      tolerance: 0,
      bufferMetres: 30,
      coastMetres: 30,
      minRingAreaM2: 5000,
    },
    calibration: { excludedSoundingIds: [] },
  };
}

describe("projectSlug", () => {
  it("makes a URL-safe id from a name", () => {
    expect(projectSlug("Kiladha Bay 2026")).toBe("kiladha-bay-2026");
  });

  it("strips accents rather than percent-encoding them", () => {
    expect(projectSlug("Anse de Λαμπαγιαννά")).toMatch(/^anse-de/);
  });

  it("never returns an empty id, which would address the collection", () => {
    expect(projectSlug("!!!")).toBe("project");
  });
});

describe("parseProjectDocument", () => {
  it("accepts a well-formed document", () => {
    expect(parseProjectDocument(valid()).name).toBe("Kiladha");
  });

  it("keeps the AOI's shape, not just its presence", () => {
    const parsed = parseProjectDocument(valid());
    expect(parsed.aoi?.coordinates[0]).toHaveLength(5);
  });

  it("accepts a project with no AOI drawn yet", () => {
    expect(parseProjectDocument({ ...valid(), aoi: null }).aoi).toBeNull();
  });

  it("defaults missing zone lists to empty rather than failing", () => {
    const { exclusions, inclusions, ...rest } = valid();
    const parsed = parseProjectDocument(rest);
    expect(parsed.exclusions).toEqual([]);
    expect(parsed.inclusions).toEqual([]);
  });

  it("rejects an unknown schema version instead of guessing", () => {
    expect(() => parseProjectDocument({ ...valid(), schemaVersion: 99 })).toThrow(/schema version/);
  });

  it("upgrades a v1 document rather than rejecting it", () => {
    // The first real project — 285 km² of water, the only measurement of the pipeline at
    // scale — was saved as v1. Refusing it on the version number is silent data loss.
    const { calibration, ...rest } = valid();
    const v1 = { ...rest, schemaVersion: 1 };
    const parsed = parseProjectDocument(v1);
    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.calibration).toEqual({ excludedSoundingIds: [] });
    // Everything a v1 document did carry survives the upgrade untouched.
    expect(parsed.aoi?.coordinates[0]).toHaveLength(5);
    expect(parsed.params.threshold).toBe(0.42);
  });

  it("keeps the excluded sounding ids", () => {
    const doc = { ...valid(), calibration: { excludedSoundingIds: ["bathy-0015"] } };
    expect(parseProjectDocument(doc).calibration.excludedSoundingIds).toEqual(["bathy-0015"]);
  });

  it("defaults a missing calibration to excluding nothing", () => {
    const { calibration, ...rest } = valid();
    expect(parseProjectDocument(rest).calibration).toEqual({ excludedSoundingIds: [] });
  });

  it("rejects excluded ids that are not strings", () => {
    const doc = { ...valid(), calibration: { excludedSoundingIds: [7] } };
    expect(() => parseProjectDocument(doc)).toThrow(/list of strings/);
  });

  it("does not store the fit — it is derived from soundings and the composite", () => {
    // Storing m1/m0 would let a saved file disagree with the raster beside it (D10).
    const doc = { ...valid(), calibration: { excludedSoundingIds: [], m1: 12, m0: 3 } };
    expect(parseProjectDocument(doc).calibration).toEqual({ excludedSoundingIds: [] });
  });

  it("rejects a nameless project", () => {
    expect(() => parseProjectDocument({ ...valid(), name: "  " })).toThrow(/needs a name/);
  });

  it("rejects a ring too short to close", () => {
    const broken = {
      ...valid(),
      aoi: {
        type: "Polygon",
        coordinates: [
          [
            [23.1, 37.4],
            [23.2, 37.4],
          ],
        ],
      },
    };
    expect(() => parseProjectDocument(broken)).toThrow(/fewer than four/);
  });

  it("rejects a position that is not a lon/lat pair", () => {
    const broken = {
      ...valid(),
      exclusions: [
        { type: "Polygon", coordinates: [[[23.1, 37.4], "nope", [23.2, 37.5], [23.1, 37.4]]] },
      ],
    };
    expect(() => parseProjectDocument(broken)).toThrow(/lon\/lat pair/);
  });

  it("names which zone was malformed", () => {
    const broken = {
      ...valid(),
      inclusions: [valid().aoi, { type: "Point", coordinates: [0, 0] }],
    };
    expect(() => parseProjectDocument(broken)).toThrow(/inclusion zone 2/);
  });

  it("rejects a non-finite parameter", () => {
    const broken = { ...valid(), params: { ...valid().params, tolerance: Number.NaN } };
    expect(() => parseProjectDocument(broken)).toThrow(/tolerance/);
  });

  it("allows a null threshold, for a project saved before any composite", () => {
    const doc = { ...valid(), params: { ...valid().params, threshold: null } };
    expect(parseProjectDocument(doc).params.threshold).toBeNull();
  });
});
