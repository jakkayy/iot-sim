#!/usr/bin/env bash
# Spike helper: compile a .ino to wasm using clang in Docker.
# The real compile service (Phase 4) runs the same clang flags in a sandbox.
# usage: scripts/compile-arduino-spike.sh arduino-shim/examples/blink.ino out.wasm
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INO="$(realpath "$1")"
OUT="$(realpath -m "$2")"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
{ echo '#include <Arduino.h>'; cat "$INO"; } > "$WORK/sketch.cpp"
docker run --rm --network none \
  -v "$ROOT/arduino-shim:/shim:ro" -v "$WORK:/work" \
  silkeh/clang:19 \
  clang++ --target=wasm32 -O2 -std=c++17 -ffreestanding -nostdlib \
    -fno-exceptions -fno-rtti -I/shim/include \
    -Wl,--no-entry -Wl,--allow-undefined \
    /work/sketch.cpp /shim/src/main.cpp -o /work/out.wasm
cp "$WORK/out.wasm" "$OUT"
echo "wrote $OUT ($(stat -c %s "$OUT") bytes)"
