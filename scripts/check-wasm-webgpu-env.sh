#!/bin/bash
set -e

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
