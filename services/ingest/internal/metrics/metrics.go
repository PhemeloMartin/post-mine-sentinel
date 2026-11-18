// Package metrics exposes Prometheus text-format counters without third-party dependencies.
package metrics

import (
	"fmt"
	"net/http"
	"sort"
	"sync/atomic"
)

// Counter is a monotonically increasing, lock-free counter.
type Counter struct {
	name, help string
	v          atomic.Uint64
}

func (c *Counter) Inc()          { c.v.Add(1) }
func (c *Counter) Add(n uint64)  { c.v.Add(n) }
func (c *Counter) Value() uint64 { return c.v.Load() }

var registry = map[string]*Counter{}

func newCounter(name, help string) *Counter {
	c := &Counter{name: name, help: help}
	registry[name] = c
	return c
}

var (
	FramesReceived    = newCounter("silknet_frames_received_total", "Uplink messages received from anchors")
	FramesAuthFailed  = newCounter("silknet_frames_auth_failed_total", "Frames failing AES-CCM authentication")
	FramesMalformed   = newCounter("silknet_frames_malformed_total", "Frames that could not be parsed")
	FramesReplayed    = newCounter("silknet_frames_replayed_total", "Frames rejected as replays or stale")
	FramesDuplicate   = newCounter("silknet_frames_duplicate_total", "Duplicate copies heard by a second anchor")
	Heartbeats        = newCounter("silknet_heartbeats_total", "Heartbeat and beacon frames")
	VotesQueued       = newCounter("silknet_votes_queued_total", "Votes queued into window batches")
	BatchesSent       = newCounter("silknet_batches_sent_total", "Window batches accepted by the fusion API")
	BatchesRetried    = newCounter("silknet_batches_retried_total", "Batch delivery retries")
	BatchesDeadLetter = newCounter("silknet_batches_dead_lettered_total", "Batches written to the dead-letter file")
	CircuitOpen       = newCounter("silknet_circuit_open_total", "Times the API circuit breaker opened")
)

// Handler serves /metrics in the Prometheus exposition format (version 0.0.4).
func Handler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		names := make([]string, 0, len(registry))
		for n := range registry {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			c := registry[n]
			fmt.Fprintf(w, "# HELP %s %s\n# TYPE %s counter\n%s %d\n", c.name, c.help, c.name, c.name, c.Value())
		}
	})
}
