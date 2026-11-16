package plugins

import (
	"sync"
	"time"
)

// ThrottleTracker enforces Valet's 10-minute event deduplication window
// and hourly per-plugin event rate limits.
type ThrottleTracker struct {
	mu      sync.Mutex
	history map[string][]time.Time
}

// NewThrottleTracker returns a ready-to-use event rate-limit tracker.
func NewThrottleTracker() *ThrottleTracker {
	return &ThrottleTracker{history: make(map[string][]time.Time)}
}

// Allow checks whether `(pluginID, eventCode)` should execute under throttling settings.
// Simulated triggers bypass deduplication so developers can test freely.
func (t *ThrottleTracker) Allow(pluginID, eventCode string, deduplicate10m bool, simulated bool) bool {
	if simulated {
		return true
	}
	t.mu.Lock()
	defer t.mu.Unlock()

	key := pluginID + ":" + eventCode
	now := time.Now()
	cutoffHour := now.Add(-time.Hour)
	cutoff10m := now.Add(-10 * time.Minute)

	prev := t.history[key]
	recent := prev[:0]
	for _, ts := range prev {
		if ts.After(cutoffHour) {
			recent = append(recent, ts)
		}
	}

	if deduplicate10m {
		for _, ts := range recent {
			if ts.After(cutoff10m) {
				t.history[key] = recent
				return false
			}
		}
	}

	recent = append(recent, now)
	t.history[key] = recent
	return true
}
