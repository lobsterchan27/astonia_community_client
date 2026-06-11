import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { constants as zlibConstants, inflateSync } from 'node:zlib';

const execFileAsync = promisify(execFile);

const REQUIRED_METADATA_FIELDS = [
  'protocol_version',
  'target_port',
  'server_commit',
  'client_commit',
  'capture_command',
];

async function main() {
  const [command, ...args] = process.argv.slice(2);

  try {
    if (command === 'check') {
      const fixtureDir = requireArg(args[0], 'fixture directory');
      const summary = await checkFixture(fixtureDir);
      console.log(`fixture ok: ${summary.fixtureName}`);
      console.log(`raw frames: ${summary.rawFrameCount}`);
      console.log(`ticks: ${summary.tickCount}`);
      console.log(`inbound bytes: ${summary.inboundBytes}`);
      console.log(`outbound bytes: ${summary.outboundBytes}`);
      return;
    }

    if (command === 'capture') {
      const { positionals, flags } = parseArgs(args);
      const fixtureDir = requireArg(positionals[0], 'fixture directory');
      const summary = await captureFixture(fixtureDir, flags);
      console.log(`fixture captured: ${summary.fixtureName}`);
      console.log(`raw frames: ${summary.rawFrameCount}`);
      console.log(`ticks: ${summary.tickCount}`);
      console.log(`inbound bytes: ${summary.inboundBytes}`);
      console.log(`outbound bytes: ${summary.outboundBytes}`);
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (error) {
    console.error(`error: ${error.message}`);
    process.exitCode = 1;
  }
}

async function checkFixture(fixtureDir) {
  const manifestPath = path.join(fixtureDir, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  validateManifest(manifest, manifestPath);

  const rawStreamPath = path.join(fixtureDir, manifest.artifacts.raw_stream);
  const tickPath = path.join(fixtureDir, manifest.artifacts.ticks);
  const rawFrames = await readNdjson(rawStreamPath);
  const expectedTicks = await readNdjson(tickPath);

  const parsedTicks = parseInboundTicks(rawFrames);
  compareTickArtifacts(parsedTicks, expectedTicks, tickPath);

  const inboundBytes = rawFrames
    .filter((frame) => frame.direction === 'inbound')
    .reduce((total, frame) => total + decodeData(frame).length, 0);
  const outboundBytes = rawFrames
    .filter((frame) => frame.direction === 'outbound')
    .reduce((total, frame) => total + decodeData(frame).length, 0);

  return {
    fixtureName: manifest.fixture_name ?? path.basename(fixtureDir),
    rawFrameCount: rawFrames.length,
    tickCount: parsedTicks.length,
    inboundBytes,
    outboundBytes,
  };
}

async function captureFixture(fixtureDir, flags) {
  const options = await captureOptions(fixtureDir, flags);
  const rawFrames = [];
  const startedAt = Date.now();
  let capturedTicks = [];
  let finished = false;
  let websocket;

  await mkdir(fixtureDir, { recursive: true });

  try {
    websocket = new WebSocket(options.gatewayUrl);
    websocket.binaryType = 'arraybuffer';

    await waitForWebSocketOpen(websocket);

    const finish = () => {
      if (!finished) {
        finished = true;
        websocket.close();
      }
    };

    websocket.addEventListener('message', async (event) => {
      try {
        const data = await webSocketDataToBuffer(event.data);
        pushRawFrame(rawFrames, 'inbound', startedAt, data, options);
        capturedTicks = parseInboundTicks(rawFrames, { allowTrailing: true });
        if (capturedTicks.length >= options.maxTicks) {
          finish();
        }
      } catch (error) {
        finished = true;
        websocket.close();
        throw error;
      }
    });

    for (const frame of buildLoginFrames(options)) {
      pushRawFrame(rawFrames, 'outbound', startedAt, frame, options);
      websocket.send(frame);
    }

    await waitForCaptureEnd(websocket, options.durationMs, () => finished);
  } finally {
    if (websocket && websocket.readyState < WebSocket.CLOSING) {
      websocket.close();
    }
  }

  capturedTicks = parseInboundTicks(rawFrames);
  if (capturedTicks.length === 0) {
    throw new Error('capture finished without any complete inbound ticks');
  }
  assertNoFailedLogin(capturedTicks);
  const manifest = buildManifest(options, rawFrames, capturedTicks);

  await writeJson(path.join(fixtureDir, 'manifest.json'), manifest);
  await writeNdjson(path.join(fixtureDir, 'raw-stream.ndjson'), rawFrames);
  await writeNdjson(path.join(fixtureDir, 'ticks.ndjson'), capturedTicks);

  return checkFixture(fixtureDir);
}

async function captureOptions(fixtureDir, flags) {
  const targetPort = numberFlag(flags, 'target-port', 5556);
  const durationMs = numberFlag(flags, 'duration-ms', 3000);
  const maxTicks = numberFlag(flags, 'max-ticks', 8);
  const maxFrames = numberFlag(flags, 'max-frames', 256);
  const maxBytes = numberFlag(flags, 'max-bytes', 1024 * 1024);
  const gatewayUrl = stringFlag(flags, 'gateway', 'ws://127.0.0.1:8787');
  const username = stringFlag(flags, 'username', process.env.ASTONIA_CAPTURE_USERNAME ?? 'FixtureCapture');
  const password = stringFlag(flags, 'password', process.env.ASTONIA_CAPTURE_PASSWORD ?? 'fixturecapture');
  const fixtureName = stringFlag(flags, 'fixture-name', path.basename(fixtureDir));

  validateAsciiBounded(username, 39, 'username');
  validateAsciiBounded(password, 15, 'password');

  return {
    fixtureDir,
    fixtureName,
    captureKind: stringFlag(flags, 'capture-kind', 'live'),
    gatewayUrl,
    protocolVersion: numberFlag(flags, 'protocol-version', 3),
    targetHost: stringFlag(flags, 'target-host', '127.0.0.1'),
    targetPort,
    serverCommit: stringFlag(flags, 'server-commit', process.env.ASTONIA_SERVER_COMMIT ?? 'unknown'),
    clientCommit: stringFlag(flags, 'client-commit', await gitHead()),
    username,
    password,
    character: stringFlag(flags, 'character', username),
    durationMs,
    maxTicks,
    maxFrames,
    maxBytes,
    captureCommand: sanitizedCaptureCommand(process.argv),
  };
}

function buildManifest(options, rawFrames, ticks) {
  return {
    schema_version: 1,
    fixture_name: options.fixtureName,
    capture_kind: options.captureKind,
    protocol_version: options.protocolVersion,
    target_host: options.targetHost,
    target_port: options.targetPort,
    gateway_url: options.gatewayUrl,
    server_commit: options.serverCommit,
    client_commit: options.clientCommit,
    capture_command: options.captureCommand,
    created_at: new Date().toISOString(),
    account: {
      username: options.username,
      character: options.character,
      password: '<redacted>',
    },
    limits: {
      duration_ms: options.durationMs,
      max_ticks: options.maxTicks,
      max_frames: options.maxFrames,
      max_bytes: options.maxBytes,
    },
    summary: {
      raw_frames: rawFrames.length,
      ticks: ticks.length,
      inbound_bytes: sumBytes(rawFrames, 'inbound'),
      outbound_bytes: sumBytes(rawFrames, 'outbound'),
    },
    artifacts: {
      raw_stream: 'raw-stream.ndjson',
      ticks: 'ticks.ndjson',
    },
  };
}

function validateManifest(manifest, manifestPath) {
  if (manifest.schema_version !== 1) {
    throw new Error(`${manifestPath}: expected schema_version 1`);
  }

  for (const field of REQUIRED_METADATA_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === '') {
      throw new Error(`${manifestPath}: missing metadata field ${field}`);
    }
  }

  if (!manifest.artifacts?.raw_stream || !manifest.artifacts?.ticks) {
    throw new Error(`${manifestPath}: artifacts.raw_stream and artifacts.ticks are required`);
  }
}

async function readNdjson(filePath) {
  const text = await readFile(filePath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, lineIndex) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${filePath}:${lineIndex + 1}: invalid JSON: ${error.message}`);
      }
    });
}

function parseInboundTicks(rawFrames, options = {}) {
  let stream = Buffer.alloc(0);
  let streamOffset = 0;
  const pendingFrameIndexes = [];
  const ticks = [];
  const compressedHistory = [];
  let inflatedHistoryLength = 0;

  for (const frame of rawFrames) {
    validateRawFrame(frame);

    if (frame.direction !== 'inbound') {
      continue;
    }

    const data = decodeData(frame);
    if (data.length === 0) {
      continue;
    }

    stream = Buffer.concat([stream, data]);
    pendingFrameIndexes.push(frame.index);

    while (stream.length > 0) {
      const tickHeader = readTickHeader(stream);
      if (!tickHeader) {
        break;
      }

      const rawTick = stream.subarray(0, tickHeader.totalLength);
      const framedPayload = rawTick.subarray(tickHeader.headerLength);
      let payload = framedPayload;
      if (tickHeader.compressed) {
        compressedHistory.push(Buffer.from(framedPayload));
        const inflatedHistory = inflateSync(Buffer.concat(compressedHistory), {
          finishFlush: zlibConstants.Z_SYNC_FLUSH,
        });
        payload = inflatedHistory.subarray(inflatedHistoryLength);
        inflatedHistoryLength = inflatedHistory.length;
      }

      ticks.push({
        index: ticks.length,
        direction: 'inbound',
        first_frame_index: pendingFrameIndexes[0],
        last_frame_index: pendingFrameIndexes[pendingFrameIndexes.length - 1],
        stream_offset: streamOffset,
        header: tickHeader.header,
        compressed: tickHeader.compressed,
        raw_length: rawTick.length,
        compressed_length: tickHeader.compressed ? framedPayload.length : undefined,
        payload_length: payload.length,
        encoding: 'base64',
        data: payload.toString('base64'),
      });

      stream = stream.subarray(tickHeader.totalLength);
      streamOffset += tickHeader.totalLength;
      pendingFrameIndexes.length = stream.length > 0 ? pendingFrameIndexes.length : 0;
    }
  }

  if (stream.length > 0 && !options.allowTrailing) {
    throw new Error(`inbound stream ended with ${stream.length} unparsed byte(s)`);
  }

  return ticks;
}

function readTickHeader(stream) {
  if (stream.length >= 2 && stream[0] === 0xff && stream[1] === 0xff) {
    if (stream.length < 4) {
      return null;
    }
    const payloadLength = stream.readUInt16BE(2);
    const totalLength = 4 + payloadLength;
    if (stream.length < totalLength) {
      return null;
    }
    return {
      header: 'big',
      compressed: false,
      headerLength: 4,
      totalLength,
    };
  }

  if (stream.length === 1 && stream[0] === 0xff) {
    return null;
  }

  if (stream.length >= 1 && (stream[0] & 0x40) !== 0) {
    const payloadLength = stream[0] & 0x3f;
    const totalLength = 1 + payloadLength;
    if (stream.length < totalLength) {
      return null;
    }
    return {
      header: 'small',
      compressed: (stream[0] & 0x80) !== 0,
      headerLength: 1,
      totalLength,
    };
  }

  if (stream.length < 2) {
    return null;
  }

  const payloadLength = stream.readUInt16BE(0) & 0x3fff;
  const totalLength = 2 + payloadLength;
  if (stream.length < totalLength) {
    return null;
  }

  return {
    header: 'normal',
    compressed: (stream[0] & 0x80) !== 0,
    headerLength: 2,
    totalLength,
  };
}

function compareTickArtifacts(parsedTicks, expectedTicks, tickPath) {
  if (parsedTicks.length !== expectedTicks.length) {
    throw new Error(
      `${tickPath}: expected ${expectedTicks.length} tick artifact(s), parsed ${parsedTicks.length}`,
    );
  }

  for (let index = 0; index < parsedTicks.length; index += 1) {
    const parsed = parsedTicks[index];
    const expected = expectedTicks[index];

    for (const field of [
      'direction',
      'stream_offset',
      'header',
      'compressed',
      'raw_length',
      'compressed_length',
      'payload_length',
      'data',
    ]) {
      if (expected[field] !== undefined && parsed[field] !== expected[field]) {
        throw new Error(
          `${tickPath}: tick ${index} ${field} mismatch; expected ${expected[field]}, parsed ${parsed[field]}`,
        );
      }
    }
  }
}

function assertNoFailedLogin(ticks) {
  for (const tick of ticks) {
    const payload = Buffer.from(tick.data, 'base64').toString('utf8');
    if (payload.includes('Username or password wrong.')) {
      throw new Error('capture reached failed login response; check fixture account setup');
    }
  }
}

function validateRawFrame(frame) {
  if (!Number.isInteger(frame.index) || frame.index < 0) {
    throw new Error('raw stream frame is missing a non-negative integer index');
  }
  if (frame.direction !== 'inbound' && frame.direction !== 'outbound') {
    throw new Error(`raw stream frame ${frame.index}: direction must be inbound or outbound`);
  }
}

function buildLoginFrames(options) {
  const username = Buffer.alloc(40);
  username.write(options.username, 0, 'ascii');

  const password = Buffer.alloc(17);
  password.write(options.password, 0, 'ascii');
  encryptPassword(options.username, password);

  const magic = Buffer.alloc(4);
  magic.writeUInt32LE((0x8fd46100 | options.protocolVersion) >>> 0, 0);

  return [username, password.subarray(0, 16), magic, Buffer.alloc(12)];
}

function encryptPassword(username, password) {
  const secret = [
    Buffer.from('\0cgf\0de8etzdf\0dx', 'binary'),
    Buffer.from('jrfa\0v7d\0drt\0edm', 'binary'),
    Buffer.from('t6zh\0dlr\0fu4dms\0', 'binary'),
    Buffer.from('jkdm\0u7z5g\0j77\0g', 'binary'),
  ];
  const name = Buffer.from(username, 'ascii');
  const key = secret[name[1] % 4];

  for (let i = 0; i < password.length; i += 1) {
    password[i] = password[i] ^ key[i] ^ name[i % 3];
  }
}

function pushRawFrame(rawFrames, direction, startedAt, data, options) {
  if (rawFrames.length >= options.maxFrames) {
    throw new Error(`capture exceeded max frame count ${options.maxFrames}`);
  }

  const usedBytes = rawFrames.reduce((total, frame) => total + decodeData(frame).length, 0);
  if (usedBytes + data.length > options.maxBytes) {
    throw new Error(`capture exceeded max byte count ${options.maxBytes}`);
  }

  rawFrames.push({
    index: rawFrames.length,
    direction,
    time_ms: Date.now() - startedAt,
    encoding: 'base64',
    data: Buffer.from(data).toString('base64'),
  });
}

function decodeData(record) {
  if (record.encoding !== 'base64') {
    throw new Error(`record ${record.index ?? '<unknown>'}: only base64 encoding is supported`);
  }
  return Buffer.from(record.data, 'base64');
}

async function waitForWebSocketOpen(websocket) {
  if (websocket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('failed to open gateway websocket'));
    };
    const cleanup = () => {
      websocket.removeEventListener('open', onOpen);
      websocket.removeEventListener('error', onError);
    };
    websocket.addEventListener('open', onOpen);
    websocket.addEventListener('error', onError);
  });
}

async function waitForCaptureEnd(websocket, durationMs, isFinished) {
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      websocket.close();
      resolve();
    }, durationMs);
    const interval = setInterval(() => {
      if (isFinished()) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve();
      }
    }, 5);
    websocket.addEventListener('close', () => {
      clearTimeout(timer);
      clearInterval(interval);
      resolve();
    });
  });
}

async function webSocketDataToBuffer(data) {
  if (Buffer.isBuffer(data)) {
    return Buffer.from(data);
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data);
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  if (typeof data === 'string') {
    return Buffer.from(data, 'utf8');
  }
  throw new Error(`unsupported websocket message type ${typeof data}`);
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeNdjson(filePath, records) {
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join('\n')}\n`);
}

function parseArgs(args) {
  const positionals = [];
  const flags = new Map();

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split('=', 2);
    if (!rawName) {
      throw new Error(`invalid flag ${arg}`);
    }

    const value =
      inlineValue !== undefined
        ? inlineValue
        : requireArg(args[(index += 1)], `value for --${rawName}`);
    flags.set(rawName, value);
  }

  return { positionals, flags };
}

function stringFlag(flags, name, defaultValue) {
  return flags.has(name) ? flags.get(name) : defaultValue;
}

function numberFlag(flags, name, defaultValue) {
  const value = stringFlag(flags, name, String(defaultValue));
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }
  return parsed;
}

function validateAsciiBounded(value, maxLength, fieldName) {
  if (!/^[\x20-\x7e]*$/.test(value)) {
    throw new Error(`${fieldName} must be printable ASCII`);
  }
  if (Buffer.byteLength(value, 'ascii') > maxLength) {
    throw new Error(`${fieldName} must be at most ${maxLength} byte(s)`);
  }
}

async function gitHead() {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD']);
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

function sanitizedCaptureCommand(argv) {
  const out = ['node', 'tools/protocol-fixture.mjs', ...argv.slice(2)];
  for (let index = 0; index < out.length; index += 1) {
    if (out[index] === '--password' && index + 1 < out.length) {
      out[index + 1] = '<redacted>';
    } else if (out[index].startsWith('--password=')) {
      out[index] = '--password=<redacted>';
    }
  }
  return out.join(' ');
}

function sumBytes(rawFrames, direction) {
  return rawFrames
    .filter((frame) => frame.direction === direction)
    .reduce((total, frame) => total + decodeData(frame).length, 0);
}

function requireArg(value, name) {
  if (!value) {
    throw new Error(`missing ${name}`);
  }
  return value;
}

function printUsage() {
  console.log(`Usage:
  node tools/protocol-fixture.mjs check FIXTURE_DIR
  node tools/protocol-fixture.mjs capture FIXTURE_DIR [--gateway ws://127.0.0.1:8787] [--target-port 5556] [--server-commit COMMIT] [--username FixtureCapture] [--password fixturecapture]`);
}

await main();
