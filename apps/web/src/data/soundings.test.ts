import { soundingId } from "@bok/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { importSoundingCsv } from "./soundings.js";

const CSV = "name,lon,lat,depth\nBathy 0001,23.15200319,37.31572657,0.6";

function respondWith(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    json: async () => body,
    text: async () => JSON.stringify(body),
  })) as unknown as typeof fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("importSoundingCsv", () => {
  it("carries the added/updated counts back, not just the rows (issue #52)", async () => {
    // Which rows were replaced is the one thing the table cannot show afterwards, and a
    // survey silently replacing another is how #52 happened.
    vi.stubGlobal(
      "fetch",
      respondWith({
        soundings: [
          {
            id: soundingId("Bathy 0001", 23.15200319, 37.31572657),
            name: "Bathy 0001",
            lon: 23.15200319,
            lat: 37.31572657,
            depthM: 0.6,
            measuredAt: null,
            source: "echo-sounder",
            note: "",
          },
        ],
        added: 1,
        updated: 0,
      }),
    );

    const result = await importSoundingCsv(CSV);
    expect(result).toMatchObject({ added: 1, updated: 0 });
    expect(result.soundings).toHaveLength(1);
    expect(result.soundings[0].depthM).toBe(0.6);
  });

  it("validates the rows client-side, so a bad reading never reaches the fit", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith({ soundings: [{ name: "Bathy 0001" }], added: 1, updated: 0 }),
    );
    await expect(importSoundingCsv(CSV)).rejects.toThrow(/Sounding 1:/);
  });

  it("surfaces the API's own message, which names the offending line", async () => {
    vi.stubGlobal(
      "fetch",
      respondWith(
        { error: 'Line 4: "Bathy 0001" repeats the name and position of line 2.' },
        false,
      ),
    );
    await expect(importSoundingCsv(CSV)).rejects.toThrow(/Line 4:/);
  });
});
