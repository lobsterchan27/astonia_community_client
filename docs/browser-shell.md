# Browser Shell

The browser shell is a small standalone target under `browser/`. It serves a
live login view that connects through the WebSocket gateway, sends the native
login byte sequence, decodes inbound ticks, replays protocol state, and renders
a minimal world canvas from decoded assets. It also keeps the WebGPU capability
probe used by renderer tests.

## Setup

Install the native client assets before building or testing the full repo:

```bash
git lfs install
git lfs pull
```

The existing `.gitattributes` tracks binary client assets such as PNG, cursor,
and ZIP files through Git LFS. The browser shell does not generate or commit
binary assets.

Install the browser shell dependencies:

```bash
cd browser
npm install
npx playwright install chromium
```

## Browser Commands

Start the local browser page:

```bash
cd browser
npm run dev
```

The dev server defaults to `http://127.0.0.1:5173/`. Pass `--host` or `--port`
after `--` to override it:

```bash
npm run dev -- --host 0.0.0.0 --port 4173
```

Run the browser entrypoint smoke check:

```bash
cd browser
npm test
```

The smoke checks start the dev server, open the page in Chromium, verify that
the shell loads without console or runtime errors, wait for the WebGPU status to
report either availability or a clear fallback, and exercise the live login
lifecycle against a fake gateway plus the committed Docker login fixture.

For a live Docker server, gateway, and browser startup sequence, see
`docs/browser-live-login.md`.

## Native Build And Test

The existing native client commands are unchanged:

```bash
make
make test
```

On hosts without SDL3, SDL3_mixer, Zig, Rust, or other native dependencies, use
the repo Docker targets:

```bash
make docker-linux
make docker-linux-dev
```

`make docker-linux` runs the Linux build in Docker. `make docker-linux-dev`
opens the Linux development container; run `make test` inside that container for
the native C test suite when local host dependencies are not installed.

The browser shell uses host Node.js/npm and is intentionally separate from the
native Linux Docker image.
