package main

import (
	"regexp"
	"strconv"
	"strings"
)

// Diag is one compiler message shown in the editor.
type Diag struct {
	File     string `json:"file"`
	Line     int    `json:"line"`
	Col      int    `json:"col"`
	Severity string `json:"severity"` // error | warning | note
	Message  string `json:"message"`
}

const (
	maxDiags   = 20
	maxMsgLen  = 300
	workPrefix = "/tmp/work/"
)

var diagRe = regexp.MustCompile(`^(.+?):(\d+):(\d+): (fatal error|error|warning|note): (.*)$`)

// sanitizePath hides container paths: user files lose their directory, shim files are
// shown as arduino-shim/<name>, and anything else is replaced so the sandbox layout never leaks.
func sanitizePath(p string) string {
	switch {
	case strings.HasPrefix(p, workPrefix):
		return strings.TrimPrefix(p, workPrefix)
	case strings.HasPrefix(p, "/shim/include/"):
		return "arduino-shim/" + strings.TrimPrefix(p, "/shim/include/")
	case strings.HasPrefix(p, "/shim/src/"):
		return "arduino-shim/" + strings.TrimPrefix(p, "/shim/src/")
	case !strings.HasPrefix(p, "/"):
		return p // relative: already a user file name from #line
	default:
		return "(system)"
	}
}

var pathInTextRe = regexp.MustCompile(`/(?:tmp|shim|usr|lib|etc|proc|sys|root|home|var)[^\s'":]*`)

func sanitizeText(s string) string {
	s = strings.ReplaceAll(s, workPrefix, "")
	s = strings.ReplaceAll(s, "/shim/include/", "arduino-shim/")
	s = pathInTextRe.ReplaceAllString(s, "(path hidden)")
	if len(s) > maxMsgLen {
		s = s[:maxMsgLen] + "…"
	}
	return s
}

// ParseDiagnostics extracts `file:line:col: severity: message` lines from clang output and
// drops everything else (source snippets, carets, command lines). If nothing matched but the
// build failed, the last non-empty line (e.g. a linker error) is reported instead.
func ParseDiagnostics(log string, failed bool) []Diag {
	var out []Diag
	var last string
	for _, line := range strings.Split(log, "\n") {
		line = strings.TrimRight(line, "\r")
		if strings.TrimSpace(line) != "" {
			last = line
		}
		m := diagRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		ln, _ := strconv.Atoi(m[2])
		col, _ := strconv.Atoi(m[3])
		sev := m[4]
		if sev == "fatal error" {
			sev = "error"
		}
		if len(out) < maxDiags {
			out = append(out, Diag{File: sanitizePath(m[1]), Line: ln, Col: col, Severity: sev, Message: sanitizeText(m[5])})
		}
	}
	if failed && !hasError(out) {
		msg := sanitizeText(strings.TrimPrefix(strings.TrimPrefix(last, "wasm-ld: "), "clang: "))
		if msg == "" {
			msg = "compilation failed"
		}
		out = append(out, Diag{Severity: "error", Message: msg})
	}
	return out
}

func hasError(ds []Diag) bool {
	for _, d := range ds {
		if d.Severity == "error" {
			return true
		}
	}
	return false
}
