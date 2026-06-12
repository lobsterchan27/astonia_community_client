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

function expectedPublicTick(tick) {
  return {
    header: tick.header,
    compressed: tick.compressed,
    rawLength: tick.raw_length,
    compressedLength: tick.compressed_length,
    payloadLength: tick.payload_length,
    data: tick.data
  };
}

async function decodeChunksInBrowser(page, chunks) {
  return page.evaluate(async (serializedChunks) => {
    const { AstoniaTickStreamDecoder } = await import('/src/protocol/tick-stream-decoder.js');
    const decoder = new AstoniaTickStreamDecoder();

    function bytesToBase64(bytes) {
      let binary = '';
      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }
      return btoa(binary);
    }

    const perChunk = [];
    for (const chunk of serializedChunks) {
      const ticks = await decoder.pushChunk(Uint8Array.from(chunk));
      perChunk.push(
        ticks.map((tick) => ({
          header: tick.header,
          compressed: tick.compressed,
          rawLength: tick.rawLength,
          compressedLength: tick.compressedLength,
          payloadLength: tick.payload.length,
          data: bytesToBase64(tick.payload)
        }))
      );
    }

    return perChunk;
  }, chunks);
}

test('decodes a small tick split across incremental chunks', async ({ page }) => {
  await page.goto('/');

  const rawFrames = await readNdjson('fixtures/protocol/tiny-login-tick/raw-stream.ndjson');
  const expectedTicks = await readNdjson('fixtures/protocol/tiny-login-tick/ticks.ndjson');
  const inboundChunks = rawFrames
    .filter((frame) => frame.direction === 'inbound')
    .map((frame) => base64ToBytes(frame.data));

  const perChunk = await decodeChunksInBrowser(page, inboundChunks);
  const emittedTicks = perChunk.flat();

  expect(perChunk.map((ticks) => ticks.length)).toEqual([0, 1]);
  expect(emittedTicks).toEqual([expectedPublicTick(expectedTicks[0])]);
});

test('decodes normal and big ticks across split headers', async ({ page }) => {
  await page.goto('/');

  const perChunk = await decodeChunksInBrowser(page, [
    [0x00],
    [0x03, 0xaa, 0xbb, 0xcc, 0xff],
    [0xff, 0x00],
    [0x02, 0x11, 0x22]
  ]);
  const emittedTicks = perChunk.flat();

  expect(perChunk.map((ticks) => ticks.length)).toEqual([0, 1, 0, 1]);
  expect(emittedTicks).toEqual([
    {
      header: 'normal',
      compressed: false,
      rawLength: 5,
      compressedLength: undefined,
      payloadLength: 3,
      data: 'qrvM'
    },
    {
      header: 'big',
      compressed: false,
      rawLength: 6,
      compressedLength: undefined,
      payloadLength: 2,
      data: 'ESI='
    }
  ]);
});

test('inflates a compressed normal tick in browser code', async ({ page }) => {
  await page.goto('/');

  const rawFrames = await readNdjson('fixtures/protocol/compressed-login-tick/raw-stream.ndjson');
  const expectedTicks = await readNdjson('fixtures/protocol/compressed-login-tick/ticks.ndjson');
  const inboundChunks = rawFrames
    .filter((frame) => frame.direction === 'inbound')
    .map((frame) => base64ToBytes(frame.data));

  const perChunk = await decodeChunksInBrowser(page, inboundChunks);
  const emittedTicks = perChunk.flat();

  expect(emittedTicks).toEqual([expectedPublicTick(expectedTicks[0])]);
});

test('replays docker login ticks with stateful zlib across compressed ticks', async ({ page }) => {
  await page.goto('/');

  const rawFrames = await readNdjson('fixtures/protocol/docker-login-tick/raw-stream.ndjson');
  const expectedTicks = await readNdjson('fixtures/protocol/docker-login-tick/ticks.ndjson');
  const inboundChunks = rawFrames
    .filter((frame) => frame.direction === 'inbound')
    .map((frame) => base64ToBytes(frame.data));

  const perChunk = await decodeChunksInBrowser(page, inboundChunks);
  const emittedTicks = perChunk.flat();

  expect(emittedTicks).toHaveLength(8);
  expect(emittedTicks[4]).toMatchObject({
    header: 'normal',
    compressed: true,
    compressedLength: 1611,
    payloadLength: 6415
  });
  expect(emittedTicks[5]).toMatchObject({
    header: 'small',
    compressed: true,
    compressedLength: 56,
    payloadLength: 62
  });
  expect(emittedTicks).toEqual(expectedTicks.map(expectedPublicTick));
});
