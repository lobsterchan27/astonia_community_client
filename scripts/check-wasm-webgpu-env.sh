#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_EMSDK_ROOT="${ASTONIA_EMSDK_ROOT:-$REPO_ROOT/.deps/emsdk}"

echo "========================================"
echo "  WASM/WebGPU Environment Check"
echo "========================================"
echo ""

FAILED=0

check_command() {
	local name="$1"
	local install_hint="$2"

	if command -v "$name" >/dev/null 2>&1; then
		echo "[ok] $name: $(command -v "$name")"
	else
		echo "[missing] $name"
		echo "          $install_hint"
		FAILED=1
	fi
}

source_emsdk_env() {
	local emsdk_root="$1"
	local env_file="$emsdk_root/emsdk_env.sh"

	if [ -f "$env_file" ]; then
		export EMSDK_QUIET=1
		# shellcheck disable=SC1090
		source "$env_file" >/dev/null 2>&1
		echo "[info] activated Emscripten SDK: $emsdk_root"
	fi
}

if ! command -v emcc >/dev/null 2>&1 || ! command -v emar >/dev/null 2>&1; then
	if [ -n "${EMSDK:-}" ]; then
		source_emsdk_env "$EMSDK"
	fi
fi

if ! command -v emcc >/dev/null 2>&1 || ! command -v emar >/dev/null 2>&1; then
	source_emsdk_env "$LOCAL_EMSDK_ROOT"
fi

check_command emcc "Install and activate Emscripten SDK; emcc must be on PATH."
check_command emar "Install and activate Emscripten SDK; emar must be on PATH."
check_command node "Install Node.js for the browser host."
check_command npm "Install npm for the browser host."

if command -v emcc >/dev/null 2>&1; then
	echo ""
	echo "emcc version:"
	emcc --version | sed -n '1,3p'
fi

if command -v node >/dev/null 2>&1; then
	echo ""
	echo "node version:"
	node --version
fi

echo ""
if [ "$FAILED" -ne 0 ]; then
	echo "WASM/WebGPU environment is incomplete."
	exit 1
fi

echo "WASM/WebGPU environment looks usable."
