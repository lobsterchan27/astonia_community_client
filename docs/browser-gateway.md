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

Live browser smoke assertions should use the native WASM observability getters
documented in `docs/wasm-webgpu.md`, such as `astonia_smoke_login_done`,
`astonia_smoke_sockstate`, `astonia_smoke_protocol_version`, and native tick
state. The gateway and browser transport shim must continue to pipe bytes
without interpreting Astonia server opcodes.

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

## WASM Client Transport

The WASM client still calls the native `astonia_net_*` C ABI declared in
`include/astonia_net.h`. For Emscripten builds, `src/wasm/astonia_net_wasm.c`
implements those symbols and delegates only browser WebSocket operations to
`src/wasm/astonia_net_jslib.js`.

The `-d` command-line value is treated as the WebSocket gateway URL. Each
`astonia_net_connect(host, port, 0)` opens that gateway URL and sets
`target-port=<port>` on the query string while preserving existing query
parameters. This lets the existing native reconnect path retarget area-server
ports after `SV_SERVER` updates `target_port`; browser JavaScript does not
decode that protocol message.

The transport behavior mirrors the native non-blocking interface:

- `astonia_net_poll(..., READ, ...)` reports readable data when queued bytes are
  available, or after close so `astonia_net_recv` can return `0`.
- `astonia_net_poll(..., WRITE, ...)` reports writable only after the WebSocket
  opens, and reports `-1` if the socket fails before opening.
- `astonia_net_send` copies raw bytes into one binary WebSocket message and
  returns the byte count accepted by the browser.
- `astonia_net_recv` drains queued binary message bytes in order and may return
  partial reads.
- `astonia_net_close` closes the WebSocket and frees the native handle.

Browsers do not expose local or peer TCP IPv4 addresses for WebSockets. The
WASM shim writes `0` to `astonia_net_local_ipv4` and `astonia_net_peer_ipv4`
outputs and returns success so the existing client `send_info` packet remains
deterministic.

## Test

```bash
cargo test --manifest-path gateway/Cargo.toml
cd browser && ASTONIA_EMSDK_ROOT=/path/to/emsdk npm test -- wasm-net-shim.spec.mjs
```
