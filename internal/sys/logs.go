package sys

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// CrashSummary describes recent DiagnosticReports findings.
type CrashSummary struct {
	Count   int      `json:"count"`
	Summary string   `json:"summary"`
	Files   []string `json:"files"`
}

// SummarizeDiagnosticLogs scans ~/Library/Logs/DiagnosticReports for recent crash reports.
func SummarizeDiagnosticLogs(homeDir string, windowMinutes int) CrashSummary {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	if windowMinutes <= 0 {
		windowMinutes = 120
	}
	diagDir := filepath.Join(homeDir, "Library", "Logs", "DiagnosticReports")
	entries, err := os.ReadDir(diagDir)
	if err != nil {
		return CrashSummary{
			Count:   0,
			Summary: "未能读取 DiagnosticReports（可能需要完全磁盘访问权限）",
			Files:   []string{},
		}
	}

	cutoff := time.Now().Add(-time.Duration(windowMinutes) * time.Minute)
	recent := make([]string, 0, 10)
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !strings.HasSuffix(name, ".ips") && !strings.HasSuffix(name, ".crash") {
			continue
		}
		if info, err := e.Info(); err == nil && info.ModTime().After(cutoff) {
			recent = append(recent, name)
		}
	}
	sort.Strings(recent)
	if len(recent) > 8 {
		recent = recent[len(recent)-8:]
	}

	summary := "近期未发现新的崩溃报告。"
	if len(recent) > 0 {
		summary = fmt.Sprintf("检测到 %d 份近期报告，最近为 %s。", len(recent), recent[len(recent)-1])
	}

	return CrashSummary{
		Count:   len(recent),
		Summary: summary,
		Files:   recent,
	}
}
