package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil && v > 0 {
		return v
	}
	return def
}

// readShimVersion asks the sandbox image for /shim/VERSION so cached results are
// invalidated automatically whenever the image (compiler flags, shim) changes.
func readShimVersion(dockerBin, image string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, dockerBin, "run", "--rm", "--network", "none", "--read-only",
		"--cap-drop", "ALL", image, "cat", "/shim/VERSION").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(out))
}

func main() {
	log := slog.New(slog.NewTextHandler(os.Stderr, nil))
	timeout := time.Duration(envInt("COMPILE_TIMEOUT_SECONDS", 20)) * time.Second
	maxWasm := int64(envInt("MAX_WASM_KB", 512)) * 1024
	dockerBin := env("DOCKER_BIN", "docker")
	image := env("SANDBOX_IMAGE", "esp32-sim-sandbox:dev")

	runner := &DockerRunner{
		DockerBin: dockerBin, Image: image, Runtime: os.Getenv("SANDBOX_RUNTIME"),
		Timeout: timeout, MaxWasm: maxWasm,
	}
	if _, err := runner.dockerArgs("startup-check"); err != nil {
		log.Error("invalid sandbox configuration", "err", err)
		os.Exit(2)
	}
	version := os.Getenv("SHIM_VERSION")
	if version == "" {
		version = readShimVersion(dockerBin, image)
	}
	if version == "" {
		log.Error("cannot determine the shim version: set SHIM_VERSION or make the sandbox image available")
		os.Exit(2)
	}

	cache, err := NewCache(env("CACHE_DIR", "/cache"), int64(envInt("CACHE_MAX_MB", 256))<<20)
	if err != nil {
		log.Error("cannot create cache", "err", err)
		os.Exit(2)
	}
	cfg := Config{
		Addr:           env("ADDR", ":8787"),
		AllowedOrigins: strings.Split(os.Getenv("ALLOWED_ORIGINS"), ","),
		TrustCF:        os.Getenv("TRUST_CF_HEADER") == "1",
		RatePerMinute:  envInt("RATE_PER_MINUTE", 10),
		MaxConcurrent:  envInt("MAX_CONCURRENT", 2),
		MaxQueue:       envInt("MAX_QUEUE", 8),
		CompileTimeout: timeout,
		MaxWasmBytes:   maxWasm,
		ShimVersion:    version,
	}
	verifier := NewTurnstile(os.Getenv("TURNSTILE_SECRET"), os.Getenv("TURNSTILE_VERIFY_URL"))
	srv := NewServer(cfg, runner, cache, verifier, log)

	httpSrv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      timeout + 30*time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
	}
	go func() {
		log.Info("compiler listening", "addr", cfg.Addr, "shim", version, "origins", cfg.AllowedOrigins, "turnstile", verifier != nil)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("server stopped", "err", err)
			os.Exit(1)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), timeout+10*time.Second)
	defer cancel()
	_ = httpSrv.Shutdown(ctx)
}
