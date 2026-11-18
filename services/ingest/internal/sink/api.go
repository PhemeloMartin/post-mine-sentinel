// Package sink delivers window batches to the fusion API with production-grade failure handling:
// per-request timeouts, exponential back-off with full jitter, a circuit breaker, and a
// dead-letter file for batches that cannot be delivered (replayable by an operator).
package sink

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/metrics"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/pipeline"
)

var ErrCircuitOpen = errors.New("sink: circuit open")

// permanentError marks failures that retrying cannot fix (HTTP 4xx except 408/429).
type permanentError struct{ status int }

func (e permanentError) Error() string { return fmt.Sprintf("permanent HTTP %d", e.status) }

type API struct {
	URL         string // e.g. http://api:8000/api/v1/ingest/windows
	Token       string
	Client      *http.Client
	MaxAttempts int
	DeadLetter  string // JSON-lines file
	Log         *slog.Logger

	mu        sync.Mutex
	failures  int
	openUntil time.Time
	dlqMu     sync.Mutex
}

func (a *API) allow() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return time.Now().After(a.openUntil)
}

func (a *API) record(ok bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if ok {
		a.failures = 0
		return
	}
	a.failures++
	if a.failures >= 5 {
		a.openUntil = time.Now().Add(30 * time.Second) // half-open after cool-down
		a.failures = 0
		metrics.CircuitOpen.Inc()
	}
}

func (a *API) post(ctx context.Context, body []byte) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.URL, bytes.NewReader(body))
	if err != nil {
		return permanentError{0}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Service-Token", a.Token)
	resp, err := a.Client.Do(req)
	if err != nil {
		return err // network error: retryable
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	switch {
	case resp.StatusCode < 300:
		return nil
	case resp.StatusCode == http.StatusRequestTimeout || resp.StatusCode == http.StatusTooManyRequests || resp.StatusCode >= 500:
		return fmt.Errorf("retryable HTTP %d", resp.StatusCode)
	default:
		return permanentError{resp.StatusCode}
	}
}

// Send implements pipeline.Sink.
func (a *API) Send(ctx context.Context, b pipeline.Batch) error {
	body, err := json.Marshal(b)
	if err != nil {
		return a.deadLetter(b, err)
	}
	attempts := max(1, a.MaxAttempts)
	var last error
	for i := 0; i < attempts; i++ {
		if !a.allow() {
			last = ErrCircuitOpen
		} else if last = a.post(ctx, body); last == nil {
			a.record(true)
			metrics.BatchesSent.Inc()
			return nil
		} else {
			var perm permanentError
			if errors.As(last, &perm) {
				return a.deadLetter(b, last)
			}
			a.record(false)
		}
		metrics.BatchesRetried.Inc()
		delay := time.Duration(rand.Int64N(int64(min(10*time.Second, (250*time.Millisecond)<<i)) + 1))
		select {
		case <-ctx.Done():
			return a.deadLetter(b, ctx.Err())
		case <-time.After(delay):
		}
	}
	return a.deadLetter(b, last)
}

func (a *API) deadLetter(b pipeline.Batch, cause error) error {
	metrics.BatchesDeadLetter.Inc()
	a.dlqMu.Lock()
	defer a.dlqMu.Unlock()
	if a.DeadLetter != "" {
		f, err := os.OpenFile(a.DeadLetter, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
		if err == nil {
			_ = json.NewEncoder(f).Encode(map[string]any{"at": time.Now().UTC(), "error": cause.Error(), "batch": b})
			_ = f.Close()
		} else {
			a.Log.Error("dead-letter write failed", "err", err)
		}
	}
	return fmt.Errorf("dead-lettered: %w", cause)
}
