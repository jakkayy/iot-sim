package main

import (
	"strings"
	"testing"
)

func f(name, content string) File { return File{Name: name, Content: content} }

func TestValidateAcceptsNormalSketches(t *testing.T) {
	ok := []File{f("sketch.ino", "#include <Arduino.h>\n#include <Wire.h>\n#include \"util.h\"\n#include <sys/types.h>\nvoid setup(){}\nvoid loop(){}\n"), f("util.h", "int x;")}
	if err := ValidateSources(ok); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRejects(t *testing.T) {
	big := strings.Repeat("a", maxSourceBytes+1)
	cases := map[string][]File{
		"no files":            nil,
		"bad name":            {f("../evil.ino", "")},
		"path separator":      {f("a/b.ino", "")},
		"wrong extension":     {f("a.sh", "")},
		"duplicate":           {f("a.ino", ""), f("A.ino", "")},
		"only headers":        {f("a.h", "")},
		"too large":           {f("a.ino", big)},
		"nul byte":            {f("a.ino", "x\x00y")},
		"absolute include":    {f("a.ino", "#include \"/etc/passwd\"\n")},
		"parent include":      {f("a.ino", "#include \"../../etc/passwd\"\n")},
		"angle abs include":   {f("a.ino", "#include </etc/shadow>\n")},
		"backslash include":   {f("a.ino", "#include \"a\\b\"\n")},
		"include_next":        {f("a.ino", "#include_next <x.h>\n")},
		"import":              {f("a.ino", "#import \"x.h\"\n")},
		"embed":               {f("a.ino", "const char d[] = {\n#embed \"x\"\n};\n")},
		"asm keyword":         {f("a.ino", "void f(){ asm(\"nop\"); }\n")},
		"__asm__":             {f("a.ino", "void f(){ __asm__(\"nop\"); }\n")},
		"incbin":              {f("a.ino", "void f(){ __asm__(\".incbin \\\"/etc/passwd\\\"\"); }\n")},
		"has_include probing": {f("a.ino", "#if __has_include(\"/etc/passwd\")\n#endif\n")},
		"macro-built include": {f("a.ino", "#include MACRO\n")},
	}
	many := make([]File, maxFiles+1)
	for i := range many {
		many[i] = f("f"+string(rune('a'+i))+".ino", "")
	}
	cases["too many files"] = many
	for name, files := range cases {
		if err := ValidateSources(files); err == nil {
			t.Errorf("%s: expected an error", name)
		}
	}
}

func TestValidateIgnoresDirectivesInCommentsAndStrings(t *testing.T) {
	src := "// #include \"/etc/passwd\"\n/* asm(\"x\") */\nconst char *s = \"asm and #include /etc\";\nvoid setup(){}\nvoid loop(){}\n"
	if err := ValidateSources([]File{f("a.ino", src)}); err != nil {
		t.Fatalf("comments/strings must not trigger: %v", err)
	}
}

func TestStripKeepsLineNumbers(t *testing.T) {
	src := "a // c\n/* x\ny */ b\n\"s\\\"t\" c\n"
	got := stripCommentsAndStrings(src, true)
	if strings.Count(got, "\n") != strings.Count(src, "\n") {
		t.Fatalf("newlines changed: %q", got)
	}
	if strings.Contains(got, "c\n/*") || strings.Contains(got, "x") {
		t.Fatalf("comments not blanked: %q", got)
	}
}

func protoTexts(src string) []string {
	var out []string
	for _, p := range findPrototypes(src) {
		out = append(out, p.text)
	}
	return out
}

func TestFindPrototypes(t *testing.T) {
	src := `
#define X 1
int counter = 0;
struct P { int a; };
void setup() { helper(1); }
void loop() { if (x) { y(); } }
static int add(int a, int b) { return a + b; }
const char* name(void) { return "x"; }
float *ptr(float v) { return 0; }
void withDefault(int a = 3) {}
void declared(int a);
void declared(int a) {}
class C { public: void m() {} };
`
	got := protoTexts(src)
	want := []string{
		"void setup();",
		"void loop();",
		"static int add(int a, int b);",
		"const char* name(void);",
		"float *ptr(float v);",
	}
	_ = want
	has := func(s string) bool {
		for _, g := range got {
			if strings.Contains(g, s) {
				return true
			}
		}
		return false
	}
	for _, w := range []string{"setup(", "loop(", "add(int a, int b)", "name(void)", "ptr(float v)"} {
		if !has(w) {
			t.Errorf("missing prototype for %s in %v", w, got)
		}
	}
	for _, bad := range []string{"withDefault", "declared", "if", "m()", "struct", "class"} {
		if has(bad) {
			t.Errorf("unexpected prototype %s in %v", bad, got)
		}
	}
}

func TestPreprocessAddsIncludePrototypesAndLineDirectives(t *testing.T) {
	src := "struct Pt { int x; };\nvoid setup() { go(); }\nvoid loop() {}\nvoid go() {}\n"
	out, err := Preprocess([]File{f("sketch.ino", src)})
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 || out[0].Name != "sketch.ino.cpp" {
		t.Fatalf("unexpected output files: %+v", out)
	}
	c := out[0].Content
	if !strings.HasPrefix(c, "#include <Arduino.h>\n#line 1 \"sketch.ino\"\n") {
		t.Fatalf("header wrong:\n%s", c)
	}
	// prototypes are placed after the struct (first definition line) and before setup()
	iStruct, iProto, iSetup := strings.Index(c, "struct Pt"), strings.Index(c, "void go();"), strings.Index(c, "void setup() {")
	if !(iStruct < iProto && iProto < iSetup) {
		t.Fatalf("prototype placement wrong (struct=%d proto=%d setup=%d):\n%s", iStruct, iProto, iSetup, c)
	}
	// after the prototypes the line counter is restored to setup()'s real line (2)
	if !strings.Contains(c, "#line 2 \"sketch.ino\"\nvoid setup()") {
		t.Fatalf("missing #line restore:\n%s", c)
	}
}

func TestPreprocessMultipleInoAndPassThrough(t *testing.T) {
	out, _ := Preprocess([]File{f("b.ino", "void helper() {}\n"), f("sketch.ino", "void setup() { helper(); }\nvoid loop() {}\n"), f("lib.h", "#pragma once\n"), f("x.cpp", "int y;\n")})
	names := []string{}
	for _, o := range out {
		names = append(names, o.Name)
	}
	if strings.Join(names, ",") != "lib.h,x.cpp,sketch.ino.cpp" {
		t.Fatalf("files: %v", names)
	}
	c := out[2].Content
	if strings.Index(c, `#line 1 "sketch.ino"`) > strings.Index(c, `#line 1 "b.ino"`) {
		t.Fatalf("sketch.ino must come first:\n%s", c)
	}
	if !strings.Contains(c, "void helper();") {
		t.Fatalf("helper() defined in another tab needs a prototype:\n%s", c)
	}
	// a project with only .cpp files is left untouched
	out, _ = Preprocess([]File{f("main.cpp", "void setup(){}\nvoid loop(){}\n")})
	if len(out) != 1 || out[0].Name != "main.cpp" {
		t.Fatalf("cpp-only passthrough broken: %+v", out)
	}
}
