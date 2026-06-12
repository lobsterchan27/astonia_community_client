import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function readNdjson(relativePath) {
  const text = await readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

async function replayDecodedTicksInBrowser(page, ticks) {
  return page.evaluate(async (serializedTicks) => {
    const { AstoniaProtocolStateReplay } = await import('/src/protocol/state-replay.js');
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

    return replay.snapshot();
  }, ticks);
}

test('replays docker login ticks into a minimal state snapshot', async ({ page }) => {
  await page.goto('/');

  const ticks = await readNdjson('fixtures/protocol/docker-login-tick/ticks.ndjson');
  const snapshot = await replayDecodedTicksInBrowser(page, ticks);

  expect(snapshot.protocolVersion).toBe(2);
  expect(snapshot.currentTick).toBe(59471);
  expect(snapshot.login).toEqual({ done: true, doneCount: 1 });
  expect(snapshot.origin).toEqual({ x: 126, y: 179 });
  expect(snapshot.position).toEqual({ x: 126, y: 179 });
  expect(snapshot.textMessages.map((message) => message.text)).toEqual([
    'Welcome to Astonia Community Server',
    '\u00b0c17FixtureCapture\u00b0c18, a new player, has entered the game.'
  ]);
  expect(snapshot.playersById).toMatchObject({
    219: {
      id: 219,
      name: 'FixtureCapture',
      level: 1,
      colors: [15855, 10570, 21024]
    },
    351: {
      id: 351,
      name: 'James',
      level: 21,
      colors: [0, 0, 0]
    }
  });
  expect(snapshot.player).toMatchObject({
    id: 219,
    name: 'FixtureCapture',
    position: { x: 126, y: 179 }
  });
  expect(snapshot.visibleWorld).toMatchObject({
    width: 51,
    height: 51,
    distance: 25,
    updatedCells: 789,
    nonEmptyCells: 789,
    bounds: { minX: 13, minY: 1, maxX: 44, maxY: 37 },
    layers: {
      ground: 697,
      floor: 178,
      item: 9,
      flags: 789,
      character: 2,
      effects: 0
    },
    characters: [
      {
        id: 219,
        name: 'FixtureCapture',
        local: { x: 25, y: 25 },
        world: { x: 126, y: 179 },
        spriteId: 2,
        health: 100
      },
      {
        id: 351,
        name: 'James',
        local: { x: 21, y: 29 },
        world: { x: 122, y: 183 },
        spriteId: 147,
        health: 100
      }
    ]
  });
  expect(snapshot.commands.modeled.byCommand).toMatchObject({
    SV_LOGINDONE: 1,
    SV_MAP10: 2,
    SV_MAP11: 789,
    SV_NAME: 2,
    SV_PROTOCOL: 1,
    SV_SETORIGIN: 1,
    SV_SETTICK: 1,
    SV_TEXT: 2
  });
  expect(snapshot.commands.skipped).toEqual({
    total: 68,
    byCommand: {
      SV_ACT: 1,
      SV_AREAINFO: 1,
      SV_ENDURANCE: 1,
      SV_MIRROR: 1,
      SV_PROF: 1,
      SV_REALTIME: 1,
      SV_SETHP: 1,
      SV_SETITEM: 10,
      SV_SETVAL0: 27,
      SV_SETVAL1: 23,
      SV_UNIQUE: 1
    }
  });
  expect(snapshot.ticksReplayed).toBe(8);
});

test('accepts decoder-shaped tick objects and empty tick payloads', async ({ page }) => {
  await page.goto('/');

  const snapshot = await page.evaluate(async () => {
    const { AstoniaProtocolStateReplay } = await import('/src/protocol/state-replay.js');
    const replay = new AstoniaProtocolStateReplay();

    replay.replayTick({ index: 0, payload: new Uint8Array([43]) });
    replay.replayTick({ index: 1, payload: new Uint8Array() });

    return replay.snapshot();
  });

  expect(snapshot.login).toEqual({ done: true, doneCount: 1 });
  expect(snapshot.commands.modeled).toEqual({
    total: 1,
    byCommand: { SV_LOGINDONE: 1 }
  });
  expect(snapshot.ticksReplayed).toBe(2);
});
