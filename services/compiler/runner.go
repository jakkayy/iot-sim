package main

import (
	"archive/tar"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// RunOutput is the raw outcome of one sandboxed compile.
type RunOutput struct {
	Wasm     []byte
	Log      string
	ExitCode int
	TimedOut bool
}

// Runner compiles a preprocessed sketch. The only implementation that runs untrusted code
// is DockerRunner; tests use fakes.
type Runner interface {
	Compile(ctx context.Context, files []File) (RunOutput, error)
}

// DockerRunner runs one throwaway container per compile.
//
// SECURITY: every isolation flag below is hard-coded. Nothing in an HTTP request can add,
// remove or change a flag, mount, capability or network setting. Config only chooses the
// image and (from an allowlist) the OCI runtime. Sources go in through stdin and the wasm
// comes back on stdout, so no host directory is ever mounted into the container.
type DockerRunner struct {
	DockerBin string
	Image     string
	Runtime   string // "" (daemon default), "runc" or "runsc" (gVisor)
	Timeout   time.Duration
	MaxWasm   int64
}

var allowedRuntimes = map[string]bool{"": true, "runc": true, "runsc": true}

// dockerArgs builds the full `docker run` argument list. Kept separate so tests can assert
// that the isolation flags are present for every job.
func (r *DockerRunner) dockerArgs(name string) ([]string, error) {
	if !allowedRuntimes[r.Runtime] {
		return nil, fmt.Errorf("runtime %q is not allowed", r.Runtime)
	}
	if r.Image == "" || strings.HasPrefix(r.Image, "-") || strings.ContainsAny(r.Image, " \t\n") {
		return nil, errors.New("invalid sandbox image")
	}
	args := []string{
		"run", "--rm", "-i",
		"--name", name,
		"--network", "none",
		"--read-only",
		"--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		"--pids-limit", "128",
		"--memory", "512m", "--memory-swap", "512m",
		"--cpus", "1",
		"--ulimit", "nofile=256:256",
		"--ulimit", "fsize=67108864",
		"--user", "65534:65534",
	}
	if r.Runtime != "" {
		args = append(args, "--runtime", r.Runtime)
	}
	return append(args, r.Image, "/shim/build/compile-stdin.sh"), nil
}

type limitedBuffer struct {
	buf      bytes.Buffer
	max      int64
	overflow bool
}

func (l *limitedBuffer) Write(p []byte) (int, error) {
	if int64(l.buf.Len())+int64(len(p)) > l.max {
		l.overflow = true
		return 0, errors.New("output limit exceeded")
	}
	return l.buf.Write(p)
}

func makeTar(files []File) ([]byte, error) {
	var buf bytes.Buffer
	tw := tar.NewWriter(&buf)
	for _, f := range files {
		if !fileNameRe.MatchString(f.Name) && f.Name != "sketch.ino.cpp" {
			return nil, fmt.Errorf("invalid file name %q", f.Name)
		}
		if err := tw.WriteHeader(&tar.Header{Name: f.Name, Mode: 0o644, Size: int64(len(f.Content)), Typeflag: tar.TypeReg}); err != nil {
			return nil, err
		}
		if _, err := tw.Write([]byte(f.Content)); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func (r *DockerRunner) Compile(ctx context.Context, files []File) (RunOutput, error) {
	name := fmt.Sprintf("sim-compile-%d", time.Now().UnixNano())
	args, err := r.dockerArgs(name)
	if err != nil {
		return RunOutput{}, err
	}
	archive, err := makeTar(files)
	if err != nil {
		return RunOutput{}, err
	}
	bin := r.DockerBin
	if bin == "" {
		bin = "docker"
	}
	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdin = bytes.NewReader(archive)
	out := &limitedBuffer{max: r.MaxWasm + 1}
	errBuf := &limitedBuffer{max: 64 * 1024}
	cmd.Stdout = out
	cmd.Stderr = errBuf
	cmd.WaitDelay = 3 * time.Second

	runErr := cmd.Run()
	if ctx.Err() == context.DeadlineExceeded {
		// Killing the docker CLI does not stop the container; do it explicitly.
		kctx, kcancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer kcancel()
		_ = exec.CommandContext(kctx, bin, "kill", name).Run()
		return RunOutput{TimedOut: true, Log: errBuf.buf.String()}, nil
	}
	if out.overflow {
		_ = exec.Command(bin, "kill", name).Run()
		return RunOutput{ExitCode: 1, Log: "output.wasm: output is too large"}, nil
	}
	res := RunOutput{Wasm: out.buf.Bytes(), Log: errBuf.buf.String()}
	if runErr != nil {
		var ee *exec.ExitError
		if errors.As(runErr, &ee) {
			res.ExitCode = ee.ExitCode()
			if res.ExitCode == 1 {
				res.Wasm = nil
				return res, nil // ordinary compile error: the log has the diagnostics
			}
			return res, fmt.Errorf("sandbox exited with code %d", res.ExitCode)
		}
		return res, runErr
	}
	return res, nil
}
