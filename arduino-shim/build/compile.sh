#!/bin/sh
# Compile Arduino C++ sources to a simulator wasm.
#   usage: compile.sh <out.wasm> <source files...>      (env SHIM=/shim)
set -eu
. "$(dirname "$0")/flags.sh"
OUT="$1"
shift
LIB=""
SHIM_SRCS=""
if [ -f "$SHIM/lib/libshim.a" ]; then
  LIB="$SHIM/lib/libshim.a"
else
  SHIM_SRCS="$(ls "$SHIM"/src/*.cpp)"
fi
# shellcheck disable=SC2086
exec clang++ $SHIM_CXXFLAGS \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--export-memory -Wl,--export-table \
  -Wl,--gc-sections -Wl,--strip-all \
  "$@" $SHIM_SRCS $LIB -o "$OUT"
