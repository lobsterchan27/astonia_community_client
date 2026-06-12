import { expect, test } from '@playwright/test';

async function runBufferScenario(page, arrivals) {
  return page.evaluate(async (arrivalTimes) => {
    const { AdaptiveTickJitterBuffer } = await import('/src/tick-jitter-buffer.js');
    const buffer = new AdaptiveTickJitterBuffer({
      fallbackTickIntervalMs: 50,
      maxInitialHoldMs: 50,
      stableSampleThreshold: 4
    });
    let nowMs = 0;
    let nextPlaybackAtMs = null;

    function schedule() {
      const delayMs = buffer.nextDelayMs(nowMs);
      nextPlaybackAtMs = delayMs === null ? null : nowMs + delayMs;
    }

    function drainDuePlayback() {
      while (nextPlaybackAtMs !== null && nextPlaybackAtMs <= nowMs) {
        nowMs = nextPlaybackAtMs;
        buffer.takeTick(nowMs);
        schedule();
      }
    }

    for (const arrival of arrivalTimes) {
      while (nextPlaybackAtMs !== null && nextPlaybackAtMs < arrival.atMs) {
        nowMs = nextPlaybackAtMs;
        buffer.takeTick(nowMs);
        schedule();
      }

      nowMs = arrival.atMs;
      buffer.enqueueTicks(Array.from({ length: arrival.count ?? 1 }, (_, index) => ({ id: `${arrival.atMs}:${index}` })), nowMs);
      if (arrival.decodeMs !== undefined) {
        buffer.recordDecodeTiming(arrival.decodeMs);
      }
      schedule();
      drainDuePlayback();
    }

    return buffer.metrics();
  }, arrivals);
}

test('adaptive jitter buffer records underflow and raises the target', async ({ page }) => {
  await page.goto('/');

  const metrics = await page.evaluate(async () => {
    const { AdaptiveTickJitterBuffer } = await import('/src/tick-jitter-buffer.js');
    const buffer = new AdaptiveTickJitterBuffer({ fallbackTickIntervalMs: 50, maxInitialHoldMs: 50 });

    buffer.enqueueTicks([{ id: 1 }], 0);
    const firstDelay = buffer.nextDelayMs(0);
    const tick = buffer.takeTick(50);
    const underflowDelay = buffer.nextDelayMs(50);
    const underflowTick = buffer.takeTick(100);

    return {
      firstDelay,
      tick,
      underflowDelay,
      underflowTick,
      metrics: buffer.metrics()
    };
  });

  expect(metrics.firstDelay).toBe(50);
  expect(metrics.tick).toEqual({ id: 1 });
  expect(metrics.underflowDelay).toBe(50);
  expect(metrics.underflowTick).toBeNull();
  expect(metrics.metrics.underflows).toBe(1);
  expect(metrics.metrics.targetQueueDepth).toBe(2);
  expect(metrics.metrics.lastBufferTargetChange).toMatchObject({
    from: 1,
    to: 2,
    reason: 'underflow'
  });
});

test('adaptive jitter buffer targets one tick under steady low jitter', async ({ page }) => {
  await page.goto('/');

  const arrivals = Array.from({ length: 12 }, (_, index) => ({ atMs: index * 50, count: 1, decodeMs: 0.4 }));
  const metrics = await runBufferScenario(page, arrivals);

  expect(metrics.targetQueueDepth).toBe(1);
  expect(metrics.queueDepth).toBeLessThanOrEqual(1);
  expect(metrics.underflows).toBe(0);
  expect(metrics.tickArrivalIntervalMs).toBe(50);
  expect(metrics.averageTickArrivalIntervalMs).toBe(50);
  expect(metrics.decodeMs).toBe(0.4);
});

test('adaptive jitter buffer raises target for bursty delivery and can settle back', async ({ page }) => {
  await page.goto('/');

  const metrics = await page.evaluate(async () => {
    const { AdaptiveTickJitterBuffer } = await import('/src/tick-jitter-buffer.js');
    const buffer = new AdaptiveTickJitterBuffer({
      fallbackTickIntervalMs: 50,
      stableSampleThreshold: 4
    });

    const arrivals = [
      { atMs: 0 },
      { atMs: 50 },
      { atMs: 100 },
      { atMs: 300, count: 3 },
      ...Array.from({ length: 24 }, (_, index) => ({ atMs: 350 + index * 50 }))
    ];

    for (const arrival of arrivals) {
      buffer.enqueueTicks(Array.from({ length: arrival.count ?? 1 }, (_, index) => ({ id: `${arrival.atMs}:${index}` })), arrival.atMs);
    }

    return buffer.metrics();
  });

  expect(metrics.bufferTargetChanges).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ from: 1, to: 2, reason: 'bursty delivery' }),
      expect.objectContaining({ from: 2, to: 1, reason: 'stable arrivals' })
    ])
  );
  expect(metrics.targetQueueDepth).toBe(1);
  expect(metrics.maxQueueDepth).toBeGreaterThanOrEqual(3);
});
