# WASM/WebGPU Browser Target

The browser target is the native Astonia client compiled to WASM with a Sokol
WebGPU renderer. Browser-hosted logic is limited to platform integration.

## Boundary

Browser JavaScript is allowed to:

- Load the generated Emscripten module from `browser/dist/`.
- Own small launch UI state such as username, password, and gateway URL.
- Provide browser platform APIs to native code, including WebSocket transport
  and WebGPU handles.
- Report startup/build errors.

Browser JavaScript is not allowed to:

- Decode the Astonia protocol into game state.
- Replay ticks.
- Predict movement.
- Build render lists.
- Render sprites, tiles, or fallback world pixels.

The C client remains authoritative for protocol, simulation, input, and drawing.

## Required Slices

1. WASM/WebGPU build environment.
   Install Emscripten, verify `emcc`, and make `make wasm-check-env` pass.

2. Native loop browser entry.
   Split the blocking `main_loop()` in `src/gui/gui_core.c` into a per-frame
   step that can run under the browser frame callback without changing tick
   semantics.

3. Browser transport shim.
   Provide `astonia_net_*` symbols for WASM that use a WebSocket to the gateway
   and keep the existing byte protocol unchanged.

4. Sokol WebGPU renderer backend.
   Implement the existing client render surface for the WASM build with
   Sokol's WebGPU backend. Desktop SDL3 remains a native platform backend, not
   the browser renderer.

5. Asset filesystem.
   Package `res/` for the WASM module so native code opens the same paths it
   already expects.

6. Browser smoke.
   Launch the generated native module from `browser/`, connect through the
   gateway, and verify that the real client owns the canvas.

## Smoke Observability Oracle

Browser login smoke tests must assert native state, not decoded protocol bytes.
The native WASM module exports this read-only oracle:

- `astonia_smoke_login_done()` returns the C client `login_done` flag.
- `astonia_smoke_sockstate()` returns the C client network state.
- `astonia_smoke_protocol_version()` returns the negotiated protocol version.
- `astonia_smoke_tick()` returns the processed native game tick.
- `astonia_smoke_queued_ticks()` returns the native count of complete ticks in
  the input buffer.
- `astonia_smoke_queue_size()` returns the native queued tick count waiting for
  processing.

Until the full C client is linked into the browser module, these getters are
present with zero-valued weak fallbacks so browser tests can verify the ABI. The
final live-login smoke should wait for `sockstate == 4`, `login_done == 1`, a
non-zero `protocol_version`, and evidence of native tick progress through
`tick`, `queued_ticks`, or `queue_size`. Browser JavaScript must not parse
`SV_LOGINDONE`, `SV_PROTOCOL`, tick packet headers, or any gameplay payload to
derive those assertions.

## Live Fixture

The disposable local server and gateway setup for the future live smoke is
documented in [WASM Live Fixture](wasm-live-fixture.md). That fixture keeps the
browser transport byte-pipe based and does not add JavaScript protocol decoding.

## Commands

Install the pinned Emscripten SDK into the ignored repo-local dependency
directory:

```bash
scripts/setup-wasm-webgpu-env.sh
```

By default this installs `emsdk` tag `6.0.0` under `.deps/emsdk` and activates
it with embedded config, avoiding user-global SDK state. Override the install
path with `ASTONIA_EMSDK_ROOT=/path/to/emsdk` or the version with
`EMSDK_VERSION=...` when needed.

Check whether this host can build the target:

```bash
make wasm-check-env
```

Build the current renderer slice:

```bash
make wasm
```

This compiles `browser/dist/astonia-client.js` from the WASM-only Sokol WebGPU
backend, the WASM `astonia_net_*` browser transport shim, the packaged native
resource filesystem, and a minimal native harness. The harness enters through
the existing `sdl_init`, `sdl_clear`, `sdl_render`, and `sdl_exit` lifecycle
calls; the WASM-only render bridge delegates those calls to Sokol WebGPU. It
deliberately does not contain protocol replay, sprite rendering, or the browser
frame-pump split owned by later slices.

## Asset Filesystem

The WASM build packages the native `res/` tree with Emscripten:

```text
--preload-file res@/res
```

The generated preload output lives under `browser/dist/` as
`astonia-client.data` next to the generated JS and WASM files. `browser/dist/`
is ignored by git, so packaged asset blobs remain build outputs instead of
source files.

The package preserves native paths such as:

- `res/gx1.zip` and `res/gx1_patch.zip` for graphics archives.
- `res/sx.zip` for sound data.
- `res/font2x.png`, `res/font3x.png`, and `res/font4x.png` for font textures.
- `res/cursor/*.cur` for native cursor files.
- `res/config/*.json` for client configuration data.

Browser JavaScript does not parse archives or decode sprites. Native code keeps
using the same `fopen` and libzip path expectations; the browser runtime only
supplies the filesystem image generated by Emscripten.

Run the representative native resource path check without Emscripten:

```bash
make -f build/make/Makefile.wasm resource-fs-native-check
```

After `make wasm`, `cd browser && npm test` loads the generated module with
`noInitialRun` and calls the exported resource filesystem probe. That probe
opens representative graphics, sound, font, cursor, and config files through
the WASM filesystem and verifies signatures or JSON readability.

Run the focused browser transport shim harness:

```bash
cd browser
ASTONIA_EMSDK_ROOT=/path/to/emsdk npm test -- wasm-net-shim.spec.mjs
```

The harness compiles `tests/wasm_net_shim_harness.c` into ignored files under
`browser/dist/` and verifies connect, poll, send, recv, close, failure, and
`target-port` retargeting through a local WebSocket byte server.

Run the dependency-light renderer API check:

```bash
make -f build/make/Makefile.wasm renderer-contract-check
```

## Sokol Dependency

Sokol headers are vendored in `third_party/sokol` from upstream commit
`ae0bc31daad8a60457cad4b5dae9223f237b2e34`. The included files are:

- `sokol_app.h`
- `sokol_gfx.h`
- `sokol_glue.h`
- `sokol_log.h`
- `LICENSE`

The refresh command is documented in `third_party/sokol/README.md`.

Start the browser host:

```bash
cd browser
npm install
npm run dev -- --host 0.0.0.0 --port 5173
```

The generated native module is expected at:

```text
browser/dist/astonia-client.js
```

The browser host intentionally does not contain an alternate renderer path. If
the native WASM module is missing, it reports a build-required state instead.
