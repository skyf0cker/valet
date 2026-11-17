package cli

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"valet/internal/configctl"
)

type daemonClient struct {
	info configctl.ControlInfo
	fast *http.Client
	slow *http.Client
}

func tryConnectDaemon(dataDir string) (*daemonClient, map[string]any, bool) {
	info, err := configctl.ReadControlInfo(dataDir)
	if err != nil || strings.TrimSpace(info.BaseURL) == "" || strings.TrimSpace(info.Token) == "" {
		return nil, nil, false
	}
	dc := &daemonClient{
		info: info,
		fast: &http.Client{Timeout: 800 * time.Millisecond},
		slow: &http.Client{Timeout: 30 * time.Second},
	}
	res, err := dc.do(dc.fast, http.MethodGet, "/api/v1/status", nil)
	if err != nil {
		return nil, nil, false
	}
	dc.fast = &http.Client{Timeout: 5 * time.Second}
	return dc, res, true
}

func (d *daemonClient) get(path string) (map[string]any, error) {
	return d.do(d.fast, http.MethodGet, path, nil)
}

func (d *daemonClient) post(path string, body any) (map[string]any, error) {
	return d.do(d.fast, http.MethodPost, path, body)
}

func (d *daemonClient) postLong(path string, body any) (map[string]any, error) {
	return d.do(d.slow, http.MethodPost, path, body)
}

func (d *daemonClient) do(client *http.Client, method, path string, body any) (map[string]any, error) {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(raw)
	}
	fullURL := strings.TrimRight(d.info.BaseURL, "/") + path
	req, err := http.NewRequest(method, fullURL, reader)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+d.info.Token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	rawResp, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if len(strings.TrimSpace(string(rawResp))) > 0 {
		if jErr := json.Unmarshal(rawResp, &out); jErr != nil {
			return nil, fmt.Errorf("control API 返回无效 JSON (HTTP %d): %w", resp.StatusCode, jErr)
		}
	}
	if resp.StatusCode >= 400 {
		if msg, ok := out["error"].(string); ok && msg != "" {
			return out, errors.New(msg)
		}
		return out, fmt.Errorf("control API 请求失败 (HTTP %d)", resp.StatusCode)
	}
	if okVal, hasOK := out["ok"].(bool); hasOK && !okVal {
		if msg, ok := out["error"].(string); ok && msg != "" {
			return out, errors.New(msg)
		}
	}
	return out, nil
}

func encodeQuery(key, value string) string {
	return url.QueryEscape(key) + "=" + url.QueryEscape(value)
}
