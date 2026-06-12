# Browser WebSocket Gateway

The gateway is a development transport bridge for the native WASM client. It
lets browser code open a WebSocket while preserving the existing Astonia TCP byte
protocol between the gateway and the server.

The gateway must stay byte-for-byte dumb:

- No protocol decoding.
- No state replay.
- No rendering.
- No client behavior.

The real client logic belongs in the C client compiled to WASM. Browser
JavaScript may only host the generated module and provide browser APIs that C
cannot call directly, such as WebSocket transport.

## Run

From this repository:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556 \
  --target-port-range 5556-5590
```

The browser host passes the gateway URL to the native module as the `-d`
argument:

```text
ws://127.0.0.1:8787
```

When the server sends an area-server redirect, the browser network shim should
reconnect through the same gateway with a `target-port` query parameter:

```text
ws://127.0.0.1:8787?target-port=5557
```

The gateway keeps the TCP host fixed to `--tcp-host`. `target-port` can only
select a TCP port inside `--target-port-range`; requests outside that range are
rejected during the WebSocket handshake.

## Test

```bash
cargo test --manifest-path gateway/Cargo.toml
```
