import { describe, expect, it, vi } from "vitest";
import { mapPool, PoolTaskError } from "./pool.js";

/** No real delay — the backoff is asserted by what it was asked to sleep for. */
const sleeps: number[] = [];
const sleep = async (ms: number) => {
  sleeps.push(ms);
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe("mapPool", () => {
  it("returns results in input order, not completion order", async () => {
    const results = await mapPool([3, 1, 2], async (n) => {
      await new Promise((r) => setTimeout(r, n));
      return n * 10;
    });
    expect(results).toEqual([30, 10, 20]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapPool(
      Array.from({ length: 12 }, (_, i) => i),
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight--;
      },
      { concurrency: 3 },
    );
    expect(peak).toBe(3);
  });

  it("does not spin up more workers than there are items", async () => {
    let peak = 0;
    let inFlight = 0;
    await mapPool(
      [1],
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
      },
      { concurrency: 8 },
    );
    expect(peak).toBe(1);
  });

  it("retries a failing task and keeps its result", async () => {
    sleeps.length = 0;
    let calls = 0;
    const results = await mapPool(
      ["a"],
      async () => {
        calls++;
        if (calls < 3) throw new Error("flaky");
        return "ok";
      },
      { retries: 2, backoffMs: 1000, sleep },
    );

    expect(results).toEqual(["ok"]);
    expect(calls).toBe(3);
    // Doubling, and never before the first attempt.
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("gives up after the retry budget and names the item", async () => {
    sleeps.length = 0;
    const error = await mapPool(
      ["a", "b", "c"],
      async (item) => {
        if (item === "b") throw new Error("upstream 502");
        return item;
      },
      { retries: 1, concurrency: 1, sleep },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PoolTaskError);
    const failure = error as PoolTaskError;
    expect(failure.index).toBe(1);
    expect(failure.message).toBe("upstream 502");
    expect((failure.cause as Error).message).toBe("upstream 502");
  });

  it("does not retry when shouldRetry declines", async () => {
    let calls = 0;
    await expect(
      mapPool(
        ["a"],
        async () => {
          calls++;
          throw new Error("400 bad request");
        },
        { retries: 5, shouldRetry: () => false, sleep },
      ),
    ).rejects.toBeInstanceOf(PoolTaskError);
    expect(calls).toBe(1);
  });

  /** The metered-service property: a dead tile must not buy the ones behind it. */
  it("stops handing out work once something fails for good", async () => {
    const started: number[] = [];
    await mapPool(
      Array.from({ length: 10 }, (_, i) => i),
      async (i) => {
        started.push(i);
        if (i === 0) throw new Error("dead");
        return i;
      },
      { retries: 0, concurrency: 1, sleep },
    ).catch(() => undefined);

    expect(started).toEqual([0]);
  });

  it("reports each success once, as it lands", async () => {
    const onSettled = vi.fn();
    const gate = deferred();

    const run = mapPool(
      ["slow", "fast"],
      async (item) => {
        if (item === "slow") await gate.promise;
        return item.toUpperCase();
      },
      { concurrency: 2, onSettled },
    );

    // "fast" has no gate, so it must report before "slow" is released.
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledWith(1, "FAST"));
    gate.resolve();
    await run;

    expect(onSettled).toHaveBeenCalledTimes(2);
    expect(onSettled).toHaveBeenCalledWith(0, "SLOW");
  });

  it("does not report an item that never succeeded", async () => {
    const onSettled = vi.fn();
    await mapPool(["a"], async () => Promise.reject(new Error("no")), {
      retries: 0,
      onSettled,
      sleep,
    }).catch(() => undefined);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it("handles an empty list without hanging", async () => {
    await expect(mapPool([], async () => 1)).resolves.toEqual([]);
  });
});
