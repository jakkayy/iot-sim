package main

import (
	"context"
	"net/http"
	"testing"
	"time"
)

func TestClientIPTrustsCloudflareHeaderOnlyWhenConfigured(t *testing.T) {
	r, _ := http.NewRequest("POST", "/compile", nil)
	r.RemoteAddr = "172.18.0.5:44321"
	r.Header.Set("CF-Connecting-IP", "203.0.113.9")
	if got := ClientIP(r, false); got != "172.18.0.5" {
		t.Errorf("untrusted: got %s", got)
	}
	if got := ClientIP(r, true); got != "203.0.113.9" {
		t.Errorf("trusted: got %s", got)
	}
	r.Header.Set("CF-Connecting-IP", "not an ip")
	if got := ClientIP(r, true); got != "172.18.0.5" {
		t.Errorf("garbage header must fall back: got %s", got)
	}
}

func TestRateLimiterBucket(t *testing.T) {
	now := time.Unix(0, 0)
	l := NewRateLimiter(10, func() time.Time { return now })
	for i := 0; i < 10; i++ {
		if !l.Allow("a") {
			t.Fatalf("request %d should pass", i)
		}
	}
	if l.Allow("a") {
		t.Fatal("11th request in the same minute must be limited")
	}
	if !l.Allow("b") {
		t.Fatal("other clients are independent")
	}
	now = now.Add(6 * time.Second) // one token refills every 6s at 10/min
	if !l.Allow("a") {
		t.Fatal("a token should have refilled")
	}
	if l.Allow("a") {
		t.Fatal("only one token refilled")
	}
	now = now.Add(time.Hour)
	for i := 0; i < 10; i++ {
		if !l.Allow("a") {
			t.Fatal("bucket refills to capacity, not beyond")
		}
	}
	if l.Allow("a") {
		t.Fatal("capacity is capped")
	}
}

func TestPoolConcurrencyQueueAndPerClientLimit(t *testing.T) {
	p := NewPool(1, 2)
	ctx := context.Background()
	rel1, err := p.Acquire(ctx, "ip1")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.Acquire(ctx, "ip1"); err != ErrBusyIP {
		t.Fatalf("same client twice: %v", err)
	}
	// ip2 queues (slot is busy) until ip1 releases
	got := make(chan error, 1)
	go func() {
		rel, err := p.Acquire(ctx, "ip2")
		if err == nil {
			rel()
		}
		got <- err
	}()
	time.Sleep(30 * time.Millisecond)
	select {
	case <-got:
		t.Fatal("ip2 must wait for the slot")
	default:
	}
	rel1()
	rel1() // releasing twice must be harmless
	if err := <-got; err != nil {
		t.Fatalf("ip2 should run after release: %v", err)
	}
}

func TestPoolRejectsWhenQueueFullAndHonoursContext(t *testing.T) {
	p := NewPool(1, 1)
	rel, _ := p.Acquire(context.Background(), "ip1")
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := p.Acquire(ctx, "ip2") // fills the queue (1 waiting)
		done <- err
	}()
	time.Sleep(30 * time.Millisecond)
	if _, err := p.Acquire(context.Background(), "ip3"); err != ErrQueueFull {
		t.Fatalf("queue full: %v", err)
	}
	cancel()
	if err := <-done; err == nil {
		t.Fatal("cancelled waiter must return an error")
	}
	rel()
	// everything is released: a new client can acquire again
	rel2, err := p.Acquire(context.Background(), "ip4")
	if err != nil {
		t.Fatalf("pool should be usable after cancel: %v", err)
	}
	rel2()
}
