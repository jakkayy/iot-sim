package main

import (
	"os"
	"regexp"
	"strings"
	"testing"
)

// module with imports env.foo (func type 0) and env.memory (memory)
func wasmWithImports() []byte {
	import1 := []byte{3, 'e', 'n', 'v', 3, 'f', 'o', 'o', 0, 0}
	import2 := []byte{3, 'e', 'n', 'v', 6, 'm', 'e', 'm', 'o', 'r', 'y', 2, 0, 1}
	body := append([]byte{2}, import1...)
	body = append(body, import2...)
	out := []byte("\x00asm\x01\x00\x00\x00")
	out = append(out, 2, byte(len(body)))
	return append(out, body...)
}

func TestWasmImports(t *testing.T) {
	got, err := WasmImports(wasmWithImports())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, ",") != "env.foo,env.memory" {
		t.Fatalf("got %v", got)
	}
}

func TestWasmImportsRejectsGarbage(t *testing.T) {
	for _, in := range [][]byte{nil, []byte("hello world"), []byte("\x00asm\x01\x00\x00\x00\x02\xff")} {
		if _, err := WasmImports(in); err == nil {
			t.Errorf("expected error for %q", in)
		}
	}
	if got, err := WasmImports([]byte("\x00asm\x01\x00\x00\x00")); err != nil || got != nil {
		t.Errorf("module without imports: %v %v", got, err)
	}
}

func TestUnsupportedImports(t *testing.T) {
	got, _ := UnsupportedImports(wasmWithImports())
	// "foo" is not in the allowlist; "memory" (a memory import) is reported too, which the shim never emits
	if len(got) != 2 {
		t.Fatalf("got %v", got)
	}
}

func TestDemangle(t *testing.T) {
	cases := map[string]string{
		"_ZN9WiFiClass5beginEPKcS1_": "WiFiClass::begin",
		"_Z7foo_barv":                "foo_bar",
		"plain_c":                    "plain_c",
		"_Zweird":                    "_Zweird",
	}
	for in, want := range cases {
		if got := demangle(in); got != want {
			t.Errorf("demangle(%q) = %q, want %q", in, got, want)
		}
	}
}

// Keeps the Go allowlist in sync with the SIM_IMPORT declarations the shim exposes.
func TestAllowedImportsMatchShimHeader(t *testing.T) {
	data, err := os.ReadFile("../../arduino-shim/include/Arduino.h")
	if err != nil {
		t.Skip("shim header not found: ", err)
	}
	re := regexp.MustCompile(`(?m)^SIM_IMPORT\((\w+)\)`)
	declared := map[string]bool{}
	for _, m := range re.FindAllStringSubmatch(string(data), -1) {
		declared[m[1]] = true
	}
	for name := range declared {
		if !allowedImports[name] {
			t.Errorf("shim declares import %q but the compiler allowlist lacks it", name)
		}
	}
	for name := range allowedImports {
		if !declared[name] {
			t.Errorf("allowlist has %q which the shim header does not declare", name)
		}
	}
}
