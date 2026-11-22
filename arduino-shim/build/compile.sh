#!/bin/sh
# Compile Arduino C++ sources to a simulator wasm. This is the single place that
# owns the clang flags: the dev helper and the sandbox image both call it.
#   usage: compile.sh <out.wasm> <source files...>      (env SHIM=/shim)
set -eu
SHIM="${SHIM:-/shim}"
OUT="$1"
shift
RES="$(clang -print-resource-dir)"
LIB=""
SHIM_SRCS=""
if [ -f "$SHIM/lib/libshim.a" ]; then
  LIB="$SHIM/lib/libshim.a"
else
  SHIM_SRCS="$(ls "$SHIM"/src/*.cpp)"
fi
exec clang++ --target=wasm32 -O2 -std=c++17 \
  -ffreestanding -nostdlib -nostdinc -nostdinc++ \
  -isystem "$SHIM/include" -isystem "$RES/include" \
  -fno-exceptions -fno-rtti -fno-threadsafe-statics -mbulk-memory \
  -Wall -Wno-unused-function -Wno-unknown-pragmas \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory -Wl,--export-table \
  -Wl,--gc-sections -Wl,--strip-all \
  "$@" $SHIM_SRCS $LIB -o "$OUT"
