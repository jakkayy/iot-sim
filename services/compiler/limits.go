package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

var (
	ErrRateLimited = errors.New("rate limited")
	ErrBusyIP      = errors.New("this client already has a compile in progress")
	ErrQueueFull   = errors.New("compile queue is full")
)

// ClientIP returns the caller's address. The CF-Connecting-IP header is only believed when
// the service sits behind Cloudflare (trustCF); otherwise anyone could spoof it to dodge limits.
func ClientIP(r *http.Request, trustCF bool) string {
	if trustCF {
		if ip := net.ParseIP(strings.TrimSpace(r.Header.Get("CF-Connecting-IP"))); ip != nil {
			return ip.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// RateLimiter is a per-key token bucket (capacity = perMinute, refilled continuously).
type RateLimiter struct {
	perMinute float64
	now       func() time.Time
	mu        sync.Mutex
	buckets   map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

func NewRateLimiter(perMinute int, now func() time.Time) *RateLimiter {
	if now == nil {
		now = time.Now
	}
	return &RateLimiter{perMinute: float64(perMinute), now: now, buckets: map[string]*bucket{}}
}

func (l *RateLimiter) Allow(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	b := l.buckets[key]
	if b == nil {
		b = &bucket{tokens: l.perMinute, last: now}
		l.buckets[key] = b
	}
	b.tokens += now.Sub(b.last).Minutes() * l.perMinute
	if b.tokens > l.perMinute {
		b.tokens = l.perMinute
	}
	b.last = now
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	if len(l.buckets) > 10000 { // bound memory: drop idle, full buckets
		for k, v := range l.buckets {
			if v.tokens >= l.perMinute-0.001 && k != key {
				delete(l.buckets, k)
			}
		}
	}
	return true
}

// Pool limits concurrent compiles, the number of waiting jobs, and jobs per client, so one
// client cannot fill the queue and a small machine is not overwhelmed.
type Pool struct {
	slots    chan struct{}
	maxQueue int
	mu       sync.Mutex
	waiting  int
	perKey   map[string]int
}

func NewPool(concurrent, maxQueue int) *Pool {
	return &Pool{slots: make(chan struct{}, concurrent), maxQueue: maxQueue, perKey: map[string]int{}}
}

// Acquire blocks until a slot is free (or ctx ends). The returned func must be called once.
func (p *Pool) Acquire(ctx context.Context, key string) (func(), error) {
	p.mu.Lock()
	if p.perKey[key] >= 1 {
		p.mu.Unlock()
		return nil, ErrBusyIP
	}
	if p.waiting >= p.maxQueue {
		p.mu.Unlock()
		return nil, ErrQueueFull
	}
	p.perKey[key]++
	p.waiting++
	p.mu.Unlock()

	release := func() {
		p.mu.Lock()
		p.perKey[key]--
		if p.perKey[key] <= 0 {
			delete(p.perKey, key)
		}
		p.mu.Unlock()
	}
	select {
	case p.slots <- struct{}{}:
		p.mu.Lock()
		p.waiting--
		p.mu.Unlock()
		var once sync.Once
		return func() {
			once.Do(func() {
				<-p.slots
				release()
			})
		}, nil
	case <-ctx.Done():
		p.mu.Lock()
		p.waiting--
		p.mu.Unlock()
		release()
		return nil, ctx.Err()
	}
}
