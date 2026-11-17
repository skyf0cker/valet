package pluginsbundle

import "embed"

// CatalogFS embeds all self-contained plugin bundles (`<slug>/manifest.yaml`, `SKILL.md`, `scripts/*`).
//
//go:embed all:disk-guard all:uninstall-scrubber all:process-sentinel all:log-detective all:surge-doctor all:battery-guardian all:wifi-sentinel all:github-watcher all:calendar-focus
var CatalogFS embed.FS
