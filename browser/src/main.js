import { loadSpriteAssets } from './assets/sprite-assets.js';
import { AstoniaLiveSession } from './live-session.js';
import { renderAstoniaRenderListToCanvas } from './render/canvas-renderer.js';

const statusCard = document.querySelector('[data-testid="webgpu-status"]');
const statusTitle = document.querySelector('[data-webgpu-title]');
const statusDetail = document.querySelector('[data-webgpu-detail]');
const liveForm = document.querySelector('[data-testid="live-login-form"]');
const liveStatusCard = document.querySelector('[data-testid="live-status"]');
const liveStatusTitle = document.querySelector('[data-testid="live-connection-status"]');
const liveStatusDetail = document.querySelector('[data-live-detail]');
const worldCanvas = document.querySelector('[data-testid="live-world-canvas"]');
const tickCount = document.querySelector('[data-testid="live-tick-count"]');
const currentTick = document.querySelector('[data-testid="live-current-tick"]');
const protocolVersion = document.querySelector('[data-testid="live-protocol-version"]');
const frameCounts = document.querySelector('[data-testid="live-frame-counts"]');
const playerName = document.querySelector('[data-testid="live-player-name"]');
const playerPosition = document.querySelector('[data-testid="live-player-position"]');
const worldSummary = document.querySelector('[data-testid="live-world-summary"]');
const commandCounts = document.querySelector('[data-testid="live-command-counts"]');
const byteCounts = document.querySelector('[data-testid="live-byte-counts"]');
const messageLog = document.querySelector('[data-testid="live-message-log"]');

const liveSession = new AstoniaLiveSession();
let spriteAssetsPromise = null;
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
  liveSession.connect({
    gatewayUrl: String(formData.get('gateway') ?? ''),
    username: String(formData.get('username') ?? ''),
    password: String(formData.get('password') ?? ''),
    protocolVersion: 3
  });
});

hydrateFormFromUrl();

if (new URLSearchParams(window.location.search).get('autoconnect') === '1') {
  liveForm.requestSubmit();
}

async function updateLiveView(state) {
  liveStatusCard.dataset.liveState = state.status;
  liveStatusTitle.textContent = statusLabel(state.status);
  liveStatusDetail.textContent = state.statusDetail;
  tickCount.textContent = String(state.decodedTicks);
  frameCounts.textContent = `${state.inboundFrames} in / ${state.outboundFrames} out`;
  byteCounts.textContent = `${state.inboundBytes} in / ${state.outboundBytes} out`;

  const snapshot = state.snapshot;
  currentTick.textContent = formatValue(snapshot?.currentTick);
  protocolVersion.textContent = formatValue(snapshot?.protocolVersion);
  playerName.textContent = snapshot?.player?.name ?? '-';
  playerPosition.textContent = snapshot?.player?.position
    ? `${snapshot.player.position.x},${snapshot.player.position.y}`
    : '-';
  worldSummary.textContent = `${snapshot?.visibleWorld?.nonEmptyCells ?? 0} cells / ${snapshot?.visibleWorld?.characters?.length ?? 0} characters`;
  commandCounts.textContent = `modeled ${snapshot?.commands?.modeled?.total ?? 0} / skipped ${snapshot?.commands?.skipped?.total ?? 0}`;
  messageLog.replaceChildren(
    ...(snapshot?.textMessages ?? []).slice(-5).map((message) => {
      const row = document.createElement('p');
      row.textContent = message.text;
      return row;
    })
  );

  if (state.renderList) {
    const serial = ++renderSerial;
    await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList);
    try {
      const assets = await getSpriteAssets();
      if (serial === renderSerial) {
        await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList, { spriteAssets: assets });
      }
    } catch {
      if (serial === renderSerial) {
        await renderAstoniaRenderListToCanvas(worldCanvas, state.renderList);
      }
    }
  }
}

function hydrateFormFromUrl() {
  const params = new URLSearchParams(window.location.search);
  for (const name of ['gateway', 'username', 'password']) {
    const value = params.get(name);
    if (value !== null) {
      liveForm.elements[name].value = value;
    }
  }
}

function getSpriteAssets() {
  spriteAssetsPromise ??= loadSpriteAssets();
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
