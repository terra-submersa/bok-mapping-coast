import { TerraDraw, TerraDrawPolygonMode } from "terra-draw";
import { describe, expect, it } from "vitest";
import { resetDraw, type StoppableDraw } from "./draw-lifecycle.js";

/** Records what was called, and throws on `clear` exactly as terra-draw does. */
function stubDraw(enabled: boolean) {
  const calls: string[] = [];
  const draw: StoppableDraw & { calls: string[] } = {
    calls,
    get enabled() {
      return enabled;
    },
    clear() {
      if (!enabled) throw new Error("Terra Draw is not enabled");
      calls.push("clear");
    },
    stop() {
      if (!enabled) return;
      enabled = false;
      calls.push("stop");
    },
  };
  return draw;
}

describe("resetDraw", () => {
  it("clears and stops a running instance", () => {
    const draw = stubDraw(true);
    resetDraw(draw);
    expect(draw.calls).toEqual(["clear", "stop"]);
    expect(draw.enabled).toBe(false);
  });

  it("is a no-op on a stopped instance", () => {
    const draw = stubDraw(false);
    expect(() => resetDraw(draw)).not.toThrow();
    expect(draw.calls).toEqual([]);
  });

  it("is a no-op before the map has built one", () => {
    expect(() => resetDraw(null)).not.toThrow();
  });

  it("can be called twice in a row", () => {
    const draw = stubDraw(true);
    resetDraw(draw);
    expect(() => resetDraw(draw)).not.toThrow();
    expect(draw.calls).toEqual(["clear", "stop"]);
  });
});

/**
 * The reason the guard exists at all (issue #40). If a future terra-draw makes `clear`
 * tolerant of a stopped instance this test goes red — which is the point: the stub above
 * would otherwise quietly stop describing the library it stands in for.
 */
describe("terra-draw's own contract", () => {
  /** Enough of an adapter to construct TerraDraw off a map. */
  function headlessAdapter() {
    return {
      getMapEventElement: () => ({
        addEventListener() {},
        removeEventListener() {},
        style: {},
      }),
      register() {},
      unregister() {},
      render() {},
      clear() {},
      project: (lng: number, lat: number) => ({ x: lng, y: lat }),
      unproject: (x: number, y: number) => ({ lng: x, lat: y }),
      setCursor() {},
      getCoordinatePrecision: () => 9,
      setDraggability() {},
      setDoubleClickToZoom() {},
      getLngLatFromEvent: () => ({ lng: 0, lat: 0 }),
    };
  }

  function headlessDraw() {
    return new TerraDraw({
      // The adapter interface is far wider than a headless test can implement, and
      // none of the rest is reachable without a map.
      // biome-ignore lint/suspicious/noExplicitAny: see above
      adapter: headlessAdapter() as any,
      modes: [new TerraDrawPolygonMode()],
    });
  }

  it("throws on clear() before start()", () => {
    const draw = headlessDraw();
    expect(draw.enabled).toBe(false);
    expect(() => draw.clear()).toThrow(/not enabled/);
  });

  it("throws on clear() after stop()", () => {
    const draw = headlessDraw();
    draw.start();
    draw.stop();
    expect(() => draw.clear()).toThrow(/not enabled/);
  });

  it("survives resetDraw in both states", () => {
    const draw = headlessDraw();
    expect(() => resetDraw(draw)).not.toThrow();
    draw.start();
    expect(() => resetDraw(draw)).not.toThrow();
    expect(draw.enabled).toBe(false);
  });
});
