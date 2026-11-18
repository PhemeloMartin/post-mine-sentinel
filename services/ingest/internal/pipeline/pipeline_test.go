package pipeline

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/silknet"
)

type memSink struct {
	mu      sync.Mutex
	batches []Batch
}

func (m *memSink) Send(_ context.Context, b Batch) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.batches = append(m.batches, b)
	return nil
}

var siteKey = []byte{0x2b, 0x7e, 0x15, 0x16, 0x28, 0xae, 0xd2, 0xa6, 0xab, 0xf7, 0x15, 0x88, 0x09, 0xcf, 0x4f, 0x3c}

func uplink(t *testing.T, typ byte, node uint16, counter uint32, d silknet.Detection) []byte {
	t.Helper()
	frame, err := silknet.Seal(silknet.Header{Type: typ, SiteID: 7, NodeID: node, Counter: counter},
		silknet.PackDetection(d), silknet.DeriveNodeKey(siteKey, 7, node))
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(Uplink{Gateway: "A1", RSSI: -101, SNR: 6.5, Frame: base64.StdEncoding.EncodeToString(frame)})
	return raw
}

func newPipeline(sink Sink) (*Pipeline, *time.Time) {
	clock := time.Date(2026, 11, 18, 21, 5, 0, 0, time.UTC)
	p := New(Config{Sites: map[uint16]Site{7: {MineID: "ZA-NW-002", Key: siteKey}}, Grace: 2 * time.Second}, sink,
		slog.New(slog.NewTextHandler(io.Discard, nil)))
	p.now = func() time.Time { return clock }
	return p, &clock
}

func TestVotesAreGroupedPerWindowAndFlushedAfterGrace(t *testing.T) {
	sink := &memSink{}
	p, clock := newPipeline(sink)
	det := silknet.Detection{WindowStart: 1795035900, ClassID: 1, PThreatU8: 240, SNRdB: 21, ArrivalMs: 1400, BatteryPct: 88}
	for i, node := range []uint16{5, 10, 21} {
		if err := p.HandleUplink("ZA-NW-002", uplink(t, silknet.TypeDetection, node, uint32(100+i), det)); err != nil {
			t.Fatal(err)
		}
	}
	p.Flush(context.Background())
	if len(sink.batches) != 0 {
		t.Fatal("flushed before the grace period")
	}
	*clock = clock.Add(3 * time.Second)
	p.Flush(context.Background())
	if len(sink.batches) != 1 || len(sink.batches[0].Votes) != 3 {
		t.Fatalf("got %+v", sink.batches)
	}
	v := sink.batches[0].Votes[0]
	if v.Kind != "seismic" || v.Cls != "footsteps" || v.Node != "S05" || v.Gateway != "A1" {
		t.Fatalf("vote mapping wrong: %+v", v)
	}
}

func TestDuplicateFromSecondAnchorIsDropped(t *testing.T) {
	sink := &memSink{}
	p, clock := newPipeline(sink)
	det := silknet.Detection{WindowStart: 1795035904, ClassID: 5, PThreatU8: 20, SNRdB: 15, ArrivalMs: 800, BatteryPct: 90}
	msg := uplink(t, silknet.TypeBenign, 6, 50, det)
	_ = p.HandleUplink("ZA-NW-002", msg)
	_ = p.HandleUplink("ZA-NW-002", msg) // same frame heard by anchor A2
	*clock = clock.Add(5 * time.Second)
	p.Flush(context.Background())
	if n := len(sink.batches[0].Votes); n != 1 {
		t.Fatalf("expected 1 vote after de-duplication, got %d", n)
	}
}

func TestForgedAndMalformedFramesAreRejected(t *testing.T) {
	p, _ := newPipeline(&memSink{})
	if err := p.HandleUplink("ZA-NW-002", []byte("not json")); err == nil {
		t.Fatal("malformed envelope accepted")
	}
	det := silknet.Detection{WindowStart: 1795035900, ClassID: 1, PThreatU8: 255, ArrivalMs: 10, BatteryPct: 50}
	forged, _ := silknet.Seal(silknet.Header{Type: silknet.TypeDetection, SiteID: 7, NodeID: 3, Counter: 9},
		silknet.PackDetection(det), make([]byte, 16)) // attacker does not know the key
	raw, _ := json.Marshal(Uplink{Gateway: "A1", Frame: base64.StdEncoding.EncodeToString(forged)})
	if err := p.HandleUplink("ZA-NW-002", raw); err == nil {
		t.Fatal("forged frame accepted")
	}
	if err := p.HandleUplink("ZA-GP-001", uplink(t, silknet.TypeDetection, 3, 10, det)); err != ErrUnknownGatewayTopic {
		t.Fatalf("topic/site mismatch not detected: %v", err)
	}
}

func TestShutdownFlushesPendingWindows(t *testing.T) {
	sink := &memSink{}
	p, _ := newPipeline(sink)
	det := silknet.Detection{WindowStart: 1795035908, ClassID: 2, PThreatU8: 230, ArrivalMs: 200, BatteryPct: 70}
	_ = p.HandleUplink("ZA-NW-002", uplink(t, silknet.TypeDetection, 4, 1, det))
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	p.Run(ctx, time.Hour)
	if len(sink.batches) != 1 {
		t.Fatal("pending window lost on shutdown")
	}
}
