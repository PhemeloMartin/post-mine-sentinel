// Package replay implements per-node anti-replay with a 64-frame sliding window
// (the IPsec ESP algorithm, RFC 4303 §3.4.3). Multiple anchors often hear the same
// frame; the window de-duplicates them while still accepting mild re-ordering.
package replay

import "sync"

const windowSize = 64

type state struct {
	highest uint32
	bitmap  uint64 // bit i set ⇒ counter (highest − i) already accepted
	seen    bool
}

// Filter is safe for concurrent use.
type Filter struct {
	mu    sync.Mutex
	nodes map[uint32]*state // key = site<<16 | node
}

func New() *Filter { return &Filter{nodes: make(map[uint32]*state)} }

// Verdict explains why a counter was accepted or rejected (exported for metrics).
type Verdict int

const (
	Accepted Verdict = iota
	Duplicate
	TooOld
)

// Check atomically tests and records a counter. Only call it after the frame authenticated,
// otherwise a forged frame could advance the window and block legitimate traffic.
func (f *Filter) Check(site, node uint16, counter uint32) Verdict {
	key := uint32(site)<<16 | uint32(node)
	f.mu.Lock()
	defer f.mu.Unlock()
	s, ok := f.nodes[key]
	if !ok {
		f.nodes[key] = &state{highest: counter, bitmap: 1, seen: true}
		return Accepted
	}
	switch {
	case counter > s.highest:
		shift := counter - s.highest
		if shift >= windowSize {
			s.bitmap = 1
		} else {
			s.bitmap = s.bitmap<<shift | 1
		}
		s.highest = counter
		return Accepted
	case s.highest-counter >= windowSize:
		return TooOld
	default:
		bit := uint64(1) << (s.highest - counter)
		if s.bitmap&bit != 0 {
			return Duplicate
		}
		s.bitmap |= bit
		return Accepted
	}
}
