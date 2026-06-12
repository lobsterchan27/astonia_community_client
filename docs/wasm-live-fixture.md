# WASM Live Fixture

This fixture is the repeatable local setup for a future WASM browser live
smoke. It starts the newer disposable server, starts the WebSocket gateway, and
documents credentials. It does not implement the final browser smoke.

The smoke path remains a byte pipe:

- Browser JavaScript opens a WebSocket to the gateway.
- The gateway forwards raw binary bytes to the Astonia TCP server.
- Browser JavaScript does not decode Astonia protocol messages.
- The server and gateway protocols are unchanged.

## Server

Use the newer server repo, not legacy server checkouts:

```bash
cd /home/bfan/astonia_community_server3
docker compose up -d --build
docker compose ps
```

The compose stack initializes the `merc` database in a local MariaDB container
from the server repo's SQL seed files. Treat this as disposable local storage:
the database lives in the compose named volume and server logs may be written to
`/home/bfan/astonia_community_server3/logs`. Do not point these commands at
production or shared databases.

Optional server socket sanity check from the server repo:

```bash
python3 scripts/latency_probe.py --host 127.0.0.1 --ports 5556 --samples 1
```

Stop without deleting the database volume:

```bash
cd /home/bfan/astonia_community_server3
docker compose down
```

Destroy the disposable database volume only when you intentionally want a clean
fixture:

```bash
cd /home/bfan/astonia_community_server3
docker compose down -v
```

`docker compose down -v` deletes the local MariaDB named volume for this compose
project.

## Gateway

Start the gateway from this client repo after the server is listening:

```bash
cargo run --manifest-path gateway/Cargo.toml -- \
  --listen 127.0.0.1:8787 \
  --tcp-host 127.0.0.1 \
  --tcp-port 5556 \
  --target-port-range 5556-5590
```

The browser gateway URL is:

```text
ws://127.0.0.1:8787
```

The default TCP target is `127.0.0.1:5556`. Redirected area ports must stay
inside the allowed `5556-5590` range and are selected through the existing
`target-port` query parameter.

## Credentials

The server seed data includes this disposable credential:

```text
username: Ishtar
password: rene754
```

The browser host defaults to:

```text
username: BrowserSmoke
password: fixturecapture
```

Create the browser-default credential idempotently in the disposable compose
database:

```bash
scripts/ensure-wasm-live-fixture.sh
```

The helper expects `/home/bfan/astonia_community_server3` by default. It first
checks whether the `BrowserSmoke` character already exists; if not, it creates
account email `browser-smoke@localhost.invalid` and then creates the character.
Override the server path or credential fields with:

```bash
ASTONIA_SERVER3_REPO=/path/to/astonia_community_server3 \
ASTONIA_FIXTURE_CHARACTER=BrowserSmoke \
ASTONIA_FIXTURE_PASSWORD=fixturecapture \
scripts/ensure-wasm-live-fixture.sh
```

The helper skips existing rows and does not verify or reset an existing
password. If the password was changed in a disposable fixture, recreate the
local database with the documented `docker compose down -v` command.

## Browser Host

After `make wasm` has generated `browser/dist/astonia-client.js`, the browser
host can be started separately:

```bash
cd browser
npm install
npm run dev -- --host 127.0.0.1 --port 5173
```

This issue does not add an automated live browser smoke. The fixture only makes
the server, gateway, and credential setup explicit for that future test.

## Fixed Ports

These defaults are not parallel-safe on one host:

- Server compose publishes `5556-5590` on the host for area servers.
- Gateway listens on `127.0.0.1:8787`.
- Browser dev server examples use `127.0.0.1:5173`.
- The server compose file uses fixed container names `astonia3-db` and
  `astonia3-server`.

Run only one default fixture stack at a time. To parallelize, use a separate
server compose project with different published ports, start the gateway with a
different `--listen` and `--target-port-range`, and pass that gateway URL in the
browser form.
