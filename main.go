package main

import (
	"log"

	"github.com/egoist/mygo"
	"valet/internal/backend"
	"valet/internal/types"
)

// ChatStreamEvent pushes incremental Pi Durable thinking, tool step, and text updates.
var ChatStreamEvent = mygo.NewEvent[types.ChatStreamPayload]("chat:stream")

// MetricsUpdatedEvent pushes live macOS disk, CPU, and memory metrics to the sidebar.
var MetricsUpdatedEvent = mygo.NewEvent[types.SystemMetrics]("metrics:updated")

// StateChangedEvent notifies the UI when background agent/plugin work updates stored state.
var StateChangedEvent = mygo.NewEvent[types.StateChangeNotice]("state:changed")

func main() {
	svc := backend.NewService()
	mygo.BindAs("Valet", svc)

	mygo.App.OnBeforeQuit(func(_ *mygo.QuitEvent) {
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

		go func() {
			if err := backend.StartService(svc, backend.StartOptions{
				DesktopReady: true,
				OnChatStream: func(payload types.ChatStreamPayload) {
					_ = ChatStreamEvent.Emit(win, payload)
				},
				OnMetrics: func(m types.SystemMetrics) {
					_ = MetricsUpdatedEvent.Emit(win, m)
				},
				OnState: func(n types.StateChangeNotice) {
					_ = StateChangedEvent.Emit(win, n)
				},
			}); err != nil {
				log.Printf("[valet] backend start failed: %v", err)
			}
		}()
	})

	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
