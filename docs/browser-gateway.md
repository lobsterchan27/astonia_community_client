# Browser WebSocket Gateway

The development gateway lets browser code open a WebSocket while preserving the
existing Astonia TCP byte protocol. It does not decode, replay, or translate
messages; binary WebSocket payload bytes are written to the TCP server, and TCP
read chunks are emitted back as binary WebSocket messages.

## Run

From this repository:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556 \
  --target-port-range 5556-5590
```

Browser clients connect to:

```text
ws://127.0.0.1:8787
```

The defaults are `--listen 127.0.0.1:8787`, `--tcp-host 127.0.0.1`, and
`--tcp-port 5556`, matching the native client's default v3 server port. The
default per-WebSocket `target-port` allow range is `5556-5590`, matching the
local development area-server ports. If the Docker server publishes a different
host port, pass that published port as `--tcp-port`. For a v35 server, use the
port exposed for that server, commonly `27584`.

Browser clients normally connect without a query string:

```text
ws://127.0.0.1:8787
```

When the Astonia server sends `SV_SERVER`, browser code reconnects to the same
gateway URL with a `target-port` query parameter:

```text
ws://127.0.0.1:8787?target-port=5557
```

The gateway keeps the TCP host fixed to `--tcp-host`; `target-port` can only
select a TCP port inside `--target-port-range`. Requests outside that range are
rejected during the WebSocket handshake. Clients that omit `target-port` keep
the existing fixed `--tcp-port` behavior.

## Docker Server

Start the Astonia server container so its TCP game port is published on the host,
then point the gateway at that host mapping. For example, if Docker maps the
server's TCP game port to `127.0.0.1:5556`, run:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556 \
  --target-port-range 5556-5590
```

If Docker publishes the game port on another host or port, keep `--listen` as
the browser-facing WebSocket address and update only `--tcp-host` and
`--tcp-port` to match the Docker mapping. If area servers are published on a
different local range, update `--target-port-range` to that explicit safe range.

See `docs/browser-live-login.md` for the full three-terminal live browser login
flow: disposable Docker server, gateway, and browser dev server.

## Test

```bash
cargo test --manifest-path gateway/Cargo.toml
```
