// Package pipeline turns authenticated SilkNet frames into per-window vote batches for the
// fusion API: decode → authenticate → replay-check → group by (site, window) → flush after a
// grace period that lets multi-hop stragglers and second-anchor duplicates arrive.
package pipeline

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/metrics"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/replay"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/silknet"
)

// Uplink is the JSON envelope an anchor gateway publishes to silknet/<mine-id>/up.
type Uplink struct {
	Gateway string  `json:"gw"`
	RSSI    float64 `json:"rssi"`
	SNR     float64 `json:"snr"`
	Frame   string  `json:"frame"` // base64(std) of the raw LoRa payload
}

// Vote mirrors services/api/app/schemas.py:Vote.
type Vote struct {
	Node            string   `json:"node"`
	Kind            string   `json:"kind"`
	Cls             string   `json:"cls"`
	PThreat         float64  `json:"p_threat"`
	SNRdB           float64  `json:"snr_db"`
	ArrivalOffsetMs *float64 `json:"arrival_offset_ms,omitempty"`
	FrameCounter    uint32   `json:"frame_counter"`
	Gateway         string   `json:"gateway"`
}

// Batch mirrors services/api/app/schemas.py:WindowBatch.
type Batch struct {
	MineID      string    `json:"mine_id"`
	WindowStart time.Time `json:"window_start"`
	Votes       []Vote    `json:"votes"`
}

// Sink receives completed batches (the HTTP poster in production, a slice in tests).
type Sink interface {
	Send(ctx context.Context, b Batch) error
}

// Config holds the site directory and key material.
type Config struct {
	Sites map[uint16]Site // site_id → site
	Grace time.Duration   // how long to wait for stragglers after a window's first vote
}

type Site struct {
	MineID string
	Key    []byte // 128-bit site master key (from Key Vault / CSI-mounted secret)
}

type pending struct {
	batch    Batch
	deadline time.Time
}

// Pipeline is safe for concurrent use by the MQTT handler.
type Pipeline struct {
	cfg     Config
	sink    Sink
	log     *slog.Logger
	replay  *replay.Filter
	mu      sync.Mutex
	windows map[string]*pending
	now     func() time.Time
}

func New(cfg Config, sink Sink, log *slog.Logger) *Pipeline {
	if cfg.Grace <= 0 {
		cfg.Grace = 2500 * time.Millisecond
	}
	return &Pipeline{cfg: cfg, sink: sink, log: log, replay: replay.New(), windows: map[string]*pending{}, now: time.Now}
}

var kinds = map[byte]string{
	silknet.TypeDetection: "seismic",
	silknet.TypeBenign:    "benign",
	silknet.TypePIR:       "pir",
	silknet.TypeTamper:    "tamper",
}

// ErrUnknownGatewayTopic is returned for uplinks whose topic site does not match the frame.
var ErrUnknownGatewayTopic = errors.New("pipeline: topic/site mismatch")

// HandleUplink processes one gateway message. Errors are counted and returned for logging;
// they never crash the service (a single bad frame must not stop the site).
func (p *Pipeline) HandleUplink(topicMine string, raw []byte) error {
	metrics.FramesReceived.Inc()
	var up Uplink
	if err := json.Unmarshal(raw, &up); err != nil {
		metrics.FramesMalformed.Inc()
		return fmt.Errorf("envelope: %w", err)
	}
	frame, err := base64.StdEncoding.DecodeString(up.Frame)
	if err != nil {
		metrics.FramesMalformed.Inc()
		return fmt.Errorf("frame base64: %w", err)
	}
	h, payload, err := silknet.Open(frame, func(id uint16) ([]byte, bool) {
		s, ok := p.cfg.Sites[id]
		return s.Key, ok
	})
	if err != nil {
		if errors.Is(err, silknet.ErrAuth) {
			metrics.FramesAuthFailed.Inc() // possible spoofing: alerting rule fires on rate
		} else {
			metrics.FramesMalformed.Inc()
		}
		return err
	}
	site := p.cfg.Sites[h.SiteID]
	if topicMine != "" && topicMine != site.MineID {
		metrics.FramesMalformed.Inc()
		return ErrUnknownGatewayTopic
	}
	// Replay check only after authentication, so forgeries cannot poison the window.
	switch p.replay.Check(h.SiteID, h.NodeID, h.Counter) {
	case replay.Duplicate:
		metrics.FramesDuplicate.Inc()
		return nil
	case replay.TooOld:
		metrics.FramesReplayed.Inc()
		return fmt.Errorf("replayed or stale counter %d from node %d", h.Counter, h.NodeID)
	}
	kind, ok := kinds[h.Type]
	if !ok { // heartbeats and beacons only refresh liveness
		metrics.Heartbeats.Inc()
		return nil
	}
	d, err := silknet.ParseDetection(payload)
	if err != nil {
		metrics.FramesMalformed.Inc()
		return err
	}
	arrival := float64(d.ArrivalMs)
	v := Vote{
		Node:            fmt.Sprintf("S%02d", h.NodeID),
		Kind:            kind,
		Cls:             d.Class(),
		PThreat:         d.PThreat(),
		SNRdB:           float64(d.SNRdB),
		ArrivalOffsetMs: &arrival,
		FrameCounter:    h.Counter,
		Gateway:         up.Gateway,
	}
	if kind == "tamper" {
		v.Cls = "tamper"
	}
	ws := time.Unix(int64(d.WindowStart), 0).UTC()
	key := fmt.Sprintf("%s|%d", site.MineID, d.WindowStart)

	p.mu.Lock()
	defer p.mu.Unlock()
	w, ok := p.windows[key]
	if !ok {
		w = &pending{batch: Batch{MineID: site.MineID, WindowStart: ws}, deadline: p.now().Add(p.cfg.Grace)}
		p.windows[key] = w
	}
	w.batch.Votes = append(w.batch.Votes, v)
	metrics.VotesQueued.Inc()
	return nil
}

// Flush sends every window whose grace period has expired. Called on a ticker.
func (p *Pipeline) Flush(ctx context.Context) { p.flush(ctx, false) }

func (p *Pipeline) flush(ctx context.Context, force bool) {
	p.mu.Lock()
	var ready []Batch
	now := p.now()
	for k, w := range p.windows {
		if force || now.After(w.deadline) {
			ready = append(ready, w.batch)
			delete(p.windows, k)
		}
	}
	p.mu.Unlock()
	for _, b := range ready {
		if err := p.sink.Send(ctx, b); err != nil {
			p.log.Error("batch not delivered", "mine", b.MineID, "window", b.WindowStart, "votes", len(b.Votes), "err", err)
		}
	}
}

// Run flushes on a ticker until ctx ends, then performs a final flush (graceful shutdown).
func (p *Pipeline) Run(ctx context.Context, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			p.flush(context.Background(), true) // graceful shutdown: deliver everything still pending
			return
		case <-t.C:
			p.Flush(ctx)
		}
	}
}
