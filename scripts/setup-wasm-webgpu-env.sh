#!/bin/bash
set -euo pipefail

EMSDK_VERSION="${EMSDK_VERSION:-6.0.0}"
EMSDK_REPO_URL="${EMSDK_REPO_URL:-https://github.com/emscripten-core/emsdk.git}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EMSDK_ROOT="${ASTONIA_EMSDK_ROOT:-$REPO_ROOT/.deps/emsdk}"

if ! command -v git >/dev/null 2>&1; then
	echo "git is required to install Emscripten SDK." >&2
	exit 1
fi

mkdir -p "$(dirname "$EMSDK_ROOT")"

if [ -d "$EMSDK_ROOT/.git" ]; then
	echo "Updating emsdk checkout at $EMSDK_ROOT"
	git -C "$EMSDK_ROOT" fetch --depth 1 --force origin "refs/tags/$EMSDK_VERSION:refs/tags/$EMSDK_VERSION"
	git -c advice.detachedHead=false -C "$EMSDK_ROOT" checkout --detach "$EMSDK_VERSION"
elif [ -e "$EMSDK_ROOT" ]; then
	echo "$EMSDK_ROOT already exists but is not an emsdk git checkout." >&2
	echo "Set ASTONIA_EMSDK_ROOT to another path or remove the directory." >&2
	exit 1
else
	echo "Cloning emsdk $EMSDK_VERSION into $EMSDK_ROOT"
	git -c advice.detachedHead=false clone --depth 1 --branch "$EMSDK_VERSION" "$EMSDK_REPO_URL" "$EMSDK_ROOT"
fi

"$EMSDK_ROOT/emsdk" install "$EMSDK_VERSION"
EMSDK_QUIET=1 "$EMSDK_ROOT/emsdk" activate --embedded "$EMSDK_VERSION" >/dev/null

echo ""
echo "Emscripten SDK $EMSDK_VERSION is installed under:"
echo "  $EMSDK_ROOT"
echo ""
echo "The environment check auto-activates this repo-local SDK:"
echo "  make wasm-check-env"
echo ""
echo "To use emcc in the current shell:"
echo "  source \"$EMSDK_ROOT/emsdk_env.sh\""
