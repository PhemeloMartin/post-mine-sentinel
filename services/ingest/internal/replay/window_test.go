package replay

import (
	"sync"
	"testing"
)

func TestWindowSemantics(t *testing.T) {
	f := New()
	steps := []struct {
		counter uint32
		want    Verdict
	}{
		{100, Accepted},
		{100, Duplicate}, // same frame via a second anchor
		{101, Accepted},
		{99, Accepted},   // mild re-ordering inside the window
		{99, Duplicate},
		{200, Accepted},  // big jump resets the bitmap
		{150, Accepted},  // still within 64 of 200
		{136, TooOld},    // 200 − 136 = 64 → outside the window
		{10, TooOld},
	}
	for i, s := range steps {
		if got := f.Check(7, 5, s.counter); got != s.want {
			t.Fatalf("step %d counter %d: got %v want %v", i, s.counter, got, s.want)
		}
	}
}

func TestNodesAreIndependent(t *testing.T) {
	f := New()
	if f.Check(1, 1, 50) != Accepted || f.Check(1, 2, 50) != Accepted || f.Check(2, 1, 50) != Accepted {
		t.Fatal("different (site,node) pairs must not interfere")
	}
}

func TestConcurrentDuplicatesAcceptedOnce(t *testing.T) {
	f := New()
	var wg sync.WaitGroup
	var mu sync.Mutex
	accepted := 0
	for g := 0; g < 16; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if f.Check(3, 3, 42) == Accepted {
				mu.Lock()
				accepted++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if accepted != 1 {
		t.Fatalf("accepted %d times, want exactly once", accepted)
	}
}
