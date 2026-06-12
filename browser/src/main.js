import { loadSpriteAssets } from './assets/sprite-assets.js';
import { AstoniaLiveSession } from './live-session.js';
import { renderAstoniaRenderListToCanvas } from './render/canvas-renderer.js';
import { hitTestAstoniaRenderListTile } from './render/tile-hit-test.js';

const statusCard = document.querySelector('[data-testid="webgpu-status"]');
const statusTitle = document.querySelector('[data-webgpu-title]');
const statusDetail = document.querySelector('[data-webgpu-detail]');
const liveForm = document.querySelector('[data-testid="live-login-form"]');
const movementPredictionToggle = document.querySelector('[data-testid="live-movement-prediction-toggle"]');
const liveStatusCard = document.querySelector('[data-testid="live-status"]');
const liveStatusTitle = document.querySelector('[data-testid="live-connection-status"]');
const liveStatusDetail = document.querySelector('[data-live-detail]');
const worldCanvas = document.querySelector('[data-testid="live-world-canvas"]');
const tickCount = document.querySelector('[data-testid="live-tick-count"]');
const currentTick = document.querySelector('[data-testid="live-current-tick"]');
const protocolVersion = document.querySelector('[data-testid="live-protocol-version"]');
const frameCounts = document.querySelector('[data-testid="live-frame-counts"]');
const bufferDepth = document.querySelector('[data-testid="live-buffer-depth"]');
const bufferUnderflows = document.querySelector('[data-testid="live-buffer-underflows"]');
const playerName = document.querySelector('[data-testid="live-player-name"]');
const playerPosition = document.querySelector('[data-testid="live-player-position"]');
const worldSummary = document.querySelector('[data-testid="live-world-summary"]');
const commandCounts = document.querySelector('[data-testid="live-command-counts"]');
const byteCounts = document.querySelector('[data-testid="live-byte-counts"]');
const latencyArrival = document.querySelector('[data-testid="live-latency-arrival"]');
const latencyTimings = document.querySelector('[data-testid="live-latency-timings"]');
const bufferTargetChange = document.querySelector('[data-testid="live-buffer-target-change"]');
const lastMoveCommand = document.querySelector('[data-testid="live-last-move-command"]');
const movementPrediction = document.querySelector('[data-testid="live-movement-prediction"]');
const areaRetarget = document.querySelector('[data-testid="live-area-retarget"]');
const lastReceivedTick = document.querySelector('[data-testid="live-last-received-tick"]');
const lastVisibleUpdate = document.querySelector('[data-testid="live-last-visible-update"]');
const messageLog = document.querySelector('[data-testid="live-message-log"]');

const urlParams = new URLSearchParams(window.location.search);
const liveSession = new AstoniaLiveSession({
  movementPrediction: {
    enabled: movementPredictionEnabledFromParams(urlParams)
  }
});
let spriteAssetsPromise = null;
let spriteAssets = null;
const spriteImageCache = new Map();
let renderSerial = 0;

function setWebGpuStatus(state, title, detail) {
  statusCard.dataset.webgpuState = state;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
}

async function probeWebGpu() {
  if (!('gpu' in navigator)) {
    setWebGpuStatus(
      'unavailable',
      'WebGPU unavailable',
      'This browser does not expose navigator.gpu. The shell is running without the GPU renderer.'
    );
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();

    if (!adapter) {
      setWebGpuStatus(
        'unavailable',
        'WebGPU unavailable',
        'navigator.gpu is present, but no adapter was granted. The shell is running without the GPU renderer.'
      );
      return;
    }

    const device = await adapter.requestDevice();
    device.destroy();

    setWebGpuStatus(
      'available',
      'WebGPU available',
      'A WebGPU adapter and device were created successfully.'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown WebGPU error';
    setWebGpuStatus(
      'error',
      'WebGPU probe failed',
      `The browser shell is running without the GPU renderer. ${message}`
    );
  }
}

void probeWebGpu();

liveSession.addEventListener('change', (event) => {
  void updateLiveView(event.detail);
});

liveForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(liveForm);
  liveSession.setMovementPredictionEnabled(movementPredictionToggle.checked);
  liveSession.connect({
    gatewayUrl: String(formData.get('gateway') ?? ''),
    username: String(formData.get('username') ?? ''),
    password: String(formData.get('password') ?? ''),
    protocolVersion: 3
  });
});

worldCanvas.addEventListener('click', (event) => {
  const renderList = liveSession.state.renderList;
  const target = hitTestAstoniaRenderListTile(renderList, canvasPointFromEvent(event, worldCanvas));
  if (!target) {
    lastMoveCommand.textContent = 'No visible tile hit';
    return;
  }

  liveSession.moveToTile(target.world);
});

movementPredictionToggle.addEventListener('change', () => {
  liveSession.setMovementPredictionEnabled(movementPredictionToggle.checked);
});

hydrateFormFromUrl();

if (urlParams.get('autoconnect') === '1') {
  liveForm.requestSubmit();
}

async function updateLiveView(state) {
  liveStatusCard.dataset.liveState = state.status;
  liveStatusTitle.textContent = statusLabel(state.status);
  liveStatusDetail.textContent = state.statusDetail;
  tickCount.textContent = String(state.decodedTicks);
  frameCounts.textContent = `${state.inboundFrames} in / ${state.outboundFrames} out`;
  byteCounts.textContent = `${state.inboundBytes} in / ${state.outboundBytes} out`;
  updateLatencyMetrics(state.latencyMetrics);

  const snapshot = state.snapshot;
  currentTick.textContent = formatValue(snapshot?.currentTick);
  protocolVersion.textContent = formatValue(snapshot?.protocolVersion);
  playerName.textContent = snapshot?.player?.name ?? '-';
  playerPosition.textContent = formatPlayerPosition(snapshot?.player?.position, state.displaySnapshot?.player?.position);
  worldSummary.textContent = `${snapshot?.visibleWorld?.nonEmptyCells ?? 0} cells / ${snapshot?.visibleWorld?.characters?.length ?? 0} characters`;
  commandCounts.textContent = `modeled ${snapshot?.commands?.modeled?.total ?? 0} / skipped ${snapshot?.commands?.skipped?.total ?? 0}`;
  lastMoveCommand.textContent = formatMoveCommand(state.lastMoveCommand);
  movementPrediction.textContent = formatMovementPrediction(state.movementPrediction);
  areaRetarget.textContent = formatAreaRetarget(state.areaRetarget);
  lastReceivedTick.textContent = formatReceivedTick(state.lastReceivedTick);
  lastVisibleUpdate.textContent = formatVisibleUpdate(state.lastVisibleUpdate);
  messageLog.replaceChildren(
    ...(snapshot?.textMessages ?? []).slice(-5).map((message) => {
      const row = document.createElement('p');
      row.textContent = message.text;
      return row;
    })
  );

  if (state.renderList) {
    const serial = ++renderSerial;
    const renderStartedAt = performance.now();
    const hadSpriteAssets = Boolean(spriteAssets);

    if (hadSpriteAssets) {
      await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList, {
        spriteAssets,
        imageCache: spriteImageCache
      });
    } else {
      await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList);
    }

    try {
      const assets = await getSpriteAssets();
      if (serial === renderSerial && !hadSpriteAssets) {
        await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList, {
          spriteAssets: assets,
          imageCache: spriteImageCache
        });
      }
    } catch {
      if (serial === renderSerial) {
        await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList);
      }
    }
    if (serial === renderSerial) {
      liveSession.recordRenderTiming(performance.now() - renderStartedAt);
      updateLatencyMetrics(liveSession.state.latencyMetrics);
    }
  }
}

function hydrateFormFromUrl() {
  const defaults = {
    gateway: defaultGatewayUrl(),
    username: 'BrowserSmoke',
    password: 'fixturecapture'
  };

  for (const name of ['gateway', 'username', 'password']) {
    const value = urlParams.get(name);
    liveForm.elements[name].value = value ?? defaults[name];
  }
  movementPredictionToggle.checked = liveSession.state.movementPrediction?.enabled !== false;
}

function defaultGatewayUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const hostname = window.location.hostname || '127.0.0.1';
  return `${protocol}//${hostname}:8787`;
}

function getSpriteAssets() {
  spriteAssetsPromise ??= loadSpriteAssets().then((assets) => {
    spriteAssets = assets;
    return assets;
  });
  return spriteAssetsPromise;
}

function statusLabel(status) {
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatValue(value) {
  return value === null || value === undefined ? '-' : String(value);
}

function canvasPointFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY
  };
}

function formatMoveCommand(command) {
  if (!command) {
    return '-';
  }

  const bytes = command.bytes.map((byte) => `0x${byte.toString(16).padStart(2, '0')}`).join(' ');
  const suffix = command.reason ? ` (${command.reason})` : '';
  return `${command.status} ${command.type} ${command.x},${command.y} [${bytes}] after ${command.sentAfterDecodedTicks} tick(s)${suffix}`;
}

function formatMovementPrediction(prediction) {
  if (!prediction) {
    return '-';
  }
  if (!prediction.enabled) {
    return 'disabled';
  }

  const visual = prediction.lastPredictedUpdate
    ? `visual ${formatPoint(prediction.lastPredictedUpdate.predictedPosition)} in ${formatMs(prediction.lastPredictedUpdate.visualMs)}`
    : 'visual -';
  const reconciliation = prediction.lastAuthoritativeReconciliation
    ? `${prediction.lastAuthoritativeReconciliation.status} ${prediction.lastAuthoritativeReconciliation.reason} in ${formatMs(prediction.lastAuthoritativeReconciliation.confirmationMs)} / ${prediction.lastAuthoritativeReconciliation.confirmationTicks ?? 0} tick(s)`
    : 'authoritative -';

  if (prediction.pending) {
    return `pending ${formatPoint(prediction.pending.originalPosition)} -> ${formatPoint(prediction.pending.predictedPosition)} toward ${formatPoint(prediction.pending.target)}, ${visual}, ${reconciliation}`;
  }

  return `${prediction.status}${prediction.reason ? ` ${prediction.reason}` : ''}, ${visual}, ${reconciliation}`;
}

function formatAreaRetarget(retarget) {
  if (!retarget) {
    return '-';
  }

  const result = retarget.result ? ` (${retarget.result})` : '';
  return `${retarget.status} server ${retarget.serverId} port ${retarget.port} after ${retarget.requestedAfterDecodedTicks} tick(s)${result}`;
}

function formatReceivedTick(tick) {
  if (!tick) {
    return '-';
  }

  return `decoded ${tick.decodedTicks}, current ${formatValue(tick.currentTick)}, raw ${tick.rawBytes} byte(s), queue ${tick.queueDepth}/${tick.targetQueueDepth}`;
}

function formatVisibleUpdate(update) {
  if (!update) {
    return '-';
  }

  const position = update.playerPosition ? `${update.playerPosition.x},${update.playerPosition.y}` : '-';
  const source = update.source ?? 'authoritative';
  const authoritative = update.authoritativePlayerPosition
    ? `, authoritative ${formatPoint(update.authoritativePlayerPosition)}`
    : '';
  return `${source} ${position} at current ${formatValue(update.currentTick)} after ${update.decodedTicks} tick(s), update ${formatMs(update.updateMs)}, visual ${formatMs(update.visualMs)}${authoritative}`;
}

function updateLatencyMetrics(metrics) {
  if (!metrics) {
    return;
  }

  bufferDepth.textContent = `${metrics.queueDepth}/${metrics.targetQueueDepth}`;
  bufferUnderflows.textContent = String(metrics.underflows);
  latencyArrival.textContent = `last ${formatMs(metrics.tickArrivalIntervalMs)}, avg ${formatMs(metrics.averageTickArrivalIntervalMs)}, jitter ${formatMs(metrics.tickArrivalJitterMs)}`;
  latencyTimings.textContent = `decode ${formatMs(metrics.decodeMs)} / update ${formatMs(metrics.updateMs)} / render ${formatMs(metrics.renderMs)}`;
  bufferTargetChange.textContent = formatBufferTargetChange(metrics.lastBufferTargetChange);
}

function formatBufferTargetChange(change) {
  if (!change) {
    return '-';
  }

  return `${change.from}->${change.to} ${change.reason} at ${formatMs(change.atMs)} (queue ${change.queueDepth}, underflows ${change.underflows})`;
}

function formatMs(value) {
  return value === null || value === undefined ? '-' : `${Number(value).toFixed(1)}ms`;
}

function formatPlayerPosition(authoritativePosition, visualPosition) {
  const authoritative = formatPoint(authoritativePosition);
  if (!visualPosition || authoritative === formatPoint(visualPosition)) {
    return authoritative;
  }

  return `${authoritative} (visual ${formatPoint(visualPosition)})`;
}

function formatPoint(point) {
  return point ? `${point.x},${point.y}` : '-';
}

function movementPredictionEnabledFromParams(params) {
  const value = params.get('movementPrediction') ?? params.get('prediction');
  if (value === null) {
    return true;
  }

  return !['0', 'false', 'off', 'no'].includes(value.toLowerCase());
}
