#!/usr/bin/env bash
# Compile every arduino-shim/examples/*.ino into packages/runtime-arduino/fixtures/<name>.wasm
# using the same compile.sh the sandbox image uses. Needs Docker and the clang image.
# usage: scripts/build-fixtures.sh [name ...]   (default: all examples)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${CLANG_IMAGE:-silkeh/clang:19}"
OUT="$ROOT/packages/runtime-arduino/fixtures"
mkdir -p "$OUT"
cd "$ROOT/arduino-shim/examples"
names=("$@")
if [ ${#names[@]} -eq 0 ]; then
  for f in *.ino; do names+=("${f%.ino}"); done
fi
for n in "${names[@]}"; do
  WORK="$(mktemp -d)"
  { echo '#include <Arduino.h>'; cat "$n.ino"; } > "$WORK/$n.cpp"
  chmod -R a+rwX "$WORK"
  docker run --rm --network none -v "$ROOT/arduino-shim:/shim:ro" -v "$WORK:/work" "$IMAGE" \
    /shim/build/compile.sh "/work/$n.wasm" "/work/$n.cpp"
  cp "$WORK/$n.wasm" "$OUT/$n.wasm"
  rm -rf "$WORK"
  echo "built $n ($(stat -c %s "$OUT/$n.wasm") bytes)"
done
