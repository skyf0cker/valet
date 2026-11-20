package sys

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMoveItemsToTrashWithReport_ElevatedBatchAndFallback(t *testing.T) {
	homeDir := t.TempDir()
	dataDir := t.TempDir()

	okFile := filepath.Join(homeDir, "Downloads", "ok.log")
	permFile1 := filepath.Join(homeDir, "Downloads", "Karabiner-VirtualHIDDevice-Manager")
	permFile2 := filepath.Join(homeDir, "Downloads", "Karabiner-Elements.plist")
	if err := os.MkdirAll(filepath.Dir(okFile), 0o755); err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	for _, p := range []string{okFile, permFile1, permFile2} {
		if err := os.WriteFile(p, []byte("payload"), 0o644); err != nil {
			t.Fatalf("write %s failed: %v", p, err)
		}
	}

	fakeMover := func(absPath, batchID string) (string, error) {
		if strings.Contains(absPath, "Karabiner-") {
			return "", errors.New(`“Karabiner-VirtualHIDDevice-Manager” couldn’t be moved to the trash because you don’t have permission to access it.`)
		}
		dest := filepath.Join(dataDir, "mock-trash", filepath.Base(absPath))
		if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
			return "", err
		}
		if err := os.Rename(absPath, dest); err != nil {
			return "", err
		}
		return dest, nil
	}

	// 1. Elevated mover batches ALL permission-denied items into ONE call and succeeds
	elevatedCalls := 0
	var elevatedBatch []string
	mockElevated := func(absPaths []string, home string, batchID string) ([]TrashRecord, []TrashFailure) {
		elevatedCalls++
		elevatedBatch = append([]string(nil), absPaths...)
		var moved []TrashRecord
		for _, p := range absPaths {
			dest := filepath.Join(dataDir, "mock-trash", filepath.Base(p))
			_ = os.MkdirAll(filepath.Dir(dest), 0o755)
			if err := os.Rename(p, dest); err == nil {
				moved = append(moved, TrashRecord{OriginalPath: p, TrashPath: dest})
			}
		}
		return moved, nil
	}

	res, err := MoveItemsToTrashWithReport(homeDir, dataDir, nil, []string{okFile, permFile1, permFile2}, 0.1, fakeMover, mockElevated)
	if err != nil {
		t.Fatalf("expected elevated batch success, got error: %v", err)
	}
	if elevatedCalls != 1 {
		t.Fatalf("expected exactly 1 elevated prompt for 2 protected files, got %d", elevatedCalls)
	}
	if len(elevatedBatch) != 2 {
		t.Fatalf("expected 2 paths batched into elevated prompt, got %d (%v)", len(elevatedBatch), elevatedBatch)
	}
	if res.MovedCount != 3 || len(res.Failed) != 0 {
		t.Fatalf("expected MovedCount=3 and 0 failed, got %+v", res)
	}

	// Verify 7-day restore brings all 3 files back cleanly
	restored, rErr := RestoreTrashBatch(dataDir, res.BatchID)
	if rErr != nil || restored != 3 {
		t.Fatalf("RestoreTrashBatch failed: restored=%d err=%v", restored, rErr)
	}
	for _, p := range []string{okFile, permFile1, permFile2} {
		if _, statErr := os.Stat(p); statErr != nil {
			t.Fatalf("expected %s restored, stat err: %v", p, statErr)
		}
	}

	// 2. When user cancels the macOS administrator prompt, return clear Chinese cancellation message
	cancelElevated := func(absPaths []string, home string, batchID string) ([]TrashRecord, []TrashFailure) {
		var failed []TrashFailure
		for _, p := range absPaths {
			failed = append(failed, TrashFailure{
				Path:       p,
				Name:       filepath.Base(p),
				Permission: false,
				Reason:     "已取消管理员授权",
			})
		}
		return nil, failed
	}
	_, err = MoveItemsToTrashWithReport(homeDir, dataDir, nil, []string{permFile1}, 0.1, fakeMover, cancelElevated)
	if err == nil || !strings.Contains(err.Error(), "取消管理员授权") {
		t.Fatalf("expected Chinese cancellation message, got: %v", err)
	}
}
