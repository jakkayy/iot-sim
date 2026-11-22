package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// These tests run the real sandbox. Enable with COMPILER_IT=1 after building the image:
//   docker build -f services/compiler/sandbox/Dockerfile -t esp32-sim-sandbox:dev .
//   COMPILER_IT=1 go test -run Integration ./...

func sandbox(t *testing.T) *DockerRunner {
	t.Helper()
	if os.Getenv("COMPILER_IT") != "1" {
		t.Skip("set COMPILER_IT=1 to run sandbox integration tests")
	}
	image := os.Getenv("SANDBOX_IMAGE")
	if image == "" {
		image = "esp32-sim-sandbox:dev"
	}
	if err := exec.Command("docker", "image", "inspect", image).Run(); err != nil {
		t.Fatalf("sandbox image %s not found: %v", image, err)
	}
	return &DockerRunner{DockerBin: "docker", Image: image, Runtime: os.Getenv("SANDBOX_RUNTIME"), Timeout: 30 * time.Second, MaxWasm: 512 * 1024}
}

func compileSketch(t *testing.T, r *DockerRunner, src string) (RunOutput, error) {
	t.Helper()
	files, err := Preprocess([]File{{Name: "sketch.ino", Content: src}})
	if err != nil {
		t.Fatal(err)
	}
	return r.Compile(context.Background(), files)
}

func TestIntegrationCompilesBlinkFast(t *testing.T) {
	r := sandbox(t)
	start := time.Now()
	out, err := compileSketch(t, r, "void setup(){ pinMode(LED_BUILTIN, OUTPUT); }\nvoid loop(){ digitalWrite(LED_BUILTIN, HIGH); delay(500); digitalWrite(LED_BUILTIN, LOW); delay(500); }\n")
	if err != nil || out.ExitCode != 0 {
		t.Fatalf("compile failed: %v exit=%d log=%s", err, out.ExitCode, out.Log)
	}
	t.Logf("compiled in %v, %d bytes", time.Since(start), len(out.Wasm))
	if time.Since(start) > 10*time.Second {
		t.Errorf("first compile took %v; the target is a few seconds", time.Since(start))
	}
	bad, err := UnsupportedImports(out.Wasm)
	if err != nil || len(bad) != 0 {
		t.Fatalf("imports: %v %v", bad, err)
	}
}

func TestIntegrationErrorsPointAtTheUsersLines(t *testing.T) {
	r := sandbox(t)
	out, err := compileSketch(t, r, "void setup() {\n  int x = 1;\n  undefinedThing(x);\n}\nvoid loop() {}\n")
	if err != nil || out.ExitCode != 1 {
		t.Fatalf("expected a compile error: %v exit=%d", err, out.ExitCode)
	}
	ds := ParseDiagnostics(out.Log, true)
	found := false
	for _, d := range ds {
		if d.Severity == "error" && d.File == "sketch.ino" && d.Line == 3 {
			found = true
		}
		if strings.Contains(d.Message+d.File, "/tmp") || strings.Contains(d.Message+d.File, "/shim") {
			t.Errorf("container path leaked: %+v", d)
		}
	}
	if !found {
		t.Fatalf("no error at sketch.ino:3 in %+v\nraw log:\n%s", ds, out.Log)
	}
}

func TestIntegrationFunctionsMayBeUsedBeforeTheyAreDefined(t *testing.T) {
	r := sandbox(t)
	out, err := compileSketch(t, r, "void setup() { blinkTwice(); }\nvoid loop() {}\nvoid blinkTwice() { digitalWrite(2, HIGH); }\n")
	if err != nil || out.ExitCode != 0 {
		t.Fatalf("auto prototypes failed: %v exit=%d log=%s", err, out.ExitCode, out.Log)
	}
}

// Everything below runs arbitrary shell commands inside the sandbox flags to prove the
// isolation is real, not just present in the argument list.
func TestIntegrationSandboxIsIsolated(t *testing.T) {
	r := sandbox(t)
	args, err := r.dockerArgs("sim-isolation-test")
	if err != nil {
		t.Fatal(err)
	}
	args = append(args[:len(args)-1], "sh", "-c", `
echo uid=$(id -u)
(touch /rootfs-write 2>/dev/null && echo rootfs=writable) || echo rootfs=readonly
(echo ok > /tmp/x 2>/dev/null && echo tmp=writable) || echo tmp=readonly
(echo '#!/bin/sh' > /tmp/x.sh; chmod +x /tmp/x.sh; /tmp/x.sh 2>/dev/null && echo tmpexec=allowed) || echo tmpexec=denied
grep CapEff /proc/self/status
ls /sys/class/net | tr '\n' ' ' | sed 's/^/ifaces=/'; echo
(cat < /dev/tcp/1.1.1.1/80 2>/dev/null && echo net=reachable) || echo net=none
ls /var/run/docker.sock 2>/dev/null && echo sock=present || echo sock=absent
grep -c Seccomp: /proc/self/status >/dev/null && grep '^NoNewPrivs' /proc/self/status
`)
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker: %v\n%s", err, out)
	}
	got := string(out)
	for _, want := range []string{
		"uid=65534", "rootfs=readonly", "tmp=writable", "tmpexec=denied", "CapEff:\t0000000000000000", "ifaces=lo ", "net=none", "sock=absent", "NoNewPrivs:\t1",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("isolation check %q failed; output:\n%s", want, got)
		}
	}
}

func TestIntegrationResourceBombsAreContained(t *testing.T) {
	r := sandbox(t)
	r.Timeout = 25 * time.Second
	// 10^12 token expansion: would exhaust memory long before finishing.
	var b strings.Builder
	b.WriteString("#define L0 x\n")
	prev := "L0"
	for i := 1; i <= 12; i++ {
		name := "L" + string(rune('0'+i%10)) + string(rune('a'+i))
		b.WriteString("#define " + name + " " + strings.Repeat(prev+" ", 10) + "\n")
		prev = name
	}
	b.WriteString("int big[] = { " + prev + " };\nvoid setup(){}\nvoid loop(){}\n")
	start := time.Now()
	out, err := compileSketch(t, r, b.String())
	took := time.Since(start)
	t.Logf("bomb contained in %v: err=%v exit=%d timedOut=%v", took, err, out.ExitCode, out.TimedOut)
	if took > 40*time.Second {
		t.Fatalf("bomb ran for %v; limits did not stop it", took)
	}
	if err == nil && out.ExitCode == 0 && !out.TimedOut {
		t.Fatal("a macro bomb must not produce a successful build")
	}
	if names, _ := exec.Command("docker", "ps", "-q", "--filter", "name=sim-compile-").Output(); len(bytes.TrimSpace(names)) != 0 {
		t.Errorf("a sandbox container is still running after the job: %s", names)
	}
}

func TestIntegrationHTTPEndToEndWithRealExamples(t *testing.T) {
	r := sandbox(t)
	cache, _ := NewCache(t.TempDir(), 64<<20)
	version := readShimVersion("docker", r.Image)
	if version == "" {
		t.Fatal("cannot read /shim/VERSION from the image")
	}
	srv := NewServer(Config{AllowedOrigins: []string{"http://localhost:3111"}, RatePerMinute: 100, MaxConcurrent: 2, MaxQueue: 4, CompileTimeout: 30 * time.Second, MaxWasmBytes: 512 << 10, ShimVersion: version}, r, cache, nil, slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn})))
	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	for _, name := range []string{"oled", "lcd", "dht", "servo", "interrupt", "ultrasonic", "analog", "serial"} {
		src, err := os.ReadFile("../../arduino-shim/examples/" + name + ".ino")
		if err != nil {
			t.Fatal(err)
		}
		body := `{"files":[{"name":"sketch.ino","content":` + jsonString(string(src)) + `}]}`
		resp, data := post(t, ts.URL, body, map[string]string{"Origin": "http://localhost:3111"})
		got := decode(t, data)
		if resp.StatusCode != http.StatusOK || !got.OK {
			t.Errorf("%s: %d %+v", name, resp.StatusCode, got)
			continue
		}
		wasm, _ := base64.StdEncoding.DecodeString(got.Wasm)
		if bad, _ := UnsupportedImports(wasm); len(bad) != 0 {
			t.Errorf("%s uses unsupported imports %v", name, bad)
		}
	}
	// second request for the same sketch is served from the cache
	src, _ := os.ReadFile("../../arduino-shim/examples/oled.ino")
	_, data := post(t, ts.URL, `{"files":[{"name":"sketch.ino","content":`+jsonString(string(src))+`}]}`, nil)
	if !decode(t, data).Cached {
		t.Error("repeat compile should be cached")
	}
}
