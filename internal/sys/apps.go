package sys

import (
	"os"
	"path/filepath"
	"strings"
)

// OrphanRemnant summarizes a suspected remnant cache directory of an uninstalled app.
type OrphanRemnant struct {
	Path      string `json:"path"`
	BundleID  string `json:"bundleId"`
	SizeLabel string `json:"sizeLabel"`
}

// ScanOrphanRemnants inspects ~/Library/Caches for reverse-DNS bundles not matched
// against currently installed apps in /Applications.
func ScanOrphanRemnants(homeDir, bundleFilter string) []OrphanRemnant {
	if homeDir == "" {
		homeDir, _ = os.UserHomeDir()
	}
	installedNames := map[string]bool{}
	for _, appDir := range []string{"/Applications", filepath.Join(homeDir, "Applications")} {
		if entries, err := os.ReadDir(appDir); err == nil {
			for _, e := range entries {
				name := strings.ToLower(strings.TrimSuffix(e.Name(), ".app"))
				if name != "" {
					installedNames[name] = true
				}
			}
		}
	}

	cachesDir := filepath.Join(homeDir, "Library", "Caches")
	entries, err := os.ReadDir(cachesDir)
	if err != nil {
		return []OrphanRemnant{}
	}

	remnants := []OrphanRemnant{}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		lower := strings.ToLower(name)
		if strings.HasPrefix(lower, "com.apple.") || strings.HasPrefix(lower, "dev.vophan.valet") {
			continue
		}
		if bundleFilter != "" && !strings.Contains(lower, strings.ToLower(bundleFilter)) {
			continue
		}
		parts := strings.Split(lower, ".")
		matchedInstalled := false
		for _, p := range parts {
			if len(p) >= 3 && installedNames[p] {
				matchedInstalled = true
				break
			}
		}
		if matchedInstalled || !strings.Contains(lower, ".") {
			continue
		}
		remnants = append(remnants, OrphanRemnant{
			Path:      "~/Library/Caches/" + name,
			BundleID:  name,
			SizeLabel: "缓存目录",
		})
		if len(remnants) >= 8 {
			break
		}
	}
	return remnants
}
