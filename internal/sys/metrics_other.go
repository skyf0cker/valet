//go:build !darwin

package sys

import "valet/internal/types"

// SampleDiskMetrics provides a cross-platform fallback telemetry snapshot outside macOS.
func SampleDiskMetrics(_ string) types.SystemMetrics {
	return types.SystemMetrics{
		DiskPct:     82,
		DiskFreeGB:  88,
		DiskTotalGB: 494,
		CPUPct:      16,
		MemPct:      58,
	}
}
