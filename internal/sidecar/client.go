package sidecar

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"sync/atomic"
	"time"
)

// HostRequestHandler answers incoming JSON-RPC `host.*` requests from Sidecar tools/hooks.
type HostRequestHandler func(ctx context.Context, method string, params json.RawMessage) (any, error)

// NotifyHandler receives streaming notifications (e.g. `host.chatStream`) from Sidecar.
type NotifyHandler func(method string, params json.RawMessage)

type rpcReply struct {
	result json.RawMessage
	err    error
}

// Client supervises the `@earendil-works/pi-durable` sidecar process over bidirectional NDJSON Unix socket IPC.
type Client struct {
	resourcesDir string
	repoRoot     string
	hostHandler  HostRequestHandler
	notify       NotifyHandler

	mu        sync.Mutex
	cmd       *exec.Cmd
	conn      net.Conn
	sockDir   string
	writeMu   sync.Mutex
	nextID    atomic.Int64
	pendingMu sync.Mutex
	pending   map[string]chan rpcReply
	doneCh    chan struct{}
	closed    bool
}

// NewClient constructs a supervised Unix domain socket JSON-RPC client for the Pi Durable sidecar.
func NewClient(resourcesDir, repoRoot string, handler HostRequestHandler, notify NotifyHandler) *Client {
	return &Client{
		resourcesDir: resourcesDir,
		repoRoot:     repoRoot,
		hostHandler:  handler,
		notify:       notify,
		pending:      make(map[string]chan rpcReply),
	}
}

// Start launches the sidecar subprocess if it is not already running.
func (c *Client) Start(ctx context.Context) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.closed {
		return errors.New("sidecar client is closed")
	}
	if c.cmd != nil && c.doneCh != nil {
		select {
		case <-c.doneCh:
		default:
			return nil // already running
		}
	}

	bin, args, dir, err := resolveSidecarCommand(c.resourcesDir, c.repoRoot)
	if err != nil {
		return err
	}

	sockDir, err := os.MkdirTemp("/tmp", "valet-ipc-")
	if err != nil {
		sockDir, err = os.MkdirTemp("", "vi-")
		if err != nil {
			return fmt.Errorf("sidecar socket dir: %w", err)
		}
	}
	sockPath := filepath.Join(sockDir, "s.sock")
	ln, err := net.Listen("unix", sockPath)
	if err != nil {
		_ = os.RemoveAll(sockDir)
		return fmt.Errorf("sidecar listen unix socket: %w", err)
	}

	cmd := exec.Command(bin, args...)
	if dir != "" {
		cmd.Dir = dir
	}
	cmd.Env = append(os.Environ(), "VALET_AGENT_SOCKET="+sockPath)
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		_ = ln.Close()
		_ = os.RemoveAll(sockDir)
		return fmt.Errorf("start sidecar (%s): %w", bin, err)
	}

	if ul, ok := ln.(*net.UnixListener); ok {
		_ = ul.SetDeadline(time.Now().Add(5 * time.Second))
	}
	conn, err := ln.Accept()
	_ = ln.Close()
	if err != nil {
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		_ = cmd.Wait()
		_ = os.RemoveAll(sockDir)
		return fmt.Errorf("accept sidecar socket: %w", err)
	}
	_ = conn.SetDeadline(time.Time{})

	doneCh := make(chan struct{})
	c.cmd = cmd
	c.writeMu.Lock()
	c.conn = conn
	c.writeMu.Unlock()
	c.sockDir = sockDir
	c.doneCh = doneCh

	go c.readLoop(conn, sockDir, cmd, doneCh)
	return nil
}

func (c *Client) readLoop(conn net.Conn, sockDir string, cmd *exec.Cmd, doneCh chan struct{}) {
	defer func() {
		_ = conn.Close()
		_ = os.RemoveAll(sockDir)
		_ = cmd.Wait()
		c.failPending(errors.New("sidecar process exited"))
		close(doneCh)
	}()

	scanner := bufio.NewScanner(conn)
	scanner.Buffer(make([]byte, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}
		var env rpcEnvelope
		if err := json.Unmarshal(line, &env); err != nil {
			continue
		}

		// Response to a Go -> Sidecar call
		if env.Method == "" && len(env.ID) > 0 {
			key := string(env.ID)
			c.pendingMu.Lock()
			ch, ok := c.pending[key]
			if ok {
				delete(c.pending, key)
			}
			c.pendingMu.Unlock()
			if ok {
				if env.Error != nil {
					ch <- rpcReply{err: errors.New(env.Error.Message)}
				} else {
					ch <- rpcReply{result: env.Result}
				}
			}
			continue
		}

		// One-way notification from Sidecar -> Go
		if env.Method != "" && len(env.ID) == 0 {
			if c.notify != nil {
				c.notify(env.Method, env.Params)
			}
			continue
		}

		// Sidecar -> Go host.* request (handled concurrently so tool hooks never block readLoop)
		if env.Method != "" && len(env.ID) > 0 {
			go c.handleHostCall(env)
		}
	}
}

func (c *Client) handleHostCall(env rpcEnvelope) {
	if c.hostHandler == nil {
		_ = c.writeEnvelope(rpcEnvelope{
			JSONRPC: "2.0",
			ID:      env.ID,
			Error:   &rpcError{Code: -32601, Message: "no host handler registered"},
		})
		return
	}
	res, err := c.hostHandler(context.Background(), env.Method, env.Params)
	if err != nil {
		_ = c.writeEnvelope(rpcEnvelope{
			JSONRPC: "2.0",
			ID:      env.ID,
			Error:   &rpcError{Code: -32000, Message: err.Error()},
		})
		return
	}
	raw, mErr := json.Marshal(res)
	if mErr != nil {
		_ = c.writeEnvelope(rpcEnvelope{
			JSONRPC: "2.0",
			ID:      env.ID,
			Error:   &rpcError{Code: -32000, Message: mErr.Error()},
		})
		return
	}
	_ = c.writeEnvelope(rpcEnvelope{
		JSONRPC: "2.0",
		ID:      env.ID,
		Result:  raw,
	})
}

func (c *Client) failPending(err error) {
	c.pendingMu.Lock()
	pending := c.pending
	c.pending = make(map[string]chan rpcReply)
	c.pendingMu.Unlock()
	for _, ch := range pending {
		ch <- rpcReply{err: err}
	}
}

func (c *Client) writeEnvelope(env rpcEnvelope) error {
	raw, err := json.Marshal(env)
	if err != nil {
		return err
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if c.conn == nil {
		return errors.New("sidecar socket is closed")
	}
	_, err = c.conn.Write(append(raw, '\n'))
	return err
}

// Call sends a JSON-RPC request to the Sidecar and awaits its response.
func (c *Client) Call(ctx context.Context, method string, params any, out any) error {
	if err := c.Start(ctx); err != nil {
		return err
	}
	return c.callConnected(ctx, method, params, out)
}

func (c *Client) callConnected(ctx context.Context, method string, params any, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}

	rawID := json.RawMessage(fmt.Sprintf("%d", c.nextID.Add(1)))
	rawParams, err := json.Marshal(params)
	if err != nil {
		return err
	}

	replyCh := make(chan rpcReply, 1)
	key := string(rawID)
	c.pendingMu.Lock()
	c.pending[key] = replyCh
	c.pendingMu.Unlock()

	if err := c.writeEnvelope(rpcEnvelope{
		JSONRPC: "2.0",
		ID:      rawID,
		Method:  method,
		Params:  rawParams,
	}); err != nil {
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return err
	}

	select {
	case rep := <-replyCh:
		if rep.err != nil {
			return rep.err
		}
		if out != nil && len(rep.result) > 0 && string(rep.result) != "null" {
			return json.Unmarshal(rep.result, out)
		}
		return nil
	case <-ctx.Done():
		c.pendingMu.Lock()
		delete(c.pending, key)
		c.pendingMu.Unlock()
		return ctx.Err()
	}
}

// Close shuts down the sidecar gracefully, falling back to process termination after timeout.
func (c *Client) Close() error {
	c.mu.Lock()
	if c.closed {
		c.mu.Unlock()
		return nil
	}
	c.closed = true
	cmd := c.cmd
	doneCh := c.doneCh
	sockDir := c.sockDir
	c.mu.Unlock()

	if cmd == nil || doneCh == nil {
		if sockDir != "" {
			_ = os.RemoveAll(sockDir)
		}
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = c.callConnected(ctx, "agent.shutdown", map[string]any{}, nil)

	c.writeMu.Lock()
	if c.conn != nil {
		_ = c.conn.Close()
		c.conn = nil
	}
	c.writeMu.Unlock()

	select {
	case <-doneCh:
	case <-time.After(1500 * time.Millisecond):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-doneCh
	}
	if sockDir != "" {
		_ = os.RemoveAll(sockDir)
	}
	return nil
}

func resolveSidecarCommand(resourcesDir, explicitRoot string) (string, []string, string, error) {
	platDir := fmt.Sprintf("%s-%s", runtime.GOOS, runtime.GOARCH)
	var binDirs []string
	if resourcesDir != "" {
		binDirs = append(binDirs,
			filepath.Join(resourcesDir, "bin"),
			filepath.Join(resourcesDir, platDir, "bin"),
		)
	}

	repoRoot := findRepoRoot(explicitRoot)
	if repoRoot != "" {
		binDirs = append(binDirs,
			filepath.Join(repoRoot, "resources", platDir, "bin"),
			filepath.Join(repoRoot, "resources", "bin"),
		)
	}

	for _, binDir := range binDirs {
		bunRunner := filepath.Join(binDir, "valet-bun")
		agentScript := filepath.Join(binDir, "valet-agent.js")
		bunInfo, bunErr := os.Stat(bunRunner)
		scriptInfo, scriptErr := os.Stat(agentScript)
		if bunErr == nil && !bunInfo.IsDir() && scriptErr == nil && !scriptInfo.IsDir() {
			return bunRunner, []string{agentScript}, binDir, nil
		}

		compiled := filepath.Join(binDir, "valet-agent")
		if info, err := os.Stat(compiled); err == nil && !info.IsDir() {
			return compiled, nil, repoRoot, nil
		}
	}

	if repoRoot != "" {
		entry := filepath.Join(repoRoot, "sidecar", "src", "main.ts")
		if _, err := os.Stat(entry); err == nil {
			if bunBin := findBun(); bunBin != "" {
				return bunBin, []string{"run", entry}, repoRoot, nil
			}
			if nodeBin, err := exec.LookPath("node"); err == nil {
				return nodeBin, []string{"--experimental-strip-types", entry}, repoRoot, nil
			}
		}
	}

	return "", nil, "", errors.New("could not locate valet-agent sidecar binary or Bun/Node runner")
}

func findRepoRoot(explicit string) string {
	candidates := []string{}
	if explicit != "" {
		candidates = append(candidates, explicit)
	}
	if wd, err := os.Getwd(); err == nil {
		cur := wd
		for i := 0; i < 6; i++ {
			candidates = append(candidates, cur)
			parent := filepath.Dir(cur)
			if parent == cur {
				break
			}
			cur = parent
		}
	}
	for _, dir := range candidates {
		if _, err := os.Stat(filepath.Join(dir, "sidecar", "src", "main.ts")); err == nil {
			return dir
		}
	}
	return explicit
}

func findBun() string {
	if p, err := exec.LookPath("bun"); err == nil {
		return p
	}
	if home, err := os.UserHomeDir(); err == nil {
		p := filepath.Join(home, ".bun", "bin", "bun")
		if _, err := os.Stat(p); err == nil {
			return p
		}
	}
	return ""
}
