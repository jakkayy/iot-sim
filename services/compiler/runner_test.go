package main

import (
	"archive/tar"
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestDockerArgsAlwaysIncludeIsolationFlags(t *testing.T) {
	r := &DockerRunner{Image: "sandbox:1", Runtime: "runsc"}
	args, err := r.dockerArgs("job-1")
	if err != nil {
		t.Fatal(err)
	}
	joined := " " + strings.Join(args, " ") + " "
	for _, must := range []string{
		" --network none ", " --read-only ", " --cap-drop ALL ", " --security-opt no-new-privileges ",
		" --pids-limit 128 ", " --memory 512m ", " --cpus 1 ", " --user 65534:65534 ", " --runtime runsc ",
		" --tmpfs /tmp:rw,noexec,nosuid,size=64m ", " --rm ", " -i ",
	} {
		if !strings.Contains(joined, must) {
			t.Errorf("missing %q in %v", must, args)
		}
	}
	if strings.Contains(joined, " -v ") || strings.Contains(joined, "--volume") || strings.Contains(joined, "--privileged") || strings.Contains(joined, "--mount") {
		t.Errorf("a mount or privileged flag slipped in: %v", args)
	}
	if args[len(args)-2] != "sandbox:1" || args[len(args)-1] != "/shim/build/compile-stdin.sh" {
		t.Errorf("image and entrypoint must come last: %v", args)
	}
}

func TestDockerArgsRejectBadConfig(t *testing.T) {
	for _, bad := range []*DockerRunner{
		{Image: "x", Runtime: "evil-runtime"},
		{Image: ""},
		{Image: "--privileged"},
		{Image: "img --privileged"},
	} {
		if _, err := bad.dockerArgs("n"); err == nil {
			t.Errorf("expected error for %+v", bad)
		}
	}
	if _, err := (&DockerRunner{Image: "x", Runtime: ""}).dockerArgs("n"); err != nil {
		t.Errorf("default runtime must be allowed: %v", err)
	}
}

func TestMakeTarContainsOnlyTheFiles(t *testing.T) {
	data, err := makeTar([]File{{"sketch.ino.cpp", "int x;"}, {"util.h", "#pragma once"}})
	if err != nil {
		t.Fatal(err)
	}
	tr := tar.NewReader(bytes.NewReader(data))
	got := map[string]string{}
	for {
		h, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(tr)
		got[h.Name] = string(b)
	}
	if len(got) != 2 || got["sketch.ino.cpp"] != "int x;" || got["util.h"] != "#pragma once" {
		t.Fatalf("tar contents: %v", got)
	}
	if _, err := makeTar([]File{{"../evil.cpp", ""}}); err == nil {
		t.Error("path traversal name must be rejected")
	}
}

func TestLimitedBufferStopsAtLimit(t *testing.T) {
	b := &limitedBuffer{max: 5}
	if _, err := b.Write([]byte("123")); err != nil {
		t.Fatal(err)
	}
	if _, err := b.Write([]byte("456")); err == nil || !b.overflow {
		t.Fatal("must refuse and flag overflow")
	}
}
