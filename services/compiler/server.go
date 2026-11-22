package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// Config holds everything that can be tuned from the environment.
type Config struct {
	Addr           string
	AllowedOrigins []string
	TrustCF        bool
	RatePerMinute  int
	MaxConcurrent  int
	MaxQueue       int
	CompileTimeout time.Duration
	MaxWasmBytes   int64
	ShimVersion    string
}

// Server is the HTTP front end. Its collaborators are interfaces or small structs so tests
// can swap the sandbox for a fake.
type Server struct {
	cfg      Config
	runner   Runner
	cache    *Cache
	limiter  *RateLimiter
	pool     *Pool
	verifier Verifier // nil = Turnstile not configured
	origins  map[string]bool
	log      *slog.Logger
}

func NewServer(cfg Config, runner Runner, cache *Cache, verifier Verifier, log *slog.Logger) *Server {
	origins := map[string]bool{}
	for _, o := range cfg.AllowedOrigins {
		if o = strings.TrimSpace(o); o != "" && o != "*" { // "*" is never accepted
			origins[o] = true
		}
	}
	if log == nil {
		log = slog.Default()
	}
	return &Server{
		cfg: cfg, runner: runner, cache: cache, verifier: verifier, origins: origins, log: log,
		limiter: NewRateLimiter(cfg.RatePerMinute, nil),
		pool:    NewPool(cfg.MaxConcurrent, cfg.MaxQueue),
	}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/compile", s.handleCompile)
	mux.HandleFunc("/healthz", s.handleHealth)
	return s.withCORS(mux)
}

// withCORS answers preflights and tags responses for allowed origins only. The compiler
// is meant to be called from the simulator's origin; other browser origins get no CORS headers.
func (s *Server) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		w.Header().Add("Vary", "Origin")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if origin != "" {
			if !s.origins[origin] {
				http.Error(w, "origin not allowed", http.StatusForbidden)
				return
			}
			w.Header().Set("Access-Control-Allow-Origin", origin)
			// Needed so the simulator page (COEP: require-corp) may read the response.
			w.Header().Set("Cross-Origin-Resource-Policy", "cross-origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "shim": s.cfg.ShimVersion})
}

type compileRequest struct {
	Files          []File   `json:"files"`
	Libs           []string `json:"libs"`
	TurnstileToken string   `json:"turnstileToken"`
}

type compileResponse struct {
	OK     bool   `json:"ok"`
	Cached bool   `json:"cached"`
	Wasm   string `json:"wasm,omitempty"` // base64
	Diags  []Diag `json:"diags"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func respondResult(w http.ResponseWriter, r *Result, cached bool) {
	resp := compileResponse{OK: r.OK, Cached: cached, Diags: r.Diags}
	if resp.Diags == nil {
		resp.Diags = []Diag{}
	}
	if r.OK {
		resp.Wasm = base64.StdEncoding.EncodeToString(r.Wasm)
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleCompile(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpError(w, http.StatusMethodNotAllowed, "POST only")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxSourceBytes+64*1024)
	var req compileRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var tooBig *http.MaxBytesError
		if errors.As(err, &tooBig) {
			httpError(w, http.StatusRequestEntityTooLarge, "request too large")
		} else {
			httpError(w, http.StatusBadRequest, "invalid JSON")
		}
		return
	}
	if len(req.Libs) > 16 {
		httpError(w, http.StatusBadRequest, "too many libs")
		return
	}
	if err := ValidateSources(req.Files); err != nil {
		httpError(w, http.StatusBadRequest, err.Error())
		return
	}

	key := CacheKey(s.cfg.ShimVersion, req.Files, req.Libs)
	if hit, ok := s.cache.Get(key); ok {
		respondResult(w, hit, true)
		return
	}

	ip := ClientIP(r, s.cfg.TrustCF)
	// Only real compiles are rate limited; cache hits above are cheap.
	if !s.limiter.Allow(ip) {
		w.Header().Set("Retry-After", "10")
		httpError(w, http.StatusTooManyRequests, "too many compiles, slow down")
		return
	}
	if s.verifier != nil {
		ok, err := s.verifier.Verify(r.Context(), req.TurnstileToken, ip)
		if err != nil {
			s.log.Warn("turnstile verification failed", "err", err)
			httpError(w, http.StatusServiceUnavailable, "could not verify the request, try again")
			return
		}
		if !ok {
			httpError(w, http.StatusForbidden, "verification failed")
			return
		}
	}
	release, err := s.pool.Acquire(r.Context(), ip)
	switch {
	case errors.Is(err, ErrBusyIP):
		httpError(w, http.StatusTooManyRequests, err.Error())
		return
	case errors.Is(err, ErrQueueFull):
		w.Header().Set("Retry-After", "5")
		httpError(w, http.StatusServiceUnavailable, err.Error())
		return
	case err != nil:
		return // client went away
	}
	defer release()

	// Another request may have finished the same sketch while this one waited.
	if hit, ok := s.cache.Get(key); ok {
		respondResult(w, hit, true)
		return
	}

	start := time.Now()
	result, cacheable := s.compile(r.Context(), req.Files)
	if cacheable {
		if err := s.cache.Put(key, result); err != nil {
			s.log.Warn("cache write failed", "err", err)
		}
	}
	s.log.Info("compile", "key", key[:12], "ok", result.OK, "ms", time.Since(start).Milliseconds())
	respondResult(w, result, false)
}

// compile runs the sandbox and turns its output into a Result. The bool says whether the
// outcome is deterministic (so safe to cache): timeouts and sandbox failures are not.
func (s *Server) compile(ctx context.Context, files []File) (*Result, bool) {
	prepared, err := Preprocess(files)
	if err != nil {
		return &Result{Diags: []Diag{{Severity: "error", Message: err.Error()}}}, true
	}
	out, err := s.runner.Compile(ctx, prepared)
	if err != nil {
		s.log.Error("sandbox failure", "err", err)
		return &Result{Diags: []Diag{{Severity: "error", Message: "the compile service had an internal error, try again"}}}, false
	}
	if out.TimedOut {
		return &Result{Diags: []Diag{{Severity: "error", Message: fmt.Sprintf("compilation timed out after %d s", int(s.cfg.CompileTimeout.Seconds()))}}}, false
	}
	if out.ExitCode != 0 {
		return &Result{Diags: ParseDiagnostics(out.Log, true)}, true
	}
	if int64(len(out.Wasm)) > s.cfg.MaxWasmBytes {
		return &Result{Diags: []Diag{{Severity: "error", Message: fmt.Sprintf("the compiled program is too large (limit %d KB)", s.cfg.MaxWasmBytes/1024)}}}, true
	}
	unsupported, err := UnsupportedImports(out.Wasm)
	if err != nil {
		s.log.Error("bad wasm from sandbox", "err", err)
		return &Result{Diags: []Diag{{Severity: "error", Message: "the compile service produced an invalid program"}}}, false
	}
	diags := ParseDiagnostics(out.Log, false)
	if len(unsupported) > 0 {
		diags = append(diags, Diag{Severity: "error", Message: "this sketch uses functions the simulator does not support: " + strings.Join(unsupported, ", ")})
		return &Result{Diags: diags}, true
	}
	return &Result{OK: true, Wasm: out.Wasm, Diags: diags}, true
}
