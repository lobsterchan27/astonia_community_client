# WASM Browser Attribution Probe

The attribution probe is a Playwright-run diagnostic for the generated
WASM/Sokol WebGPU browser client. It observes platform events and exported
native counters only. Browser JavaScript must not decode Astonia protocol bytes,
decode asset archives, build render lists, or draw fallback world pixels.

## Generated-Module Probe

Build the browser artifacts first:

```bash
ASTONIA_EMSDK_ROOT=/home/bfan/astonia_community_client/.deps/emsdk make wasm
```

Run the deterministic generated-module probe:

```bash
cd browser
ASTONIA_ATTRIBUTION_PROBE_MS=5000 npm test -- tests/wasm-freeze-attribution.spec.mjs
```

The probe launches `browser/dist/astonia-client.js` through the normal browser
host with debug probe mode enabled and writes one JSON summary under:

```text
.worktree/attribution/*generated-module-attribution*.summary.json
```

If the disposable live fixture is unavailable, attach this generated-module
artifact and state that live gateway evidence was not collected.

## Live Fixture Probe

Start the disposable server and gateway from
[WASM Live Fixture](wasm-live-fixture.md), then run:

```bash
cd browser
ASTONIA_LIVE_SMOKE=1 \
ASTONIA_LIVE_GATEWAY_URL=ws://127.0.0.1:8787 \
ASTONIA_EMSDK_ROOT=/home/bfan/astonia_community_client/.deps/emsdk \
npm test -- tests/wasm-live-smoke.spec.mjs
```

The live smoke attaches the same canonical artifact shape under:

```text
.worktree/attribution/*live-smoke-attribution*.summary.json
```

## SSH, Tailscale, And Dev Server

For manual browser inspection over SSH, run the browser host on the remote
machine:

```bash
cd browser
npm run dev -- --host 0.0.0.0 --port 5173
```

Forward the browser and gateway ports:

```bash
ssh -L 5173:127.0.0.1:5173 -L 8787:127.0.0.1:8787 user@remote
```

Open `http://127.0.0.1:5173/?astonia_probe=1` locally and use gateway
`ws://127.0.0.1:8787`.

With Tailscale, start the dev server with `--host 0.0.0.0`, open
`http://<tailscale-ip>:5173/?astonia_probe=1`, and use
`ws://<tailscale-ip>:8787` as the gateway URL. For Playwright live smoke over a
Tailscale gateway, pass:

```bash
ASTONIA_LIVE_GATEWAY_URL=ws://<tailscale-ip>:8787
```

Manual dev-server inspection is useful for reproducing, but the canonical JSON
artifact is produced by the Playwright probes above.

## Artifact Schema

Each artifact has:

- `schemaVersion`: currently `1`.
- `artifactKind`: `astonia_wasm_browser_attribution`.
- `run`: run id, UTC generation time, mode, repo root, and browser root.
- `inputs`: probe duration, gateway URL when used, fixture flags, and command
  context. Passwords are not stored.
- `host`: RAF/timer/eval responsiveness, longest gaps, eval timeouts, console
  messages, and page errors.
- `webgpu`: adapter/device/surface lifecycle events and device-lost details.
- `native`: sampled exported C/WASM startup, gateway/login, render, texture,
  and asset queue counters with first/last/delta summaries.
- `gateway`: WebSocket URL/target-port evidence, open/read/close/error/send
  counts, byte counts, and byte-pipe harness references.
- `classification`: one bucket plus the exact observations that matched.
- `outcome`: probe-specific context such as live initial-data observation,
  progress samples, launch events, and fixture availability.

## Classifier Rules

Rules are evaluated in this order:

1. `webgpu_lifecycle_failure`: unexpected `device.lost`, adapter/device/surface
   failure, or WebGPU error before normal native teardown.
2. `main_thread_starvation`: browser eval timed out or RAF/timer/eval gap
   exceeded the starvation threshold.
3. `native_loop_not_advancing`: native startup is running or startup succeeded,
   but frame and step counters did not advance.
4. `gateway_login_not_advancing`: live gateway enabled, native loop advanced,
   host stayed responsive, but native login was not established. A raw `tick`
   change alone is transport/server evidence, not login completion.
5. `asset_work_over_budget`: native loop advanced while texture queue backlog or
   drops persisted without CPU/upload progress.
6. `no_freeze_observed`: host responsiveness stayed within threshold, native
   frame and step counters advanced, login was established when the live fixture
   was enabled, and render present count advanced.
7. `render_progress_absent`: native loop advanced but render present count did
   not advance.
8. `unknown`: no rule matched; attach the artifact and use the evidence fields
   to decide the next owner.

## Storage Safety

Artifacts are written only under repo-local `.worktree/attribution`, which is
ignored locally. The probe reads generated browser artifacts and, when enabled,
the disposable fixture. It does not write to `/tmp`, production storage, gateway
state, or server databases.
