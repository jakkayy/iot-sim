# Shared clang flags: the single source of truth for compile.sh and build-lib.sh.
# Sourced, not executed.
SHIM="${SHIM:-/shim}"
RES="$(clang -print-resource-dir)"
SHIM_CXXFLAGS="--target=wasm32 -O2 -std=c++17 \
  -ffreestanding -nostdlib -nostdinc -nostdinc++ \
  -isystem $SHIM/include -isystem $RES/include \
  -fno-exceptions -fno-rtti -fno-threadsafe-statics -mbulk-memory \
  -ffunction-sections -fdata-sections \
  -Wall -Wno-unused-function -Wno-unknown-pragmas"
