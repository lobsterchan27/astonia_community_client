import { createAstoniaRenderList } from './render/render-list.js';
import { AstoniaProtocolStateReplay } from './protocol/state-replay.js';
import { AstoniaTickStreamDecoder } from './protocol/tick-stream-decoder.js';
import { buildAstoniaLoginFrames } from './protocol/login.js';
import { encodeAstoniaMoveCommand } from './protocol/move-command.js';
import {
  createFirstStepMovementPrediction,
  createPredictedMovementSnapshot,
  initialMovementPredictionState,
  normalizeMovementPredictionOptions,
  reconcileMovementPrediction
} from './movement-prediction.js';
import { AdaptiveTickJitterBuffer } from './tick-jitter-buffer.js';

const DEFAULT_GATEWAY_URL = 'ws://127.0.0.1:8787';

export class AstoniaLiveSession extends EventTarget {
  #webSocketFactory;
  #decoderFactory;
  #replayFactory;
  #tickBufferFactory;
  #now;
  #setTimeout;
  #clearTimeout;
  #decoder;
  #replay;
  #tickBuffer;
  #replayTimer;
  #replayTimerDueAt;
  #socket;
  #messageQueue;
  #state;
  #loginOptions;
  #baseGatewayUrl;
  #areaRetargetAttempt;
  #movementPredictionOptions;

  constructor(options = {}) {
    super();
    this.#webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
    this.#decoderFactory = options.decoderFactory ?? (() => new AstoniaTickStreamDecoder());
    this.#replayFactory = options.replayFactory ?? (() => new AstoniaProtocolStateReplay(options.replayOptions));
    this.#tickBufferFactory =
      options.tickBufferFactory ?? (() => new AdaptiveTickJitterBuffer(options.tickBufferOptions));
    this.#now = options.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
    this.#setTimeout = options.setTimeout ?? ((callback, delay) => setTimeout(callback, delay));
    this.#clearTimeout = options.clearTimeout ?? ((timer) => clearTimeout(timer));
    this.#decoder = null;
    this.#replay = null;
    this.#tickBuffer = null;
    this.#replayTimer = null;
    this.#replayTimerDueAt = null;
    this.#socket = null;
    this.#messageQueue = Promise.resolve();
    this.#movementPredictionOptions = normalizeMovementPredictionOptions(options.movementPrediction);
    this.#state = initialState(this.#movementPredictionOptions);
    this.#loginOptions = null;
    this.#baseGatewayUrl = DEFAULT_GATEWAY_URL;
    this.#areaRetargetAttempt = 0;
  }

  get state() {
    return cloneState(this.#state);
  }

  connect(options = {}) {
    if (this.#socket && this.#socket.readyState < WebSocket.CLOSING) {
      this.close();
    }

    if (Object.hasOwn(options, 'movementPrediction')) {
      this.#movementPredictionOptions = normalizeMovementPredictionOptions(options.movementPrediction);
    }

    const gatewayUrl = options.gatewayUrl || DEFAULT_GATEWAY_URL;
    this.#loginOptions = { ...options, gatewayUrl };
    this.#baseGatewayUrl = gatewayUrl;
    this.#areaRetargetAttempt = 0;
    this.#decoder = this.#decoderFactory();
    this.#replay = this.#replayFactory();
    this.#tickBuffer = this.#tickBufferFactory();
    this.#clearReplayTimer();
    this.#messageQueue = Promise.resolve();
    this.#state = {
      ...initialState(this.#movementPredictionOptions),
      latencyMetrics: this.#tickBuffer.metrics(),
      gatewayUrl,
      status: 'connecting',
      statusDetail: `Opening ${gatewayUrl}`
    };
    this.#emitChange();

    this.#openGatewaySocket(gatewayUrl);
  }

  #openGatewaySocket(gatewayUrl, retarget = null) {
    const socket = this.#webSocketFactory(gatewayUrl);
    this.#socket = socket;
    socket.binaryType = 'arraybuffer';

    socket.addEventListener('open', () => {
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      try {
        const frames = buildAstoniaLoginFrames(this.#loginOptions ?? {});
        for (const frame of frames) {
          socket.send(frame);
          this.#state.outboundFrames += 1;
          this.#state.outboundBytes += frame.byteLength;
        }

        this.#state.status = 'login-sent';
        if (retarget) {
          this.#state.areaRetarget = {
            ...this.#state.areaRetarget,
            status: 'connected',
            result: 'Login bytes sent to retargeted gateway.'
          };
          this.#state.statusDetail = `Retargeted to area port ${retarget.port}; login bytes sent.`;
        } else {
          this.#state.statusDetail = 'Login bytes sent; waiting for server ticks.';
        }
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

      this.#fail(new Error('Gateway WebSocket reported an error.'), socket);
    });

    socket.addEventListener('close', () => {
      if (!this.#isCurrentSocket(socket)) {
        return;
      }

      this.#clearReplayTimer();
      this.#clearMovementPrediction('socket-closed');
      if (this.#state.status !== 'error') {
        this.#state.status = this.#state.decodedTicks > 0 ? 'closed' : 'closed-before-ticks';
        this.#state.statusDetail = 'Gateway WebSocket closed.';
        if (this.#state.areaRetarget?.status === 'connecting') {
          this.#state.areaRetarget = {
            ...this.#state.areaRetarget,
            status: 'failed',
            result: 'Gateway WebSocket closed before the retarget login completed.'
          };
        }
        this.#emitChange();
      }
    });
  }

  close() {
    this.#clearReplayTimer();
    const predictionCleared = this.#clearMovementPrediction('explicit-close');
    const socket = this.#socket;
    this.#socket = null;
    socket?.close();
    if (predictionCleared) {
      this.#emitChange();
    }
  }

  setMovementPredictionEnabled(enabled) {
    const nextOptions = {
      ...this.#movementPredictionOptions,
      enabled: Boolean(enabled)
    };
    if (nextOptions.enabled === this.#movementPredictionOptions.enabled) {
      return;
    }

    this.#movementPredictionOptions = nextOptions;
    this.#state.movementPrediction = {
      ...initialMovementPredictionState(this.#movementPredictionOptions),
      status: nextOptions.enabled ? 'idle' : 'disabled',
      reason: nextOptions.enabled ? null : 'disabled'
    };
    this.#refreshDisplaySnapshot();
    this.#emitChange();
  }

  recordRenderTiming(durationMs) {
    this.#tickBuffer?.recordRenderTiming(durationMs);
    this.#state.latencyMetrics = this.#tickBuffer?.metrics() ?? this.#state.latencyMetrics;
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

    let sentAtMs = null;
    try {
      this.#socket.send(frame);
      sentAtMs = this.#now();
    } catch (error) {
      commandState.status = 'failed';
      commandState.reason = error instanceof Error ? error.message : String(error);
      this.#state.lastMoveCommand = commandState;
      this.#emitChange();
      return false;
    }

    this.#state.outboundFrames += 1;
    this.#state.outboundBytes += frame.byteLength;
    commandState.status = 'sent';
    this.#state.lastMoveCommand = commandState;
    this.#startMovementPrediction(target, {
      sentAtMs,
      sentAfterDecodedTicks: commandState.sentAfterDecodedTicks,
      outboundFrame: commandState.outboundFrame
    });
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
      if (!this.#isOpenSocket(socket)) {
        return;
      }

      this.#state.inboundFrames += 1;
      this.#state.inboundBytes += bytes.byteLength;

      const decoder = this.#decoder;
      const replay = this.#replay;
      const tickBuffer = this.#tickBuffer;
      if (!decoder || !replay || !tickBuffer) {
        return;
      }

      const decodeStartedAt = this.#now();
      const ticks = await decoder.pushChunk(bytes);
      const decodeMs = this.#now() - decodeStartedAt;
      if (!this.#isOpenSocket(socket) || decoder !== this.#decoder || replay !== this.#replay || tickBuffer !== this.#tickBuffer) {
        return;
      }
      tickBuffer.recordDecodeTiming(decodeMs);

      if (ticks.length > 0) {
        tickBuffer.enqueueTicks(ticks, this.#now());
      }
      this.#state.latencyMetrics = tickBuffer.metrics();
      this.#state.status = this.#state.snapshot?.login?.done ? 'live' : 'receiving';
      this.#state.statusDetail =
        ticks.length > 0
          ? `Queued ${ticks.length} decoded tick(s) from the latest gateway frame.`
          : 'Received gateway bytes; waiting for a full tick.';
      this.#emitChange();
      this.#scheduleBufferedReplay();
    } catch (error) {
      if (!this.#isOpenSocket(socket)) {
        return;
      }
      this.#fail(error, socket);
    }
  }

  #replayBufferedTick() {
    this.#replayTimer = null;
    this.#replayTimerDueAt = null;

    const replay = this.#replay;
    const tickBuffer = this.#tickBuffer;
    const socket = this.#socket;
    if (!replay || !tickBuffer || !socket || socket.readyState !== 1) {
      return;
    }

    try {
      const tick = tickBuffer.takeTick(this.#now());
      if (!tick) {
        this.#state.latencyMetrics = tickBuffer.metrics();
        this.#state.statusDetail = `Jitter buffer underflow; increasing target to ${this.#state.latencyMetrics.targetQueueDepth} tick(s).`;
        this.#emitChange();
        this.#scheduleBufferedReplay();
        return;
      }

      const updateStartedAt = this.#now();
      const tickIndex = this.#state.decodedTicks;
      const replayResult = replay.replayTick(tick, { tickIndex });
      this.#state.decodedTicks += 1;
      this.#state.lastRawTickBytes = tick.rawLength ?? 0;
      tickBuffer.recordUpdateTiming(this.#now() - updateStartedAt);
      this.#state.latencyMetrics = tickBuffer.metrics();

      if (replayResult?.retargetEvents?.length > 0) {
        this.#retargetArea(replayResult.retargetEvents.at(-1), socket);
        return;
      }

      this.#state.snapshot = replay.snapshot();
      this.#reconcileMovementPrediction();
      this.#refreshDisplaySnapshot();
      this.#state.lastReceivedTick = {
        decodedTicks: this.#state.decodedTicks,
        currentTick: this.#state.snapshot.currentTick ?? null,
        rawBytes: tick.rawLength ?? 0,
        queueDepth: this.#state.latencyMetrics.queueDepth,
        targetQueueDepth: this.#state.latencyMetrics.targetQueueDepth
      };
      this.#state.lastVisibleUpdate = {
        decodedTicks: this.#state.decodedTicks,
        currentTick: this.#state.snapshot.currentTick ?? null,
        playerPosition: clonePoint(this.#state.displaySnapshot?.player?.position),
        authoritativePlayerPosition: clonePoint(this.#state.snapshot.player?.position),
        source: this.#state.movementPrediction?.pending ? 'prediction' : 'authoritative',
        updateMs: this.#state.latencyMetrics.updateMs,
        visualMs: null,
        prediction: this.#state.movementPrediction?.pending
          ? {
              id: this.#state.movementPrediction.pending.id,
              status: this.#state.movementPrediction.status
            }
          : null
      };
      this.#state.status = this.#state.snapshot.login.done ? 'live' : 'receiving';
      this.#state.statusDetail = `Replayed buffered tick at ${this.#state.latencyMetrics.queueDepth}/${this.#state.latencyMetrics.targetQueueDepth} queued tick(s).`;
      this.#emitChange();
      this.#scheduleBufferedReplay();
    } catch (error) {
      this.#fail(error, this.#socket);
    }
  }

  #retargetArea(event, socket) {
    if (!this.#isCurrentSocket(socket)) {
      return;
    }

    const requestedAfterDecodedTicks = this.#state.decodedTicks;
    const targetGatewayUrl = buildRetargetGatewayUrl(this.#baseGatewayUrl, event.port);
    const oldSocket = this.#socket;
    const nextTickBuffer = this.#tickBufferFactory();
    this.#clearReplayTimer();
    this.#socket = null;
    this.#decoder = this.#decoderFactory();
    this.#replay = this.#replayFactory();
    this.#tickBuffer = nextTickBuffer;
    this.#messageQueue = Promise.resolve();
    this.#areaRetargetAttempt += 1;
    this.#state = {
      ...this.#state,
      status: 'retargeting',
      statusDetail: `Server requested area ${event.serverId} on port ${event.port}; opening ${targetGatewayUrl}`,
      gatewayUrl: targetGatewayUrl,
      decodedTicks: 0,
      lastRawTickBytes: 0,
      snapshot: null,
      renderList: null,
      displaySnapshot: null,
      lastReceivedTick: null,
      lastVisibleUpdate: null,
      latencyMetrics: nextTickBuffer.metrics(),
      movementPrediction: initialMovementPredictionState(this.#movementPredictionOptions),
      areaRetarget: {
        status: 'connecting',
        attempt: this.#areaRetargetAttempt,
        type: event.type,
        tickIndex: event.tickIndex,
        serverId: event.serverId,
        port: event.port,
        gatewayUrl: targetGatewayUrl,
        baseGatewayUrl: this.#baseGatewayUrl,
        requestedAfterDecodedTicks,
        result: null
      }
    };
    this.#emitChange();
    oldSocket?.close();
    this.#openGatewaySocket(targetGatewayUrl, this.#state.areaRetarget);
  }

  #scheduleBufferedReplay() {
    if (!this.#tickBuffer) {
      return;
    }

    const nowMs = this.#now();
    const delayMs = this.#tickBuffer.nextDelayMs(nowMs);
    if (delayMs === null) {
      return;
    }

    const dueAtMs = nowMs + delayMs;
    if (this.#replayTimer !== null) {
      if (this.#replayTimerDueAt !== null && this.#replayTimerDueAt <= dueAtMs) {
        return;
      }
      this.#clearReplayTimer();
    }

    this.#replayTimerDueAt = dueAtMs;
    this.#replayTimer = this.#setTimeout(() => this.#replayBufferedTick(), delayMs);
  }

  #clearReplayTimer() {
    if (this.#replayTimer === null) {
      return;
    }

    this.#clearTimeout(this.#replayTimer);
    this.#replayTimer = null;
    this.#replayTimerDueAt = null;
  }

  #fail(error, socket) {
    if (socket && !this.#isCurrentSocket(socket)) {
      return;
    }

    this.#state.status = 'error';
    this.#state.statusDetail = error instanceof Error ? error.message : String(error);
    this.#clearMovementPrediction('error');
    if (this.#state.areaRetarget?.status === 'connecting') {
      this.#state.areaRetarget = {
        ...this.#state.areaRetarget,
        status: 'failed',
        result: this.#state.statusDetail
      };
    }
    this.#emitChange();
  }

  #isCurrentSocket(socket) {
    return socket === this.#socket;
  }

  #isOpenSocket(socket) {
    return this.#isCurrentSocket(socket) && socket.readyState === 1;
  }

  #startMovementPrediction(target, metadata) {
    const predictionState = initialMovementPredictionState(this.#movementPredictionOptions);
    if (!this.#movementPredictionOptions.enabled) {
      this.#state.movementPrediction = {
        ...predictionState,
        status: 'disabled',
        reason: 'disabled'
      };
      this.#refreshDisplaySnapshot();
      return;
    }

    const visualAtMs = this.#now();
    const prediction = createFirstStepMovementPrediction(this.#state.snapshot, target, {
      ...metadata,
      id: `move:${metadata.outboundFrame}`,
      visualAtMs,
      confirmationTickWindow: this.#movementPredictionOptions.confirmationTickWindow
    });

    if (prediction.status !== 'pending') {
      this.#state.movementPrediction = {
        ...predictionState,
        status: 'skipped',
        reason: prediction.reason,
        pending: null,
        lastPredictedUpdate: null,
        lastAuthoritativeReconciliation: prediction
      };
      this.#refreshDisplaySnapshot();
      return;
    }

    this.#state.movementPrediction = {
      ...predictionState,
      status: 'pending',
      reason: null,
      pending: prediction,
      lastPredictedUpdate: {
        id: prediction.id,
        target: clonePoint(prediction.target),
        originalPosition: clonePoint(prediction.originalPosition),
        predictedPosition: clonePoint(prediction.predictedPosition),
        decodedTicks: this.#state.decodedTicks,
        currentTick: this.#state.snapshot?.currentTick ?? null,
        visualMs: prediction.visualMs,
        outboundFrame: prediction.outboundFrame
      },
      lastAuthoritativeReconciliation: null
    };
    this.#refreshDisplaySnapshot();
    this.#state.lastVisibleUpdate = {
      decodedTicks: this.#state.decodedTicks,
      currentTick: this.#state.snapshot?.currentTick ?? null,
      playerPosition: clonePoint(this.#state.displaySnapshot?.player?.position),
      authoritativePlayerPosition: clonePoint(this.#state.snapshot?.player?.position),
      source: 'prediction',
      updateMs: null,
      visualMs: prediction.visualMs,
      prediction: {
        id: prediction.id,
        status: 'pending'
      }
    };
  }

  #reconcileMovementPrediction() {
    const pending = this.#state.movementPrediction?.pending;
    if (!pending) {
      return;
    }

    const result = reconcileMovementPrediction(pending, this.#state.snapshot, {
      decodedTicks: this.#state.decodedTicks,
      nowMs: this.#now()
    });
    if (!result) {
      return;
    }

    this.#state.movementPrediction = {
      ...this.#state.movementPrediction,
      status: result.status,
      reason: result.reason,
      pending: result.status === 'pending' ? pending : null,
      lastAuthoritativeReconciliation: result
    };
  }

  #refreshDisplaySnapshot() {
    const snapshot = this.#state.snapshot;
    if (!snapshot) {
      this.#state.displaySnapshot = null;
      this.#state.renderList = null;
      return;
    }

    this.#state.displaySnapshot = this.#state.movementPrediction?.pending
      ? createPredictedMovementSnapshot(snapshot, this.#state.movementPrediction.pending)
      : snapshot;
    this.#state.renderList = createAstoniaRenderList(this.#state.displaySnapshot);
  }

  #clearMovementPrediction(reason) {
    const state = this.#state.movementPrediction;
    if (!state?.pending) {
      return false;
    }

    this.#state.movementPrediction = {
      ...state,
      status: 'cleared',
      reason,
      pending: null,
      lastAuthoritativeReconciliation: {
        predictionId: state.pending.id,
        status: 'cleared',
        reason,
        target: clonePoint(state.pending.target),
        originalPosition: clonePoint(state.pending.originalPosition),
        predictedPosition: clonePoint(state.pending.predictedPosition),
        authoritativePosition: clonePoint(this.#state.snapshot?.player?.position),
        decodedTicks: this.#state.decodedTicks,
        currentTick: this.#state.snapshot?.currentTick ?? null,
        confirmationTicks: Math.max(0, this.#state.decodedTicks - state.pending.sentAfterDecodedTicks),
        confirmationMs: null
      }
    };
    this.#refreshDisplaySnapshot();
    return true;
  }

  #emitChange() {
    this.dispatchEvent(new CustomEvent('change', { detail: this.state }));
  }
}

function initialState(movementPredictionOptions = normalizeMovementPredictionOptions()) {
  const latencyMetrics = new AdaptiveTickJitterBuffer().metrics();
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
    displaySnapshot: null,
    renderList: null,
    lastMoveCommand: null,
    lastReceivedTick: null,
    lastVisibleUpdate: null,
    latencyMetrics,
    movementPrediction: initialMovementPredictionState(movementPredictionOptions),
    areaRetarget: null
  };
}

function cloneState(state) {
  return {
    ...state,
    snapshot: state.snapshot,
    displaySnapshot: state.displaySnapshot,
    renderList: state.renderList,
    lastMoveCommand: state.lastMoveCommand ? cloneDebugObject(state.lastMoveCommand) : null,
    lastReceivedTick: state.lastReceivedTick ? cloneDebugObject(state.lastReceivedTick) : null,
    lastVisibleUpdate: state.lastVisibleUpdate ? cloneDebugObject(state.lastVisibleUpdate) : null,
    latencyMetrics: state.latencyMetrics ? cloneDebugObject(state.latencyMetrics) : null,
    movementPrediction: state.movementPrediction ? cloneDebugObject(state.movementPrediction) : null,
    areaRetarget: state.areaRetarget ? cloneDebugObject(state.areaRetarget) : null
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

function buildRetargetGatewayUrl(gatewayUrl, port) {
  const documentBase =
    typeof window !== 'undefined' && window.location ? window.location.href : 'http://127.0.0.1/';
  const url = new URL(gatewayUrl, documentBase);
  url.searchParams.set('target-port', String(port));
  return url.toString();
}
