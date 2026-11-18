import { describe, expect, it } from 'vitest';
import { RateLimiter } from '../src/notion/limiter.js';

/** A fake clock: sleeping just moves time forward. */
function fakeClock() {
  let t = 1_000;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('spaces request starts by the minimum interval, in order', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(400, clock.now, clock.sleep);
    const starts: [string, number][] = [];
    const job = (name: string) => limiter.schedule(async () => void starts.push([name, clock.now()]));
    await Promise.all([job('a'), job('b'), job('c')]);
    expect(starts).toEqual([
      ['a', 1_000],
      ['b', 1_400],
      ['c', 1_800],
    ]);
  });

  it('does not wait when requests are already far apart', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(400, clock.now, clock.sleep);
    await limiter.schedule(async () => undefined);
    await clock.sleep(5_000);
    const before = clock.now();
    await limiter.schedule(async () => undefined);
    expect(clock.now()).toBe(before);
  });

  it('keeps going after a request fails', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(400, clock.now, clock.sleep);
    const failed = limiter.schedule(async () => {
      throw new Error('boom');
    });
    const ok = limiter.schedule(async () => 'ok');
    await expect(failed).rejects.toThrow('boom');
    await expect(ok).resolves.toBe('ok');
  });

  it('wraps fetch so every call is scheduled', async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter(400, clock.now, clock.sleep);
    const calls: number[] = [];
    const fakeFetch = (async () => {
      calls.push(clock.now());
      return new Response('{}');
    }) as unknown as typeof fetch;
    const wrapped = limiter.wrapFetch(fakeFetch);
    await Promise.all([wrapped('https://api.notion.com/a'), wrapped('https://api.notion.com/b')]);
    expect(calls).toEqual([1_000, 1_400]);
  });
});
