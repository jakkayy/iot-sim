#!/bin/sh
# Sandbox entrypoint. Reads a tar of the sketch on stdin, compiles it, writes the wasm to
# stdout and compiler messages to stderr. Exit codes: 0 ok, 1 compile error, 2 internal.
# Runs with a read-only root filesystem, no network, and only /tmp writable.
set -u
W=/tmp/work
mkdir -p "$W" || exit 2
cd "$W" || exit 2
tar -x -f - -C "$W" || exit 2
# Only C++ translation units are compiled; headers are reached through #include.
set -- "$W"/*.cpp
[ -e "$1" ] || { echo "no source files" >&2; exit 2; }
if /shim/build/compile.sh "$W/out.wasm" "$@" 2>"$W/log"; then
  cat "$W/log" >&2
  cat "$W/out.wasm"
  exit 0
fi
cat "$W/log" >&2
exit 1
