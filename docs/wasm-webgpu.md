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
backend and a minimal native harness. The harness enters through the existing
`sdl_init`, `sdl_clear`, `sdl_render`, and `sdl_exit` lifecycle calls; the
WASM-only bridge delegates those calls to Sokol WebGPU. It deliberately does
not contain protocol replay, sprite rendering, network transport, asset
packaging, or the browser frame-pump split owned by later slices.

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
