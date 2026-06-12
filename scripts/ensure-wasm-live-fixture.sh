#!/bin/bash
set -euo pipefail

SERVER_REPO="${ASTONIA_SERVER3_REPO:-/home/bfan/astonia_community_server3}"
FIXTURE_EMAIL="${ASTONIA_FIXTURE_EMAIL:-browser-smoke@localhost.invalid}"
FIXTURE_CHARACTER="${ASTONIA_FIXTURE_CHARACTER:-BrowserSmoke}"
FIXTURE_PASSWORD="${ASTONIA_FIXTURE_PASSWORD:-fixturecapture}"
FIXTURE_CLASS="${ASTONIA_FIXTURE_CLASS:-MWG}"

usage() {
	cat <<EOF
Usage: scripts/ensure-wasm-live-fixture.sh [options]

Ensure the disposable browser live-smoke account exists in the newer server
repo's Docker Compose database. Start the disposable server first:

  cd $SERVER_REPO
  docker compose up -d --build

Options:
  --server-repo PATH   Server repo path. Default: $SERVER_REPO
  --email EMAIL        Fixture account email. Default: $FIXTURE_EMAIL
  --character NAME     Fixture character/login name. Default: $FIXTURE_CHARACTER
  --password PASSWORD  Fixture password. Default: $FIXTURE_PASSWORD
  --class CLASS        Character class. Default: $FIXTURE_CLASS
  -h, --help           Show this help.

Environment variables with the same defaults:
  ASTONIA_SERVER3_REPO
  ASTONIA_FIXTURE_EMAIL
  ASTONIA_FIXTURE_CHARACTER
  ASTONIA_FIXTURE_PASSWORD
  ASTONIA_FIXTURE_CLASS
EOF
}

die() {
	echo "error: $*" >&2
	exit 1
}

while [ "$#" -gt 0 ]; do
	case "$1" in
		--server-repo)
			[ "$#" -ge 2 ] || die "--server-repo requires a value"
			SERVER_REPO="$2"
			shift 2
			;;
		--email)
			[ "$#" -ge 2 ] || die "--email requires a value"
			FIXTURE_EMAIL="$2"
			shift 2
			;;
		--character)
			[ "$#" -ge 2 ] || die "--character requires a value"
			FIXTURE_CHARACTER="$2"
			shift 2
			;;
		--password)
			[ "$#" -ge 2 ] || die "--password requires a value"
			FIXTURE_PASSWORD="$2"
			shift 2
			;;
		--class)
			[ "$#" -ge 2 ] || die "--class requires a value"
			FIXTURE_CLASS="$2"
			shift 2
			;;
		-h|--help)
			usage
			exit 0
			;;
		*)
			die "unknown option: $1"
			;;
	esac
done

validate_sql_safe() {
	local name="$1"
	local value="$2"
	local regex="$3"

	if [[ ! "$value" =~ $regex ]]; then
		die "$name contains unsupported characters for this helper: $value"
	fi
}

validate_sql_safe "email" "$FIXTURE_EMAIL" '^[A-Za-z0-9_.@+-]+$'
validate_sql_safe "character" "$FIXTURE_CHARACTER" '^[A-Za-z][A-Za-z0-9_-]{0,39}$'
validate_sql_safe "class" "$FIXTURE_CLASS" '^[MF][WM]G?$'

[ -f "$SERVER_REPO/docker-compose.yml" ] || die "docker-compose.yml not found under $SERVER_REPO"

if ! command -v docker >/dev/null 2>&1; then
	die "docker is required"
fi

if ! docker compose version >/dev/null 2>&1; then
	die "docker compose is required"
fi

compose() {
	docker compose --project-directory "$SERVER_REPO" -f "$SERVER_REPO/docker-compose.yml" "$@"
}

running_services="$(compose ps --services --status running 2>/dev/null || true)"
if ! grep -qx "db" <<<"$running_services" || ! grep -qx "server" <<<"$running_services"; then
	cat >&2 <<EOF
error: the disposable server compose stack is not running.

Start it first:
  cd $SERVER_REPO
  docker compose up -d --build
EOF
	exit 1
fi

mysql_query() {
	local sql="$1"
	compose exec -T server sh -lc \
		'MYSQL_PWD="$AS3_DBPASS" mysql -h "$AS3_DBHOST" -u "$AS3_DBUSER" "$AS3_DBNAME" --batch --raw --skip-column-names -e "$1"' \
		sh "$sql"
}

server_exec() {
	compose exec -T server sh -lc 'cd /server && "$@"' sh "$@"
}

echo "Checking disposable WASM live fixture in $SERVER_REPO"

character_row="$(mysql_query "SELECT CONCAT(c.sID, CHAR(9), COALESCE(s.email, '')) FROM chars c LEFT JOIN subscriber s ON s.ID = c.sID WHERE c.name = '$FIXTURE_CHARACTER' LIMIT 1;" | head -n 1)"
if [ -n "$character_row" ]; then
	account_id="${character_row%%$'\t'*}"
	account_email="${character_row#*$'\t'}"
	if [ "$account_email" = "$character_row" ]; then
		account_email=""
	fi
	echo "Fixture character $FIXTURE_CHARACTER already exists on account $account_id${account_email:+ ($account_email)}"
else
	account_id="$(mysql_query "SELECT ID FROM subscriber WHERE email = '$FIXTURE_EMAIL' ORDER BY ID LIMIT 1;" | head -n 1)"
	if [ -z "$account_id" ]; then
		echo "Creating fixture account $FIXTURE_EMAIL"
		server_exec ./create_account -e "$FIXTURE_EMAIL" "$FIXTURE_PASSWORD"
		account_id="$(mysql_query "SELECT ID FROM subscriber WHERE email = '$FIXTURE_EMAIL' ORDER BY ID LIMIT 1;" | head -n 1)"
	fi

	[ -n "$account_id" ] || die "fixture account was not found after creation"

	echo "Creating fixture character $FIXTURE_CHARACTER on account $account_id"
	server_exec ./create_character -e "$account_id" "$FIXTURE_CHARACTER" "$FIXTURE_CLASS"
fi

cat <<EOF

Disposable fixture credential:
  username: $FIXTURE_CHARACTER
  expected password: $FIXTURE_PASSWORD
  gateway:  ws://127.0.0.1:8787

This helper does not verify or reset an existing password. For a clean
disposable database:
  cd $SERVER_REPO
  docker compose down -v
EOF
