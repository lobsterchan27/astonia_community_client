import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const browserRoot = fileURLToPath(new URL('../..', import.meta.url));
export const repoRoot = resolve(browserRoot, '..');
export const attributionArtifactDir = resolve(repoRoot, '.worktree/attribution');

export const attributionBuckets = [
  'no_freeze_observed',
  'webgpu_lifecycle_failure',
  'main_thread_starvation',
  'native_loop_not_advancing',
  'gateway_login_not_advancing',
  'asset_work_over_budget',
  'render_progress_absent',
  'unknown'
];

const nativeGetterGroups = {
  startup: [
    ['status', '_astonia_native_startup_adapter_status'],
    ['startupResult', '_astonia_native_startup_adapter_startup_result'],
    ['loopInitResult', '_astonia_native_startup_adapter_loop_init_result'],
    ['frameCount', '_astonia_native_startup_adapter_frame_count'],
    ['stepCount', '_astonia_native_startup_adapter_step_count'],
    ['shutdownCount', '_astonia_native_startup_adapter_shutdown_count'],
    ['hasUsername', '_astonia_native_startup_adapter_has_username'],
    ['hasPassword', '_astonia_native_startup_adapter_has_password'],
    ['hasServerUrl', '_astonia_native_startup_adapter_has_server_url'],
    ['wantWidth', '_astonia_native_startup_adapter_want_width'],
    ['wantHeight', '_astonia_native_startup_adapter_want_height'],
    ['threadCount', '_astonia_native_startup_adapter_thread_count']
  ],
  gatewayLogin: [
    ['loginDone', '_astonia_smoke_login_done'],
    ['sockstate', '_astonia_smoke_sockstate'],
    ['protocolVersion', '_astonia_smoke_protocol_version'],
    ['tick', '_astonia_smoke_tick'],
    ['queuedTicks', '_astonia_smoke_queued_ticks'],
    ['queueSize', '_astonia_smoke_queue_size']
  ],
  render: [
    ['renderBeginCount', '_astonia_smoke_render_begin_count'],
    ['renderPresentCount', '_astonia_smoke_render_present_count'],
    ['renderPresentFailureCount', '_astonia_smoke_render_present_failure_count'],
    ['textureCreateCount', '_astonia_smoke_texture_create_count'],
    ['textureUploadCount', '_astonia_smoke_texture_upload_count'],
    ['textureBlitCount', '_astonia_smoke_texture_blit_count'],
    ['textureJobQueueCount', '_astonia_smoke_texture_job_queue_count'],
    ['textureJobQueuePeak', '_astonia_smoke_texture_job_queue_peak'],
    ['textureJobEnqueueCount', '_astonia_smoke_texture_job_enqueue_count'],
    ['textureJobDropCount', '_astonia_smoke_texture_job_drop_count'],
    ['textureCpuWorkCount', '_astonia_smoke_texture_cpu_work_count']
  ]
};

const webGpuConsolePrefix = '[attribution-webgpu]';

function boundedPush(values, value, maxSamples) {
  values.push(value);
  if (values.length > maxSamples) {
    values.shift();
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function maxNumber(values) {
  const numbers = values.filter((value) => Number.isFinite(value));
  return numbers.length ? Math.max(...numbers) : 0;
}

function parseTargetPort(url) {
  try {
    const parsed = new URL(String(url));
    const targetPort = parsed.searchParams.get('target-port');
    return targetPort === null ? null : numberOrNull(targetPort);
  } catch {
    return null;
  }
}

function parseConsoleJsonWithPrefix(messages, prefix) {
  const parsed = [];
  for (const message of messages ?? []) {
    const text = String(message.text ?? '');
    if (!text.includes(prefix)) {
      continue;
    }
    const jsonStart = text.indexOf('{');
    if (jsonStart < 0) {
      continue;
    }
    try {
      parsed.push(JSON.parse(text.slice(jsonStart)));
    } catch {
      // Keep malformed console payloads out of the canonical JSON.
    }
  }
  return parsed;
}

export function collectPageEvidence(page, { consoleLimit = 500 } = {}) {
  const consoleMessages = [];
  const pageErrors = [];

  page.on('console', (message) => {
    boundedPush(consoleMessages, { type: message.type(), text: message.text() }, consoleLimit);
  });
  page.on('pageerror', (error) => {
    boundedPush(pageErrors, String(error?.stack || error?.message || error), consoleLimit);
  });

  return { consoleMessages, pageErrors };
}

export async function installAttributionProbe(page, { maxSamples = 1000, timerIntervalMs = 100, wrapWebGpu = true } = {}) {
  await page.addInitScript(
    ({
      maxSamples: probeMaxSamples,
      timerIntervalMs: probeTimerIntervalMs,
      nativeGetterGroups: getterGroups,
      wrapWebGpu: probeWrapWebGpu
    }) => {
      const nowMs = () => Number(performance.now().toFixed(3));
      const push = (values, value) => {
        values.push(value);
        if (values.length > probeMaxSamples) {
          values.shift();
        }
      };
      const byteLength = (data) => {
        if (typeof data === 'string') {
          return data.length;
        }
        if (data instanceof ArrayBuffer) {
          return data.byteLength;
        }
        if (ArrayBuffer.isView(data)) {
          return data.byteLength;
        }
        if (typeof Blob !== 'undefined' && data instanceof Blob) {
          return data.size;
        }
        return null;
      };
      const targetPort = (url) => {
        try {
          const parsed = new URL(String(url), window.location.href);
          const value = parsed.searchParams.get('target-port');
          return value === null ? null : Number(value);
        } catch {
          return null;
        }
      };

      const probe = {
        startedAt: nowMs(),
        host: {
          timer: { intervalMs: probeTimerIntervalMs, count: 0, ticks: [] },
          raf: { count: 0, ticks: [] }
        },
        webgpu: {
          events: [],
          deviceLost: { observed: false, reason: null, message: null, elapsedMs: null }
        },
        gateway: {
          connections: [],
          counts: {
            constructed: 0,
            open: 0,
            read: 0,
            close: 0,
            error: 0,
            send: 0,
            bytesRead: 0,
            bytesSent: 0
          }
        },
        nativeSamples: []
      };
      window.astoniaAttributionProbe = probe;

      window.astoniaAttributionRecordWebGpu = (stage, detail = {}) => {
        const event = {
          sequence: probe.webgpu.events.length + 1,
          elapsedMs: Number((nowMs() - probe.startedAt).toFixed(3)),
          stage,
          detail
        };
        push(probe.webgpu.events, event);
        if (stage === 'device-lost') {
          probe.webgpu.deviceLost = {
            observed: true,
            reason: detail.reason ?? null,
            message: detail.message ?? null,
            elapsedMs: event.elapsedMs
          };
        }
        console.debug('[attribution-webgpu]', JSON.stringify(event));
        return event;
      };

      const readExport = (module, exportName, missingExports) => {
        const fn = module?.[exportName];
        if (typeof fn !== 'function') {
          missingExports.push(exportName);
          return null;
        }
        try {
          const value = fn();
          return typeof value === 'bigint' ? Number(value) : Number(value);
        } catch (error) {
          missingExports.push(`${exportName}: ${error instanceof Error ? error.message : String(error)}`);
          return null;
        }
      };

      window.astoniaAttributionReadNativeSample = () => {
        const module = window.astoniaNativeModule;
        if (!module) {
          return null;
        }

        const missingExports = [];
        const sample = {
          elapsedMs: Number((nowMs() - probe.startedAt).toFixed(3)),
          startup: {},
          gatewayLogin: {},
          render: {},
          missingExports
        };

        for (const [groupName, getters] of Object.entries(getterGroups)) {
          for (const [key, exportName] of getters) {
            sample[groupName][key] = readExport(module, exportName, missingExports);
          }
        }

        return sample;
      };

      let previousTimerAt = probe.startedAt;
      window.setInterval(() => {
        const current = nowMs();
        const tick = {
          count: ++probe.host.timer.count,
          elapsedMs: Number((current - probe.startedAt).toFixed(3)),
          deltaMs: Number((current - previousTimerAt).toFixed(3))
        };
        previousTimerAt = current;
        push(probe.host.timer.ticks, tick);
        document.documentElement.dataset.astoniaAttributionTimerTick = String(tick.count);

        const nativeSample = window.astoniaAttributionReadNativeSample();
        if (nativeSample) {
          push(probe.nativeSamples, nativeSample);
        }
      }, probeTimerIntervalMs);

      if (typeof window.requestAnimationFrame === 'function') {
        let previousRafAt = null;
        const rafLoop = (timestamp) => {
          const current = Number(timestamp.toFixed(3));
          const tick = {
            count: ++probe.host.raf.count,
            elapsedMs: Number((current - probe.startedAt).toFixed(3)),
            deltaMs: previousRafAt === null ? 0 : Number((current - previousRafAt).toFixed(3))
          };
          previousRafAt = current;
          push(probe.host.raf.ticks, tick);
          window.requestAnimationFrame(rafLoop);
        };
        window.requestAnimationFrame(rafLoop);
      }

      const NativeWebSocket = window.WebSocket;
      if (typeof NativeWebSocket === 'function') {
        window.WebSocket = new Proxy(NativeWebSocket, {
          construct(Target, args) {
            const url = String(args[0]);
            const connection = {
              id: probe.gateway.connections.length + 1,
              url,
              targetPort: targetPort(url),
              createdElapsedMs: Number((nowMs() - probe.startedAt).toFixed(3)),
              openCount: 0,
              readCount: 0,
              closeCount: 0,
              errorCount: 0,
              sendCount: 0,
              bytesRead: 0,
              bytesSent: 0,
              closeEvents: []
            };
            probe.gateway.counts.constructed++;
            push(probe.gateway.connections, connection);

            const socket = Reflect.construct(Target, args);
            socket.addEventListener('open', () => {
              connection.openCount++;
              probe.gateway.counts.open++;
            });
            socket.addEventListener('message', (event) => {
              const length = byteLength(event.data);
              connection.readCount++;
              probe.gateway.counts.read++;
              if (length !== null) {
                connection.bytesRead += length;
                probe.gateway.counts.bytesRead += length;
              }
            });
            socket.addEventListener('close', (event) => {
              connection.closeCount++;
              probe.gateway.counts.close++;
              push(connection.closeEvents, {
                code: event.code,
                reason: String(event.reason || ''),
                wasClean: event.wasClean
              });
            });
            socket.addEventListener('error', () => {
              connection.errorCount++;
              probe.gateway.counts.error++;
            });

            const nativeSend = socket.send.bind(socket);
            socket.send = (data) => {
              const length = byteLength(data);
              connection.sendCount++;
              probe.gateway.counts.send++;
              if (length !== null) {
                connection.bytesSent += length;
                probe.gateway.counts.bytesSent += length;
              }
              return nativeSend(data);
            };
            return socket;
          }
        });
      }

      const wrapDevice = (device) => {
        if (!device || typeof device !== 'object') {
          return device;
        }
        const lost = device.lost;
        if (lost && typeof lost.then === 'function') {
          lost
            .then((info) => {
              window.astoniaAttributionRecordWebGpu('device-lost', {
                reason: info?.reason ?? null,
                message: info?.message ?? null
              });
            })
            .catch((error) => {
              window.astoniaAttributionRecordWebGpu('device-lost-promise-error', {
                message: error instanceof Error ? error.message : String(error)
              });
            });
        }
        return new Proxy(device, {
          get(target, prop, receiver) {
            if (prop === 'destroy' && typeof target.destroy === 'function') {
              return (...args) => {
                window.astoniaAttributionRecordWebGpu('device-destroy', {});
                return target.destroy.apply(target, args);
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        });
      };

      const wrapAdapter = (adapter) => {
        if (!adapter || typeof adapter !== 'object') {
          return adapter;
        }
        return new Proxy(adapter, {
          get(target, prop, receiver) {
            if (prop === 'requestDevice' && typeof target.requestDevice === 'function') {
              return async (...args) => {
                window.astoniaAttributionRecordWebGpu('request-device', {});
                const device = await target.requestDevice.apply(target, args);
                window.astoniaAttributionRecordWebGpu('device-resolved', {});
                return wrapDevice(device);
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        });
      };

      const wrapGpu = (gpu) => {
        if (!gpu || typeof gpu !== 'object') {
          return gpu;
        }
        return new Proxy(gpu, {
          get(target, prop, receiver) {
            if (prop === 'requestAdapter' && typeof target.requestAdapter === 'function') {
              return async (...args) => {
                window.astoniaAttributionRecordWebGpu('request-adapter', {});
                const adapter = await target.requestAdapter.apply(target, args);
                window.astoniaAttributionRecordWebGpu(adapter ? 'adapter-resolved' : 'adapter-missing', {});
                return wrapAdapter(adapter);
              };
            }
            return Reflect.get(target, prop, receiver);
          }
        });
      };

      if (probeWrapWebGpu) {
        try {
          const nativeGpu = navigator.gpu;
          if (nativeGpu) {
            const wrappedGpu = wrapGpu(nativeGpu);
            Object.defineProperty(Navigator.prototype, 'gpu', {
              configurable: true,
              get() {
                return wrappedGpu;
              }
            });
          } else {
            window.astoniaAttributionRecordWebGpu('navigator-gpu-unavailable', {});
          }
        } catch (error) {
          window.astoniaAttributionRecordWebGpu('navigator-gpu-wrap-error', {
            message: error instanceof Error ? error.message : String(error)
          });
        }

        const nativeGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
          const context = nativeGetContext.call(this, type, ...args);
          if (type !== 'webgpu' || !context || typeof context !== 'object') {
            return context;
          }
          window.astoniaAttributionRecordWebGpu('canvas-webgpu-context', {
            width: this.width,
            height: this.height
          });
          return new Proxy(context, {
            get(target, prop, receiver) {
              if (prop === 'configure' && typeof target.configure === 'function') {
                return (...configureArgs) => {
                  window.astoniaAttributionRecordWebGpu('surface-configure', {});
                  return target.configure.apply(target, configureArgs);
                };
              }
              if (prop === 'getCurrentTexture' && typeof target.getCurrentTexture === 'function') {
                return (...textureArgs) => {
                  window.astoniaAttributionRecordWebGpu('surface-current-texture', {});
                  return target.getCurrentTexture.apply(target, textureArgs);
                };
              }
              return Reflect.get(target, prop, receiver);
            }
          });
        };
      } else {
        window.astoniaAttributionRecordWebGpu('navigator-gpu-wrap-skipped', {});
      }
    },
    { maxSamples, timerIntervalMs, nativeGetterGroups, wrapWebGpu }
  );
}

export async function installMockWebGpuAttribution(page, { deviceLostAfterMs = null } = {}) {
  await page.addInitScript(({ deviceLostAfterMs: lostAfterMs }) => {
    const record = (stage, detail = {}) => window.astoniaAttributionRecordWebGpu?.(stage, detail);
    const limits = {
      maxTextureDimension1D: 8192,
      maxTextureDimension2D: 8192,
      maxTextureDimension3D: 2048,
      maxTextureArrayLayers: 256,
      maxBindGroups: 4,
      maxBindGroupsPlusVertexBuffers: 24,
      maxBindingsPerBindGroup: 1000,
      maxDynamicUniformBuffersPerPipelineLayout: 8,
      maxDynamicStorageBuffersPerPipelineLayout: 4,
      maxSampledTexturesPerShaderStage: 16,
      maxSamplersPerShaderStage: 16,
      maxStorageBuffersPerShaderStage: 8,
      maxStorageTexturesPerShaderStage: 4,
      maxUniformBuffersPerShaderStage: 12,
      minUniformBufferOffsetAlignment: 256,
      minStorageBufferOffsetAlignment: 256,
      maxUniformBufferBindingSize: 65536,
      maxStorageBufferBindingSize: 134217728,
      maxVertexBuffers: 8,
      maxBufferSize: 268435456,
      maxVertexAttributes: 16,
      maxVertexBufferArrayStride: 2048
    };
    const pass = {
      setPipeline() {},
      setBindGroup() {},
      setVertexBuffer() {},
      setIndexBuffer() {},
      setBlendConstant() {},
      setStencilReference() {},
      draw() {},
      drawIndexed() {},
      end() {}
    };
    const texture = {
      createView() {
        return {};
      },
      destroy() {
        record('texture-destroy', {});
      }
    };
    const commandEncoder = {
      beginRenderPass() {
        return pass;
      },
      beginComputePass() {
        return pass;
      },
      finish() {
        return {};
      }
    };
    let resolveLost;
    const lost = new Promise((resolve) => {
      resolveLost = resolve;
    });
    const device = {
      features: new Set(),
      limits,
      queue: {
        submit() {},
        writeBuffer() {},
        writeTexture() {}
      },
      lost,
      createTexture() {
        return texture;
      },
      createShaderModule() {
        return {};
      },
      createBuffer(desc = {}) {
        const size = Number(desc.size ?? 0);
        return {
          getMappedRange() {
            return new ArrayBuffer(size);
          },
          unmap() {},
          destroy() {}
        };
      },
      createSampler() {
        return {};
      },
      createBindGroupLayout() {
        return {};
      },
      createBindGroup() {
        return {};
      },
      createPipelineLayout() {
        return {};
      },
      createRenderPipeline() {
        return {};
      },
      createComputePipeline() {
        return {};
      },
      createCommandEncoder() {
        return commandEncoder;
      },
      destroy() {
        record('device-destroy', {});
      }
    };
    if (Number.isFinite(lostAfterMs)) {
      window.setTimeout(() => {
        resolveLost({ reason: 'destroyed', message: 'mock device lost by attribution probe' });
      }, lostAfterMs);
    }
    device.lost.then((info) =>
      record('device-lost', {
        reason: info?.reason ?? null,
        message: info?.message ?? null
      })
    );
    const adapter = {
      features: new Set(),
      limits,
      async requestDevice() {
        record('request-device', {});
        record('device-resolved', {});
        return device;
      }
    };
    const nativeGetContext = HTMLCanvasElement.prototype.getContext;

    HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
      if (type === 'webgpu') {
        record('canvas-webgpu-context', { width: this.width, height: this.height });
        return {
          canvas: this,
          configure() {
            record('surface-configure', {});
          },
          getCurrentTexture() {
            record('surface-current-texture', {});
            return texture;
          }
        };
      }

      return nativeGetContext.call(this, type, ...args);
    };

    Object.defineProperty(Navigator.prototype, 'gpu', {
      configurable: true,
      get() {
        return {
          async requestAdapter() {
            record('request-adapter', {});
            record('adapter-resolved', {});
            return adapter;
          },
          getPreferredCanvasFormat() {
            return 'bgra8unorm';
          }
        };
      }
    });
  }, { deviceLostAfterMs });
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function evaluateWithTimeout(page, fn, arg, timeoutMs, label) {
  let timeout;
  try {
    return await Promise.race([
      page.evaluate(fn, arg),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

export async function runAttributionSampling(
  page,
  { durationMs = 5000, pingIntervalMs = 500, evaluationTimeoutMs = 2000 } = {}
) {
  const startedAt = Date.now();
  const deadline = startedAt + durationMs;
  const pings = [];
  const evalTimeouts = [];

  while (Date.now() < deadline) {
    const sequence = pings.length + 1;
    const pingStartedAt = Date.now();
    try {
      const ping = await evaluateWithTimeout(
        page,
        (nextSequence) => {
          const probe = window.astoniaAttributionProbe;
          const marker = `attribution-eval-${nextSequence}`;
          document.body.dataset.astoniaAttributionEval = marker;
          const immediateNativeSample = window.astoniaAttributionReadNativeSample?.();
          if (immediateNativeSample && probe) {
            probe.nativeSamples.push(immediateNativeSample);
            if (probe.nativeSamples.length > 1000) {
              probe.nativeSamples.shift();
            }
          }

          return {
            sequence: nextSequence,
            elapsedMs: probe ? Number((performance.now() - probe.startedAt).toFixed(3)) : null,
            marker,
            domMarker: document.body.dataset.astoniaAttributionEval,
            domTimerTick: document.documentElement.dataset.astoniaAttributionTimerTick ?? null,
            timerTickCount: probe?.host.timer.count ?? 0,
            rafTickCount: probe?.host.raf.count ?? 0,
            latestNativeSample: immediateNativeSample ?? probe?.nativeSamples.at(-1) ?? null
          };
        },
        sequence,
        evaluationTimeoutMs,
        'browser attribution eval probe'
      );
      pings.push({
        ...ping,
        roundTripMs: Date.now() - pingStartedAt,
        wallElapsedMs: Date.now() - startedAt
      });
    } catch (error) {
      evalTimeouts.push({
        sequence,
        wallElapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error)
      });
      break;
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await sleep(Math.min(pingIntervalMs, remainingMs));
    }
  }

  return {
    requestedDurationMs: durationMs,
    pingIntervalMs,
    evaluationTimeoutMs,
    pings,
    evalTimeouts,
    browserEvaluationTimedOut: evalTimeouts.length > 0,
    actualDurationMs: Date.now() - startedAt
  };
}

async function readAttributionSnapshot(page, timeoutMs = 2000) {
  try {
    return await evaluateWithTimeout(
      page,
      () => {
        const probe = window.astoniaAttributionProbe;
        if (!probe) {
          return null;
        }
        const summarizeBrowserCadence = (ticks) => {
          const deltas = ticks.map((tick) => Number(tick.deltaMs)).filter(Number.isFinite);
          return {
            count: ticks.at(-1)?.count ?? 0,
            longestGapMs: deltas.length ? Math.max(...deltas) : 0,
            lastDeltaMs: deltas.at(-1) ?? 0,
            recentTicks: ticks.slice(-20)
          };
        };
        const immediateNativeSample = window.astoniaAttributionReadNativeSample?.();
        if (immediateNativeSample) {
          probe.nativeSamples.push(immediateNativeSample);
          if (probe.nativeSamples.length > 1000) {
            probe.nativeSamples.shift();
          }
        }

        return {
          elapsedMs: Number((performance.now() - probe.startedAt).toFixed(3)),
          host: {
            timer: summarizeBrowserCadence(probe.host.timer.ticks),
            raf: summarizeBrowserCadence(probe.host.raf.ticks)
          },
          webgpu: probe.webgpu,
          gateway: probe.gateway,
          nativeSamples: probe.nativeSamples
        };
      },
      undefined,
      timeoutMs,
      'browser attribution snapshot'
    );
  } catch (error) {
    return {
      timedOut: true,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function getPath(object, path) {
  return path.reduce((current, key) => (current == null ? null : current[key]), object);
}

function delta(first, last, path) {
  const start = numberOrNull(getPath(first, path));
  const end = numberOrNull(getPath(last, path));
  return start === null || end === null ? null : end - start;
}

function summarizeNativeSamples(samples) {
  const first = samples[0] ?? null;
  const last = samples.at(-1) ?? null;
  const missingExports = [...new Set(samples.flatMap((sample) => sample.missingExports ?? []))].sort();

  return {
    sampleCount: samples.length,
    first,
    last,
    missingExports,
    deltas: {
      startupFrameCount: delta(first, last, ['startup', 'frameCount']),
      startupStepCount: delta(first, last, ['startup', 'stepCount']),
      shutdownCount: delta(first, last, ['startup', 'shutdownCount']),
      tick: delta(first, last, ['gatewayLogin', 'tick']),
      queuedTicks: delta(first, last, ['gatewayLogin', 'queuedTicks']),
      queueSize: delta(first, last, ['gatewayLogin', 'queueSize']),
      renderBeginCount: delta(first, last, ['render', 'renderBeginCount']),
      renderPresentCount: delta(first, last, ['render', 'renderPresentCount']),
      renderPresentFailureCount: delta(first, last, ['render', 'renderPresentFailureCount']),
      textureCreateCount: delta(first, last, ['render', 'textureCreateCount']),
      textureUploadCount: delta(first, last, ['render', 'textureUploadCount']),
      textureBlitCount: delta(first, last, ['render', 'textureBlitCount']),
      textureJobQueueCount: delta(first, last, ['render', 'textureJobQueueCount']),
      textureJobQueuePeak: delta(first, last, ['render', 'textureJobQueuePeak']),
      textureJobEnqueueCount: delta(first, last, ['render', 'textureJobEnqueueCount']),
      textureJobDropCount: delta(first, last, ['render', 'textureJobDropCount']),
      textureCpuWorkCount: delta(first, last, ['render', 'textureCpuWorkCount'])
    }
  };
}

function ruleEvidence(rule, observations) {
  return { rule, observations };
}

export function classifyAttribution(artifact) {
  const native = artifact.native.summary;
  const last = native.last;
  const deltas = native.deltas;
  const webgpu = artifact.webgpu;
  const host = artifact.host;
  const gateway = artifact.gateway;

  const evidence = [];
  const normalDeviceLost =
    webgpu.deviceLost?.observed &&
    webgpu.deviceLost.reason === 'destroyed' &&
    (last?.startup?.shutdownCount ?? 0) > 0 &&
    webgpu.lifecycleEvents.some((event) => event.stage === 'device-destroy');
  const deviceLostUnexpected = webgpu.deviceLost?.observed && !normalDeviceLost;
  const webgpuFailureEvent = webgpu.lifecycleEvents.find((event) => {
    if (event.stage === 'device-lost' && normalDeviceLost) {
      return false;
    }
    return /(?:error|failed|missing|lost)/i.test(event.stage);
  });
  if (deviceLostUnexpected || webgpuFailureEvent) {
    evidence.push(
      ruleEvidence('webgpu lifecycle failed before a normal native teardown', {
        deviceLost: webgpu.deviceLost,
        event: webgpuFailureEvent ?? null,
        shutdownCount: last?.startup?.shutdownCount ?? null
      })
    );
    return { bucket: 'webgpu_lifecycle_failure', evidence };
  }

  const longestHostGapMs = Math.max(
    host.responsiveness.timer.longestGapMs ?? 0,
    host.responsiveness.raf.longestGapMs ?? 0,
    host.responsiveness.longestEvalRoundTripMs ?? 0
  );
  if (host.browserEvaluationTimedOut || longestHostGapMs >= host.responsiveness.starvationThresholdMs) {
    evidence.push(
      ruleEvidence('host event loop stopped responding within the probe window', {
        browserEvaluationTimedOut: host.browserEvaluationTimedOut,
        longestHostGapMs,
        starvationThresholdMs: host.responsiveness.starvationThresholdMs,
        evalTimeouts: host.evalTimeouts
      })
    );
    return { bucket: 'main_thread_starvation', evidence };
  }

  const frameDelta = deltas.startupFrameCount ?? 0;
  const stepDelta = deltas.startupStepCount ?? 0;
  const renderPresentDelta = deltas.renderPresentCount ?? 0;
  const startupOk = last?.startup?.startupResult === 0 && last?.startup?.loopInitResult === 0;
  const moduleRunning = last?.startup?.status === 2 || frameDelta > 0 || stepDelta > 0;
  if ((startupOk || moduleRunning) && frameDelta <= 0 && stepDelta <= 0) {
    evidence.push(
      ruleEvidence('native module is running but frame and step counters did not advance', {
        startup: last?.startup ?? null,
        frameDelta,
        stepDelta
      })
    );
    return { bucket: 'native_loop_not_advancing', evidence };
  }

  const loginEstablished =
    (last?.gatewayLogin?.loginDone ?? 0) > 0 ||
    (last?.gatewayLogin?.protocolVersion ?? 0) > 0 ||
    (last?.gatewayLogin?.sockstate ?? 0) >= 4;
  if (gateway.enabled && (frameDelta > 0 || stepDelta > 0) && !loginEstablished) {
    evidence.push(
      ruleEvidence('gateway/live login did not advance while native loop and host stayed responsive', {
        gatewayCounts: gateway.counts,
        connections: gateway.connections,
        gatewayLogin: last?.gatewayLogin ?? null,
        tickDelta: deltas.tick ?? null,
        queuedTicksDelta: deltas.queuedTicks ?? null,
        queueSizeDelta: deltas.queueSize ?? null,
        frameDelta,
        stepDelta
      })
    );
    return { bucket: 'gateway_login_not_advancing', evidence };
  }

  const textureQueueBacklog = (last?.render?.textureJobQueueCount ?? 0) > 0;
  const textureDrops = (deltas.textureJobDropCount ?? 0) > 0;
  const assetProgressDelta = (deltas.textureCpuWorkCount ?? 0) + (deltas.textureUploadCount ?? 0);
  if ((frameDelta > 0 || stepDelta > 0) && (textureDrops || (textureQueueBacklog && assetProgressDelta <= 0))) {
    evidence.push(
      ruleEvidence('texture asset queue stayed backlogged or dropped work without CPU/upload progress', {
        render: last?.render ?? null,
        assetProgressDelta,
        textureDrops,
        frameDelta,
        stepDelta
      })
    );
    return { bucket: 'asset_work_over_budget', evidence };
  }

  if (frameDelta > 0 && stepDelta > 0 && (!gateway.enabled || loginEstablished) && renderPresentDelta > 0) {
    evidence.push(
      ruleEvidence('host, native loop, gateway/login, and render progress advanced during the probe window', {
        gatewayEnabled: gateway.enabled,
        loginEstablished,
        frameDelta,
        stepDelta,
        renderPresentDelta,
        gatewayLogin: last?.gatewayLogin ?? null,
        render: last?.render ?? null
      })
    );
    return { bucket: 'no_freeze_observed', evidence };
  }

  if ((frameDelta > 0 || stepDelta > 0) && renderPresentDelta <= 0) {
    evidence.push(
      ruleEvidence('native loop advanced but render present counter did not advance', {
        render: last?.render ?? null,
        renderPresentDelta,
        frameDelta,
        stepDelta
      })
    );
    return { bucket: 'render_progress_absent', evidence };
  }

  evidence.push(
    ruleEvidence('no attribution rule matched', {
      startup: last?.startup ?? null,
      gatewayLogin: last?.gatewayLogin ?? null,
      render: last?.render ?? null,
      deltas
    })
  );
  return { bucket: 'unknown', evidence };
}

export async function buildAttributionArtifact(
  page,
  {
    mode,
    inputs = {},
    pageEvidence = {},
    sampling = null,
    outcome = {},
    snapshotTimeoutMs = 2000,
    starvationThresholdMs = 2000
  } = {}
) {
  const snapshot = await readAttributionSnapshot(page, snapshotTimeoutMs);
  const pings = sampling?.pings ?? [];
  const pingNativeSamples = pings.map((ping) => ping.latestNativeSample).filter(Boolean);
  const nativeSamples = snapshot?.nativeSamples?.length ? snapshot.nativeSamples : pingNativeSamples;
  const webgpuEvents = snapshot?.webgpu?.events?.length
    ? snapshot.webgpu.events
    : parseConsoleJsonWithPrefix(pageEvidence.consoleMessages, webGpuConsolePrefix);
  const deviceLostEvent = webgpuEvents.find((event) => event.stage === 'device-lost');
  const deviceLost = snapshot?.webgpu?.deviceLost ?? {
    observed: Boolean(deviceLostEvent),
    reason: deviceLostEvent?.detail?.reason ?? null,
    message: deviceLostEvent?.detail?.message ?? null,
    elapsedMs: deviceLostEvent?.elapsedMs ?? null
  };
  const fallbackWebSocketUrls = [
    ...(outcome.webSocketUrls ?? []),
    ...(outcome.progressStart?.webSocketUrls ?? []),
    ...(outcome.progressEnd?.webSocketUrls ?? [])
  ];
  const fallbackConnections = [...new Set(fallbackWebSocketUrls)].map((url, index) => ({
    id: index + 1,
    url,
    targetPort: parseTargetPort(url),
    createdElapsedMs: null,
    openCount: null,
    readCount: null,
    closeCount: null,
    errorCount: null,
    sendCount: null,
    bytesRead: null,
    bytesSent: null,
    closeEvents: []
  }));
  const gatewayConnections = snapshot?.gateway?.connections?.length ? snapshot.gateway.connections : fallbackConnections;
  const gatewayCounts = snapshot?.gateway?.counts ?? {
    constructed: fallbackConnections.length,
    open: null,
    read: null,
    close: null,
    error: null,
    send: null,
    bytesRead: null,
    bytesSent: null
  };
  const artifact = {
    schemaVersion: 1,
    artifactKind: 'astonia_wasm_browser_attribution',
    run: {
      id: `${Date.now()}`,
      generatedAt: new Date().toISOString(),
      mode,
      repoRoot,
      browserRoot
    },
    inputs,
    host: {
      browserEvaluationTimedOut: Boolean(sampling?.browserEvaluationTimedOut || snapshot?.timedOut),
      evalTimeouts: [...(sampling?.evalTimeouts ?? []), ...(snapshot?.timedOut ? [{ message: snapshot.error }] : [])],
      responsiveness: {
        requestedDurationMs: sampling?.requestedDurationMs ?? null,
        actualDurationMs: sampling?.actualDurationMs ?? null,
        pingIntervalMs: sampling?.pingIntervalMs ?? null,
        evaluationTimeoutMs: sampling?.evaluationTimeoutMs ?? null,
        starvationThresholdMs,
        pingCount: pings.length,
        longestEvalRoundTripMs: maxNumber(pings.map((ping) => ping.roundTripMs)),
        timer: snapshot?.host?.timer ?? { count: 0, longestGapMs: 0, lastDeltaMs: 0, recentTicks: [] },
        raf: snapshot?.host?.raf ?? { count: 0, longestGapMs: 0, lastDeltaMs: 0, recentTicks: [] },
        recentPings: pings.slice(-50)
      },
      consoleMessages: pageEvidence.consoleMessages ?? [],
      pageErrors: pageEvidence.pageErrors ?? []
    },
    webgpu: {
      deviceLost,
      lifecycleEvents: webgpuEvents
    },
    native: {
      getterGroups: nativeGetterGroups,
      samples: nativeSamples.slice(-250),
      summary: summarizeNativeSamples(nativeSamples)
    },
    gateway: {
      enabled: Boolean(inputs.liveFixtureEnabled || inputs.gatewayUrl || snapshot?.gateway?.connections?.length),
      url: inputs.gatewayUrl ?? null,
      targetPort: inputs.gatewayUrl ? parseTargetPort(inputs.gatewayUrl) : null,
      counts: gatewayCounts,
      connections: gatewayConnections,
      bytePipeTestReferences: inputs.bytePipeTestReferences ?? [
        {
          name: 'wasm-net-shim byte-pipe harness',
          command: 'cd browser && ASTONIA_EMSDK_ROOT=/path/to/emsdk npm test -- tests/wasm-net-shim.spec.mjs',
          artifact: null,
          status: 'not-run-by-attribution-probe'
        }
      ]
    },
    outcome
  };
  artifact.classification = classifyAttribution(artifact);
  return artifact;
}

export async function writeAttributionArtifact(testInfo, artifact, name) {
  mkdirSync(attributionArtifactDir, { recursive: true });
  const safeName = String(name || artifact.run.mode || 'attribution').replace(/[^A-Za-z0-9_.-]+/g, '-');
  const path = resolve(attributionArtifactDir, `${safeName}-${artifact.run.id}.summary.json`);
  artifact.artifactPath = path;
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  if (testInfo) {
    await testInfo.attach('wasm-browser-attribution-summary', { path, contentType: 'application/json' });
  }
  return path;
}

export function sampleHasInitialServerData(sample) {
  return sample.loginDone > 0 || sample.protocolVersion > 0 || sample.tick > 0 || sample.queueSize > 0;
}
