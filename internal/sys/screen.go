package sys

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/egoist/mygo/plugins/permissionflow"
	"valet/internal/types"
)

// CaptureCurrentScreen verifies Screen Recording permission, captures the main display
// cleanly via macOS screencapture + sips resizing, and returns a bounded base64 attachment.
func CaptureCurrentScreen(ctx context.Context, dataDir string, desktopReady bool) types.ScreenCaptureResult {
	if desktopReady {
		st, err := permissionflow.Check(permissionflow.ScreenRecording)
		if err == nil && st != permissionflow.Granted {
			reqSt, _ := permissionflow.Request(ctx, permissionflow.ScreenRecording)
			if reqSt != permissionflow.Granted {
				_, _ = OpenPermissionSettings("screen_recording", true)
				return types.ScreenCaptureResult{
					OK:               false,
					PermissionDenied: true,
					Error:            "未获得 macOS「屏幕录制」权限，已打开系统设置。请开启 Valet 开关（如系统提示需重启应用后生效）再试。",
				}
			}
		}
	}

	baseDir := dataDir
	if baseDir == "" {
		baseDir = os.TempDir()
	}
	capturesDir := filepath.Join(baseDir, "captures")
	if err := os.MkdirAll(capturesDir, 0o755); err != nil {
		return types.ScreenCaptureResult{
			OK:    false,
			Error: fmt.Sprintf("创建截图目录失败：%v", err),
		}
	}

	stamp := time.Now().Format("20060102-150405")
	idSuffix := time.Now().UnixNano()
	rawPNG := filepath.Join(capturesDir, fmt.Sprintf("screen-%s-%d.png", stamp, idSuffix))
	finalJPG := filepath.Join(capturesDir, fmt.Sprintf("screen-%s-%d.jpg", stamp, idSuffix))

	capCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	cmd := exec.CommandContext(capCtx, "/usr/sbin/screencapture", "-x", "-t", "png", rawPNG)
	if out, err := cmd.CombinedOutput(); err != nil {
		_ = os.Remove(rawPNG)
		detail := ""
		if len(bytes.TrimSpace(out)) > 0 {
			detail = fmt.Sprintf(" (%s)", string(bytes.TrimSpace(out)))
		}
		if desktopReady {
			_, _ = OpenPermissionSettings("screen_recording", true)
		}
		return types.ScreenCaptureResult{
			OK:               false,
			PermissionDenied: true,
			Error:            fmt.Sprintf("截取当前屏幕失败，请确认已在「系统设置 › 隐私与安全性 › 屏幕录制」中允许 Valet%s。", detail),
		}
	}

	info, statErr := os.Stat(rawPNG)
	if statErr != nil || info.Size() < 100 {
		_ = os.Remove(rawPNG)
		if desktopReady {
			_, _ = OpenPermissionSettings("screen_recording", true)
		}
		return types.ScreenCaptureResult{
			OK:               false,
			PermissionDenied: true,
			Error:            "截取当前屏幕失败（未生成有效图像），请确认已在「系统设置 › 隐私与安全性 › 屏幕录制」中允许 Valet。",
		}
	}

	finalPath := finalJPG
	mimeType := "image/jpeg"
	sipsCtx, sipsCancel := context.WithTimeout(ctx, 8*time.Second)
	defer sipsCancel()
	sipsCmd := exec.CommandContext(
		sipsCtx,
		"/usr/bin/sips",
		"-Z", "1440",
		"-s", "format", "jpeg",
		"-s", "formatOptions", "76",
		rawPNG,
		"--out", finalJPG,
	)
	if err := sipsCmd.Run(); err != nil {
		finalPath = rawPNG
		mimeType = "image/png"
	} else if _, err := os.Stat(finalJPG); err != nil {
		finalPath = rawPNG
		mimeType = "image/png"
	} else {
		_ = os.Remove(rawPNG)
	}

	data, err := os.ReadFile(finalPath)
	if err != nil || len(data) == 0 {
		return types.ScreenCaptureResult{
			OK:    false,
			Error: fmt.Sprintf("读取截图文件失败：%v", err),
		}
	}

	width, height := 0, 0
	if cfg, _, cfgErr := image.DecodeConfig(bytes.NewReader(data)); cfgErr == nil {
		width = cfg.Width
		height = cfg.Height
	}
	kb := max(1, len(data)/1024)
	meta := fmt.Sprintf("%d KB", kb)
	if width > 0 && height > 0 {
		meta = fmt.Sprintf("%d×%d · %d KB", width, height, kb)
	}
	ext := "jpg"
	if mimeType == "image/png" {
		ext = "png"
	}
	dataURL := "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)

	return types.ScreenCaptureResult{
		OK: true,
		Attachment: &types.ChatAttachment{
			ID:       fmt.Sprintf("scr-%d", idSuffix),
			Kind:     "screen",
			Name:     fmt.Sprintf("当前屏幕 %s.%s", time.Now().Format("15:04:05"), ext),
			Meta:     meta,
			Badge:    "SCR",
			Path:     finalPath,
			DataURL:  dataURL,
			MimeType: mimeType,
		},
	}
}
