const DEFAULT_USER = 'BrowserSmoke';
const DEFAULT_PASSWORD = 'fixturecapture';
const DIST_ARTIFACTS = [
  {
    url: '/dist/astonia-client.js',
    name: 'browser/dist/astonia-client.js'
  },
  {
    url: '/dist/astonia-client.wasm',
    name: 'browser/dist/astonia-client.wasm'
  },
  {
    url: '/dist/astonia-client.data',
    name: 'browser/dist/astonia-client.data'
  }
];
const DIST_MODULE = DIST_ARTIFACTS[0].url;

const elements = {
  form: document.querySelector('[data-testid="wasm-launch-form"]'),
  canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
  launchButton: document.querySelector('[data-testid="wasm-launch-form"] button[type="submit"]'),
  webgpuStatus: document.querySelector('[data-testid="webgpu-status"]'),
  webgpuTitle: document.querySelector('[data-webgpu-title]'),
  webgpuDetail: document.querySelector('[data-webgpu-detail]'),
  moduleStatus: document.querySelector('[data-testid="wasm-module-status"]'),
  moduleTitle: document.querySelector('[data-module-title]'),
  moduleDetail: document.querySelector('[data-module-detail]'),
  log: document.querySelector('[data-testid="native-log"]')
};

let webgpuAvailable = false;
let artifactSetReady = false;
let launchOwner = null;

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

function updateLaunchAvailability() {
  elements.launchButton.disabled = !webgpuAvailable || !artifactSetReady || launchOwner !== null;
}

async function checkWebGpu() {
  if (!('gpu' in navigator)) {
    webgpuAvailable = false;
    setWebGpuStatus(
      'unavailable',
      'WebGPU Unavailable',
      'This browser session cannot start the WASM/WebGPU client.'
    );
    updateLaunchAvailability();
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
      updateLaunchAvailability();
      return;
    }

    webgpuAvailable = true;
    setWebGpuStatus('available', 'WebGPU Available', 'Native WASM client launch is allowed.');
  } catch (error) {
    webgpuAvailable = false;
    setWebGpuStatus('error', 'WebGPU Probe Failed', error instanceof Error ? error.message : String(error));
  } finally {
    updateLaunchAvailability();
  }
}

async function probeArtifact(artifact) {
  const response = await fetch(artifact.url, { method: 'HEAD', cache: 'no-store' });
  const missingHeader =
    response.headers.get('x-astonia-artifact-missing') === '1' ||
    response.headers.get('x-astonia-module-missing') === '1';

  if (missingHeader || response.status === 404) {
    return artifact.name;
  }

  if (!response.ok) {
    throw new Error(`Probe for ${artifact.name} failed with HTTP ${response.status}.`);
  }

  return null;
}

async function checkNativeArtifacts() {
  try {
    const missingArtifacts = (await Promise.all(DIST_ARTIFACTS.map(probeArtifact))).filter(Boolean);

    if (missingArtifacts.length > 0) {
      artifactSetReady = false;
      setModuleStatus(
        'build-required',
        missingArtifacts.length === DIST_ARTIFACTS.length ? 'Build Required' : 'Incomplete Native Artifacts',
        `Missing ${missingArtifacts.join(', ')}. Run the WASM/WebGPU native build to generate the browser/dist artifact set.`
      );
      return;
    }

    artifactSetReady = true;
    setModuleStatus(
      'ready',
      'Native Module Ready',
      'browser/dist/astonia-client.js, .wasm, and .data are present.'
    );
  } catch (error) {
    artifactSetReady = false;
    setModuleStatus('error', 'Module Probe Failed', error instanceof Error ? error.message : String(error));
  } finally {
    updateLaunchAvailability();
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
  if (launchOwner !== null) {
    return;
  }

  if (!webgpuAvailable) {
    appendLog('WebGPU is required for this browser target.');
    return;
  }

  if (!artifactSetReady) {
    appendLog('The complete native browser artifact set is required before launch.');
    return;
  }

  const owner = {
    aborted: false,
    arguments: collectLaunchArgs(elements.form),
    canvas: elements.canvas,
    module: null
  };
  launchOwner = owner;
  updateLaunchAvailability();
  setModuleStatus('loading', 'Loading Native Module', 'Loading the compiled WASM/WebGPU client.');

  function setCurrentLoadingDetail(detail) {
    if (launchOwner === owner && !owner.aborted) {
      setModuleStatus('loading', 'Loading Native Module', detail);
    }
  }

  try {
    const moduleUrl = `${DIST_MODULE}?t=${Date.now()}`;
    const imported = await import(moduleUrl);
    const createModule = imported.default ?? imported.createAstoniaClientModule;
    if (typeof createModule !== 'function') {
      throw new Error('Emscripten module factory export not found.');
    }

    const module = await createModule({
      canvas: owner.canvas,
      arguments: owner.arguments,
      locateFile(path) {
        return `/dist/${path}`;
      },
      print(message) {
        appendLog(String(message));
      },
      printErr(message) {
        appendLog(String(message));
      },
      setStatus(message) {
        setCurrentLoadingDetail(String(message || 'Preparing native runtime.'));
      },
      monitorRunDependencies(left) {
        const count = Number(left);
        const detail =
          Number.isFinite(count) && count > 0
            ? `Preparing native runtime (${count} run dependencies remaining).`
            : 'Starting native runtime.';
        setCurrentLoadingDetail(detail);
      },
      onAbort(reason) {
        owner.aborted = true;
        const detail = String(reason);
        appendLog(`Native module aborted: ${detail}`);
        if (launchOwner === owner) {
          launchOwner = null;
          setModuleStatus('aborted', 'Native Module Aborted', detail);
          updateLaunchAvailability();
        }
      }
    });

    if (owner.aborted) {
      return;
    }

    owner.module = module;
    window.astoniaNativeModule = module;
    setModuleStatus('running', 'Native Module Running', 'The real client owns the canvas.');
  } catch (error) {
    if (!owner.aborted && launchOwner === owner) {
      launchOwner = null;
      setModuleStatus('error', 'Native Module Failed', error instanceof Error ? error.message : String(error));
    }
  } finally {
    updateLaunchAvailability();
  }
}

function initializeForm() {
  elements.launchButton.disabled = true;
  elements.form.gateway.value = defaultGateway();
  elements.form.username.value = DEFAULT_USER;
  elements.form.password.value = DEFAULT_PASSWORD;
  elements.form.addEventListener('submit', startNativeClient);
}

initializeForm();
await Promise.all([checkWebGpu(), checkNativeArtifacts()]);
