import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const browserRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = resolve(browserRoot, '..');
const harnessOutput = resolve(browserRoot, 'dist/wasm-net-shim-harness.mjs');
const fixturePayload = [0x00, 0xff, 0x41, 0x0a, 0x80, 0x7f];

function findEmcc() {
  const candidates = [];
  if (process.env.ASTONIA_EMSDK_ROOT) {
    candidates.push(resolve(process.env.ASTONIA_EMSDK_ROOT, 'upstream/emscripten/emcc'));
  }
  candidates.push(resolve(repoRoot, '.deps/emsdk/upstream/emscripten/emcc'));
  candidates.push('emcc');

  for (const candidate of candidates) {
    if (candidate.includes('/') && !existsSync(candidate)) {
      continue;
    }

    const result = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (result.status === 0) {
      return candidate;
    }
  }

  return null;
}

function buildHarness(emcc) {
  const args = [
    '-std=c99',
    '-O2',
    '-Wall',
    '-Wextra',
    '-Wpedantic',
    '-Werror',
    '-Iinclude',
    'tests/wasm_net_shim_harness.c',
    'src/wasm/astonia_net_wasm.c',
    '--js-library',
    'src/wasm/astonia_net_jslib.js',
    '--no-entry',
    '-sENVIRONMENT=web',
    '-sMODULARIZE=1',
    '-sEXPORT_ES6=1',
    '-sEXPORT_NAME=createWasmNetShimHarness',
    '-sALLOW_MEMORY_GROWTH=1',
    '-sNO_EXIT_RUNTIME=1',
    "-sEXPORTED_FUNCTIONS=['_wasm_net_harness_connect','_wasm_net_harness_poll','_wasm_net_harness_send_fixture','_wasm_net_harness_recv_reply_fixture','_wasm_net_harness_ipv4_placeholders_ok','_wasm_net_harness_close']",
    "-sEXPORTED_RUNTIME_METHODS=['ccall']",
    '-o',
    harnessOutput
  ];

  const result = spawnSync(emcc, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: emcc.includes('/')
      ? { ...process.env, ASTONIA_EMSDK_ROOT: dirname(dirname(dirname(emcc))) }
      : process.env
  });

  if (result.status !== 0) {
    throw new Error(`emcc failed\n${result.stdout}\n${result.stderr}`);
  }
}

function websocketAccept(key) {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function encodeServerFrame(payload, opcode = 2) {
  const body = Buffer.from(payload);
  if (body.length < 126) {
    return Buffer.concat([Buffer.from([0x80 | opcode, body.length]), body]);
  }

  if (body.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }

  throw new Error('test frame too large');
}

function decodeClientFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      length = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      throw new Error('test harness does not accept 64-bit WebSocket frames');
    }

    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (buffer.length - offset < frameLength) {
      break;
    }

    const maskStart = offset + headerLength;
    const dataStart = maskStart + maskLength;
    const payload = Buffer.from(buffer.subarray(dataStart, dataStart + length));
    if (masked) {
      const mask = buffer.subarray(maskStart, maskStart + 4);
      for (let i = 0; i < payload.length; i++) {
        payload[i] ^= mask[i % 4];
      }
    }

    frames.push({ opcode, payload });
    offset += frameLength;
  }

  return { frames, rest: Buffer.from(buffer.subarray(offset)) };
}

async function startWebSocketByteServer() {
  const requests = [];
  const received = [];
  const waiters = [];
  const connections = [];
  const server = createServer();

  function publishReceived(payload) {
    received.push(Array.from(payload));
    while (waiters.length > 0) {
      waiters.shift()();
    }
  }

  server.on('upgrade', (req, socket) => {
    requests.push(req.url);
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${websocketAccept(req.headers['sec-websocket-key'])}`,
        '',
        ''
      ].join('\r\n')
    );

    const connection = {
      socket,
      sendBinary(payload) {
        socket.write(encodeServerFrame(payload));
      },
      close() {
        if (!socket.destroyed) {
          socket.write(encodeServerFrame([], 8));
          socket.end();
        }
      }
    };
    connection.closed = new Promise((resolveClosed) => {
      socket.on('close', resolveClosed);
      socket.on('end', resolveClosed);
    });
    connections.push(connection);

    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      const decoded = decodeClientFrames(buffered);
      buffered = decoded.rest;

      for (const frame of decoded.frames) {
        if (frame.opcode === 2) {
          publishReceived(frame.payload);
        } else if (frame.opcode === 8) {
          socket.end();
        }
      }
    });
  });

  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();

  return {
    url: `ws://127.0.0.1:${address.port}/gateway?existing=1`,
    requests,
    received,
    connections,
    async waitForReceived(index = 0) {
      while (received.length <= index) {
        await new Promise((resolveWaiter) => waiters.push(resolveWaiter));
      }
      return received[index];
    },
    async close() {
      for (const connection of connections) {
        connection.close();
      }
      await new Promise((resolveClose) => server.close(resolveClose));
    }
  };
}

async function loadHarness(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const imported = await import(`/dist/wasm-net-shim-harness.mjs?t=${Date.now()}`);
    const createModule = imported.default ?? imported.createWasmNetShimHarness;
    window.netHarness = await createModule({
      locateFile(path) {
        return `/dist/${path}`;
      }
    });
  });
}

async function waitForHarnessPoll(page, mask, predicate) {
  const deadline = Date.now() + 3000;
  let value = 0;

  while (Date.now() < deadline) {
    value = await page.evaluate((pollMask) => window.netHarness._wasm_net_harness_poll(pollMask), mask);
    if (predicate(value)) {
      return value;
    }
    await page.waitForTimeout(25);
  }

  throw new Error(`timed out waiting for poll(${mask}), last value ${value}`);
}

async function connectHarness(page, url, port) {
  const connected = await page.evaluate(
    ({ gatewayUrl, targetPort }) =>
      window.netHarness.ccall(
        'wasm_net_harness_connect',
        'number',
        ['string', 'number'],
        [gatewayUrl, targetPort]
      ),
    { gatewayUrl: url, targetPort: port }
  );
  expect(connected).toBe(1);
  await waitForHarnessPoll(page, 2, (value) => (value & 2) === 2);
}

const emcc = findEmcc();

test.describe('WASM astonia_net browser shim', () => {
  test.skip(!emcc, 'Emscripten is required for the focused WASM network shim harness');

  test.beforeAll(() => {
    buildHarness(emcc);
  });

  test('connects, polls, sends, receives, exposes safe IPv4 placeholders, and closes', async ({ page }) => {
    const server = await startWebSocketByteServer();
    try {
      await loadHarness(page);
      await connectHarness(page, server.url, 5557);

      expect(await page.evaluate(() => window.netHarness._wasm_net_harness_ipv4_placeholders_ok())).toBe(1);

      expect(await page.evaluate(() => window.netHarness._wasm_net_harness_send_fixture())).toBe(
        fixturePayload.length
      );
      await expect(server.waitForReceived()).resolves.toEqual(fixturePayload);

      server.connections[0].sendBinary([0x13, 0x00, 0xfe, 0x20, 0x99]);
      await waitForHarnessPoll(page, 1, (value) => (value & 1) === 1);
      expect(await page.evaluate(() => window.netHarness._wasm_net_harness_recv_reply_fixture())).toBe(5);

      await page.evaluate(() => window.netHarness._wasm_net_harness_close());
      await server.connections[0].closed;

      const requestUrl = new URL(server.requests[0], 'ws://shim.test');
      expect(requestUrl.searchParams.get('existing')).toBe('1');
      expect(requestUrl.searchParams.get('target-port')).toBe('5557');
    } finally {
      await server.close();
    }
  });

  test('reports failed WebSocket connects through poll', async ({ page }) => {
    const unused = createServer();
    await new Promise((resolveListen) => unused.listen(0, '127.0.0.1', resolveListen));
    const unusedPort = unused.address().port;
    await new Promise((resolveClose) => unused.close(resolveClose));

    await loadHarness(page);
    const connected = await page.evaluate(
      (gatewayUrl) =>
        window.netHarness.ccall(
          'wasm_net_harness_connect',
          'number',
          ['string', 'number'],
          [gatewayUrl, 5556]
        ),
      `ws://127.0.0.1:${unusedPort}/gateway`
    );
    expect(connected).toBe(1);

    await waitForHarnessPoll(page, 2, (value) => value === -1);
  });

  test('retargets reconnects by replacing target-port while preserving raw bytes', async ({ page }) => {
    const server = await startWebSocketByteServer();
    try {
      await loadHarness(page);

      await connectHarness(page, server.url, 5556);
      expect(await page.evaluate(() => window.netHarness._wasm_net_harness_send_fixture())).toBe(
        fixturePayload.length
      );
      await expect(server.waitForReceived(0)).resolves.toEqual(fixturePayload);
      await page.evaluate(() => window.netHarness._wasm_net_harness_close());
      await server.connections[0].closed;

      await connectHarness(page, server.url, 5590);
      expect(await page.evaluate(() => window.netHarness._wasm_net_harness_send_fixture())).toBe(
        fixturePayload.length
      );
      await expect(server.waitForReceived(1)).resolves.toEqual(fixturePayload);
      await page.evaluate(() => window.netHarness._wasm_net_harness_close());
      await server.connections[1].closed;

      expect(
        server.requests.map((request) =>
          new URL(request, 'ws://shim.test').searchParams.get('target-port')
        )
      ).toEqual(['5556', '5590']);
    } finally {
      await server.close();
    }
  });
});
