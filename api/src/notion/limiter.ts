/**
 * Spaces out Notion requests so LensIQ stays under Notion's average of three
 * requests per second per integration. Every HTTP request the SDK makes,
 * including its own 429 retries (which honor Retry-After), goes through one
 * limiter, because it wraps the SDK's `fetch`.
 */
export class RateLimiter {
  private nextStart = 0;
  private chain: Promise<unknown> = Promise.resolve();

  /**
   * @param minIntervalMs Minimum gap between request starts. 400 ms ≈ 2.5 req/s.
   * @param now Clock, injectable for tests.
   * @param sleep Delay, injectable for tests.
   */
  constructor(
    private readonly minIntervalMs = 400,
    private readonly now: () => number = Date.now,
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  ) {}

  /** Runs `fn` once its turn comes. Requests start in the order they were scheduled. */
  schedule<T>(fn: () => Promise<T>): Promise<T> {
    const turn = this.chain.then(async () => {
      const wait = this.nextStart - this.now();
      if (wait > 0) await this.sleep(wait);
      this.nextStart = this.now() + this.minIntervalMs;
    });
    // The queue only orders start times; a failed request must not block later ones.
    this.chain = turn.catch(() => undefined);
    return turn.then(fn);
  }

  /** A `fetch` that waits for its turn. Pass it to the Notion SDK client. */
  wrapFetch(inner: typeof fetch = fetch): typeof fetch {
    return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      this.schedule(() => inner(input, init))) as typeof fetch;
  }
}
