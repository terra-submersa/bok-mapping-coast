import { type Sounding, soundingId } from "@bok/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createSoundingStore, type SoundingStore } from "../soundings/store.js";
import { createSoundingRoutes } from "./soundings.js";

/** `Response.json()` is `unknown` under strict TS; assert the shape at the boundary. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Two of the real Argolid readings — one in each of the survey's two clusters. */
const KILADHA = {
  name: "Bathy 0001",
  lon: 23.15200319,
  lat: 37.31572657,
  depthM: 0.6,
  measuredAt: "2026-08-04T08:25:38Z",
  source: "echo-sounder",
};
const NORTH = {
  name: "Bathy 0015",
  lon: 23.13234628,
  lat: 37.42865578,
  depthM: 4.6,
  measuredAt: "2026-08-04T10:12:00Z",
  source: "echo-sounder",
};

/** Derived rather than written out, so the expectation cannot drift from the rule (#52). */
const KILADHA_ID = soundingId(KILADHA.name, KILADHA.lon, KILADHA.lat);
const NORTH_ID = soundingId(NORTH.name, NORTH.lon, NORTH.lat);

describe("sounding routes", () => {
  let store: SoundingStore;
  let app: ReturnType<typeof createSoundingRoutes>;

  beforeEach(() => {
    store = createSoundingStore(":memory:");
    app = createSoundingRoutes(() => store);
  });

  function post(body: unknown) {
    return app.request("/soundings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("round-trips a batch through save and list", async () => {
    expect((await post([KILADHA, NORTH])).status).toBe(200);

    const { soundings } = await json<{ soundings: Sounding[] }>(await app.request("/soundings"));
    expect(soundings).toHaveLength(2);
    expect(soundings[0].name).toBe("Bathy 0001");
    expect(soundings[0].depthM).toBe(0.6);
    // The timestamp is what makes a tide correction possible later (D13).
    expect(soundings[0].measuredAt).toBe("2026-08-04T08:25:38Z");
  });

  it("upserts on re-import rather than doubling the survey", async () => {
    await post([KILADHA]);
    await post([{ ...KILADHA, depthM: 0.8 }]);

    const { soundings } = await json<{ soundings: Sounding[] }>(await app.request("/soundings"));
    expect(soundings).toHaveLength(1);
    expect(soundings[0].depthM).toBe(0.8);
  });

  it("keeps a same-named reading taken somewhere else, rather than overwriting (#52)", async () => {
    await post([KILADHA]);
    // The second survey of issue #52: also "Bathy 0001", 15 km north.
    await post([{ ...KILADHA, lon: 23.3216889, lat: 37.404918, depthM: 1.4, source: "rope" }]);

    const { soundings } = await json<{ soundings: Sounding[] }>(await app.request("/soundings"));
    expect(soundings).toHaveLength(2);
    expect(soundings.map((s) => s.depthM).sort()).toEqual([0.6, 1.4]);
  });

  it("says how many rows it added and how many it replaced", async () => {
    expect(await json<unknown>(await post([KILADHA, NORTH]))).toMatchObject({
      added: 2,
      updated: 0,
    });
    // One correction to a reading already stored, one reading that is new.
    expect(
      await json<unknown>(
        await post([
          { ...KILADHA, depthM: 0.8 },
          { ...NORTH, name: "Bathy 0016" },
        ]),
      ),
    ).toMatchObject({ added: 1, updated: 1 });
  });

  it("filters by bbox, which is how a project finds its own soundings", async () => {
    await post([KILADHA, NORTH]);

    const res = await app.request("/soundings?bbox=23.14,37.31,23.16,37.32");
    const { soundings } = await json<{ soundings: Sounding[] }>(res);
    expect(soundings.map((s) => s.name)).toEqual(["Bathy 0001"]);
  });

  it("400s on a malformed bbox instead of silently returning everything", async () => {
    const res = await app.request("/soundings?bbox=nonsense");
    expect(res.status).toBe(400);
  });

  it("rejects the whole batch when one row is bad, and says which", async () => {
    const res = await post([KILADHA, { ...NORTH, depthM: -2 }]);
    expect(res.status).toBe(400);
    expect((await json<{ error: string }>(res)).error).toMatch(/Sounding 2:/);

    // Nothing landed — half an imported survey is worse than none.
    const { soundings } = await json<{ soundings: Sounding[] }>(await app.request("/soundings"));
    expect(soundings).toEqual([]);
  });

  it("puts one sounding, with the path id winning over the body's", async () => {
    const res = await app.request("/soundings/lambayanna-1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...KILADHA, id: "something-else" }),
    });
    expect(res.status).toBe(200);
    expect((await json<Sounding>(res)).id).toBe("lambayanna-1");
  });

  it("404s for a sounding that was never saved", async () => {
    expect((await app.request("/soundings/nowhere")).status).toBe(404);
  });

  it("deletes, then 404s on the second attempt", async () => {
    await post([KILADHA]);
    expect((await app.request(`/soundings/${KILADHA_ID}`, { method: "DELETE" })).status).toBe(204);
    expect((await app.request(`/soundings/${KILADHA_ID}`, { method: "DELETE" })).status).toBe(404);
  });

  describe("CSV (issue #48)", () => {
    function postCsv(csv: string) {
      return app.request("/soundings", {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: csv,
      });
    }

    it("imports a CSV body directly, in the shape a Garmin export has", async () => {
      const res = await postCsv("name,lon,lat,depth\nBathy 0001,23.152,37.3157,0.6");
      expect(res.status).toBe(200);

      const { soundings } = await json<{ soundings: Sounding[] }>(await app.request("/soundings"));
      expect(soundings[0].depthM).toBe(0.6);
    });

    it("400s on a bad CSV row and names the line", async () => {
      const res = await postCsv("name,lon,lat,depth\nBathy 0001,23.152,37.3157,-4");
      expect(res.status).toBe(400);
      expect((await json<{ error: string }>(res)).error).toMatch(/Line 2:/);
    });

    it("exports as a file, which is the backup path the DB depends on", async () => {
      await post([KILADHA, NORTH]);
      const res = await app.request("/soundings.csv");

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("text/csv");
      expect(res.headers.get("Content-Disposition")).toContain("soundings.csv");
      expect(await res.text()).toContain("Bathy 0001");
    });

    it("round-trips: export, wipe, re-import, same rows", async () => {
      await post([KILADHA, NORTH]);
      const exported = await (await app.request("/soundings.csv")).text();

      store.remove(KILADHA_ID);
      store.remove(NORTH_ID);
      expect(store.list()).toEqual([]);

      expect((await postCsv(exported)).status).toBe(200);
      const { soundings } = await json<{ soundings: Sounding[] }>(await app.request("/soundings"));
      // Including the timestamps — an export that dropped them would silently lose the
      // one thing that keeps a tide correction possible (D13).
      expect(soundings).toEqual([
        expect.objectContaining({ id: KILADHA_ID, measuredAt: KILADHA.measuredAt }),
        expect.objectContaining({ id: NORTH_ID, measuredAt: NORTH.measuredAt }),
      ]);
    });

    it("exports a header alone when there is nothing stored", async () => {
      expect((await (await app.request("/soundings.csv")).text()).trim()).toBe(
        "id,name,lon,lat,depth,measured_at,source,note",
      );
    });
  });
});
