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

function tickSettingOrigin({ currentTick, x, y }) {
  return [
    0x40 | 10,
    16,
    currentTick & 0xff,
    (currentTick >>> 8) & 0xff,
    (currentTick >>> 16) & 0xff,
    (currentTick >>> 24) & 0xff,
    15,
    x & 0xff,
    x >>> 8,
    y & 0xff,
    y >>> 8
  ];
}

async function runPredictionScenario(page, scenario) {
  await page.goto('/');

  return page.evaluate(async (input) => {
    const { AstoniaLiveSession } = await import('/src/live-session.js');
    let socket;
    let currentPosition = { ...input.initialPosition };

    function clonePoint(point) {
      return point ? { ...point } : null;
    }

    function makeSnapshot(position, ticks) {
      const distance = 25;
      const local = { x: distance, y: distance };
      const character = {
        id: 1,
        name: 'FixtureCapture',
        local: clonePoint(local),
        world: clonePoint(position),
        spriteId: 12_345,
        action: null,
        duration: null,
        step: null,
        direction: null,
        health: null,
        mana: null,
        shield: null
      };

      return {
        protocolVersion: 3,
        currentTick: 10_000 + ticks,
        login: { done: true, doneCount: 1 },
        origin: clonePoint(position),
        position: clonePoint(position),
        player: {
          ...character,
          position: clonePoint(position)
        },
        playersById: {
          1: {
            id: 1,
            name: 'FixtureCapture',
            level: 1,
            colors: [0, 0, 0],
            clan: 0,
            pkStatus: 0
          }
        },
        carriedItem: null,
        textMessages: [],
        areaRetargets: { total: 0, latest: null, events: [] },
        visibleWorld: {
          width: distance * 2 + 1,
          height: distance * 2 + 1,
          distance,
          updatedCells: 1,
          nonEmptyCells: 1,
          bounds: {
            minX: distance,
            minY: distance,
            maxX: distance,
            maxY: distance
          },
          layers: {
            ground: 0,
            floor: 0,
            item: 0,
            flags: 0,
            character: 1,
            effects: 0
          },
          cells: [],
          characters: [character]
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

    const replay = {
      ticks: 0,
      replayTick() {
        this.ticks += 1;
      },
      snapshot() {
        return makeSnapshot(currentPosition, this.ticks);
      }
    };

    const session = new AstoniaLiveSession({
      decoderFactory: () => ({
        async pushChunk(bytes) {
          return [{ payload: new Uint8Array(bytes), rawLength: bytes.byteLength }];
        }
      }),
      replayFactory: () => replay,
      webSocketFactory: () => {
        socket = new ManualWebSocket();
        return socket;
      },
      movementPrediction: input.movementPrediction,
      tickBufferOptions: {
        fallbackTickIntervalMs: 1,
        maxInitialHoldMs: 0
      }
    });

    function summarize() {
      const state = session.state;
      const characterCommand = state.renderList?.commands.find((command) => command.layer === 'character') ?? null;
      return {
        decodedTicks: state.decodedTicks,
        snapshotPosition: clonePoint(state.snapshot?.player?.position),
        displayPosition: clonePoint(state.displaySnapshot?.player?.position),
        renderCharacterWorld: clonePoint(characterCommand?.world),
        renderCharacterLocal: clonePoint(characterCommand?.local),
        movementPrediction: state.movementPrediction,
        lastVisibleUpdate: state.lastVisibleUpdate,
        lastMoveCommand: state.lastMoveCommand,
        sentFrames: socket.sent
      };
    }

    async function receiveAuthoritativePosition(position) {
      currentPosition = { ...position };
      const expectedTicks = session.state.decodedTicks + 1;
      socket.receive([expectedTicks]);
      await waitFor(() => session.state.decodedTicks === expectedTicks);
      return summarize();
    }

    session.connect({
      gatewayUrl: 'ws://prediction.gateway.test',
      username: 'FixtureCapture',
      password: 'fixturecapture',
      protocolVersion: 3
    });
    socket.dispatchEvent(new Event('open'));
    await waitFor(() => socket.sent.length === 4);

    const beforeMove = await receiveAuthoritativePosition(input.initialPosition);
    const moveResult = session.moveToTile(input.target);
    const afterMove = summarize();
    const afterTicks = [];
    for (const position of input.authoritativePositions ?? []) {
      afterTicks.push(await receiveAuthoritativePosition(position));
    }

    return {
      moveResult,
      beforeMove,
      afterMove,
      afterTicks
    };
  }, scenario);
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

test('live session accepts a first-step movement prediction without mutating the authoritative snapshot', async ({ page }) => {
  const result = await runPredictionScenario(page, {
    initialPosition: { x: 10, y: 20 },
    target: { x: 12, y: 21 },
    movementPrediction: { enabled: true, confirmationTickWindow: 3 },
    authoritativePositions: [{ x: 11, y: 21 }]
  });

  expect(result.moveResult).toBe(true);
  expect(result.afterMove.sentFrames.at(-1)).toEqual([2, 12, 0, 21, 0]);
  expect(result.afterMove.snapshotPosition).toEqual({ x: 10, y: 20 });
  expect(result.afterMove.displayPosition).toEqual({ x: 11, y: 21 });
  expect(result.afterMove.displayPosition).not.toEqual({ x: 12, y: 21 });
  expect(result.afterMove.renderCharacterWorld).toEqual({ x: 11, y: 21 });
  expect(result.afterMove.movementPrediction).toMatchObject({
    status: 'pending',
    pending: {
      originalPosition: { x: 10, y: 20 },
      predictedPosition: { x: 11, y: 21 },
      target: { x: 12, y: 21 }
    },
    lastPredictedUpdate: {
      predictedPosition: { x: 11, y: 21 }
    }
  });
  expect(result.afterMove.lastVisibleUpdate).toMatchObject({
    source: 'prediction',
    playerPosition: { x: 11, y: 21 },
    authoritativePlayerPosition: { x: 10, y: 20 }
  });

  expect(result.afterTicks[0]).toMatchObject({
    snapshotPosition: { x: 11, y: 21 },
    displayPosition: { x: 11, y: 21 },
    movementPrediction: {
      status: 'accepted',
      pending: null,
      lastAuthoritativeReconciliation: {
        status: 'accepted',
        reason: 'authoritative-position-matched',
        confirmationTicks: 1
      }
    }
  });
});

test('live session rejects a movement prediction when authoritative movement diverges', async ({ page }) => {
  const result = await runPredictionScenario(page, {
    initialPosition: { x: 10, y: 20 },
    target: { x: 12, y: 20 },
    movementPrediction: { enabled: true, confirmationTickWindow: 3 },
    authoritativePositions: [{ x: 10, y: 21 }]
  });

  expect(result.afterMove.displayPosition).toEqual({ x: 11, y: 20 });
  expect(result.afterTicks[0]).toMatchObject({
    snapshotPosition: { x: 10, y: 21 },
    displayPosition: { x: 10, y: 21 },
    movementPrediction: {
      status: 'rejected',
      pending: null,
      lastAuthoritativeReconciliation: {
        status: 'rejected',
        reason: 'authoritative-position-diverged',
        authoritativePosition: { x: 10, y: 21 },
        predictedPosition: { x: 11, y: 20 }
      }
    }
  });
});

test('live session keeps delayed movement prediction only inside the confirmation window', async ({ page }) => {
  const delayed = await runPredictionScenario(page, {
    initialPosition: { x: 10, y: 20 },
    target: { x: 12, y: 20 },
    movementPrediction: { enabled: true, confirmationTickWindow: 3 },
    authoritativePositions: [
      { x: 10, y: 20 },
      { x: 11, y: 20 }
    ]
  });

  expect(delayed.afterTicks[0]).toMatchObject({
    snapshotPosition: { x: 10, y: 20 },
    displayPosition: { x: 11, y: 20 },
    movementPrediction: {
      status: 'pending',
      pending: {
        predictedPosition: { x: 11, y: 20 }
      },
      lastAuthoritativeReconciliation: {
        status: 'pending',
        reason: 'awaiting-authoritative-confirmation',
        confirmationTicks: 1
      }
    }
  });
  expect(delayed.afterTicks[1].movementPrediction).toMatchObject({
    status: 'accepted',
    pending: null,
    lastAuthoritativeReconciliation: {
      status: 'accepted',
      confirmationTicks: 2
    }
  });

  const expired = await runPredictionScenario(page, {
    initialPosition: { x: 10, y: 20 },
    target: { x: 12, y: 20 },
    movementPrediction: { enabled: true, confirmationTickWindow: 1 },
    authoritativePositions: [{ x: 10, y: 20 }]
  });

  expect(expired.afterTicks[0]).toMatchObject({
    snapshotPosition: { x: 10, y: 20 },
    displayPosition: { x: 10, y: 20 },
    movementPrediction: {
      status: 'rejected',
      pending: null,
      lastAuthoritativeReconciliation: {
        status: 'rejected',
        reason: 'confirmation-window-expired',
        confirmationTicks: 1
      }
    }
  });
});

test('live session can disable movement prediction while still sending CL_MOVE', async ({ page }) => {
  const result = await runPredictionScenario(page, {
    initialPosition: { x: 10, y: 20 },
    target: { x: 12, y: 20 },
    movementPrediction: false,
    authoritativePositions: []
  });

  expect(result.moveResult).toBe(true);
  expect(result.afterMove.sentFrames.at(-1)).toEqual([2, 12, 0, 20, 0]);
  expect(result.afterMove.snapshotPosition).toEqual({ x: 10, y: 20 });
  expect(result.afterMove.displayPosition).toEqual({ x: 10, y: 20 });
  expect(result.afterMove.renderCharacterWorld).toEqual({ x: 10, y: 20 });
  expect(result.afterMove.movementPrediction).toMatchObject({
    enabled: false,
    status: 'disabled',
    pending: null,
    lastPredictedUpdate: null
  });
});

test('move command encoder emits the native CL_MOVE five-byte packet', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { encodeAstoniaMoveCommand } = await import('/src/protocol/move-command.js');

    return {
      ordinary: Array.from(encodeAstoniaMoveCommand({ x: 126, y: 179 })),
      endianProbe: Array.from(encodeAstoniaMoveCommand({ x: 0x1234, y: 0xabcd }))
    };
  });

  expect(result).toEqual({
    ordinary: [2, 126, 0, 179, 0],
    endianProbe: [2, 0x34, 0x12, 0xcd, 0xab]
  });
});

test('render-list hit testing converts a canvas tile click to a world tile', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { hitTestAstoniaRenderListTile } = await import('/src/render/tile-hit-test.js');
    const renderList = {
      viewport: { tileWidth: 40, tileHeight: 20 },
      commands: [
        {
          id: 'ground:25,25:12008',
          layer: 'ground',
          spriteId: 12_008,
          local: { x: 25, y: 25 },
          world: { x: 126, y: 179 },
          screen: { x: 400, y: 220 }
        }
      ]
    };

    return {
      center: hitTestAstoniaRenderListTile(renderList, { x: 400, y: 230 }),
      edge: hitTestAstoniaRenderListTile(renderList, { x: 420, y: 230 }),
      miss: hitTestAstoniaRenderListTile(renderList, { x: 421, y: 230 })
    };
  });

  expect(result.center).toMatchObject({
    id: 'ground:25,25:12008',
    layer: 'ground',
    local: { x: 25, y: 25 },
    world: { x: 126, y: 179 },
    spriteId: 12_008
  });
  expect(result.edge).toMatchObject({ world: { x: 126, y: 179 } });
  expect(result.miss).toBeNull();
});

test('browser click sends CL_MOVE and later server ticks drive visible movement debug state', async ({ page }) => {
  await installFakeGateway(page);

  const rawFrames = await readNdjson('fixtures/protocol/docker-login-tick/raw-stream.ndjson');
  const ticks = await readNdjson('fixtures/protocol/docker-login-tick/ticks.ndjson');
  const inboundChunks = rawFrames
    .filter((frame) => frame.direction === 'inbound')
    .map((frame) => base64ToBytes(frame.data));

  await page.goto('/?gateway=ws://fixture.gateway.test&username=FixtureCapture&password=fixturecapture&autoconnect=1');
  await expect.poll(() => page.evaluate(() => window.__fakeAstoniaSockets[0]?.sent.length ?? 0)).toBe(4);

  for (const chunk of inboundChunks) {
    await page.evaluate((bytes) => window.__fakeAstoniaSockets[0].__receive(bytes), chunk);
  }

  await expect(page.getByTestId('live-connection-status')).toContainText('Live');
  await expect(page.getByTestId('live-player-position')).toHaveText('126,179');

  const clickTarget = await page.evaluate(async (serializedTicks) => {
    const { AstoniaProtocolStateReplay } = await import('/src/protocol/state-replay.js');
    const { createAstoniaRenderList } = await import('/src/render/render-list.js');
    const replay = new AstoniaProtocolStateReplay();

    function base64ToBytes(base64) {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    }

    for (const tick of serializedTicks) {
      replay.replayTickPayload(base64ToBytes(tick.data), { tickIndex: tick.index });
    }

    const renderList = createAstoniaRenderList(replay.snapshot());
    const command = renderList.commands.find(
      (entry) => entry.layer === 'ground' && entry.world?.x === 127 && entry.world?.y === 179
    );

    return {
      world: command.world,
      point: {
        x: command.screen.x,
        y: command.screen.y + renderList.viewport.tileHeight / 2
      }
    };
  }, ticks);

  await page.getByTestId('live-world-canvas').evaluate((canvas, point) => {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + point.x * (rect.width / canvas.width),
        clientY: rect.top + point.y * (rect.height / canvas.height)
      })
    );
  }, clickTarget.point);

  await expect.poll(() => page.evaluate(() => window.__fakeAstoniaSockets[0].sent.length)).toBe(5);
  const sentMove = await page.evaluate(() => window.__fakeAstoniaSockets[0].sent.at(-1));
  expect(sentMove).toEqual([2, 127, 0, 179, 0]);
  await expect(page.getByTestId('live-last-move-command')).toContainText('sent CL_MOVE 127,179');
  await expect(page.getByTestId('live-last-move-command')).toContainText('[0x02 0x7f 0x00 0xb3 0x00]');

  await page.evaluate((bytes) => window.__fakeAstoniaSockets[0].__receive(bytes), tickSettingOrigin({
    currentTick: 59_472,
    ...clickTarget.world
  }));

  await expect(page.getByTestId('live-tick-count')).toHaveText('9');
  await expect(page.getByTestId('live-current-tick')).toHaveText('59472');
  await expect(page.getByTestId('live-player-position')).toHaveText('127,179');
  await expect(page.getByTestId('live-last-received-tick')).toContainText('decoded 9');
  await expect(page.getByTestId('live-last-visible-update')).toContainText('127,179 at current 59472');
});
