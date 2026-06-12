import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function readNdjson(relativePath) {
  const text = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

function base64ToBytes(base64) {
  return [...Buffer.from(base64, 'base64')];
}

async function installFakeGateway(page) {
  await page.addInitScript(() => {
    class FakeWebSocket extends EventTarget {
      static instances = [];
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        super();
        this.url = url;
        this.binaryType = '';
        this.readyState = FakeWebSocket.CONNECTING;
        this.sent = [];
        FakeWebSocket.instances.push(this);

        setTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatchEvent(new Event('open'));
        }, 0);
      }

      send(data) {
        this.sent.push(Array.from(new Uint8Array(data)));
      }

      close() {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatchEvent(new CloseEvent('close', { code: 1000, reason: 'test close' }));
      }

      __receive(bytes) {
        this.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(bytes).buffer }));
      }
    }

    window.WebSocket = FakeWebSocket;
    window.__fakeAstoniaSockets = FakeWebSocket.instances;
  });
}

test('browser login frames match the captured native Docker login sequence', async ({ page }) => {
  await page.goto('/');

  const rawFrames = await readNdjson('fixtures/protocol/docker-login-tick/raw-stream.ndjson');
  const expectedOutbound = rawFrames
    .filter((frame) => frame.direction === 'outbound')
    .map((frame) => base64ToBytes(frame.data));

  const loginFrames = await page.evaluate(async () => {
    const { buildAstoniaLoginFrames } = await import('/src/protocol/login.js');

    return buildAstoniaLoginFrames({
      username: 'FixtureCapture',
      password: 'fixturecapture',
      protocolVersion: 3
    }).map((frame) => Array.from(frame));
  });

  expect(loginFrames).toEqual(expectedOutbound);
});

test('browser live view connects through the gateway and renders decoded Docker ticks', async ({ page }) => {
  await installFakeGateway(page);

  const rawFrames = await readNdjson('fixtures/protocol/docker-login-tick/raw-stream.ndjson');
  const expectedOutbound = rawFrames
    .filter((frame) => frame.direction === 'outbound')
    .map((frame) => base64ToBytes(frame.data));
  const inboundChunks = rawFrames
    .filter((frame) => frame.direction === 'inbound')
    .map((frame) => base64ToBytes(frame.data));

  await page.goto('/?gateway=ws://fixture.gateway.test&username=FixtureCapture&password=fixturecapture&autoconnect=1');

  await expect.poll(() => page.evaluate(() => window.__fakeAstoniaSockets[0]?.sent.length ?? 0)).toBe(4);
  const sentFrames = await page.evaluate(() => window.__fakeAstoniaSockets[0].sent);
  expect(sentFrames).toEqual(expectedOutbound);

  for (const chunk of inboundChunks) {
    await page.evaluate((bytes) => window.__fakeAstoniaSockets[0].__receive(bytes), chunk);
  }

  await expect(page.getByTestId('live-connection-status')).toContainText('Live');
  await expect(page.getByTestId('live-tick-count')).toHaveText('8');
  await expect(page.getByTestId('live-current-tick')).toHaveText('59471');
  await expect(page.getByTestId('live-protocol-version')).toHaveText('2');
  await expect(page.getByTestId('live-player-name')).toHaveText('FixtureCapture');
  await expect(page.getByTestId('live-player-position')).toHaveText('126,179');
  await expect(page.getByTestId('live-buffer-depth')).toContainText('/');
  await expect(page.getByTestId('live-buffer-underflows')).toHaveText(/\d+/);
  await expect(page.getByTestId('live-latency-arrival')).toContainText('jitter');
  await expect(page.getByTestId('live-latency-timings')).toContainText('decode');
  await expect(page.getByTestId('live-command-counts')).toContainText('modeled 799');
  await expect(page.getByTestId('live-command-counts')).toContainText('skipped 68');

  const canvasSample = await page.getByTestId('live-world-canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonEmptyPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] > 0 && (data[index] !== 0 || data[index + 1] !== 0 || data[index + 2] !== 0)) {
        nonEmptyPixels += 1;
      }
    }
    return { width: canvas.width, height: canvas.height, nonEmptyPixels };
  });

  expect(canvasSample.width).toBeGreaterThan(900);
  expect(canvasSample.height).toBeGreaterThan(500);
  expect(canvasSample.nonEmptyPixels).toBeGreaterThan(1000);
  await expect(page.getByTestId('live-latency-timings')).toHaveText(/render \d+\.\dms/);
});

test('live session serializes back-to-back gateway messages through the decoder', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { AstoniaLiveSession } = await import('/src/live-session.js');
    let socket;
    let releaseFirstDecode;

    function emptySnapshot() {
      return {
        protocolVersion: null,
        currentTick: null,
        login: { done: false, doneCount: 0 },
        origin: null,
        position: null,
        player: null,
        playersById: {},
        carriedItem: null,
        textMessages: [],
        visibleWorld: {
          width: 0,
          height: 0,
          distance: 0,
          updatedCells: 0,
          nonEmptyCells: 0,
          bounds: null,
          layers: {},
          cells: [],
          characters: []
        },
        commands: {
          modeled: { total: 0, byCommand: {} },
          skipped: { total: 0, byCommand: {} }
        },
        ticksReplayed: 0
      };
    }

    async function waitFor(predicate) {
      const startedAt = Date.now();
      while (!predicate()) {
        if (Date.now() - startedAt > 1000) {
          throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    class ManualWebSocket extends EventTarget {
      static CLOSING = 2;

      constructor() {
        super();
        this.binaryType = '';
        this.readyState = 1;
        this.sent = [];
      }

      send(data) {
        this.sent.push(Array.from(new Uint8Array(data)));
      }

      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
      }

      receive(bytes) {
        this.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(bytes).buffer }));
      }
    }

    const decoder = {
      active: 0,
      calls: 0,
      maxActive: 0,
      async pushChunk() {
        this.calls += 1;
        this.active += 1;
        this.maxActive = Math.max(this.maxActive, this.active);
        if (this.calls === 1) {
          await new Promise((resolve) => {
            releaseFirstDecode = resolve;
          });
        }
        this.active -= 1;
        return [];
      }
    };

    const replay = {
      snapshot() {
        return emptySnapshot();
      }
    };

    const session = new AstoniaLiveSession({
      decoderFactory: () => decoder,
      replayFactory: () => replay,
      webSocketFactory: () => {
        socket = new ManualWebSocket();
        return socket;
      }
    });

    session.connect({
      gatewayUrl: 'ws://queued.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture'
    });
    socket.dispatchEvent(new Event('open'));
    socket.receive([0x40]);
    socket.receive([0x40]);
    await Promise.resolve();
    await Promise.resolve();

    const beforeRelease = {
      calls: decoder.calls,
      maxActive: decoder.maxActive
    };

    releaseFirstDecode();
    await waitFor(() => decoder.calls === 2 && decoder.active === 0);

    return {
      beforeRelease,
      afterRelease: {
        calls: decoder.calls,
        maxActive: decoder.maxActive
      }
    };
  });

  expect(result.beforeRelease).toEqual({ calls: 1, maxActive: 1 });
  expect(result.afterRelease).toEqual({ calls: 2, maxActive: 1 });
});

test('live session reconnect starts with fresh decoder and replay state', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { AstoniaLiveSession } = await import('/src/live-session.js');
    const sockets = [];
    const decoders = [];
    const replays = [];

    function emptySnapshot() {
      return {
        protocolVersion: null,
        currentTick: null,
        login: { done: false, doneCount: 0 },
        origin: null,
        position: null,
        player: null,
        playersById: {},
        carriedItem: null,
        textMessages: [],
        visibleWorld: {
          width: 0,
          height: 0,
          distance: 0,
          updatedCells: 0,
          nonEmptyCells: 0,
          bounds: null,
          layers: {},
          cells: [],
          characters: []
        },
        commands: {
          modeled: { total: 0, byCommand: {} },
          skipped: { total: 0, byCommand: {} }
        },
        ticksReplayed: 0
      };
    }

    async function waitFor(predicate) {
      const startedAt = Date.now();
      while (!predicate()) {
        if (Date.now() - startedAt > 1000) {
          throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    class ManualWebSocket extends EventTarget {
      static CLOSING = 2;

      constructor() {
        super();
        this.binaryType = '';
        this.readyState = 1;
      }

      send() {}

      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
      }

      receive(bytes) {
        this.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(bytes).buffer }));
      }
    }

    const session = new AstoniaLiveSession({
      decoderFactory: () => {
        const decoder = {
          chunks: [],
          async pushChunk(bytes) {
            this.chunks.push(Array.from(bytes));
            return [{ payload: new Uint8Array([43]), rawLength: bytes.byteLength }];
          }
        };
        decoders.push(decoder);
        return decoder;
      },
      replayFactory: () => {
        const replay = {
          ticks: 0,
          replayTick() {
            this.ticks += 1;
          },
          snapshot() {
            return {
              ...emptySnapshot(),
              currentTick: this.ticks,
              login: { done: true, doneCount: this.ticks },
              ticksReplayed: this.ticks
            };
          }
        };
        replays.push(replay);
        return replay;
      },
      webSocketFactory: () => {
        const socket = new ManualWebSocket();
        sockets.push(socket);
        return socket;
      }
    });

    session.connect({
      gatewayUrl: 'ws://reconnect.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture'
    });
    sockets[0].dispatchEvent(new Event('open'));
    sockets[0].receive([1]);
    await waitFor(() => session.state.decodedTicks === 1);

    session.connect({
      gatewayUrl: 'ws://reconnect.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture'
    });
    const cleanStateAfterReconnect = {
      decodedTicks: session.state.decodedTicks,
      snapshot: session.state.snapshot,
      renderList: session.state.renderList
    };

    sockets[1].dispatchEvent(new Event('open'));
    sockets[1].receive([2]);
    await waitFor(() => session.state.decodedTicks === 1 && replays[1]?.ticks === 1);

    return {
      decoderCount: decoders.length,
      replayCount: replays.length,
      firstDecoderChunks: decoders[0].chunks,
      secondDecoderChunks: decoders[1].chunks,
      firstReplayTicks: replays[0].ticks,
      secondReplayTicks: replays[1].ticks,
      cleanStateAfterReconnect,
      finalDecodedTicks: session.state.decodedTicks,
      finalCurrentTick: session.state.snapshot.currentTick
    };
  });

  expect(result).toEqual({
    decoderCount: 2,
    replayCount: 2,
    firstDecoderChunks: [[1]],
    secondDecoderChunks: [[2]],
    firstReplayTicks: 1,
    secondReplayTicks: 1,
    cleanStateAfterReconnect: {
      decodedTicks: 0,
      snapshot: null,
      renderList: null
    },
    finalDecodedTicks: 1,
    finalCurrentTick: 1
  });
});

test('live session exposes adaptive buffer latency metrics in public state', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { AstoniaLiveSession } = await import('/src/live-session.js');
    let socket;

    function emptySnapshot(ticks) {
      return {
        protocolVersion: null,
        currentTick: ticks,
        login: { done: true, doneCount: ticks },
        origin: null,
        position: null,
        player: null,
        playersById: {},
        carriedItem: null,
        textMessages: [],
        visibleWorld: {
          width: 0,
          height: 0,
          distance: 0,
          updatedCells: 0,
          nonEmptyCells: 0,
          bounds: null,
          layers: {},
          cells: [],
          characters: []
        },
        commands: {
          modeled: { total: 0, byCommand: {} },
          skipped: { total: 0, byCommand: {} }
        },
        ticksReplayed: ticks
      };
    }

    async function waitFor(predicate) {
      const startedAt = Date.now();
      while (!predicate()) {
        if (Date.now() - startedAt > 1000) {
          throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    class ManualWebSocket extends EventTarget {
      static CLOSING = 2;

      constructor() {
        super();
        this.binaryType = '';
        this.readyState = 1;
      }

      send() {}

      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
      }

      receive(bytes) {
        this.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(bytes).buffer }));
      }
    }

    const replay = {
      ticks: 0,
      replayTick() {
        this.ticks += 1;
      },
      snapshot() {
        return emptySnapshot(this.ticks);
      }
    };

    const session = new AstoniaLiveSession({
      decoderFactory: () => ({
        async pushChunk(bytes) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return [{ payload: new Uint8Array([43]), rawLength: bytes.byteLength }];
        }
      }),
      replayFactory: () => replay,
      webSocketFactory: () => {
        socket = new ManualWebSocket();
        return socket;
      },
      tickBufferOptions: {
        fallbackTickIntervalMs: 20,
        maxInitialHoldMs: 20
      }
    });

    session.connect({
      gatewayUrl: 'ws://metrics.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture'
    });
    socket.dispatchEvent(new Event('open'));
    socket.receive([1, 2, 3]);
    await waitFor(() => session.state.decodedTicks === 1);
    session.recordRenderTiming(3.25);

    return {
      lastReceivedTick: session.state.lastReceivedTick,
      lastVisibleUpdate: session.state.lastVisibleUpdate,
      latencyMetrics: session.state.latencyMetrics
    };
  });

  expect(result.lastReceivedTick).toMatchObject({
    decodedTicks: 1,
    currentTick: 1,
    rawBytes: 3,
    targetQueueDepth: 1
  });
  expect(result.lastVisibleUpdate.updateMs).toBeGreaterThanOrEqual(0);
  expect(result.latencyMetrics).toMatchObject({
    queueDepth: 0,
    targetQueueDepth: 1,
    ticksQueued: 1,
    ticksReplayed: 1,
    underflows: 0
  });
  expect(result.latencyMetrics.decodeMs).toBeGreaterThan(0);
  expect(result.latencyMetrics.updateMs).toBeGreaterThanOrEqual(0);
  expect(result.latencyMetrics.renderMs).toBe(3.3);
});

test('live session does not replay buffered ticks after the gateway closes', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { AstoniaLiveSession } = await import('/src/live-session.js');
    let socket;
    let timerId = 0;
    const timers = [];

    function emptySnapshot(ticks) {
      return {
        protocolVersion: null,
        currentTick: ticks,
        login: { done: true, doneCount: ticks },
        origin: null,
        position: null,
        player: null,
        playersById: {},
        carriedItem: null,
        textMessages: [],
        visibleWorld: {
          width: 0,
          height: 0,
          distance: 0,
          updatedCells: 0,
          nonEmptyCells: 0,
          bounds: null,
          layers: {},
          cells: [],
          characters: []
        },
        commands: {
          modeled: { total: 0, byCommand: {} },
          skipped: { total: 0, byCommand: {} }
        },
        ticksReplayed: ticks
      };
    }

    async function waitFor(predicate) {
      const startedAt = Date.now();
      while (!predicate()) {
        if (Date.now() - startedAt > 1000) {
          throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    class ManualWebSocket extends EventTarget {
      static CLOSING = 2;

      constructor() {
        super();
        this.binaryType = '';
        this.readyState = 1;
      }

      send() {}

      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
      }

      receive(bytes) {
        this.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(bytes).buffer }));
      }
    }

    const replay = {
      ticks: 0,
      replayTick() {
        this.ticks += 1;
      },
      snapshot() {
        return emptySnapshot(this.ticks);
      }
    };

    const session = new AstoniaLiveSession({
      decoderFactory: () => ({
        async pushChunk(bytes) {
          return [{ payload: new Uint8Array([43]), rawLength: bytes.byteLength }];
        }
      }),
      replayFactory: () => replay,
      webSocketFactory: () => {
        socket = new ManualWebSocket();
        return socket;
      },
      setTimeout: (callback, delayMs) => {
        const timer = { id: ++timerId, callback, delayMs, active: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        timer.active = false;
      },
      tickBufferOptions: {
        fallbackTickIntervalMs: 50,
        maxInitialHoldMs: 50
      }
    });

    session.connect({
      gatewayUrl: 'ws://close-before-replay.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture'
    });
    socket.dispatchEvent(new Event('open'));
    socket.receive([1, 2, 3]);
    await waitFor(() => timers.some((timer) => timer.active) && session.state.latencyMetrics.queueDepth === 1);

    socket.close();
    const afterClose = {
      status: session.state.status,
      decodedTicks: session.state.decodedTicks,
      lastVisibleUpdate: session.state.lastVisibleUpdate,
      replayTicks: replay.ticks,
      activeTimerCount: timers.filter((timer) => timer.active).length
    };

    for (const timer of timers) {
      timer.callback();
      timer.active = false;
    }

    return {
      afterClose,
      afterTimers: {
        status: session.state.status,
        decodedTicks: session.state.decodedTicks,
        lastVisibleUpdate: session.state.lastVisibleUpdate,
        replayTicks: replay.ticks,
        activeTimerCount: timers.filter((timer) => timer.active).length
      }
    };
  });

  expect(result.afterClose).toMatchObject({
    status: 'closed-before-ticks',
    decodedTicks: 0,
    lastVisibleUpdate: null,
    replayTicks: 0,
    activeTimerCount: 0
  });
  expect(result.afterTimers).toMatchObject({
    status: 'closed-before-ticks',
    decodedTicks: 0,
    lastVisibleUpdate: null,
    replayTicks: 0,
    activeTimerCount: 0
  });
});

test('live session ignores decoded ticks that finish after the gateway closes', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { AstoniaLiveSession } = await import('/src/live-session.js');
    let socket;
    let resolveDecode;
    let decodeStarted = false;
    let timerId = 0;
    const timers = [];
    const decodePromise = new Promise((resolve) => {
      resolveDecode = resolve;
    });

    function emptySnapshot(ticks) {
      return {
        protocolVersion: null,
        currentTick: ticks,
        login: { done: true, doneCount: ticks },
        origin: null,
        position: null,
        player: null,
        playersById: {},
        carriedItem: null,
        textMessages: [],
        visibleWorld: {
          width: 0,
          height: 0,
          distance: 0,
          updatedCells: 0,
          nonEmptyCells: 0,
          bounds: null,
          layers: {},
          cells: [],
          characters: []
        },
        commands: {
          modeled: { total: 0, byCommand: {} },
          skipped: { total: 0, byCommand: {} }
        },
        ticksReplayed: ticks
      };
    }

    async function waitFor(predicate) {
      const startedAt = Date.now();
      while (!predicate()) {
        if (Date.now() - startedAt > 1000) {
          throw new Error('Timed out waiting for condition');
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }

    class ManualWebSocket extends EventTarget {
      static CLOSING = 2;

      constructor() {
        super();
        this.binaryType = '';
        this.readyState = 1;
      }

      send() {}

      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent('close', { code: 1000 }));
      }

      receive(bytes) {
        this.dispatchEvent(new MessageEvent('message', { data: Uint8Array.from(bytes).buffer }));
      }
    }

    const replay = {
      ticks: 0,
      replayTick() {
        this.ticks += 1;
      },
      snapshot() {
        return emptySnapshot(this.ticks);
      }
    };

    const session = new AstoniaLiveSession({
      decoderFactory: () => ({
        async pushChunk() {
          decodeStarted = true;
          return decodePromise;
        }
      }),
      replayFactory: () => replay,
      webSocketFactory: () => {
        socket = new ManualWebSocket();
        return socket;
      },
      setTimeout: (callback, delayMs) => {
        const timer = { id: ++timerId, callback, delayMs, active: true };
        timers.push(timer);
        return timer;
      },
      clearTimeout: (timer) => {
        timer.active = false;
      },
      tickBufferOptions: {
        fallbackTickIntervalMs: 50,
        maxInitialHoldMs: 50
      }
    });

    session.connect({
      gatewayUrl: 'ws://close-during-decode.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture'
    });
    socket.dispatchEvent(new Event('open'));
    socket.receive([1, 2, 3]);
    await waitFor(() => decodeStarted);

    socket.close();
    const afterClose = {
      status: session.state.status,
      decodedTicks: session.state.decodedTicks,
      lastVisibleUpdate: session.state.lastVisibleUpdate,
      replayTicks: replay.ticks,
      activeTimerCount: timers.filter((timer) => timer.active).length
    };

    resolveDecode([{ payload: new Uint8Array([43]), rawLength: 3 }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    return {
      afterClose,
      afterDecode: {
        status: session.state.status,
        decodedTicks: session.state.decodedTicks,
        lastVisibleUpdate: session.state.lastVisibleUpdate,
        replayTicks: replay.ticks,
        activeTimerCount: timers.filter((timer) => timer.active).length
      }
    };
  });

  expect(result.afterClose).toMatchObject({
    status: 'closed-before-ticks',
    decodedTicks: 0,
    lastVisibleUpdate: null,
    replayTicks: 0,
    activeTimerCount: 0
  });
  expect(result.afterDecode).toMatchObject({
    status: 'closed-before-ticks',
    decodedTicks: 0,
    lastVisibleUpdate: null,
    replayTicks: 0,
    activeTimerCount: 0
  });
});
