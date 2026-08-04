/** Which item failed, so the caller can name it in a message the Planner can act on. */
export class PoolTaskError extends Error {
  readonly index: number;
  override readonly cause: unknown;

  constructor(index: number, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PoolTaskError";
    this.index = index;
    this.cause = cause;
  }
}

export interface PoolOptions<R> {
  /** How many tasks may be in flight at once. */
  concurrency?: number;
  /** Extra attempts after the first. 0 disables retrying. */
  retries?: number;
  /** Delay before the first retry; doubles each attempt. */
  backoffMs?: number;
  /** Decides whether a given failure is worth another attempt. Defaults to always. */
  shouldRetry?: (error: unknown) => boolean;
  /** Called once per item that succeeds, in completion order rather than index order. */
  onSettled?: (index: number, result: R) => void;
  /** Injected so tests do not spend real seconds proving the backoff exists. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs `task` over `items` with a bounded number in flight, retrying each independently,
 * and returns the results **in input order**.
 *
 * Built for the tiled composite fetch (issue #41), where the constraints are unusual
 * enough to be worth stating: the Processing API is metered, so the pool stops handing
 * out new work the moment anything fails for good — there is no point paying for tiles
 * eight and nine once tile three is unrecoverable. Requests already in flight are left to
 * finish rather than aborted; they are already paid for, and cancelling them would not
 * refund anything.
 *
 * One failure fails the whole call. For composites that is deliberate rather than lazy:
 * a missing tile is not a hole, it is `sceneCount === 0`, which `landMask` reads as land.
 * A partial mosaic would grow a coastline in open water and look entirely plausible.
 */
export async function mapPool<T, R>(
  items: readonly T[],
  task: (item: T, index: number) => Promise<R>,
  {
    concurrency = 3,
    retries = 2,
    backoffMs = 1000,
    shouldRetry = () => true,
    onSettled,
    sleep = defaultSleep,
  }: PoolOptions<R> = {},
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let stopped = false;

  async function attempt(index: number): Promise<R> {
    let lastError: unknown;
    for (let tries = 0; tries <= retries; tries++) {
      if (tries > 0) await sleep(backoffMs * 2 ** (tries - 1));
      try {
        return await task(items[index], index);
      } catch (error) {
        lastError = error;
        if (!shouldRetry(error)) break;
      }
    }
    throw new PoolTaskError(index, lastError);
  }

  async function worker(): Promise<void> {
    while (!stopped) {
      const index = next++;
      if (index >= items.length) return;
      try {
        results[index] = await attempt(index);
      } catch (error) {
        stopped = true;
        throw error;
      }
      onSettled?.(index, results[index]);
    }
  }

  const width = Math.max(1, Math.min(concurrency, items.length));
  // Promise.all attaches a handler to every worker, so a second concurrent failure
  // cannot surface as an unhandled rejection.
  await Promise.all(Array.from({ length: width }, () => worker()));
  return results;
}
