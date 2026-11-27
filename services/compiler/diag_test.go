package main

import (
	"strings"
	"testing"
)

const sampleLog = `/tmp/work/sketch.ino.cpp:12:5: error: use of undeclared identifier 'foo'
   12 |     foo();
      |     ^
sketch.ino:7:10: warning: unused variable 'x' [-Wunused-variable]
/shim/include/Wire.h:30:3: note: candidate function not viable
/usr/lib/llvm-19/lib/clang/19/include/stddef.h:1:1: error: something in the system
1 warning and 2 errors generated.
`

func TestParseDiagnostics(t *testing.T) {
	ds := ParseDiagnostics(sampleLog, true)
	if len(ds) != 4 {
		t.Fatalf("got %d diags: %+v", len(ds), ds)
	}
	if ds[0] != (Diag{File: "sketch.ino.cpp", Line: 12, Col: 5, Severity: "error", Message: "use of undeclared identifier 'foo'"}) {
		t.Errorf("first: %+v", ds[0])
	}
	if ds[1].File != "sketch.ino" || ds[1].Line != 7 || ds[1].Severity != "warning" {
		t.Errorf("second: %+v", ds[1])
	}
	if ds[2].File != "arduino-shim/Wire.h" || ds[2].Severity != "note" {
		t.Errorf("third: %+v", ds[2])
	}
	if ds[3].File != "(system)" {
		t.Errorf("system path must be hidden: %+v", ds[3])
	}
	for _, d := range ds {
		if strings.Contains(d.File+d.Message, "/usr") || strings.Contains(d.File+d.Message, "/tmp") {
			t.Errorf("container path leaked: %+v", d)
		}
	}
}

func TestParseDiagnosticsHidesPathsInMessagesAndTruncates(t *testing.T) {
	log := "a.cpp:1:1: error: cannot open /etc/passwd or /tmp/work/secret.h " + strings.Repeat("x", 400) + "\n"
	ds := ParseDiagnostics(log, true)
	if len(ds) != 1 || strings.Contains(ds[0].Message, "/etc") || strings.Contains(ds[0].Message, "/tmp") {
		t.Fatalf("paths not hidden: %+v", ds)
	}
	if len([]rune(ds[0].Message)) > maxMsgLen+1 {
		t.Errorf("message not truncated: %d", len(ds[0].Message))
	}
}

func TestParseDiagnosticsCapsCount(t *testing.T) {
	var b strings.Builder
	for i := 0; i < 50; i++ {
		b.WriteString("a.cpp:1:1: error: e\n")
	}
	if got := len(ParseDiagnostics(b.String(), true)); got != maxDiags {
		t.Fatalf("got %d, want %d", got, maxDiags)
	}
}

func TestParseDiagnosticsFallsBackToLinkerMessage(t *testing.T) {
	ds := ParseDiagnostics("wasm-ld: error: undefined symbol: foo\n", true)
	if len(ds) != 1 || ds[0].Severity != "error" || !strings.Contains(ds[0].Message, "undefined symbol: foo") {
		t.Fatalf("fallback: %+v", ds)
	}
	if ds := ParseDiagnostics("", true); len(ds) != 1 || ds[0].Message != "compilation failed" {
		t.Fatalf("empty failure: %+v", ds)
	}
	if ds := ParseDiagnostics("a.cpp:1:1: warning: w\n", false); len(ds) != 1 || ds[0].Severity != "warning" {
		t.Fatalf("success with warnings: %+v", ds)
	}
}
