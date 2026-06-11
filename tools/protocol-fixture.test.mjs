import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const execFileAsync = promisify(execFile);

test('check validates a fixture through the public command', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['tools/protocol-fixture.mjs', 'check', 'fixtures/protocol/tiny-login-tick'],
    { cwd: new URL('..', import.meta.url) },
  );

  assert.match(stdout, /fixture ok: tiny-login-tick/);
  assert.match(stdout, /raw frames: 3/);
  assert.match(stdout, /ticks: 1/);
});

test('check validates post-inflate tick payloads', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['tools/protocol-fixture.mjs', 'check', 'fixtures/protocol/compressed-login-tick'],
    { cwd: new URL('..', import.meta.url) },
  );

  assert.match(stdout, /fixture ok: compressed-login-tick/);
  assert.match(stdout, /raw frames: 1/);
  assert.match(stdout, /ticks: 1/);
});

test('capture writes a checkable gateway fixture', async (t) => {
  const server = await startWebSocketFixtureServer(Buffer.from([0x43, 0x35, 0x03, 0x2b]));
  t.after(() => server.close());

  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'astonia-protocol-fixture-'));
  t.after(() => rm(fixtureDir, { recursive: true, force: true }));

  const { stdout } = await execFileAsync(
    process.execPath,
    [
      'tools/protocol-fixture.mjs',
      'capture',
      fixtureDir,
      '--gateway',
      server.url,
      '--target-port',
      '5556',
      '--server-commit',
      'test-server-commit',
      '--username',
      'FixtureCapture',
      '--password',
      'fixturecapture',
      '--duration-ms',
      '500',
      '--max-ticks',
      '1',
      '--fixture-name',
      'capture-command-test',
    ],
    { cwd: new URL('..', import.meta.url) },
  );

  assert.match(stdout, /fixture captured: capture-command-test/);
  assert(server.receivedPayloads.length >= 4);

  const manifest = JSON.parse(await readFile(path.join(fixtureDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.server_commit, 'test-server-commit');
  assert.equal(manifest.protocol_version, 3);
  assert.equal(manifest.target_port, 5556);
  assert.match(manifest.capture_command, /^node tools\/protocol-fixture\.mjs capture /);
  assert.doesNotMatch(manifest.capture_command, /\/home\/|mise|\.local\/share/);
  assert.equal(manifest.account.password, '<redacted>');

  const check = await execFileAsync(
    process.execPath,
    ['tools/protocol-fixture.mjs', 'check', fixtureDir],
    { cwd: new URL('..', import.meta.url) },
  );
  assert.match(check.stdout, /fixture ok: capture-command-test/);
  assert.match(check.stdout, /ticks: 1/);
});

test('capture rejects failed-login server responses', async (t) => {
  const failedLoginTick = Buffer.from(
    'XgkbAFVzZXJuYW1lIG9yIHBhc3N3b3JkIHdyb25nLg==',
    'base64',
  );
  const server = await startWebSocketFixtureServer(failedLoginTick);
  t.after(() => server.close());

  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), 'astonia-protocol-fixture-'));
  t.after(() => rm(fixtureDir, { recursive: true, force: true }));

  await assert.rejects(
    execFileAsync(
      process.execPath,
      [
        'tools/protocol-fixture.mjs',
        'capture',
        fixtureDir,
        '--gateway',
        server.url,
        '--target-port',
        '5556',
        '--server-commit',
        'test-server-commit',
        '--username',
        'FixtureCapture',
        '--password',
        'wrong_password',
        '--duration-ms',
        '500',
        '--max-ticks',
        '1',
        '--fixture-name',
        'failed-login-test',
      ],
      { cwd: new URL('..', import.meta.url) },
    ),
    /capture reached failed login response/,
  );
});

async function startWebSocketFixtureServer(inboundPayload) {
  const receivedPayloads = [];
  const server = net.createServer((socket) => {
    let upgraded = false;
    let buffer = Buffer.alloc(0);
    let sentFixturePayload = false;

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      if (!upgraded) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }

        const header = buffer.subarray(0, headerEnd).toString('latin1');
        const key = /^Sec-WebSocket-Key: (.+)$/im.exec(header)?.[1]?.trim();
        assert(key);
        socket.write(
          [
            'HTTP/1.1 101 Switching Protocols',
            'Upgrade: websocket',
            'Connection: Upgrade',
            `Sec-WebSocket-Accept: ${webSocketAccept(key)}`,
            '',
            '',
          ].join('\r\n'),
        );

        buffer = buffer.subarray(headerEnd + 4);
        upgraded = true;
      }

      const parsed = readClientFrames(buffer);
      buffer = parsed.remaining;
      for (const payload of parsed.payloads) {
        receivedPayloads.push(payload);
      }
      if (parsed.closeReceived) {
        socket.write(Buffer.from([0x88, 0x00]));
        socket.end();
        return;
      }

      if (!sentFixturePayload && receivedPayloads.length > 0) {
        socket.write(writeServerBinaryFrame(inboundPayload));
        sentFixturePayload = true;
      }
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  return {
    receivedPayloads,
    url: `ws://127.0.0.1:${port}`,
    close: () => server.close(),
  };
}

function webSocketAccept(key) {
  return createHash('sha1')
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest('base64');
}

function readClientFrames(input) {
  const payloads = [];
  let closeReceived = false;
  let offset = 0;

  while (input.length - offset >= 2) {
    const first = input[offset];
    const second = input[offset + 1];
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (input.length - offset < 4) {
        break;
      }
      length = input.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      throw new Error('test server does not support 64-bit websocket payload lengths');
    }

    const masked = (second & 0x80) !== 0;
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (input.length - offset < frameLength) {
      break;
    }

    const opcode = first & 0x0f;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(input.subarray(payloadStart, payloadStart + length));

    if (masked) {
      const mask = input.subarray(offset + headerLength, offset + headerLength + 4);
      for (let i = 0; i < payload.length; i += 1) {
        payload[i] ^= mask[i % 4];
      }
    }

    if (opcode === 0x1 || opcode === 0x2) {
      payloads.push(payload);
    } else if (opcode === 0x8) {
      closeReceived = true;
    }

    offset += frameLength;
  }

  return {
    closeReceived,
    payloads,
    remaining: input.subarray(offset),
  };
}

function writeServerBinaryFrame(payload) {
  assert(payload.length < 126);
  return Buffer.concat([Buffer.from([0x82, payload.length]), payload]);
}
