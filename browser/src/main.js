const DEFAULT_USER = 'BrowserSmoke';
const DEFAULT_PASSWORD = 'fixturecapture';
const DIST_MODULE = '/dist/astonia-client.js';

const elements = {
  form: document.querySelector('[data-testid="wasm-launch-form"]'),
  canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
  webgpuStatus: document.querySelector('[data-testid="webgpu-status"]'),
  webgpuTitle: document.querySelector('[data-webgpu-title]'),
  webgpuDetail: document.querySelector('[data-webgpu-detail]'),
  moduleStatus: document.querySelector('[data-testid="wasm-module-status"]'),
  moduleTitle: document.querySelector('[data-module-title]'),
  moduleDetail: document.querySelector('[data-module-detail]'),
  log: document.querySelector('[data-testid="native-log"]')
};

let webgpuAvailable = false;
let moduleLoading = false;

function defaultGateway() {
  const scheme = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${scheme}://${window.location.hostname}:8787`;
}

function appendLog(message) {
  const line = document.createElement('div');
  line.textContent = message;
  elements.log.append(line);
  elements.log.scrollTop = elements.log.scrollHeight;
}

function setWebGpuStatus(state, title, detail) {
  elements.webgpuStatus.dataset.webgpuState = state;
  elements.webgpuTitle.textContent = title;
  elements.webgpuDetail.textContent = detail;
}

function setModuleStatus(state, title, detail) {
  elements.moduleStatus.dataset.moduleState = state;
  elements.moduleTitle.textContent = title;
  elements.moduleDetail.textContent = detail;
}

async function checkWebGpu() {
  if (!('gpu' in navigator)) {
    webgpuAvailable = false;
    setWebGpuStatus(
      'unavailable',
      'WebGPU Unavailable',
      'This browser session cannot start the WASM/WebGPU client.'
    );
    return;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      webgpuAvailable = false;
      setWebGpuStatus(
        'unavailable',
        'WebGPU Unavailable',
        'No WebGPU adapter was granted for this browser session.'
      );
      return;
    }

    webgpuAvailable = true;
    setWebGpuStatus('available', 'WebGPU Available', 'Native WASM client launch is allowed.');
  } catch (error) {
    webgpuAvailable = false;
    setWebGpuStatus('error', 'WebGPU Probe Failed', error instanceof Error ? error.message : String(error));
  }
}

async function checkNativeModule() {
  try {
    const response = await fetch(DIST_MODULE, { method: 'HEAD', cache: 'no-store' });
    if (response.headers.get('x-astonia-module-missing') === '1' || !response.ok) {
      setModuleStatus(
        'missing',
        'Build Required',
        'Run the WASM/WebGPU native build to generate browser/dist/astonia-client.js.'
      );
      return;
    }

    setModuleStatus('ready', 'Native Module Ready', 'browser/dist/astonia-client.js is present.');
  } catch (error) {
    setModuleStatus('error', 'Module Probe Failed', error instanceof Error ? error.message : String(error));
  }
}

function collectLaunchArgs(form) {
  const data = new FormData(form);
  return [
    '-u',
    String(data.get('username') ?? DEFAULT_USER),
    '-p',
    String(data.get('password') ?? DEFAULT_PASSWORD),
    '-d',
    String(data.get('gateway') ?? defaultGateway()),
    '-w',
    '1280',
    '-h',
    '720',
    '-m',
    '0'
  ];
}

async function startNativeClient(event) {
  event.preventDefault();
  if (moduleLoading) {
    return;
  }

  if (!webgpuAvailable) {
    appendLog('WebGPU is required for this browser target.');
    return;
  }

  moduleLoading = true;
  setModuleStatus('loading', 'Starting Native Module', 'Loading the compiled WASM/WebGPU client.');

  try {
    const moduleUrl = `${DIST_MODULE}?t=${Date.now()}`;
    const imported = await import(moduleUrl);
    const createModule = imported.default ?? imported.createAstoniaClientModule;
    if (typeof createModule !== 'function') {
      throw new Error('Emscripten module factory export not found.');
    }

    const module = await createModule({
      canvas: elements.canvas,
      arguments: collectLaunchArgs(elements.form),
      locateFile(path) {
        return `/dist/${path}`;
      },
      print(message) {
        appendLog(String(message));
      },
      printErr(message) {
        appendLog(String(message));
      },
      onAbort(reason) {
        appendLog(`Native module aborted: ${reason}`);
      }
    });

    window.astoniaNativeModule = module;
    setModuleStatus('running', 'Native Module Running', 'The real client owns the canvas.');
  } catch (error) {
    setModuleStatus('error', 'Native Module Failed', error instanceof Error ? error.message : String(error));
  } finally {
    moduleLoading = false;
  }
}

function initializeForm() {
  elements.form.gateway.value = defaultGateway();
  elements.form.username.value = DEFAULT_USER;
  elements.form.password.value = DEFAULT_PASSWORD;
  elements.form.addEventListener('submit', startNativeClient);
}

initializeForm();
await Promise.all([checkWebGpu(), checkNativeModule()]);
