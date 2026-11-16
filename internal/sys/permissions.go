package sys

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/permissionflow"
)

func mapPermission(id string) (permissionflow.Permission, bool) {
	switch id {
	case "full_disk":
		return permissionflow.FullDiskAccess, true
	case "accessibility":
		return permissionflow.Accessibility, true
	case "screen_recording":
		return permissionflow.ScreenRecording, true
	case "microphone":
		return permissionflow.Microphone, true
	default:
		return "", false
	}
}

// CheckPermissionStatus queries real macOS permission grant status when available.
func CheckPermissionStatus(id string, fallback bool, desktopReady bool) bool {
	if id == "notifications" {
		if !desktopReady {
			return fallback
		}
		return mygo.NotificationsSupported()
	}
	if !desktopReady {
		return fallback
	}
	p, ok := mapPermission(id)
	if !ok {
		return fallback
	}
	st, err := permissionflow.Check(p)
	if err != nil {
		return fallback
	}
	if st == permissionflow.Granted {
		return true
	}
	if st == permissionflow.Denied || st == permissionflow.NotDetermined {
		return false
	}
	return fallback
}

// OpenPermissionSettings opens System Settings on the matching privacy pane when running under MyGo.
func OpenPermissionSettings(id string, desktopReady bool) (bool, error) {
	if !desktopReady {
		return false, nil
	}
	if p, ok := mapPermission(id); ok {
		if err := permissionflow.OpenSettings(p); err == nil {
			return true, nil
		}
	}
	if id == "automation" {
		if err := mygo.Shell.OpenExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation"); err == nil {
			return true, nil
		}
	}
	if id == "notifications" {
		if err := mygo.Shell.OpenExternal("x-apple.systempreferences:com.apple.Notifications-Settings.extension"); err == nil {
			return true, nil
		}
	}
	return false, nil
}
