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
const AUDIO_NATIVE_STATE = {
  unavailable: 0,
  locked: 1,
  ready: 2
};
const SDL_KEYCODE = {
  unknown: 0,
  backspace: 8,
  tab: 9,
  return: 13,
  escape: 27,
  delete: 127,
  capsLock: 0x40000039,
  f1: 0x4000003a,
  f2: 0x4000003b,
  f3: 0x4000003c,
  f4: 0x4000003d,
  f5: 0x4000003e,
  f6: 0x4000003f,
  f7: 0x40000040,
  f8: 0x40000041,
  f9: 0x40000042,
  f10: 0x40000043,
  f11: 0x40000044,
  f12: 0x40000045,
  printScreen: 0x40000046,
  scrollLock: 0x40000047,
  pause: 0x40000048,
  insert: 0x40000049,
  home: 0x4000004a,
  pageUp: 0x4000004b,
  end: 0x4000004d,
  pageDown: 0x4000004e,
  right: 0x4000004f,
  left: 0x40000050,
  down: 0x40000051,
  up: 0x40000052,
  numLock: 0x40000053,
  kpDivide: 0x40000054,
  kpMultiply: 0x40000055,
  kpMinus: 0x40000056,
  kpPlus: 0x40000057,
  kpEnter: 0x40000058,
  kp1: 0x40000059,
  kp2: 0x4000005a,
  kp3: 0x4000005b,
  kp4: 0x4000005c,
  kp5: 0x4000005d,
  kp6: 0x4000005e,
  kp7: 0x4000005f,
  kp8: 0x40000060,
  kp9: 0x40000061,
  kp0: 0x40000062,
  kpPeriod: 0x40000063,
  leftCtrl: 0x400000e0,
  leftShift: 0x400000e1,
  leftAlt: 0x400000e2,
  rightCtrl: 0x400000e4,
  rightShift: 0x400000e5,
  rightAlt: 0x400000e6
};
const KEYCODE_BY_KEY = new Map([
  ['Backspace', SDL_KEYCODE.backspace],
  ['Tab', SDL_KEYCODE.tab],
  ['Enter', SDL_KEYCODE.return],
  ['Escape', SDL_KEYCODE.escape],
  ['Delete', SDL_KEYCODE.delete],
  ['CapsLock', SDL_KEYCODE.capsLock],
  ['F1', SDL_KEYCODE.f1],
  ['F2', SDL_KEYCODE.f2],
  ['F3', SDL_KEYCODE.f3],
  ['F4', SDL_KEYCODE.f4],
  ['F5', SDL_KEYCODE.f5],
  ['F6', SDL_KEYCODE.f6],
  ['F7', SDL_KEYCODE.f7],
  ['F8', SDL_KEYCODE.f8],
  ['F9', SDL_KEYCODE.f9],
  ['F10', SDL_KEYCODE.f10],
  ['F11', SDL_KEYCODE.f11],
  ['F12', SDL_KEYCODE.f12],
  ['PrintScreen', SDL_KEYCODE.printScreen],
  ['ScrollLock', SDL_KEYCODE.scrollLock],
  ['Pause', SDL_KEYCODE.pause],
  ['Insert', SDL_KEYCODE.insert],
  ['Home', SDL_KEYCODE.home],
  ['PageUp', SDL_KEYCODE.pageUp],
  ['End', SDL_KEYCODE.end],
  ['PageDown', SDL_KEYCODE.pageDown],
  ['ArrowRight', SDL_KEYCODE.right],
  ['ArrowLeft', SDL_KEYCODE.left],
  ['ArrowDown', SDL_KEYCODE.down],
  ['ArrowUp', SDL_KEYCODE.up],
  ['NumLock', SDL_KEYCODE.numLock],
  ['Control', SDL_KEYCODE.leftCtrl],
  ['Shift', SDL_KEYCODE.leftShift],
  ['Alt', SDL_KEYCODE.leftAlt]
]);
const KEYCODE_BY_CODE = new Map([
  ['ControlLeft', SDL_KEYCODE.leftCtrl],
  ['ControlRight', SDL_KEYCODE.rightCtrl],
  ['ShiftLeft', SDL_KEYCODE.leftShift],
  ['ShiftRight', SDL_KEYCODE.rightShift],
  ['AltLeft', SDL_KEYCODE.leftAlt],
  ['AltRight', SDL_KEYCODE.rightAlt],
  ['NumpadDivide', SDL_KEYCODE.kpDivide],
  ['NumpadMultiply', SDL_KEYCODE.kpMultiply],
  ['NumpadSubtract', SDL_KEYCODE.kpMinus],
  ['NumpadAdd', SDL_KEYCODE.kpPlus],
  ['NumpadEnter', SDL_KEYCODE.kpEnter],
  ['NumpadDecimal', SDL_KEYCODE.kpPeriod],
  ['Numpad0', SDL_KEYCODE.kp0],
  ['Numpad1', SDL_KEYCODE.kp1],
  ['Numpad2', SDL_KEYCODE.kp2],
  ['Numpad3', SDL_KEYCODE.kp3],
  ['Numpad4', SDL_KEYCODE.kp4],
  ['Numpad5', SDL_KEYCODE.kp5],
  ['Numpad6', SDL_KEYCODE.kp6],
  ['Numpad7', SDL_KEYCODE.kp7],
  ['Numpad8', SDL_KEYCODE.kp8],
  ['Numpad9', SDL_KEYCODE.kp9]
]);

const elements = {
  form: document.querySelector('[data-testid="wasm-launch-form"]'),
  canvas: document.querySelector('[data-testid="wasm-client-canvas"]'),
  launchButton: document.querySelector('[data-testid="wasm-launch-form"] button[type="submit"]'),
  audioStatus: document.querySelector('[data-testid="audio-status"]'),
  audioTitle: document.querySelector('[data-audio-title]'),
  audioDetail: document.querySelector('[data-audio-detail]'),
  audioUnlockButton: document.querySelector('[data-testid="audio-unlock-button"]'),
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
let audioContext = null;
let audioState = 'unavailable';
let audioUnlockAttempt = null;

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

function audioContextConstructor() {
  return window.AudioContext ?? window.webkitAudioContext ?? null;
}

function setAudioStatus(state, title, detail) {
  const previousAudioState = audioState;

  audioState = state;
  elements.audioStatus.dataset.audioState = state;
  elements.audioTitle.textContent = title;
  elements.audioDetail.textContent = detail;

  elements.audioUnlockButton.disabled = state !== 'locked';
  elements.audioUnlockButton.textContent =
    state === 'ready' ? 'Audio Ready' : state === 'unavailable' ? 'Unavailable' : 'Unlock Audio';
  if (previousAudioState !== state) {
    reportNativeAudioState(window.astoniaNativeModule);
  }
}

function updateAudioStatusFromPlatform(detailOverride = null) {
  if (!audioContextConstructor()) {
    setAudioStatus(
      'unavailable',
      'Audio Unavailable',
      detailOverride ?? 'This browser session does not expose Web Audio.'
    );
    return;
  }

  if (audioContext?.state === 'running') {
    setAudioStatus(
      'ready',
      'Audio Ready',
      detailOverride ?? 'Browser audio is unlocked for native playback.'
    );
    return;
  }

  setAudioStatus(
    'locked',
    'Audio Locked',
    detailOverride ?? 'Unlock from a browser gesture before native sound can play.'
  );
}

function isAudioUnlockGesture(event) {
  if (!event?.isTrusted) {
    return false;
  }

  return navigator.userActivation?.isActive !== false;
}

async function unlockAudioFromGesture(event) {
  if (!isAudioUnlockGesture(event)) {
    return audioState;
  }

  if (audioUnlockAttempt) {
    return audioUnlockAttempt;
  }

  audioUnlockAttempt = (async () => {
    const AudioContextCtor = audioContextConstructor();
    if (!AudioContextCtor) {
      updateAudioStatusFromPlatform();
      return audioState;
    }

    try {
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new AudioContextCtor();
        audioContext.addEventListener?.('statechange', () => updateAudioStatusFromPlatform());
      }

      if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
        await audioContext.resume();
      }

      updateAudioStatusFromPlatform();
    } catch (error) {
      updateAudioStatusFromPlatform(error instanceof Error ? error.message : String(error));
    }

    return audioState;
  })();

  try {
    return await audioUnlockAttempt;
  } finally {
    audioUnlockAttempt = null;
  }
}

function reportNativeAudioState(module) {
  const report = module?._astonia_wasm_audio_report_browser_state;
  if (typeof report === 'function') {
    report(AUDIO_NATIVE_STATE[audioState] ?? AUDIO_NATIVE_STATE.unavailable);
  }
}

function activeNativeInputModule() {
  return launchOwner?.module ?? null;
}

function eventModifiers(event) {
  return {
    shift: event.shiftKey ? 1 : 0,
    ctrl: event.ctrlKey ? 1 : 0,
    alt: event.altKey ? 1 : 0
  };
}

function reportNativeModifiers(module, modifiers) {
  const report = module?._astonia_wasm_input_set_modifiers;
  if (typeof report === 'function') {
    report(modifiers.shift, modifiers.ctrl, modifiers.alt);
  }
}

function editableTarget(target) {
  if (!target || target === document || target === window) {
    return false;
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
    return true;
  }

  return target.isContentEditable === true;
}

function browserKeycode(event) {
  if (KEYCODE_BY_CODE.has(event.code)) {
    return KEYCODE_BY_CODE.get(event.code);
  }

  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) {
    return letter[1].toLowerCase().codePointAt(0);
  }

  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) {
    return digit[1].codePointAt(0);
  }

  if (KEYCODE_BY_KEY.has(event.key)) {
    return KEYCODE_BY_KEY.get(event.key);
  }

  if (typeof event.key === 'string' && event.key.length === 1) {
    const character = /^[A-Z]$/.test(event.key) ? event.key.toLowerCase() : event.key;
    return character.codePointAt(0) ?? SDL_KEYCODE.unknown;
  }

  return SDL_KEYCODE.unknown;
}

function canProduceText(event) {
  return (
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.isComposing &&
    typeof event.key === 'string' &&
    Array.from(event.key).length === 1
  );
}

function forwardNativeKey(event, exportName) {
  const module = activeNativeInputModule();
  if (!module || editableTarget(event.target)) {
    return;
  }

  const modifiers = eventModifiers(event);
  reportNativeModifiers(module, modifiers);

  const nativeInput = module[exportName];
  const keycode = browserKeycode(event);
  if (typeof nativeInput !== 'function' || keycode === SDL_KEYCODE.unknown) {
    return;
  }

  nativeInput(keycode, modifiers.shift, modifiers.ctrl, modifiers.alt);
  if (event.cancelable && (exportName !== '_astonia_wasm_input_key_down' || !canProduceText(event))) {
    event.preventDefault();
  }
}

function forwardNativeText(event) {
  const module = activeNativeInputModule();
  if (!module || editableTarget(event.target) || event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
    return;
  }

  const nativeInput = module._astonia_wasm_input_text;
  if (typeof nativeInput !== 'function' || typeof event.key !== 'string' || event.key.length === 0 || event.key === 'Dead') {
    return;
  }

  const characters = Array.from(event.key);
  if (characters.length !== 1) {
    return;
  }

  const modifiers = eventModifiers(event);
  reportNativeModifiers(module, modifiers);
  nativeInput(characters[0].codePointAt(0), modifiers.shift, modifiers.ctrl, modifiers.alt);

  if (event.cancelable) {
    event.preventDefault();
  }
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

  if (audioUnlockAttempt) {
    await audioUnlockAttempt;
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

    const moduleConfig = {
      canvas: owner.canvas,
      arguments: owner.arguments,
      preRun: [
        () => {
          reportNativeAudioState(moduleConfig);
        }
      ],
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
    };

    recordLaunchProbe('create-module-start', { arguments: redactLaunchArgs(owner.arguments) }, owner);
    const module = await createModule(moduleConfig);

    if (owner.aborted) {
      recordLaunchProbe('create-module-resolved-after-abort', {}, owner);
      return;
    }

    owner.module = module;
    window.astoniaNativeModule = module;
    reportNativeAudioState(module);
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
  elements.launchButton.addEventListener('click', unlockAudioFromGesture);
  elements.form.addEventListener('submit', startNativeClient);
  elements.audioUnlockButton.addEventListener('click', unlockAudioFromGesture);
  window.addEventListener('keydown', (event) => forwardNativeKey(event, '_astonia_wasm_input_key_down'));
  window.addEventListener('keyup', (event) => forwardNativeKey(event, '_astonia_wasm_input_key_up'));
  window.addEventListener('keypress', forwardNativeText);
  updateAudioStatusFromPlatform();
}

initializeForm();
await Promise.all([checkWebGpu(), checkNativeArtifacts()]);
