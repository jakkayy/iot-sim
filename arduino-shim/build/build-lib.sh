#!/bin/sh
# Precompile the shim into lib/libshim.a so each job only compiles the user's code.
# Run when the sandbox image is built.
set -eu
. "$(dirname "$0")/flags.sh"
OBJ="$(mktemp -d)"
mkdir -p "$SHIM/lib"
for f in "$SHIM"/src/*.cpp; do
  # main.cpp holds the exported entry points; nothing references it, so inside an archive the
  # linker would silently drop it. compile.sh links it as a plain object instead.
  [ "$(basename "$f")" = "main.cpp" ] && continue
  # shellcheck disable=SC2086
  clang++ $SHIM_CXXFLAGS -c "$f" -o "$OBJ/$(basename "$f" .cpp).o"
done
rm -f "$SHIM/lib/libshim.a"
AR="$(command -v llvm-ar || command -v llvm-ar-19)"
"$AR" rcs "$SHIM/lib/libshim.a" "$OBJ"/*.o
rm -rf "$OBJ"
echo "built $SHIM/lib/libshim.a"
