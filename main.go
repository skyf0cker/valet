package main

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"log"
	"math"
	"path/filepath"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"valet/internal/backend"
	"valet/internal/plugins"
	"valet/internal/types"
)

// ChatStreamEvent pushes incremental Pi Durable thinking, tool step, and text updates.
var ChatStreamEvent = mygo.NewEvent[types.ChatStreamPayload]("chat:stream")

// MetricsUpdatedEvent pushes live macOS disk, CPU, and memory metrics to the sidebar.
var MetricsUpdatedEvent = mygo.NewEvent[types.SystemMetrics]("metrics:updated")

// StateChangedEvent notifies the UI when background agent/plugin work updates stored state.
var StateChangedEvent = mygo.NewEvent[types.StateChangeNotice]("state:changed")

// WorkflowUpdatedEvent notifies the UI when a local Vercel Workflow run changes status or node state.
var WorkflowUpdatedEvent = mygo.NewEvent[types.WorkflowUpdatedPayload]("workflow:updated")

func main() {
	svc := backend.NewService()
	mygo.BindAs("Valet", svc)

	var (
		trayMu sync.Mutex
		tray   *mygo.Tray
	)

	mygo.App.OnBeforeQuit(func(_ *mygo.QuitEvent) {
		mygo.GlobalShortcut.UnregisterAll()
		trayMu.Lock()
		if tray != nil {
			tray.Destroy()
			tray = nil
		}
		trayMu.Unlock()
		_ = backend.CloseService(svc)
	})

	mygo.App.WhenReady(func() {
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:                "Valet",
			Width:                1280,
			Height:               820,
			MinWidth:             720,
			MinHeight:            600,
			TitleBarStyle:        mygo.TitleBarHidden,
			TrafficLightPosition: &mygo.Point{X: 20, Y: 20},
			BackgroundColor:      "light-dark(#ffffff, #0e0e0e)",
			// Opens where the user left it last time.
			StateKey: "main",
			// The frontend: devUrl during `mygo dev`, frontendDist
			// embedded by `mygo build` otherwise (see mygo.json).
			URL: "/",
		})

		trayIcon := buildTrayTemplateIconPNG()
		buildTrayMenu := func(paused bool) *mygo.Menu {
			pauseLabel := "暂停守护 (Alt+Esc)"
			if paused {
				pauseLabel = "恢复守护 (Alt+Esc)"
			}
			return mygo.NewMenu([]*mygo.MenuItem{
				{
					ID:          "show",
					Label:       "打开 Valet 控制台",
					Click:       func(_ *mygo.MenuItem, _ *mygo.Window) { win.Show(); win.Focus() },
				},
				{
					ID:    "pause",
					Label: pauseLabel,
					Click: func(_ *mygo.MenuItem, _ *mygo.Window) { go func() { _, _ = svc.TogglePause() }() },
				},
				mygo.Separator(),
				{
					ID:    "quit",
					Label: "退出 Valet",
					Click: func(_ *mygo.MenuItem, _ *mygo.Window) { mygo.App.Quit() },
				},
			})
		}

		syncTray := func(show bool, paused bool) {
			trayMu.Lock()
			defer trayMu.Unlock()
			if !show {
				if tray != nil {
					tray.Destroy()
					tray = nil
				}
				return
			}
			menu := buildTrayMenu(paused)
			if tray == nil {
				t, err := mygo.NewTray(mygo.TrayOptions{
					ID:             "valet.tray",
					Icon:           trayIcon,
					IconIsTemplate: true,
					ToolTip:        "Valet 正在守护此 Mac",
					Menu:           menu,
				})
				if err != nil {
					log.Printf("[valet] tray create error: %v", err)
					return
				}
				tray = t
			} else {
				tray.SetMenu(menu)
			}
			if paused {
				tray.SetToolTip("Valet（已暂停守护）")
			} else {
				tray.SetToolTip("Valet 正在守护此 Mac")
			}
		}

		if err := mygo.GlobalShortcut.Register("Alt+Escape", func() {
			go func() { _, _ = svc.TogglePause() }()
		}); err != nil {
			log.Printf("[valet] shortcut Alt+Escape register skipped: %v", err)
		}

		startOpts := backend.StartOptions{
			DesktopReady: true,
			WatchDir:     watchDirWithMyGo,
			OnSyncTray:   syncTray,
			OnSyncLogin: func(launchAtLogin bool) {
				if err := mygo.App.SetOpenAtLogin(launchAtLogin); err != nil {
					log.Printf("[valet] SetOpenAtLogin(%v) failed: %v", launchAtLogin, err)
				}
			},
			OnNotify: func(_kind, title, subtitle, body string) {
				if !mygo.NotificationsSupported() {
					return
				}
				n := mygo.NewNotification(mygo.NotificationOptions{
					Title:    title,
					Subtitle: subtitle,
					Body:     body,
					Group:    "valet.events",
				})
				if err := n.Show(); err != nil {
					log.Printf("[valet] notification show failed: %v", err)
				}
			},
			OnChatStream: func(payload types.ChatStreamPayload) {
				_ = ChatStreamEvent.Emit(win, payload)
			},
			OnMetrics: func(m types.SystemMetrics) {
				_ = MetricsUpdatedEvent.Emit(win, m)
			},
			OnState: func(n types.StateChangeNotice) {
				_ = StateChangedEvent.Emit(win, n)
			},
			OnWorkflowUpdated: func(p types.WorkflowUpdatedPayload) {
				_ = WorkflowUpdatedEvent.Emit(win, p)
			},
		}
		backend.ConfigureService(svc, startOpts)

		go func() {
			if err := backend.StartService(svc, startOpts); err != nil {
				log.Printf("[valet] backend start failed: %v", err)
			}
		}()
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func watchDirWithMyGo(ctx context.Context, dir string) (<-chan plugins.FsWatchEvent, func() error, error) {
	watcher, err := mygo.WatchFiles(ctx, dir, mygo.FileWatchOptions{
		Debounce: 200 * time.Millisecond,
		MaxDelay: 600 * time.Millisecond,
	})
	if err != nil {
		return nil, nil, err
	}
	ch := make(chan plugins.FsWatchEvent, 64)
	go func() {
		defer close(ch)
		for {
			events, err := watcher.Next(ctx)
			if err != nil {
				return
			}
			for _, ev := range events {
				op := string(ev.Op)
				if op == string(mygo.FileHint) {
					op = "write"
				}
				fullPath := watcher.Root()
				if ev.Path != "" && ev.Path != "." {
					fullPath = filepath.Join(watcher.Root(), ev.Path)
				}
				select {
				case ch <- plugins.FsWatchEvent{Op: op, Path: fullPath, IsDir: ev.IsDir}:
				case <-ctx.Done():
					return
				}
			}
		}
	}()
	return ch, watcher.Close, nil
}

// buildTrayTemplateIconPNG renders the exact 32x32 monochrome Paper bowtie icon for macOS template trays.
func buildTrayTemplateIconPNG() []byte {
	const size = 32
	const sub = 4
	const unitScale = 26.0 / 24.0

	cubicPt := func(p0, c1, c2, p3 [2]float64, t float64) [2]float64 {
		u := 1 - t
		return [2]float64{
			u*u*u*p0[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p3[0],
			u*u*u*p0[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p3[1],
		}
	}
	const segs = 32
	leftWing := make([][2]float64, 0, segs*2+4)
	leftWing = append(leftWing, [2]float64{2.5, 7.2})
	for i := 1; i <= segs; i++ {
		leftWing = append(leftWing, cubicPt([2]float64{2.5, 7.2}, [2]float64{2.5, 6.5}, [2]float64{3.2, 6.1}, [2]float64{3.8, 6.4}, float64(i)/segs))
	}
	leftWing = append(leftWing, [2]float64{10.0, 9.7}, [2]float64{10.0, 14.3}, [2]float64{3.8, 17.6})
	for i := 1; i <= segs; i++ {
		leftWing = append(leftWing, cubicPt([2]float64{3.8, 17.6}, [2]float64{3.2, 17.9}, [2]float64{2.5, 17.5}, [2]float64{2.5, 16.8}, float64(i)/segs))
	}

	inPoly := func(px, py float64, poly [][2]float64) bool {
		inside := false
		j := len(poly) - 1
		for i := range poly {
			pi, pj := poly[i], poly[j]
			if ((pi[1] > py) != (pj[1] > py)) &&
				(px < (pj[0]-pi[0])*(py-pi[1])/(pj[1]-pi[1])+pi[0]) {
				inside = !inside
			}
			j = i
		}
		return inside
	}

	inKnot := func(u, v float64) bool {
		qx := math.Abs(u-12.0) - (1.8 - 1.2)
		qy := math.Abs(v-12.0) - (2.4 - 1.2)
		return math.Hypot(math.Max(qx, 0), math.Max(qy, 0))+math.Min(math.Max(qx, qy), 0)-1.2 <= 0
	}

	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			hits := 0
			for sy := 0; sy < sub; sy++ {
				py := float64(y) + (float64(sy)+0.5)/float64(sub)
				for sx := 0; sx < sub; sx++ {
					px := float64(x) + (float64(sx)+0.5)/float64(sub)
					u := (px-16.0)/unitScale + 12.0
					v := (py-16.0)/unitScale + 12.0
					if inKnot(u, v) || (u < 12.0 && inPoly(u, v, leftWing)) || (u > 12.0 && inPoly(24.0-u, v, leftWing)) {
						hits++
					}
				}
			}
			if hits > 0 {
				a := uint8(math.Round(float64(hits) / float64(sub*sub) * 255.0))
				img.SetNRGBA(x, y, color.NRGBA{R: 0, G: 0, B: 0, A: a})
			}
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}
