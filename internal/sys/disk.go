package sys

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"
)

var hardBlockedPrefixes = []string{
	"/System",
	"/bin",
	"/sbin",
	"/usr",
	"/Library/Apple",
	"~/.ssh",
	"~/.gnupg",
	"~/.aws",
	"~/Library/Keychains",
}

// ExpandHome converts a leading "~/" or "~" into homeDir and resolves relative paths against homeDir (or ~/Downloads for bare names).
func ExpandHome(raw, homeDir string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	if trimmed == "~" {
		return filepath.Clean(homeDir)
	}
	if strings.HasPrefix(trimmed, "~/") {
		return filepath.Clean(filepath.Join(homeDir, trimmed[2:]))
	}
	if filepath.IsAbs(trimmed) {
		return filepath.Clean(trimmed)
	}
	cand := filepath.Clean(filepath.Join(homeDir, trimmed))
	if _, err := os.Lstat(cand); err == nil {
		return cand
	}
	if !strings.ContainsAny(trimmed, "/\\") && homeDir != "" {
		dlCand := filepath.Clean(filepath.Join(homeDir, "Downloads", trimmed))
		if _, err := os.Lstat(dlCand); err == nil {
			return dlCand
		}
	}
	return cand
}

func hasPathPrefix(target, prefix string) bool {
	if target == "" || prefix == "" {
		return false
	}
	return target == prefix || strings.HasPrefix(target, prefix+string(filepath.Separator))
}

// ValidateTargetPath guarantees no destructive operation touches root, home root,
// OS system directories, credential vaults, or user-configured protectedDirs.
func ValidateTargetPath(rawPath, homeDir string, protectedDirs []string) (string, error) {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	cleanedHome := filepath.Clean(homeDir)
	norm := ExpandHome(rawPath, cleanedHome)
	if norm == "" || norm == "/" || norm == cleanedHome {
		return "", fmt.Errorf("安全边界拒绝：禁止操作根目录或用户主目录 %q", rawPath)
	}
	if norm == "/Applications" {
		return "", errors.New("安全边界拒绝：禁止删除 /Applications 根目录")
	}

	for _, p := range hardBlockedPrefixes {
		expanded := ExpandHome(p, cleanedHome)
		if hasPathPrefix(norm, expanded) {
			return "", fmt.Errorf("安全边界拒绝：路径 %q 属于系统或凭据敏感区", rawPath)
		}
	}
	for _, p := range protectedDirs {
		expanded := ExpandHome(p, cleanedHome)
		if hasPathPrefix(norm, expanded) {
			return "", fmt.Errorf("受保护路径：路径 %q 位于保护目录 %q 内", rawPath, p)
		}
	}
	return norm, nil
}

// DiskCandidate represents a single read-only scanned cleanup candidate.
type DiskCandidate struct {
	Path      string  `json:"path"`
	Label     string  `json:"label"`
	Category  string  `json:"category"` // "cache" | "large_file"
	SizeMB    float64 `json:"sizeMB"`
	SizeLabel string  `json:"sizeLabel"`
}

// DiskScanReport summarizes read-only cache & large idle file findings.
type DiskScanReport struct {
	Items                  []DiskCandidate `json:"items"`
	CleanablePaths         []string        `json:"cleanablePaths"`
	EstimatedReclaimableGB float64         `json:"estimatedReclaimableGB"`
	ScannedAt              string          `json:"scannedAt"`
}

func formatBytesLabel(bytes int64) string {
	gb := float64(bytes) / (1024 * 1024 * 1024)
	if gb >= 1.0 {
		return fmt.Sprintf("%.1f GB", gb)
	}
	mb := math.Max(1, math.Round(float64(bytes)/(1024*1024)))
	return fmt.Sprintf("%.0f MB", mb)
}

func measureDirBounded(root string, maxEntries int) int64 {
	var total int64
	seen := 0
	_ = filepath.WalkDir(root, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		seen++
		if seen > maxEntries {
			return fs.SkipAll
		}
		if !d.IsDir() {
			if info, err := d.Info(); err == nil {
				total += info.Size()
			}
		}
		return nil
	})
	return total
}

// ScanDisk scans well-known safe developer cache paths & idle large files in ~/Downloads,
// strictly avoiding protected directories and bounding runtime so UI calls stay responsive.
func ScanDisk(homeDir string, protectedDirs []string, minLargeFileMB int, idleDays int) DiskScanReport {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	if minLargeFileMB <= 0 {
		minLargeFileMB = 512
	}
	if idleDays < 0 {
		idleDays = 90
	}

	items := []DiskCandidate{}
	cacheRoots := []struct {
		raw   string
		label string
	}{
		{"~/Library/Developer/Xcode/DerivedData", "Xcode DerivedData 缓存"},
		{"~/Library/Developer/CoreSimulator/Caches", "iOS 模拟器旧缓存"},
		{"~/.npm/_cacache", "npm 全局下载缓存"},
		{"~/Library/Caches/Homebrew", "Homebrew 下载缓存"},
	}

	for _, c := range cacheRoots {
		norm, err := ValidateTargetPath(c.raw, homeDir, protectedDirs)
		if err != nil {
			continue
		}
		info, err := os.Stat(norm)
		if err != nil || !info.IsDir() {
			continue
		}
		bytes := measureDirBounded(norm, 3500)
		mb := math.Round((float64(bytes)/(1024*1024))*10) / 10
		if mb >= 1 {
			items = append(items, DiskCandidate{
				Path:      c.raw,
				Label:     c.label,
				Category:  "cache",
				SizeMB:    mb,
				SizeLabel: formatBytesLabel(bytes),
			})
		}
	}

	downloadsPath, err := ValidateTargetPath("~/Downloads", homeDir, protectedDirs)
	if err == nil {
		var cutoff time.Time
		if idleDays > 0 {
			cutoff = time.Now().Add(-time.Duration(idleDays) * 24 * time.Hour)
		}
		if entries, err := os.ReadDir(downloadsPath); err == nil {
			for i, entry := range entries {
				if i > 400 || entry.IsDir() {
					continue
				}
				info, err := entry.Info()
				if err != nil {
					continue
				}
				sizeMB := float64(info.Size()) / (1024 * 1024)
				if sizeMB >= float64(minLargeFileMB) && (idleDays == 0 || info.ModTime().Before(cutoff)) {
					rel := "~/Downloads/" + entry.Name()
					items = append(items, DiskCandidate{
						Path:      rel,
						Label:     rel,
						Category:  "large_file",
						SizeMB:    math.Round(sizeMB*10) / 10,
						SizeLabel: formatBytesLabel(info.Size()),
					})
				}
			}
		}
	}

	var totalMB float64
	paths := make([]string, 0, len(items))
	for _, it := range items {
		totalMB += it.SizeMB
		paths = append(paths, it.Path)
	}

	return DiskScanReport{
		Items:                  items,
		CleanablePaths:         paths,
		EstimatedReclaimableGB: math.Round((totalMB/1024.0)*10) / 10,
		ScannedAt:              time.Now().Format(time.RFC3339),
	}
}

// TrashRecord tracks one reversible file/directory move so 7-day 1-click restore works cleanly.
type TrashRecord struct {
	OriginalPath string `json:"originalPath"`
	TrashPath    string `json:"trashPath"`
	Simulated    bool   `json:"simulated,omitempty"`
}

// TrashBatch stores a reversible group of trashed targets keyed by batch ID.
type TrashBatch struct {
	ID        string        `json:"id"`
	CreatedAt string        `json:"createdAt"`
	Items     []TrashRecord `json:"items"`
	Restored  bool          `json:"restored,omitempty"`
}

// TrashMover abstracts OS Trash movement (`mygo.Shell.TrashItemResult` in app mode or local staging vault).
type TrashMover func(absPath string, batchID string) (trashPath string, err error)

// MoveItemsToTrash safely validates each path and moves existing files to Trash (or staging vault),
// recording a 7-day reversible TrashBatch in `<dataDir>/trash-ledger.json`.
func MoveItemsToTrash(
	homeDir, dataDir string,
	protectedDirs []string,
	paths []string,
	estimatedGB float64,
	mover TrashMover,
) (batchID string, movedCount int, reclaimedGB float64, err error) {
	batchID = fmt.Sprintf("trash-%d", time.Now().UnixNano())
	records := make([]TrashRecord, 0, len(paths))
	var measuredBytes int64
	realMoved := 0
	var missing []string

	for _, raw := range paths {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		norm, vErr := ValidateTargetPath(raw, homeDir, protectedDirs)
		if vErr != nil {
			return "", 0, 0, vErr
		}
		info, sErr := os.Lstat(norm)
		if sErr != nil {
			if errors.Is(sErr, os.ErrNotExist) {
				if mover != nil {
					missing = append(missing, norm)
					continue
				}
				// Record demo/simulated path cleanly without failing on synthetic UI presets.
				records = append(records, TrashRecord{
					OriginalPath: norm,
					Simulated:    true,
				})
				movedCount++
				continue
			}
			return "", 0, 0, sErr
		}

		if info.IsDir() {
			measuredBytes += measureDirBounded(norm, 5000)
		} else {
			measuredBytes += info.Size()
		}

		var dest string
		if mover != nil {
			dest, err = mover(norm, batchID)
			if err != nil {
				return "", 0, 0, err
			}
		} else {
			dest, err = moveToVault(dataDir, batchID, norm)
			if err != nil {
				return "", 0, 0, err
			}
		}
		records = append(records, TrashRecord{
			OriginalPath: norm,
			TrashPath:    dest,
		})
		movedCount++
		realMoved++
	}

	if mover != nil && realMoved == 0 && len(missing) > 0 {
		return "", 0, 0, fmt.Errorf("未找到可移入废纸篓的目标文件：%s", strings.Join(missing, "、"))
	}

	if len(records) > 0 && dataDir != "" {
		_ = appendTrashBatch(dataDir, TrashBatch{
			ID:        batchID,
			CreatedAt: time.Now().Format(time.RFC3339),
			Items:     records,
		})
	}

	if measuredBytes > 0 {
		reclaimedGB = math.Round((float64(measuredBytes)/1e9)*100) / 100
		if reclaimedGB < 0.01 && estimatedGB > 0 {
			reclaimedGB = estimatedGB
		}
	} else {
		reclaimedGB = estimatedGB
	}

	return batchID, movedCount, reclaimedGB, nil
}

// RestoreTrashBatch returns all recorded items in a TrashBatch back to their original paths.
func RestoreTrashBatch(dataDir, batchID string) (int, error) {
	if dataDir == "" || batchID == "" {
		return 0, nil
	}
	batches, err := loadTrashLedger(dataDir)
	if err != nil {
		return 0, err
	}
	restored := 0
	found := false
	for i := range batches {
		if batches[i].ID != batchID {
			continue
		}
		found = true
		for _, item := range batches[i].Items {
			if item.Simulated || item.TrashPath == "" {
				restored++
				continue
			}
			if _, statErr := os.Stat(item.TrashPath); statErr != nil {
				continue
			}
			if mkErr := os.MkdirAll(filepath.Dir(item.OriginalPath), 0o755); mkErr != nil {
				return restored, mkErr
			}
			if rnErr := os.Rename(item.TrashPath, item.OriginalPath); rnErr != nil {
				return restored, rnErr
			}
			restored++
		}
		batches[i].Restored = true
	}
	if !found {
		return 0, nil
	}
	_ = saveTrashLedger(dataDir, batches)
	return restored, nil
}

func moveToVault(dataDir, batchID, absPath string) (string, error) {
	if dataDir == "" {
		return "", errors.New("missing dataDir for staging vault")
	}
	vaultDir := filepath.Join(dataDir, "trash-vault", batchID)
	if err := os.MkdirAll(vaultDir, 0o755); err != nil {
		return "", err
	}
	dest := filepath.Join(vaultDir, filepath.Base(absPath))
	if _, err := os.Stat(dest); err == nil {
		dest = fmt.Sprintf("%s-%d", dest, time.Now().UnixNano())
	}
	if err := os.Rename(absPath, dest); err != nil {
		return "", err
	}
	return dest, nil
}

func ledgerPath(dataDir string) string {
	return filepath.Join(dataDir, "trash-ledger.json")
}

func loadTrashLedger(dataDir string) ([]TrashBatch, error) {
	b, err := os.ReadFile(ledgerPath(dataDir))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []TrashBatch{}, nil
		}
		return nil, err
	}
	var batches []TrashBatch
	if err := json.Unmarshal(b, &batches); err != nil {
		return []TrashBatch{}, nil
	}
	return batches, nil
}

func saveTrashLedger(dataDir string, batches []TrashBatch) error {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(batches, "", "  ")
	if err != nil {
		return err
	}
	tmp := ledgerPath(dataDir) + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, ledgerPath(dataDir))
}

func appendTrashBatch(dataDir string, batch TrashBatch) error {
	batches, _ := loadTrashLedger(dataDir)
	batches = append(batches, batch)
	if len(batches) > 100 {
		batches = batches[len(batches)-100:]
	}
	return saveTrashLedger(dataDir, batches)
}
