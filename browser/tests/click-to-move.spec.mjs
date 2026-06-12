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
