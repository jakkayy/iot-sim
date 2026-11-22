package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Result is what a compile produces and what the cache stores.
type Result struct {
	OK    bool   `json:"ok"`
	Wasm  []byte `json:"-"`
	Diags []Diag `json:"diags"`
}

// CacheKey identifies a compile: the sources, requested libraries and the shim version
// (which pins the image and therefore the compiler flags).
func CacheKey(shimVersion string, files []File, libs []string) string {
	h := sha256.New()
	write := func(s string) {
		h.Write([]byte(strconv.Itoa(len(s))))
		h.Write([]byte{':'})
		h.Write([]byte(s))
	}
	write(shimVersion)
	ls := append([]string{}, libs...)
	sort.Strings(ls)
	for _, l := range ls {
		write("lib")
		write(l)
	}
	fs := append([]File{}, files...)
	sort.Slice(fs, func(i, j int) bool { return fs[i].Name < fs[j].Name })
	for _, f := range fs {
		write("file")
		write(f.Name)
		write(f.Content)
	}
	return hex.EncodeToString(h.Sum(nil))
}

// Cache is a size-bounded on-disk cache; the oldest entries (by mtime) are evicted first.
type Cache struct {
	dir      string
	maxBytes int64
	mu       sync.Mutex
}

func NewCache(dir string, maxBytes int64) (*Cache, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	return &Cache{dir: dir, maxBytes: maxBytes}, nil
}

func (c *Cache) path(key, ext string) (string, error) {
	if len(key) != 64 {
		return "", errors.New("bad cache key")
	}
	return filepath.Join(c.dir, key+ext), nil
}

func (c *Cache) Get(key string) (*Result, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	jp, err := c.path(key, ".json")
	if err != nil {
		return nil, false
	}
	data, err := os.ReadFile(jp)
	if err != nil {
		return nil, false
	}
	var r Result
	if json.Unmarshal(data, &r) != nil {
		return nil, false
	}
	if r.OK {
		wp, _ := c.path(key, ".wasm")
		if r.Wasm, err = os.ReadFile(wp); err != nil {
			return nil, false
		}
		now := time.Now()
		_ = os.Chtimes(wp, now, now)
	}
	now := time.Now()
	_ = os.Chtimes(jp, now, now)
	return &r, true
}

func (c *Cache) Put(key string, r *Result) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	jp, err := c.path(key, ".json")
	if err != nil {
		return err
	}
	if r.OK {
		wp, _ := c.path(key, ".wasm")
		if err := atomicWrite(wp, r.Wasm); err != nil {
			return err
		}
	}
	data, _ := json.Marshal(r)
	if err := atomicWrite(jp, data); err != nil {
		return err
	}
	c.evictLocked()
	return nil
}

func atomicWrite(path string, data []byte) error {
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (c *Cache) evictLocked() {
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return
	}
	type item struct {
		path string
		size int64
		mod  time.Time
	}
	var items []item
	var total int64
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, item{filepath.Join(c.dir, e.Name()), info.Size(), info.ModTime()})
		total += info.Size()
	}
	if total <= c.maxBytes {
		return
	}
	sort.Slice(items, func(i, j int) bool { return items[i].mod.Before(items[j].mod) })
	target := c.maxBytes * 9 / 10
	for _, it := range items {
		if total <= target {
			break
		}
		if os.Remove(it.path) == nil {
			total -= it.size
		}
	}
}
