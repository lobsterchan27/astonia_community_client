# Sokol

This directory vendors the Sokol headers used by the WASM/WebGPU renderer
backend.

- Upstream: <https://github.com/floooh/sokol>
- Pinned commit: `ae0bc31daad8a60457cad4b5dae9223f237b2e34`
- License: zlib/libpng, preserved in `LICENSE`

Refresh command:

```bash
for f in LICENSE sokol_app.h sokol_gfx.h sokol_glue.h sokol_log.h; do
  curl -fsSL "https://raw.githubusercontent.com/floooh/sokol/ae0bc31daad8a60457cad4b5dae9223f237b2e34/$f" \
    -o "third_party/sokol/$f"
done
```
