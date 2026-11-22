// Copies runtime wasm binaries into public/ so the browser can fetch them
// same-origin (required under COEP). Runs before dev/build.
import { cpSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "../../../packages/runtime-micropython/package.json"));
const pkgDir = dirname(require.resolve("@micropython/micropython-webassembly-pyscript/package.json"));
const dest = join(here, "../public/micropython");
mkdirSync(dest, { recursive: true });
for (const f of ["micropython.wasm", "micropython.mjs"]) cpSync(join(pkgDir, f), join(dest, f));
console.log("copied micropython.wasm + micropython.mjs ->", dest, existsSync(dest) && readdirSync(dest));

