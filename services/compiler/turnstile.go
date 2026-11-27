package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// Verifier checks a Cloudflare Turnstile token. A nil Verifier means "not configured".
type Verifier interface {
	Verify(ctx context.Context, token, ip string) (bool, error)
}

type turnstile struct {
	secret string
	url    string
	client *http.Client
}

const turnstileURL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

func NewTurnstile(secret, verifyURL string) Verifier {
	if secret == "" {
		return nil
	}
	if verifyURL == "" {
		verifyURL = turnstileURL
	}
	return &turnstile{secret: secret, url: verifyURL, client: &http.Client{Timeout: 5 * time.Second}}
}

func (t *turnstile) Verify(ctx context.Context, token, ip string) (bool, error) {
	if token == "" {
		return false, nil
	}
	form := url.Values{"secret": {t.secret}, "response": {token}}
	if ip != "" {
		form.Set("remoteip", ip)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, t.url, strings.NewReader(form.Encode()))
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := t.client.Do(req)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false, errors.New("turnstile: unexpected status " + resp.Status)
	}
	var out struct {
		Success bool `json:"success"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(nil, resp.Body, 1<<16)).Decode(&out); err != nil {
		return false, err
	}
	return out.Success, nil
}
