import { expect, test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  attributionBuckets,
  browserRoot,
  buildAttributionArtifact,
  classifyAttribution,
  collectPageEvidence,
  installAttributionProbe,
  installMockWebGpuAttribution,
  runAttributionSampling,
  writeAttributionArtifact
} from './helpers/attribution-probe.mjs';

const distModulePath = resolve(browserRoot, 'dist/astonia-client.js');
const generatedProbeDurationMs = Number.parseInt(process.env.ASTONIA_ATTRIBUTION_PROBE_MS ?? '3000', 10);
const generatedProbeEvalTimeoutMs = 2000;

function nativeSample(overrides = {}) {
  return {
    startup: {
      status: 2,
      startupResult: 0,
      loopInitResult: 0,
      frameCount: 0,
      stepCount: 0,
      shutdownCount: 0,
      ...overrides.startup
    },
    gatewayLogin: {
      loginDone: 0,
      sockstate: 0,
      protocolVersion: 0,
      tick: 0,
      queuedTicks: 0,
      queueSize: 0,
      ...overrides.gatewayLogin
    },
    render: {
      renderBeginCount: 0,
      renderPresentCount: 0,
      renderPresentFailureCount: 0,
      textureCreateCount: 0,
      textureUploadCount: 0,
      textureBlitCount: 0,
      textureJobQueueCount: 0,
      textureJobQueuePeak: 0,
      textureJobEnqueueCount: 0,
      textureJobDropCount: 0,
      textureCpuWorkCount: 0,
      ...overrides.render
    }
  };
}

function classifiedArtifact({ first = nativeSample(), last = nativeSample(), deltas = {}, host = {}, webgpu = {}, gateway = {} }) {
  return {
    host: {
      browserEvaluationTimedOut: false,
      evalTimeouts: [],
      responsiveness: {
        timer: { longestGapMs: 0 },
        raf: { longestGapMs: 0 },
        longestEvalRoundTripMs: 0,
        starvationThresholdMs: 2000
      },
      ...host
    },
    webgpu: {
      deviceLost: { observed: false, reason: null, message: null, elapsedMs: null },
      lifecycleEvents: [],
      ...webgpu
    },
    gateway: {
      enabled: false,
      counts: { constructed: 0, open: 0, read: 0, close: 0, error: 0, send: 0, bytesRead: 0, bytesSent: 0 },
      connections: [],
      ...gateway
    },
    native: {
      summary: {
        first,
        last,
        deltas: {
          startupFrameCount: last.startup.frameCount - first.startup.frameCount,
          startupStepCount: last.startup.stepCount - first.startup.stepCount,
          renderBeginCount: last.render.renderBeginCount - first.render.renderBeginCount,
          renderPresentCount: last.render.renderPresentCount - first.render.renderPresentCount,
          textureUploadCount: last.render.textureUploadCount - first.render.textureUploadCount,
          textureCpuWorkCount: last.render.textureCpuWorkCount - first.render.textureCpuWorkCount,
          textureJobDropCount: last.render.textureJobDropCount - first.render.textureJobDropCount,
          ...deltas
        }
      }
    }
  };
}

test('classifier buckets are explicit and evidence-backed', () => {
  const cases = [
    [
      'no_freeze_observed',
      classifiedArtifact({
        last: nativeSample({
          startup: { frameCount: 5, stepCount: 5 },
          gatewayLogin: { loginDone: 1, sockstate: 4, protocolVersion: 2, tick: 2 },
          render: { renderBeginCount: 5, renderPresentCount: 5 }
        }),
        gateway: {
          enabled: true,
          counts: { constructed: 1, open: 1, read: 1, close: 0, error: 0, send: 1, bytesRead: 128, bytesSent: 16 }
        }
      })
    ],
    [
      'webgpu_lifecycle_failure',
      classifiedArtifact({
        webgpu: {
          deviceLost: { observed: true, reason: 'unknown', message: 'adapter reset', elapsedMs: 100 },
          lifecycleEvents: [{ stage: 'device-lost' }]
        }
      })
    ],
    [
      'main_thread_starvation',
      classifiedArtifact({
        host: {
          browserEvaluationTimedOut: true,
          evalTimeouts: [{ message: 'browser attribution eval probe timed out after 2000ms' }]
        }
      })
    ],
    ['native_loop_not_advancing', classifiedArtifact({})],
    [
      'gateway_login_not_advancing',
      classifiedArtifact({
        last: nativeSample({ startup: { frameCount: 5, stepCount: 5 } }),
        gateway: { enabled: true, counts: { constructed: 1, open: 1, read: 0, close: 0, error: 0, send: 1, bytesRead: 0, bytesSent: 16 } }
      })
    ],
    [
      'gateway_login_not_advancing',
      classifiedArtifact({
        last: nativeSample({
          startup: { frameCount: 5, stepCount: 5 },
          gatewayLogin: { sockstate: 0, protocolVersion: 0, loginDone: 0, tick: 2 },
          render: { renderBeginCount: 5, renderPresentCount: 5 }
        }),
        gateway: {
          enabled: true,
          counts: { constructed: 1, open: 1, read: 1, close: 1, error: 0, send: 1, bytesRead: 7, bytesSent: 16 }
        }
      })
    ],
    [
      'asset_work_over_budget',
      classifiedArtifact({
        last: nativeSample({
          startup: { frameCount: 5, stepCount: 5 },
          render: { textureJobQueueCount: 4, textureJobQueuePeak: 4 }
        })
      })
    ],
    [
      'render_progress_absent',
      classifiedArtifact({
        last: nativeSample({ startup: { frameCount: 5, stepCount: 5 } })
      })
    ],
    [
      'unknown',
      classifiedArtifact({
        first: nativeSample({ startup: { status: 4, startupResult: 1, loopInitResult: -5 } }),
        last: nativeSample({ startup: { status: 4, startupResult: 1, loopInitResult: -5 } })
      })
    ]
  ];

  for (const [expectedBucket, artifact] of cases) {
    const classification = classifyAttribution(artifact);
    expect(classification.bucket).toBe(expectedBucket);
    expect(classification.evidence.length).toBeGreaterThan(0);
  }
});

test('generated native module attribution probe emits a canonical JSON summary', async ({ page }, testInfo) => {
  test.setTimeout(generatedProbeDurationMs + 20_000);
  test.skip(!existsSync(distModulePath), 'native WASM module has not been built');

  const pageEvidence = collectPageEvidence(page);
  await installAttributionProbe(page);
  await installMockWebGpuAttribution(page);
  await page.goto('/?astonia_probe=1');
  await expect(page.getByTestId('wasm-module-status')).toHaveAttribute('data-module-state', 'ready');

  await page.locator('input[name="username"]').fill('');
  await page.locator('input[name="password"]').fill('');
  await page.getByRole('button', { name: 'Launch' }).click();
  await page.waitForFunction(() => window.astoniaNativeModule && window.astoniaWasmLaunchProbe?.events?.length > 0);

  const sampling = await runAttributionSampling(page, {
    durationMs: generatedProbeDurationMs,
    pingIntervalMs: 250,
    evaluationTimeoutMs: generatedProbeEvalTimeoutMs
  });
  const artifact = await buildAttributionArtifact(page, {
    mode: 'generated_module',
    inputs: {
      liveFixtureEnabled: false,
      generatedModule: 'browser/dist/astonia-client.js',
      durationMs: generatedProbeDurationMs,
      evaluationTimeoutMs: generatedProbeEvalTimeoutMs
    },
    pageEvidence,
    sampling,
    outcome: {
      liveFixture: 'not-enabled',
      note: 'Generated-module attribution probe ran without the disposable live server fixture.'
    }
  });
  const artifactPath = await writeAttributionArtifact(testInfo, artifact, 'generated-module-attribution');

  expect(existsSync(artifactPath)).toBe(true);
  expect(artifact.schemaVersion).toBe(1);
  expect(artifact.artifactKind).toBe('astonia_wasm_browser_attribution');
  expect(attributionBuckets).toContain(artifact.classification.bucket);
  expect(artifact.webgpu.lifecycleEvents.map((event) => event.stage)).toEqual(
    expect.arrayContaining(['request-adapter', 'adapter-resolved'])
  );
  expect(artifact.native.summary.sampleCount).toBeGreaterThan(0);
  expect(artifact.host.responsiveness.pingCount).toBeGreaterThan(0);
});
