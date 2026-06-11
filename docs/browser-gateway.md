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
  --tcp-port 5556
```

Browser clients connect to:

```text
ws://127.0.0.1:8787
```

The defaults are `--listen 127.0.0.1:8787`, `--tcp-host 127.0.0.1`, and
`--tcp-port 5556`, matching the native client's default v3 server port. If the
Docker server publishes a different host port, pass that published port as
`--tcp-port`. For a v35 server, use the port exposed for that server, commonly
`27584`.

## Docker Server

Start the Astonia server container so its TCP game port is published on the host,
then point the gateway at that host mapping. For example, if Docker maps the
server's TCP game port to `127.0.0.1:5556`, run:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556
```

If Docker publishes the game port on another host or port, keep `--listen` as
the browser-facing WebSocket address and update only `--tcp-host` and
`--tcp-port` to match the Docker mapping.

## Test

```bash
cargo test --manifest-path gateway/Cargo.toml
```
