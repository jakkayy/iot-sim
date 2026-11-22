package main

import (
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
)

// File is one source file of a sketch.
type File struct {
	Name    string `json:"name"`
	Content string `json:"content"`
}

const (
	maxFiles       = 8
	maxSourceBytes = 200 * 1024
)

var (
	fileNameRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}\.(ino|cpp|h|hpp)$`)
	includeRe  = regexp.MustCompile(`(?m)^[ \t]*#[ \t]*(include|include_next|import|embed)\b(.*)$`)
	pathOKRe   = regexp.MustCompile(`^[A-Za-z0-9_+\-][A-Za-z0-9_+\-./]*$`)
	asmRe      = regexp.MustCompile(`\b(asm|__asm__|__asm)\b|\.incbin|__has_include|__has_embed`)
)

// ValidateSources rejects anything that could make the compiler read files outside the
// sketch or run arbitrary assembler. The sandbox is the real defence; this keeps error
// output from leaking container contents and stops the obvious tricks early.
func ValidateSources(files []File) error {
	if len(files) == 0 {
		return errors.New("no files")
	}
	if len(files) > maxFiles {
		return fmt.Errorf("too many files (max %d)", maxFiles)
	}
	total := 0
	seen := map[string]bool{}
	hasMain := false
	for _, f := range files {
		if !fileNameRe.MatchString(f.Name) {
			return fmt.Errorf("invalid file name %q", f.Name)
		}
		if seen[strings.ToLower(f.Name)] {
			return fmt.Errorf("duplicate file name %q", f.Name)
		}
		seen[strings.ToLower(f.Name)] = true
		total += len(f.Content)
		if strings.Contains(f.Content, "\x00") {
			return fmt.Errorf("%s: binary content is not allowed", f.Name)
		}
		if strings.HasSuffix(f.Name, ".ino") || strings.HasSuffix(f.Name, ".cpp") {
			hasMain = true
		}
		stripped := stripCommentsAndStrings(f.Content, true)
		if loc := asmRe.FindString(stripped); loc != "" {
			return fmt.Errorf("%s: %q is not allowed", f.Name, strings.TrimSpace(loc))
		}
		// Includes keep their <...> / "..." text, so check the raw directive lines.
		for _, m := range includeRe.FindAllStringSubmatch(stripCommentsOnly(f.Content), -1) {
			if m[1] != "include" {
				return fmt.Errorf("%s: #%s is not allowed", f.Name, m[1])
			}
			arg := strings.TrimSpace(m[2])
			if len(arg) < 3 || (arg[0] != '<' && arg[0] != '"') {
				return fmt.Errorf("%s: unsupported #include form", f.Name)
			}
			closer := byte('>')
			if arg[0] == '"' {
				closer = '"'
			}
			end := strings.IndexByte(arg[1:], closer)
			if end < 0 {
				return fmt.Errorf("%s: unterminated #include", f.Name)
			}
			path := arg[1 : 1+end]
			if !pathOKRe.MatchString(path) || strings.Contains(path, "..") || strings.Contains(path, "//") {
				return fmt.Errorf("%s: #include path %q is not allowed", f.Name, path)
			}
		}
	}
	if total > maxSourceBytes {
		return fmt.Errorf("sketch is too large (max %d KB)", maxSourceBytes/1024)
	}
	if !hasMain {
		return errors.New("need a .ino or .cpp file")
	}
	return nil
}

// stripCommentsOnly removes comments but keeps string contents (so #include "x" survives).
func stripCommentsOnly(src string) string { return stripCommentsAndStrings(src, false) }

// stripCommentsAndStrings replaces comments (and optionally string/char literal contents)
// with spaces, keeping newlines so line numbers stay valid.
func stripCommentsAndStrings(src string, blankStrings bool) string {
	out := []byte(src)
	i := 0
	blank := func(from, to int) {
		for k := from; k < to && k < len(out); k++ {
			if out[k] != '\n' {
				out[k] = ' '
			}
		}
	}
	for i < len(src) {
		switch {
		case strings.HasPrefix(src[i:], "//"):
			j := strings.IndexByte(src[i:], '\n')
			if j < 0 {
				j = len(src) - i
			}
			blank(i, i+j)
			i += j
		case strings.HasPrefix(src[i:], "/*"):
			j := strings.Index(src[i+2:], "*/")
			end := len(src)
			if j >= 0 {
				end = i + 2 + j + 2
			}
			blank(i, end)
			i = end
		case src[i] == '"' || src[i] == '\'':
			q := src[i]
			j := i + 1
			for j < len(src) && src[j] != q && src[j] != '\n' {
				if src[j] == '\\' {
					j++
				}
				j++
			}
			if blankStrings && j > i+1 {
				blank(i+1, min(j, len(src)))
			}
			i = j + 1
		default:
			i++
		}
	}
	return string(out)
}

var funcHeaderRe = regexp.MustCompile(`^\s*((?:[A-Za-z_][\w:<>,*&\s]*?))\s*([*&]*)\s*([A-Za-z_]\w*)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)\s*(const)?\s*$`)

var notFunctionKeywords = map[string]bool{
	"if": true, "for": true, "while": true, "switch": true, "else": true, "do": true, "catch": true,
	"return": true, "sizeof": true,
}

var notFunctionStarts = []string{"struct", "class", "enum", "union", "namespace", "typedef", "template", "extern", "using", "return", "else"}

// prototype describes one function definition found at file scope.
type prototype struct {
	text string // e.g. "int add(int a, int b);"
	line int    // 0-based line index in the analysed text where the definition starts
}

// findPrototypes scans file-scope function definitions (the way the Arduino builder
// does) so functions can be used before they are defined.
func findPrototypes(src string) []prototype {
	clean := stripCommentsAndStrings(src, true)
	lines := strings.Split(clean, "\n")
	// Drop preprocessor lines (and their continuations) from analysis, keep line count.
	for i := 0; i < len(lines); i++ {
		if strings.HasPrefix(strings.TrimSpace(lines[i]), "#") {
			for {
				cont := strings.HasSuffix(strings.TrimRight(lines[i], " \t\r"), "\\")
				lines[i] = ""
				if !cont || i+1 >= len(lines) {
					break
				}
				i++
			}
		}
	}
	text := strings.Join(lines, "\n")

	var protos []prototype
	depth, paren := 0, 0
	stmtStart := 0
	declared := map[string]bool{}
	for i := 0; i < len(text); i++ {
		switch text[i] {
		case '(':
			paren++
		case ')':
			if paren > 0 {
				paren--
			}
		case ';':
			if depth == 0 && paren == 0 {
				if m := funcHeaderRe.FindStringSubmatch(text[stmtStart:i]); m != nil {
					declared[m[3]] = true
				}
				stmtStart = i + 1
			}
		case '{':
			if depth == 0 && paren == 0 {
				header := text[stmtStart:i]
				if m := funcHeaderRe.FindStringSubmatch(header); m != nil && isFunctionDef(m) && !declared[m[3]] {
					params := strings.TrimSpace(m[4])
					if !strings.Contains(params, "=") {
						ret := strings.Join(strings.Fields(m[1]), " ")
						proto := fmt.Sprintf("%s %s%s(%s)%s;", ret, m[2], m[3], params, strings.TrimSpace(" "+m[5]))
						startLine := strings.Count(text[:stmtStart+len(header)-len(strings.TrimLeft(header, " \t\r\n"))], "\n")
						protos = append(protos, prototype{text: strings.ReplaceAll(strings.Join(strings.Fields(proto), " "), "( ", "("), line: startLine})
					}
				}
			}
			depth++
		case '}':
			if depth > 0 {
				depth--
			}
			if depth == 0 {
				stmtStart = i + 1
			}
		}
	}
	return protos
}

func isFunctionDef(m []string) bool {
	name := m[3]
	if notFunctionKeywords[name] {
		return false
	}
	first := strings.Fields(m[1])
	if len(first) == 0 {
		return false // constructor-like or macro call; no return type
	}
	for _, kw := range notFunctionStarts {
		if first[0] == kw {
			return false
		}
	}
	return true
}

// Preprocess turns the user's files into compilable C++: all .ino files are
// concatenated (sketch.ino first), get `#include <Arduino.h>` and prototypes for
// functions defined later, with #line directives so errors point at the user's lines.
func Preprocess(files []File) ([]File, error) {
	var inos, rest []File
	for _, f := range files {
		if strings.HasSuffix(f.Name, ".ino") {
			inos = append(inos, f)
		} else {
			rest = append(rest, f)
		}
	}
	sort.SliceStable(inos, func(i, j int) bool {
		a, b := inos[i].Name == "sketch.ino", inos[j].Name == "sketch.ino"
		if a != b {
			return a
		}
		return inos[i].Name < inos[j].Name
	})
	out := append([]File{}, rest...)
	if len(inos) == 0 {
		return out, nil
	}

	type seg struct {
		file  string
		lines []string
	}
	var segs []seg
	var all []string
	for _, f := range inos {
		ls := strings.Split(strings.ReplaceAll(f.Content, "\r\n", "\n"), "\n")
		segs = append(segs, seg{f.Name, ls})
		all = append(all, ls...)
	}
	protos := findPrototypes(strings.Join(all, "\n"))

	// Insert prototypes just before the first definition so user-defined types above it are visible.
	insertAt := -1
	var protoText []string
	if len(protos) > 0 {
		insertAt = protos[0].line
		for _, p := range protos {
			protoText = append(protoText, p.text)
		}
	}

	var b strings.Builder
	b.WriteString("#include <Arduino.h>\n")
	global := 0
	for _, s := range segs {
		fmt.Fprintf(&b, "#line 1 %q\n", s.file)
		for i, l := range s.lines {
			if global == insertAt {
				for _, p := range protoText {
					b.WriteString(p + "\n")
				}
				fmt.Fprintf(&b, "#line %d %q\n", i+1, s.file)
			}
			b.WriteString(l + "\n")
			global++
		}
	}
	out = append(out, File{Name: "sketch.ino.cpp", Content: b.String()})
	return out, nil
}
