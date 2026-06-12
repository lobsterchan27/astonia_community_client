# Browser Protocol Fixtures

Protocol fixtures record browser-gateway traffic without changing the gateway.
They are intended for browser protocol tests that need repeatable framing and
tick payload samples without starting a live server for every test.

## Prerequisites

Start a disposable Astonia Docker server and publish its TCP game port on the
host. The default v3 development mapping is `127.0.0.1:5556`.

Start the browser WebSocket gateway in another terminal:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556 \
  --target-port-range 5556-5590
```

For a different Docker host port, keep `--listen` as the browser-facing
WebSocket address and pass the Docker mapping as `--tcp-host` and `--tcp-port`.
If the fixture needs area retargets, set `--target-port-range` to the explicit
safe range published by that local server.

## Dev Account

Use only a disposable local account. The fixture tool defaults to:

```text
username: FixtureCapture
password: fixturecapture
character: FixtureCapture
```

Use an alpha-only character/login name. The v3 server rejects names containing
characters such as `_` before checking the password, which produces a misleading
password-wrong response. If the Docker server does not auto-create this account
and character, create that exact account/character in the disposable dev
database before capture. Do not capture personal accounts or production
credentials. Fixture manifests redact the password, but raw outbound protocol
frames intentionally include the login byte stream for replay.

## Capture

Run from the client repository:

```bash
node tools/protocol-fixture.mjs capture fixtures/protocol/docker-login-tick \
  --gateway ws://127.0.0.1:8787 \
  --target-host 127.0.0.1 \
  --target-port 5556 \
  --server-commit "$ASTONIA_SERVER_COMMIT" \
  --username FixtureCapture \
  --password fixturecapture \
  --character FixtureCapture \
  --duration-ms 3000 \
  --max-ticks 8 \
  --max-frames 256 \
  --max-bytes 1048576
```

`--server-commit` should be the checked-out server commit used to build or run
the Docker server. `client_commit` is read from `git rev-parse HEAD` unless
overridden with `--client-commit`.

The committed fixtures under `fixtures/protocol/**` must stay small and
deterministic. Keep captures to login and initial ticks unless a later issue
explicitly needs more protocol surface.

## Check

Validate any fixture at the framing level:

```bash
node tools/protocol-fixture.mjs check fixtures/protocol/docker-login-tick
```

The check command loads `manifest.json`, reassembles inbound raw stream frames,
parses Astonia tick framing, inflates compressed tick payloads, and compares the
result with `ticks.ndjson`.

## Fixture Files

Each fixture directory contains:

- `manifest.json`: metadata including protocol version, target host/port,
  server commit, client commit, capture command, account label, limits, and
  artifact names.
- `raw-stream.ndjson`: raw inbound and outbound WebSocket payloads, base64
  encoded, preserving gateway byte chunks.
- `ticks.ndjson`: parsed inbound tick records with post-inflate payload bytes,
  base64 encoded.

`fixtures/protocol/.gitignore` narrowly unignores fixture `manifest.json` files
because the repository globally ignores `*.json`.
