# Browser Live Login

This path runs the browser client against a disposable Astonia server through
the raw WebSocket gateway. The browser sends the same initial login byte frames
as the native client, decodes inbound tick framing, replays protocol state, and
renders a minimal world canvas from the decoded sprite archives.

## Terminals

Use a throwaway Docker server and account. From the server repository, start
the current Docker Compose stack. It brings up MariaDB and the Astonia server,
and publishes the area-server game ports on `127.0.0.1:5556-5590`:

```bash
cd /home/bfan/astonia_community_server3
docker compose up -d
docker compose logs -f server
```

Create a disposable local account and character in that Docker stack:

```bash
cd /home/bfan/astonia_community_server3
docker exec astonia3-server /entrypoint.sh create_account fixture@example.test fixturecapture
docker exec astonia3-server /entrypoint.sh create_character 1 FixtureCapture MWG
```

If the database already has accounts, replace `1` with the account id printed
by the create-account command. Do not run these commands against production or
shared durable storage.

Start the WebSocket gateway from the client repository:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556 \
  --target-port-range 5556-5590
```

Start the browser dev server:

```bash
cd browser
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`, keep the gateway as
`ws://127.0.0.1:8787`, enter a disposable local character and password, and
press `Connect`. For fixture-compatible local servers the default form account
is:

```text
username/character: FixtureCapture
password: fixturecapture
```

Use only disposable local credentials. The browser keeps credentials in memory
for the login attempt; committed fixtures redact passwords, but raw fixture
captures intentionally contain the outbound login byte stream.

## Expected Result

The live status should move through `Connecting`, `Login Sent`, and then
`Live` after a successful login tick. The debug panel shows inbound/outbound
frames and bytes, decoded tick count, current server tick, protocol version,
player name and position, visible world counts, modeled/skipped command counts,
the latest first-step movement prediction status, and the latest area retarget
attempt/result. The `Predict` checkbox enables visual-only first-step movement
prediction after click-to-move; use `?prediction=0` or clear the checkbox to
compare against fully server-authoritative visuals. The canvas renders the
visible world using decoded sprites where the loaded archives contain them and
colored fallbacks otherwise.

## Automated Smoke

The browser Playwright suite includes a gateway lifecycle smoke that uses a
fake WebSocket and the committed Docker login fixture. It verifies that browser
login bytes match the captured native sequence, that inbound gateway chunks
decode into eight live ticks, and that the canvas is nonblank:

```bash
cd browser
npm test -- tests/live-login.spec.mjs
```

There is not yet a committed live fixture that causes the real server to emit
`SV_SERVER`. The automated boundary for area transfer is currently the parser
fixture test, a live-session fake-gateway reconnect test, and gateway TCP
routing tests that prove allowed `target-port` requests reach the requested
backend and disallowed ports are rejected.

Run the complete browser suite with:

```bash
cd browser
npm test
```

## Manual Fallback

When a live Docker server is not available, validate the committed fixture and
browser lifecycle instead:

```bash
node tools/protocol-fixture.mjs check fixtures/protocol/docker-login-tick
cd browser
npm test -- tests/live-login.spec.mjs
```

This fallback verifies the connection lifecycle at the browser/gateway byte
boundary without opening a real socket to durable server storage.
