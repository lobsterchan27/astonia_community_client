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
let launchSequence = 0;

const LAUNCH_PROBE_PREFIX = '[DEBUG-wasm-launch-probe]';

function launchProbeConsoleEnabled() {
  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get('astonia_probe') === '1' ||
      params.get('probe') === '1' ||
      window.localStorage?.getItem('astonia_probe') === '1'
    );
  } catch {
    return false;
  }
}

function artifactResourceTiming() {
  return performance
    .getEntriesByType('resource')
    .filter((entry) => DIST_ARTIFACTS.some((artifact) => entry.name.includes(artifact.url)))
    .map((entry) => ({
      name: entry.name,
      initiatorType: entry.initiatorType,
      duration: Number(entry.duration.toFixed(3)),
      transferSize: entry.transferSize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      responseEnd: Number(entry.responseEnd.toFixed(3))
    }));
}

function cloneProbeDetail(detail) {
  try {
    return JSON.parse(JSON.stringify(detail));
  } catch {
    return { value: String(detail) };
  }
}

function errorProbeDetail(error) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack
    };
  }

  return { message: String(error) };
}

function truncateProbeMessage(message) {
  const text = String(message);
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}

function redactLaunchArgs(args) {
  const redacted = Array.from(args);
  const passwordFlag = redacted.indexOf('-p');
  if (passwordFlag >= 0 && passwordFlag + 1 < redacted.length) {
    redacted[passwordFlag + 1] = '<redacted>';
  }
  return redacted;
}

const launchProbe = {
  enabled: launchProbeConsoleEnabled(),
  events: [],
  artifactResourceTiming
};

window.astoniaWasmLaunchProbe = launchProbe;

function recordLaunchProbe(stage, detail = {}, owner = null) {
  const event = {
    sequence: launchProbe.events.length + 1,
    elapsedMs: Number(performance.now().toFixed(3)),
    ownerId: owner?.id ?? null,
    stage,
    detail: cloneProbeDetail(detail),
    moduleState: elements.moduleStatus?.dataset.moduleState ?? null,
    launchActive: launchOwner !== null
  };

  launchProbe.events.push(event);
  launchProbe.lastEvent = event;

  if (launchProbe.enabled) {
    console.debug(LAUNCH_PROBE_PREFIX, JSON.stringify(event));
  }

  return event;
}

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

function nativeStartupDetail(module) {
  if (typeof module?._astonia_native_startup_adapter_status !== 'function') {
    return 'The real client owns the canvas.';
  }

  const statusNames = new Map([
    [0, 'created'],
    [1, 'starting'],
    [2, 'running'],
    [3, 'stopped'],
    [4, 'startup failed'],
    [5, 'loop init failed'],
    [6, 'cleaned up']
  ]);
  const status = module._astonia_native_startup_adapter_status();
  const startupResult =
    typeof module._astonia_native_startup_adapter_startup_result === 'function'
      ? module._astonia_native_startup_adapter_startup_result()
      : null;
  const loopResult =
    typeof module._astonia_native_startup_adapter_loop_init_result === 'function'
      ? module._astonia_native_startup_adapter_loop_init_result()
      : null;

  return `Native lifecycle ${statusNames.get(status) ?? status}; startup ${startupResult}; loop ${loopResult}.`;
}

async function startNativeClient(event) {
  event.preventDefault();
  recordLaunchProbe('submit', {
    webgpuAvailable,
    artifactSetReady,
    launchBusy: launchOwner !== null
  });

  if (launchOwner !== null) {
    recordLaunchProbe('submit-ignored-busy');
    return;
  }

  if (!webgpuAvailable) {
    recordLaunchProbe('submit-blocked-webgpu');
    appendLog('WebGPU is required for this browser target.');
    return;
  }

  if (!artifactSetReady) {
    recordLaunchProbe('submit-blocked-artifacts');
    appendLog('The complete native browser artifact set is required before launch.');
    return;
  }

  const owner = {
    id: ++launchSequence,
    aborted: false,
    arguments: collectLaunchArgs(elements.form),
    canvas: elements.canvas,
    module: null,
    pendingStartedAt: performance.now(),
    watchdog: null
  };
  launchOwner = owner;
  updateLaunchAvailability();
  setModuleStatus('loading', 'Loading Native Module', 'Loading the compiled WASM/WebGPU client.');
  recordLaunchProbe(
    'owner-created',
    {
      arguments: redactLaunchArgs(owner.arguments),
      canvas: {
        width: owner.canvas.width,
        height: owner.canvas.height,
        clientWidth: owner.canvas.clientWidth,
        clientHeight: owner.canvas.clientHeight
      }
    },
    owner
  );

  function setCurrentLoadingDetail(detail) {
    if (launchOwner !== owner || owner.aborted || owner.module !== null) {
      recordLaunchProbe(
        'loading-detail-ignored',
        {
          detail,
          reason:
            owner.module !== null ? 'module-resolved' : owner.aborted ? 'owner-aborted' : 'owner-not-current'
        },
        owner
      );
      return;
    }

    if (owner.lastLoadingDetail !== detail) {
      owner.lastLoadingDetail = detail;
      recordLaunchProbe('loading-detail', { detail }, owner);
    }
    setModuleStatus('loading', 'Loading Native Module', detail);
  }

  owner.watchdog = window.setInterval(() => {
    if (launchOwner !== owner || owner.aborted || owner.module !== null) {
      window.clearInterval(owner.watchdog);
      owner.watchdog = null;
      return;
    }

    recordLaunchProbe(
      'pending',
      {
        pendingMs: Number((performance.now() - owner.pendingStartedAt).toFixed(3)),
        artifactResourceTiming: artifactResourceTiming()
      },
      owner
    );
  }, 5000);

  try {
    const moduleUrl = `${DIST_MODULE}?t=${Date.now()}`;
    recordLaunchProbe('import-start', { moduleUrl }, owner);
    const imported = await import(moduleUrl);
    recordLaunchProbe('import-resolved', { exportKeys: Object.keys(imported).sort() }, owner);
    const createModule = imported.default ?? imported.createAstoniaClientModule;
    if (typeof createModule !== 'function') {
      throw new Error('Emscripten module factory export not found.');
    }

    recordLaunchProbe('create-module-start', { arguments: redactLaunchArgs(owner.arguments) }, owner);
    const module = await createModule({
      canvas: owner.canvas,
      arguments: owner.arguments,
      locateFile(path) {
        const located = `/dist/${path}`;
        recordLaunchProbe('callback:locateFile', { path, located }, owner);
        return located;
      },
      print(message) {
        const text = String(message);
        recordLaunchProbe('callback:print', { message: truncateProbeMessage(text) }, owner);
        appendLog(text);
      },
      printErr(message) {
        const text = String(message);
        recordLaunchProbe('callback:printErr', { message: truncateProbeMessage(text) }, owner);
        appendLog(text);
      },
      setStatus(message) {
        const detail = String(message || 'Preparing native runtime.');
        recordLaunchProbe('callback:setStatus', { message: truncateProbeMessage(detail) }, owner);
        setCurrentLoadingDetail(detail);
      },
      monitorRunDependencies(left) {
        const count = Number(left);
        recordLaunchProbe('callback:monitorRunDependencies', { left: count }, owner);
        const detail =
          Number.isFinite(count) && count > 0
            ? `Preparing native runtime (${count} run dependencies remaining).`
            : 'Starting native runtime.';
        setCurrentLoadingDetail(detail);
      },
      onRuntimeInitialized() {
        recordLaunchProbe('callback:onRuntimeInitialized', {}, owner);
      },
      onAbort(reason) {
        owner.aborted = true;
        const detail = String(reason);
        recordLaunchProbe(
          'callback:onAbort',
          { reason: truncateProbeMessage(detail), artifactResourceTiming: artifactResourceTiming() },
          owner
        );
        appendLog(`Native module aborted: ${detail}`);
        if (launchOwner === owner) {
          launchOwner = null;
          setModuleStatus('aborted', 'Native Module Aborted', detail);
          updateLaunchAvailability();
        }
      }
    });

    if (owner.aborted) {
      recordLaunchProbe('create-module-resolved-after-abort', {}, owner);
      return;
    }

    owner.module = module;
    window.astoniaNativeModule = module;
    recordLaunchProbe(
      'create-module-resolved',
      {
        exportCount: Object.keys(module).length,
        startupDetail: nativeStartupDetail(module),
        artifactResourceTiming: artifactResourceTiming()
      },
      owner
    );
    setModuleStatus('running', 'Native Module Running', nativeStartupDetail(module));
    recordLaunchProbe('running', { startupDetail: nativeStartupDetail(module) }, owner);
  } catch (error) {
    recordLaunchProbe(
      'error',
      { error: errorProbeDetail(error), artifactResourceTiming: artifactResourceTiming() },
      owner
    );
    if (!owner.aborted && launchOwner === owner) {
      launchOwner = null;
      setModuleStatus('error', 'Native Module Failed', error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (owner.watchdog !== null) {
      window.clearInterval(owner.watchdog);
      owner.watchdog = null;
    }
    recordLaunchProbe('finally', {}, owner);
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
