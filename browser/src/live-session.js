import { createAstoniaRenderList } from './render/render-list.js';
import { AstoniaProtocolStateReplay } from './protocol/state-replay.js';
import { AstoniaTickStreamDecoder } from './protocol/tick-stream-decoder.js';
import { buildAstoniaLoginFrames } from './protocol/login.js';
import { encodeAstoniaMoveCommand } from './protocol/move-command.js';

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:8787';

export class AstoniaLiveSession extends EventTarget {
  #webSocketFactory;
  #decoderFactory;
  #replayFactory;
  #decoder;
  #replay;
  #socket;
  #messageQueue;
  #state;

  constructor(options = {}) {
    super();
    this.#webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.#decoderFactory = options.decoderFactory ?? (() => new AstoniaTickStreamDecoder());
    this.#replayFactory = options.replayFactory ?? (() => new AstoniaProtocolStateReplay(options.replayOptions));
    this.#decoder = null;
    this.#replay = null;
    this.#socket = null;
    this.#messageQueue = Promise.resolve();
    this.#state = initialState();
  }

  get state() {
    return cloneState(this.#state);
  }

  connect(options = {}) {
    if (this.#socket && this.#socket.readyState < WebSocket.CLOSING) {
      this.close();
    }

    const gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY_URL;
    this.#decoder = this.#decoderFactory();
    this.#replay = this.#replayFactory();
    this.#messageQueue = Promise.resolve();
    this.#state = {
      ...initialState(),
      gatewayUrl,
      status: 'connecting',
      statusDetail: `Opening ${gatewayUrl}`
    };
    this.#emitChange();

    const socket = this.#webSocketFactory(gatewayUrl);
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      try {
        const frames = buildAstoniaLoginFrames(options);
        for (const frame of frames) {
          socket.send(frame);
          this.#state.outboundFrames += 1;
          this.#state.outboundBytes += frame.byteLength;
        }

        this.#state.status = 'login-sent';
        this.#state.statusDetail = 'Login bytes sent; waiting for server ticks.';
        this.#emitChange();
      } catch (error) {
        this.#fail(error, socket);
        socket.close();
      }
    });

    socket.addEventListener('message', (event) => {
      const queued = this.#messageQueue.then(() => this.#receiveMessage(event.data, socket));
      this.#messageQueue = queued.catch(() => {});
    });

    socket.addEventListener('error', () => {
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      this.#state.status = 'error';
      this.#state.statusDetail = 'Gateway WebSocket reported an error.';
      this.#emitChange();
    });

    socket.addEventListener('close', () => {
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      if (this.#state.status !== 'error') {
        this.#state.status = this.#state.decodedTicks > 0 ? 'closed' : 'closed-before-ticks';
        this.#state.statusDetail = 'Gateway WebSocket closed.';
        this.#emitChange();
      }
    });
  }

  close() {
    this.#socket?.close();
    this.#socket = null;
  }

  moveToTile(target) {
    const frame = encodeAstoniaMoveCommand(target);
    const commandState = {
      type: 'CL_MOVE',
      x: target.x,
      y: target.y,
      bytes: Array.from(frame),
      status: 'not-sent',
      sentAfterDecodedTicks: this.#state.decodedTicks,
      outboundFrame: this.#state.outboundFrames + 1,
      reason: null
    };

    if (!this.#socket || this.#socket.readyState !== 1) {
      commandState.reason = 'Gateway WebSocket is not open.';
      this.#state.lastMoveCommand = commandState;
      this.#emitChange();
      return false;
    }

    this.#socket.send(frame);
    this.#state.outboundFrames += 1;
    this.#state.outboundBytes += frame.byteLength;
    commandState.status = 'sent';
    this.#state.lastMoveCommand = commandState;
    this.#state.statusDetail = `Sent CL_MOVE to ${target.x},${target.y}; waiting for server-authoritative ticks.`;
    this.#emitChange();
    return true;
  }

  async #receiveMessage(data, socket) {
    try {
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      const bytes = await webSocketDataToBytes(data);
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      this.#state.inboundFrames += 1;
      this.#state.inboundBytes += bytes.byteLength;

      const decoder = this.#decoder;
      const replay = this.#replay;
      if (!decoder || !replay) {
        return;
      }

      const ticks = await decoder.pushChunk(bytes);
      if (!this.#isCurrentSocket(socket) || decoder !== this.#decoder || replay !== this.#replay) {
        return;
      }

      for (const tick of ticks) {
        const tickIndex = this.#state.decodedTicks;
        replay.replayTick(tick, { tickIndex });
        this.#state.decodedTicks += 1;
        this.#state.lastRawTickBytes = tick.rawLength;
      }

      this.#state.snapshot = replay.snapshot();
      this.#state.renderList = createAstoniaRenderList(this.#state.snapshot);
      if (ticks.length > 0) {
        this.#state.lastReceivedTick = {
          decodedTicks: this.#state.decodedTicks,
          currentTick: this.#state.snapshot.currentTick ?? null,
          rawBytes: ticks.at(-1).rawLength
        };
        this.#state.lastVisibleUpdate = {
          decodedTicks: this.#state.decodedTicks,
          currentTick: this.#state.snapshot.currentTick ?? null,
          playerPosition: clonePoint(this.#state.snapshot.player?.position)
        };
      }
      this.#state.status = this.#state.snapshot.login.done ? 'live' : 'receiving';
      this.#state.statusDetail =
        ticks.length > 0 ? `Decoded ${ticks.length} tick(s) from the latest gateway frame.` : 'Received gateway bytes; waiting for a full tick.';
      this.#emitChange();
    } catch (error) {
      this.#fail(error, socket);
    }
  }

  #fail(error, socket) {
    if (socket && !this.#isCurrentSocket(socket)) {
      return;
    }

    this.#state.status = 'error';
    this.#state.statusDetail = error instanceof Error ? error.message : String(error);
    this.#emitChange();
  }

  #isCurrentSocket(socket) {
    return socket === this.#socket;
  }

  #emitChange() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state }));
  }
}

function initialState() {
  return {
    status: 'idle',
    statusDetail: 'Not connected.',
    gatewayUrl: DEFAULT_GATEWAY_URL,
    inboundFrames: 0,
    inboundBytes: 0,
    outboundFrames: 0,
    outboundBytes: 0,
    decodedTicks: 0,
    lastRawTickBytes: 0,
    snapshot: null,
    renderList: null,
    lastMoveCommand: null,
    lastReceivedTick: null,
    lastVisibleUpdate: null
  };
}

function cloneState(state) {
  return {
    ...state,
    snapshot: state.snapshot,
    renderList: state.renderList,
    lastMoveCommand: state.lastMoveCommand ? cloneDebugObject(state.lastMoveCommand) : null,
    lastReceivedTick: state.lastReceivedTick ? cloneDebugObject(state.lastReceivedTick) : null,
    lastVisibleUpdate: state.lastVisibleUpdate ? cloneDebugObject(state.lastVisibleUpdate) : null
  };
}

function cloneDebugObject(value) {
  return JSON.parse(JSON.stringify(value));
}

function clonePoint(point) {
  return point ? { ...point } : null;
}

async function webSocketDataToBytes(data) {
  if (data instanceof Uint8Array) {
    return copyBytes(data);
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  throw new Error(`Unsupported gateway message type: ${typeof data}`);
}

function copyBytes(bytes) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}
