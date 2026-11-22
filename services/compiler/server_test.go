package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// A valid wasm module importing only allowed functions (env.pinMode, func type 0).
var okWasm = func() []byte {
	imp := []byte{1, 3, 'e', 'n', 'v', 7, 'p', 'i', 'n', 'M', 'o', 'd', 'e', 0, 0}
	out := []byte("\x00asm\x01\x00\x00\x00")
	out = append(out, 2, byte(len(imp)))
	return append(out, imp...)
}()

var badWasm = func() []byte { // imports env.WiFi_begin which the simulator lacks
	imp := []byte{1, 3, 'e', 'n', 'v', 10, 'W', 'i', 'F', 'i', '_', 'b', 'e', 'g', 'i', 'n', 0, 0}
	out := []byte("\x00asm\x01\x00\x00\x00")
	out = append(out, 2, byte(len(imp)))
	return append(out, imp...)
}()

type fakeRunner struct {
	calls atomic.Int32
	out   RunOutput
	err   error
	delay time.Duration
	seen  []File
}

func (f *fakeRunner) Compile(ctx context.Context, files []File) (RunOutput, error) {
	f.calls.Add(1)
	f.seen = files
	if f.delay > 0 {
		select {
		case <-time.After(f.delay):
		case <-ctx.Done():
			return RunOutput{}, ctx.Err()
		}
	}
	return f.out, f.err
}

type fakeVerifier struct {
	ok  bool
	err error
}

func (v fakeVerifier) Verify(ctx context.Context, token, ip string) (bool, error) {
	return v.ok && token == "good", v.err
}

func testServer(t *testing.T, r Runner, v Verifier, mut func(*Config)) (*Server, *httptest.Server) {
	t.Helper()
	cfg := Config{
		AllowedOrigins: []string{"https://sim.example"}, RatePerMinute: 100, MaxConcurrent: 2, MaxQueue: 4,
		CompileTimeout: 5 * time.Second, MaxWasmBytes: 1 << 20, ShimVersion: "test",
	}
	if mut != nil {
		mut(&cfg)
	}
	cache, err := NewCache(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	s := NewServer(cfg, r, cache, v, slog.New(slog.NewTextHandler(io.Discard, nil)))
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

const goodSketch = `{"files":[{"name":"sketch.ino","content":"void setup(){}\nvoid loop(){}\n"}]`

func post(t *testing.T, url, body string, hdr map[string]string) (*http.Response, []byte) {
	t.Helper()
	req, _ := http.NewRequest("POST", url+"/compile", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp, b
}

func decode(t *testing.T, b []byte) compileResponse {
	t.Helper()
	var r compileResponse
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatalf("bad json %q: %v", b, err)
	}
	return r
}

func TestCompileSuccessThenCacheHit(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm, Log: "sketch.ino:1:1: warning: w\n"}}
	_, ts := testServer(t, fr, nil, nil)
	resp, body := post(t, ts.URL, goodSketch+`}`, nil)
	got := decode(t, body)
	if resp.StatusCode != 200 || !got.OK || got.Cached {
		t.Fatalf("first: %d %+v", resp.StatusCode, got)
	}
	wasm, _ := base64.StdEncoding.DecodeString(got.Wasm)
	if !bytes.Equal(wasm, okWasm) || len(got.Diags) != 1 || got.Diags[0].Severity != "warning" {
		t.Fatalf("payload: %+v", got)
	}
	_, body = post(t, ts.URL, goodSketch+`}`, nil)
	if got := decode(t, body); !got.OK || !got.Cached {
		t.Fatalf("second request must be a cache hit: %+v", got)
	}
	if fr.calls.Load() != 1 {
		t.Fatalf("sandbox ran %d times, want 1", fr.calls.Load())
	}
}

func TestRunnerReceivesPreprocessedSourcesNotRawIno(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm}}
	_, ts := testServer(t, fr, nil, nil)
	post(t, ts.URL, goodSketch+`}`, nil)
	if len(fr.seen) != 1 || fr.seen[0].Name != "sketch.ino.cpp" || !strings.HasPrefix(fr.seen[0].Content, "#include <Arduino.h>") {
		t.Fatalf("runner input: %+v", fr.seen)
	}
}

func TestCompileErrorIsReportedAndCached(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{ExitCode: 1, Log: "/tmp/work/sketch.ino.cpp:3:5: error: nope\n"}}
	_, ts := testServer(t, fr, nil, nil)
	_, body := post(t, ts.URL, goodSketch+`}`, nil)
	got := decode(t, body)
	if got.OK || len(got.Diags) != 1 || got.Diags[0].File != "sketch.ino.cpp" || got.Diags[0].Line != 3 {
		t.Fatalf("diags: %+v", got)
	}
	post(t, ts.URL, goodSketch+`}`, nil)
	if fr.calls.Load() != 1 {
		t.Fatal("deterministic failures should be cached too")
	}
}

func TestUnsupportedFunctionsBecomeAnError(t *testing.T) {
	_, ts := testServer(t, &fakeRunner{out: RunOutput{Wasm: badWasm}}, nil, nil)
	_, body := post(t, ts.URL, goodSketch+`}`, nil)
	got := decode(t, body)
	if got.OK || !strings.Contains(got.Diags[len(got.Diags)-1].Message, "WiFi_begin") {
		t.Fatalf("expected unsupported-function error: %+v", got)
	}
}

func TestTimeoutAndSandboxFailuresAreNotCached(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{TimedOut: true}}
	_, ts := testServer(t, fr, nil, nil)
	_, body := post(t, ts.URL, goodSketch+`}`, nil)
	if got := decode(t, body); got.OK || !strings.Contains(got.Diags[0].Message, "timed out") {
		t.Fatalf("timeout: %+v", got)
	}
	fr.out = RunOutput{Wasm: okWasm}
	_, body = post(t, ts.URL, goodSketch+`}`, nil)
	if got := decode(t, body); !got.OK {
		t.Fatalf("a timeout must not poison the cache: %+v", got)
	}
	fr2 := &fakeRunner{err: errors.New("docker: cannot connect to daemon /var/run/docker.sock")}
	_, ts2 := testServer(t, fr2, nil, nil)
	_, body = post(t, ts2.URL, goodSketch+`}`, nil)
	got := decode(t, body)
	if got.OK || strings.Contains(string(body), "docker.sock") {
		t.Fatalf("internal errors must not leak details: %s", body)
	}
}

func TestOversizedWasmIsRejected(t *testing.T) {
	_, ts := testServer(t, &fakeRunner{out: RunOutput{Wasm: okWasm}}, nil, func(c *Config) { c.MaxWasmBytes = 10 })
	_, body := post(t, ts.URL, goodSketch+`}`, nil)
	if got := decode(t, body); got.OK || !strings.Contains(got.Diags[0].Message, "too large") {
		t.Fatalf("%+v", got)
	}
}

func TestBadRequests(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm}}
	_, ts := testServer(t, fr, nil, nil)
	cases := map[string]struct {
		body string
		want int
	}{
		"not json":       {`nope`, 400},
		"no files":       {`{"files":[]}`, 400},
		"traversal name": {`{"files":[{"name":"../x.ino","content":""}]}`, 400},
		"abs include":    {`{"files":[{"name":"a.ino","content":"#include \"/etc/passwd\"\nvoid setup(){}"}]}`, 400},
		"asm":            {`{"files":[{"name":"a.ino","content":"void setup(){ asm(\"nop\"); }"}]}`, 400},
		"too many libs":  {`{"files":[{"name":"a.ino","content":"x"}],"libs":["1","2","3","4","5","6","7","8","9","10","11","12","13","14","15","16","17"]}`, 400},
		"huge body":      {`{"files":[{"name":"a.ino","content":"` + strings.Repeat("a", maxSourceBytes+100*1024) + `"}]}`, 413},
	}
	for name, c := range cases {
		resp, _ := post(t, ts.URL, c.body, nil)
		if resp.StatusCode != c.want {
			t.Errorf("%s: status %d, want %d", name, resp.StatusCode, c.want)
		}
	}
	if fr.calls.Load() != 0 {
		t.Fatal("rejected requests must never reach the sandbox")
	}
	resp, err := http.Get(ts.URL + "/compile")
	if err != nil || resp.StatusCode != 405 {
		t.Errorf("GET /compile: %v %v", err, resp)
	}
}

func TestCORS(t *testing.T) {
	_, ts := testServer(t, &fakeRunner{out: RunOutput{Wasm: okWasm}}, nil, nil)
	resp, _ := post(t, ts.URL, goodSketch+`}`, map[string]string{"Origin": "https://sim.example"})
	if resp.Header.Get("Access-Control-Allow-Origin") != "https://sim.example" || resp.Header.Get("Cross-Origin-Resource-Policy") != "cross-origin" {
		t.Errorf("allowed origin headers: %v", resp.Header)
	}
	resp, _ = post(t, ts.URL, goodSketch+`}`, map[string]string{"Origin": "https://evil.example"})
	if resp.StatusCode != 403 || resp.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Errorf("foreign origin must be refused: %d %v", resp.StatusCode, resp.Header)
	}
	req, _ := http.NewRequest("OPTIONS", ts.URL+"/compile", nil)
	req.Header.Set("Origin", "https://sim.example")
	resp, _ = http.DefaultClient.Do(req)
	if resp.StatusCode != 204 || !strings.Contains(resp.Header.Get("Access-Control-Allow-Methods"), "POST") {
		t.Errorf("preflight: %d %v", resp.StatusCode, resp.Header)
	}
	// "*" in the config must never turn into a wildcard
	s, _ := testServer(t, &fakeRunner{}, nil, func(c *Config) { c.AllowedOrigins = []string{"*"} })
	if len(s.origins) != 0 {
		t.Errorf("wildcard origin accepted: %v", s.origins)
	}
}

func TestRateLimitAppliesToCompilesButNotCacheHits(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm}}
	_, ts := testServer(t, fr, nil, func(c *Config) { c.RatePerMinute = 2 })
	mk := func(n int) string {
		return `{"files":[{"name":"sketch.ino","content":"void setup(){}\nvoid loop(){}\n// ` + strings.Repeat("x", n) + `"}]}`
	}
	for i := 1; i <= 2; i++ {
		if resp, _ := post(t, ts.URL, mk(i), nil); resp.StatusCode != 200 {
			t.Fatalf("compile %d: %d", i, resp.StatusCode)
		}
	}
	if resp, _ := post(t, ts.URL, mk(3), nil); resp.StatusCode != 429 {
		t.Fatalf("third distinct compile must be limited: %d", resp.StatusCode)
	}
	for i := 0; i < 5; i++ { // already cached: not counted
		if resp, _ := post(t, ts.URL, mk(1), nil); resp.StatusCode != 200 {
			t.Fatalf("cache hit was rate limited: %d", resp.StatusCode)
		}
	}
}

func TestRateLimitUsesCloudflareIPOnlyWhenTrusted(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm}}
	_, ts := testServer(t, fr, nil, func(c *Config) { c.RatePerMinute = 1; c.TrustCF = true })
	mk := func(n int) string {
		return `{"files":[{"name":"sketch.ino","content":"void setup(){}\nvoid loop(){}\n// ` + strings.Repeat("y", n) + `"}]}`
	}
	if resp, _ := post(t, ts.URL, mk(1), map[string]string{"CF-Connecting-IP": "203.0.113.1"}); resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	if resp, _ := post(t, ts.URL, mk(2), map[string]string{"CF-Connecting-IP": "203.0.113.1"}); resp.StatusCode != 429 {
		t.Fatalf("same real client must be limited: %d", resp.StatusCode)
	}
	if resp, _ := post(t, ts.URL, mk(3), map[string]string{"CF-Connecting-IP": "203.0.113.2"}); resp.StatusCode != 200 {
		t.Fatalf("a different real client has its own bucket: %d", resp.StatusCode)
	}
}

func TestTurnstile(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm}}
	_, ts := testServer(t, fr, fakeVerifier{ok: true}, nil)
	if resp, _ := post(t, ts.URL, goodSketch+`}`, nil); resp.StatusCode != 403 {
		t.Fatalf("missing token: %d", resp.StatusCode)
	}
	if fr.calls.Load() != 0 {
		t.Fatal("unverified requests must not reach the sandbox")
	}
	if resp, _ := post(t, ts.URL, goodSketch+`,"turnstileToken":"good"}`, nil); resp.StatusCode != 200 {
		t.Fatalf("good token: %d", resp.StatusCode)
	}
	// a cached sketch does not need a fresh token
	if resp, _ := post(t, ts.URL, goodSketch+`}`, nil); resp.StatusCode != 200 {
		t.Fatalf("cache hit should skip verification: %d", resp.StatusCode)
	}
	_, ts2 := testServer(t, &fakeRunner{out: RunOutput{Wasm: okWasm}}, fakeVerifier{err: errors.New("cloudflare down")}, nil)
	if resp, _ := post(t, ts2.URL, goodSketch+`,"turnstileToken":"good"}`, nil); resp.StatusCode != 503 {
		t.Fatalf("verifier outage: %d", resp.StatusCode)
	}
}

func TestOneCompileAtATimePerClient(t *testing.T) {
	fr := &fakeRunner{out: RunOutput{Wasm: okWasm}, delay: 300 * time.Millisecond}
	_, ts := testServer(t, fr, nil, nil)
	first := make(chan int, 1)
	go func() {
		resp, _ := post(t, ts.URL, goodSketch+`}`, nil)
		first <- resp.StatusCode
	}()
	time.Sleep(80 * time.Millisecond)
	other := `{"files":[{"name":"sketch.ino","content":"void setup(){}\nvoid loop(){}\n// second"}]}`
	if resp, _ := post(t, ts.URL, other, nil); resp.StatusCode != 429 {
		t.Fatalf("a second concurrent compile from the same client: %d", resp.StatusCode)
	}
	if code := <-first; code != 200 {
		t.Fatalf("first compile: %d", code)
	}
}

func TestHealth(t *testing.T) {
	_, ts := testServer(t, &fakeRunner{}, nil, nil)
	resp, err := http.Get(ts.URL + "/healthz")
	if err != nil || resp.StatusCode != 200 {
		t.Fatalf("%v %v", err, resp)
	}
	b, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(b), `"shim":"test"`) {
		t.Fatalf("health body: %s", b)
	}
}

func jsonString(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
