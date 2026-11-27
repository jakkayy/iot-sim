import { describe, expect, test } from "bun:test";
import { compileSketch, splitDiags } from "./compile";
import { compileUrl, DEFAULT_COMPILE_URL } from "./config";

const json = (status: number, body: unknown) =>
  (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
const opts = (fetchImpl: typeof fetch) => ({ url: "http://c.test/", fetchImpl });

describe("compileSketch", () => {
  test("decodes the wasm on success and reports cache hits", async () => {
    const wasm = btoa(String.fromCharCode(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0));
    const r = await compileSketch("x", opts(json(200, { ok: true, cached: true, wasm, diags: [] })));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(new Uint8Array(r.wasm)).toEqual(new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
      expect(r.cached).toBe(true);
    }
  });

  test("sends the sketch to /compile as sketch.ino", async () => {
    let seen: { url: string; body: unknown } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(init.body as string) };
      return new Response(JSON.stringify({ ok: false, diags: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    await compileSketch("void setup(){}", opts(f));
    expect(seen!.url).toBe("http://c.test/compile");
    expect(seen!.body).toEqual({ files: [{ name: "sketch.ino", content: "void setup(){}" }] });
  });

  test("compile errors come back as diagnostics, not as a service problem", async () => {
    const diags = [{ file: "sketch.ino", line: 3, col: 5, severity: "error" as const, message: "nope" }];
    const r = await compileSketch("x", opts(json(200, { ok: false, diags })));
    expect(r).toEqual({ ok: false, diags });
  });

  test("HTTP failures map to readable service errors", async () => {
    for (const [status, text] of [[429, "Too many"], [503, "busy"], [413, "too large"], [403, "refused"], [500, "HTTP 500"]] as const) {
      const r = await compileSketch("x", opts(json(status, { error: "x" })));
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.service).toBe(true);
        expect(r.diags[0].message).toContain(text);
      }
    }
  });

  test("a 400 is a problem with the code, with the server's explanation", async () => {
    const r = await compileSketch("x", opts(json(400, { error: "a.ino: asm is not allowed" })));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.service).toBeUndefined();
      expect(r.diags[0].message).toBe("a.ino: asm is not allowed");
    }
  });

  test("network failure and timeouts are explained", async () => {
    const down = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const r = await compileSketch("x", opts(down));
    expect(!r.ok && r.service && r.diags[0].message).toContain("Cannot reach");
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))))) as unknown as typeof fetch;
    const slow = await compileSketch("x", { url: "http://c", fetchImpl: hang, timeoutMs: 20 });
    expect(!slow.ok && slow.diags[0].message).toContain("too long");
  });

  test("a cancelled compile returns quietly", async () => {
    const ctl = new AbortController();
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))))) as unknown as typeof fetch;
    const p = compileSketch("x", { url: "http://c", fetchImpl: hang, signal: ctl.signal });
    ctl.abort();
    expect(await p).toEqual({ ok: false, diags: [] });
  });

  test("garbage responses do not crash", async () => {
    const f = (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch;
    const r = await compileSketch("x", opts(f));
    expect(!r.ok && r.service).toBe(true);
  });
});

describe("splitDiags", () => {
  test("only errors in the user's file become markers; everything is printed", () => {
    const { markers, text } = splitDiags([
      { file: "sketch.ino", line: 3, col: 5, severity: "error", message: "bad" },
      { file: "sketch.ino", line: 4, col: 1, severity: "warning", message: "meh" },
      { file: "arduino-shim/Wire.h", line: 9, col: 1, severity: "error", message: "in lib" },
      { file: "arduino-shim/Wire.h", line: 9, col: 1, severity: "note", message: "candidate" },
      { file: "", line: 0, col: 0, severity: "error", message: "linker" },
    ]);
    expect(markers).toEqual([{ line: 3, message: "bad" }]);
    expect(text).toEqual([
      "sketch.ino:3:5: error: bad",
      "sketch.ino:4:1: warning: meh",
      "arduino-shim/Wire.h:9:1: error: in lib",
      "error: linker",
    ]);
  });
});

describe("compileUrl", () => {
  test("defaults, and only honours ?compile= in e2e mode", () => {
    expect(compileUrl("")).toBe(DEFAULT_COMPILE_URL);
    expect(compileUrl("?compile=http://evil")).toBe(DEFAULT_COMPILE_URL);
    expect(compileUrl("?e2e&compile=http://localhost:8788")).toBe("http://localhost:8788");
  });
});
