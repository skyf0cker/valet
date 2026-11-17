package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"
)

const defaultWebhookListenAddr = "127.0.0.1:41920"

// startWebhookServer binds a loopback HTTP ingress endpoint (`POST /events/{pluginId}/{eventCode}`)
// allowing external scripts, webhooks, and developer hooks to push custom events into Valet.
func (s *Service) startWebhookServer(preferFixedPort bool) (string, *http.Server, error) {
	var ln net.Listener
	var err error
	if preferFixedPort {
		ln, err = net.Listen("tcp", defaultWebhookListenAddr)
	}
	if ln == nil {
		ln, err = net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			return "", nil, err
		}
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeWebhookJSON(w, http.StatusOK, map[string]any{"ok": true})
	})
	mux.HandleFunc("/events/", s.handleWebhookEvent)

	addr := ln.Addr().String()
	baseURL := "http://" + addr
	endpoint := baseURL + "/events"
	s.registerControlAPI(mux, baseURL, endpoint)

	srv := &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go func() {
		if serveErr := srv.Serve(ln); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			return
		}
	}()

	return endpoint, srv, nil
}

func (s *Service) handleWebhookEvent(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeWebhookJSON(w, http.StatusMethodNotAllowed, map[string]any{
			"ok":    false,
			"error": "请使用 POST /events/{pluginId}/{eventCode} 推送事件",
		})
		return
	}

	trimmed := strings.TrimPrefix(r.URL.Path, "/events/")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) < 2 || strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		writeWebhookJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": "路径格式应为 /events/{pluginId}/{eventCode}",
		})
		return
	}
	pluginID := strings.TrimSpace(parts[0])
	eventCode := strings.TrimSpace(parts[1])

	snap := s.store.Snapshot()
	var found bool
	var active bool
	for _, p := range snap.Plugins {
		if p.ID == pluginID {
			found = true
			active = p.Installed && p.Enabled
			break
		}
	}
	if !found {
		writeWebhookJSON(w, http.StatusNotFound, map[string]any{
			"ok":    false,
			"error": fmt.Sprintf("未找到插件 %q", pluginID),
		})
		return
	}
	if !active {
		writeWebhookJSON(w, http.StatusConflict, map[string]any{
			"ok":    false,
			"error": fmt.Sprintf("插件 %q 未安装或已停用", pluginID),
		})
		return
	}

	rawBody, err := io.ReadAll(io.LimitReader(r.Body, 256*1024))
	if err != nil {
		writeWebhookJSON(w, http.StatusBadRequest, map[string]any{
			"ok":    false,
			"error": fmt.Sprintf("读取请求体失败：%v", err),
		})
		return
	}

	payload := map[string]any{}
	trimmedBody := strings.TrimSpace(string(rawBody))
	if trimmedBody != "" {
		var parsed map[string]any
		if json.Unmarshal([]byte(trimmedBody), &parsed) == nil && parsed != nil {
			payload = parsed
		} else {
			payload["raw"] = trimmedBody
		}
	}
	payload["sensor"] = "webhook"

	if r.URL.Query().Get("sync") == "1" {
		res, dErr := s.dispatchPluginEventInternal(r.Context(), pluginID, eventCode, payload, false)
		if dErr != nil {
			status := http.StatusInternalServerError
			if strings.Contains(dErr.Error(), "throttled") {
				status = http.StatusTooManyRequests
			}
			writeWebhookJSON(w, status, map[string]any{
				"ok":    false,
				"error": dErr.Error(),
			})
			return
		}
		writeWebhookJSON(w, http.StatusOK, map[string]any{
			"ok":        true,
			"pluginId":  pluginID,
			"eventCode": eventCode,
			"eventId":   res.Event.ID,
			"status":    res.Event.Status,
			"summary":   res.Event.Summary,
			"inboxId": func() string {
				if res.InboxItem != nil {
					return res.InboxItem.ID
				}
				return ""
			}(),
		})
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		_, _ = s.dispatchPluginEventInternal(ctx, pluginID, eventCode, payload, false)
	}()

	writeWebhookJSON(w, http.StatusAccepted, map[string]any{
		"ok":        true,
		"accepted":  true,
		"pluginId":  pluginID,
		"eventCode": eventCode,
	})
}

func writeWebhookJSON(w http.ResponseWriter, status int, payload map[string]any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
