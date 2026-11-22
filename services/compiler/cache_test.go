package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestCacheKeyDependsOnEverythingThatMatters(t *testing.T) {
	base := CacheKey("v1", []File{{"a.ino", "x"}}, []string{"L"})
	same := CacheKey("v1", []File{{"a.ino", "x"}}, []string{"L"})
	if base != same || len(base) != 64 {
		t.Fatalf("key not stable: %s %s", base, same)
	}
	for name, k := range map[string]string{
		"shim version": CacheKey("v2", []File{{"a.ino", "x"}}, []string{"L"}),
		"content":      CacheKey("v1", []File{{"a.ino", "y"}}, []string{"L"}),
		"file name":    CacheKey("v1", []File{{"b.ino", "x"}}, []string{"L"}),
		"libs":         CacheKey("v1", []File{{"a.ino", "x"}}, []string{"M"}),
		"no libs":      CacheKey("v1", []File{{"a.ino", "x"}}, nil),
	} {
		if k == base {
			t.Errorf("key ignores %s", name)
		}
	}
	// order of files and libs must not matter
	a := CacheKey("v", []File{{"a.ino", "1"}, {"b.h", "2"}}, []string{"x", "y"})
	b := CacheKey("v", []File{{"b.h", "2"}, {"a.ino", "1"}}, []string{"y", "x"})
	if a != b {
		t.Error("key depends on ordering")
	}
	// length prefixes prevent ("ab","c") colliding with ("a","bc")
	if CacheKey("v", []File{{"a.ino", "ab"}, {"c.h", ""}}, nil) == CacheKey("v", []File{{"a.ino", "a"}, {"bc.h", ""}}, nil) {
		t.Error("ambiguous concatenation collides")
	}
}

func TestCacheRoundTripAndErrors(t *testing.T) {
	c, err := NewCache(t.TempDir(), 1<<20)
	if err != nil {
		t.Fatal(err)
	}
	key := CacheKey("v", []File{{"a.ino", "1"}}, nil)
	if _, ok := c.Get(key); ok {
		t.Fatal("unexpected hit")
	}
	ok := &Result{OK: true, Wasm: []byte("\x00asm1234"), Diags: []Diag{{Severity: "warning", Message: "w"}}}
	if err := c.Put(key, ok); err != nil {
		t.Fatal(err)
	}
	got, hit := c.Get(key)
	if !hit || !got.OK || !bytes.Equal(got.Wasm, ok.Wasm) || len(got.Diags) != 1 {
		t.Fatalf("round trip: %+v hit=%v", got, hit)
	}
	// failures are cached too (no wasm)
	k2 := CacheKey("v", []File{{"b.ino", "2"}}, nil)
	_ = c.Put(k2, &Result{OK: false, Diags: []Diag{{Severity: "error", Message: "boom"}}})
	got, hit = c.Get(k2)
	if !hit || got.OK || got.Diags[0].Message != "boom" {
		t.Fatalf("error round trip: %+v", got)
	}
	if _, err := c.path("../../etc/passwd", ".json"); err == nil {
		t.Error("path traversal key must be rejected")
	}
}

func TestCacheEvictsOldestWhenOverBudget(t *testing.T) {
	dir := t.TempDir()
	c, _ := NewCache(dir, 3000)
	var keys []string
	for i := 0; i < 5; i++ {
		k := CacheKey("v", []File{{"a.ino", string(rune('a' + i))}}, nil)
		keys = append(keys, k)
		_ = c.Put(k, &Result{OK: true, Wasm: bytes.Repeat([]byte{byte(i)}, 1000)})
		// make mtimes strictly increasing so "oldest" is well defined
		old := time.Now().Add(time.Duration(i-10) * time.Minute)
		_ = os.Chtimes(filepath.Join(dir, k+".wasm"), old, old)
		_ = os.Chtimes(filepath.Join(dir, k+".json"), old, old)
	}
	if _, ok := c.Get(keys[0]); ok {
		t.Error("oldest entry should have been evicted")
	}
	if _, ok := c.Get(keys[4]); !ok {
		t.Error("newest entry must survive")
	}
	var total int64
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		info, _ := e.Info()
		total += info.Size()
	}
	if total > 3000 {
		t.Errorf("cache is %d bytes, budget 3000", total)
	}
}
