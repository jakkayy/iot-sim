export interface Diag {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warning" | "note";
  message: string;
}

export type CompileResult =
  | { ok: true; wasm: ArrayBuffer; diags: Diag[]; cached: boolean }
  | { ok: false; diags: Diag[]; /** Service problem (down, rate limited) rather than a problem in the code. */ service?: boolean };

const serviceError = (message: string): CompileResult => ({
  ok: false,
  service: true,
  diags: [{ file: "", line: 0, col: 0, severity: "error", message }],
});

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Ask the compile service to build a sketch. Never throws: failures become a CompileResult. */
export async function compileSketch(
  code: string,
  opts: { url: string; signal?: AbortSignal; fetchImpl?: typeof fetch; timeoutMs?: number },
): Promise<CompileResult> {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), opts.timeoutMs ?? 40_000);
  const onAbort = () => timeout.abort();
  opts.signal?.addEventListener("abort", onAbort);
  try {
    const res = await doFetch(`${opts.url.replace(/\/$/, "")}/compile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ files: [{ name: "sketch.ino", content: code }] }),
      signal: timeout.signal,
    });
    if (res.status === 429) return serviceError("Too many compiles right now. Wait a few seconds and try again.");
    if (res.status === 503) return serviceError("The compile service is busy. Try again in a moment.");
    if (res.status === 413) return serviceError("The sketch is too large to compile (limit 200 KB).");
    if (res.status === 403) return serviceError("The compile service refused this request.");
    let body: { ok?: boolean; wasm?: string; diags?: Diag[]; cached?: boolean; error?: string };
    try {
      body = await res.json();
    } catch {
      return serviceError("The compile service sent an unreadable response.");
    }
    if (res.status === 400) {
      return { ok: false, diags: [{ file: "", line: 0, col: 0, severity: "error", message: body.error ?? "Invalid sketch" }] };
    }
    if (!res.ok) return serviceError(`The compile service failed (HTTP ${res.status}).`);
    const diags = body.diags ?? [];
    if (body.ok && body.wasm) return { ok: true, wasm: base64ToBytes(body.wasm), diags, cached: !!body.cached };
    return { ok: false, diags };
  } catch (e) {
    if (opts.signal?.aborted) return { ok: false, diags: [] };
    if (timeout.signal.aborted) return serviceError("Compiling took too long and was cancelled.");
    return serviceError("Cannot reach the compile service. Check your connection, or use MicroPython, which runs without it.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/** Editor markers for errors in the user's own file; everything else goes to the serial monitor. */
export function splitDiags(diags: Diag[], userFile = "sketch.ino") {
  const markers = diags
    .filter((d) => d.severity === "error" && d.file === userFile && d.line > 0)
    .map((d) => ({ line: d.line, message: d.message }));
  const text = diags
    .filter((d) => d.severity !== "note" || d.file === userFile)
    .map((d) => (d.file ? `${d.file}${d.line ? `:${d.line}` : ""}${d.col ? `:${d.col}` : ""}: ` : "") + `${d.severity}: ${d.message}`);
  return { markers, text };
}
