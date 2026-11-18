package mqtt

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"net"
	"sync"
	"time"
)

// Handler processes one inbound message. Returning an error does not stop the client; QoS 1
// messages are acknowledged only after the handler returns (at-least-once processing).
type Handler func(ctx context.Context, m Message) error

// Client maintains a subscription across broker restarts and network failures.
type Client struct {
	Addr      string
	TLS       *tls.Config // nil = plain TCP (dev only); production uses mTLS
	Options   ConnectOptions
	Topic     string
	Handler   Handler
	Log       *slog.Logger
	OnConnect func()

	writeMu sync.Mutex
	conn    net.Conn
}

// Run blocks until ctx is cancelled, reconnecting with capped exponential back-off + full jitter.
func (c *Client) Run(ctx context.Context) error {
	attempt := 0
	for {
		err := c.session(ctx)
		if ctx.Err() != nil {
			return ctx.Err()
		}
		attempt++
		if err == nil {
			attempt = 0
		}
		delay := backoff(attempt)
		c.Log.Warn("mqtt session ended; reconnecting", "err", err, "attempt", attempt, "delay", delay)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
}

func backoff(attempt int) time.Duration {
	capped := min(30*time.Second, time.Duration(1<<min(attempt, 6))*250*time.Millisecond)
	return time.Duration(rand.Int64N(int64(capped) + 1))
}

func (c *Client) write(p Packet) error {
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	if err := c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return err
	}
	_, err := c.conn.Write(Encode(p))
	return err
}

func (c *Client) session(ctx context.Context) error {
	d := net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	var conn net.Conn
	var err error
	if c.TLS != nil {
		conn, err = tls.DialWithDialer(&d, "tcp", c.Addr, c.TLS)
	} else {
		conn, err = d.DialContext(ctx, "tcp", c.Addr)
	}
	if err != nil {
		return fmt.Errorf("dial %s: %w", c.Addr, err)
	}
	defer conn.Close()
	c.conn = conn
	r := bufio.NewReader(conn)

	if err := c.write(Connect(c.Options)); err != nil {
		return err
	}
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	ack, err := Read(r)
	if err != nil {
		return fmt.Errorf("connack: %w", err)
	}
	code, err := ConnackCode(ack)
	if err != nil {
		return err
	}
	if code != 0 {
		return fmt.Errorf("broker refused connection (code %d)", code)
	}
	if err := c.write(Subscribe(1, c.Topic, 1)); err != nil {
		return err
	}
	c.Log.Info("mqtt connected", "addr", c.Addr, "topic", c.Topic)
	if c.OnConnect != nil {
		c.OnConnect()
	}

	keepAlive := time.Duration(c.Options.KeepAliveSec) * time.Second
	if keepAlive <= 0 {
		keepAlive = 30 * time.Second // a zero ticker interval would panic
	}
	sessCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	go func() { // PINGREQ at half the keep-alive interval
		t := time.NewTicker(keepAlive / 2)
		defer t.Stop()
		for {
			select {
			case <-sessCtx.Done():
				return
			case <-t.C:
				if err := c.write(PingReq()); err != nil {
					cancel()
					return
				}
			}
		}
	}()
	go func() { // unblock the reader on shutdown
		<-sessCtx.Done()
		_ = c.write(Disconnect())
		_ = conn.Close()
	}()

	for {
		// The broker must send something (PINGRESP at least) within 1.5 × keep-alive (§3.1.2.10).
		_ = conn.SetReadDeadline(time.Now().Add(keepAlive + keepAlive/2))
		p, err := Read(r)
		if err != nil {
			if errors.Is(err, net.ErrClosed) && ctx.Err() != nil {
				return nil
			}
			return fmt.Errorf("read: %w", err)
		}
		switch p.Type {
		case PUBLISH:
			m, err := ParsePublish(p)
			if err != nil {
				c.Log.Warn("dropping malformed publish", "err", err)
				continue
			}
			if herr := c.Handler(sessCtx, m); herr != nil {
				c.Log.Warn("handler error", "topic", m.Topic, "err", herr)
			}
			if m.QoS == 1 {
				if err := c.write(PubAck(m.PacketID)); err != nil {
					return err
				}
			}
		case SUBACK:
			if len(p.Body) >= 3 && p.Body[2] == 0x80 {
				return errors.New("subscription rejected by broker")
			}
		case PINGRESP, PUBACK:
		default:
			c.Log.Debug("ignoring packet", "type", p.Type)
		}
	}
}
