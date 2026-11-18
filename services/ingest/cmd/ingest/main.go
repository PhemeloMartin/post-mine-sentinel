// Command ingest bridges anchor gateways (MQTT) to the Sentinel fusion API.
//
//	gateway --MQTT/TLS--> ingest --HTTPS--> api /ingest/windows --> Bayesian fusion --> alerts
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/config"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/metrics"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/mqtt"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/pipeline"
	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/sink"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	cfg, err := config.Load()
	if err != nil {
		log.Error("invalid configuration", "err", err)
		os.Exit(2)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	api := &sink.API{URL: cfg.APIURL, Token: cfg.APIToken, MaxAttempts: 5, DeadLetter: cfg.DeadLetter, Log: log,
		Client: &http.Client{Timeout: 10 * time.Second}}
	pipe := pipeline.New(pipeline.Config{Sites: cfg.Sites, Grace: cfg.Grace}, api, log)

	var ready atomic.Bool
	mux := http.NewServeMux()
	mux.Handle("/metrics", metrics.Handler())
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if !ready.Load() {
			http.Error(w, "mqtt not connected", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})
	srv := &http.Server{Addr: cfg.MetricsAddr, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("metrics server failed", "err", err)
			stop()
		}
	}()

	flushDone := make(chan struct{})
	go func() {
		pipe.Run(ctx, 250*time.Millisecond)
		close(flushDone)
	}()

	client := &mqtt.Client{
		Addr:      cfg.MQTTAddr,
		Options:   mqtt.ConnectOptions{ClientID: cfg.ClientID, Username: cfg.MQTTUser, Password: cfg.MQTTPassword, KeepAliveSec: 30, CleanSession: false},
		Topic:     cfg.MQTTTopic,
		Log:       log,
		OnConnect: func() { ready.Store(true) },
		Handler: func(_ context.Context, m mqtt.Message) error {
			// Topic: silknet/<mine-id>/up — cross-checked against the authenticated site id.
			parts := strings.Split(m.Topic, "/")
			mine := ""
			if len(parts) == 3 {
				mine = parts[1]
			}
			return pipe.HandleUplink(mine, m.Payload)
		},
	}
	log.Info("ingest starting", "mqtt", cfg.MQTTAddr, "sites", len(cfg.Sites), "api", cfg.APIURL)
	if err := client.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Error("mqtt client stopped", "err", err)
	}
	ready.Store(false)

	// Graceful shutdown: flush pending windows, then stop the metrics server.
	<-flushDone
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdownCtx)
	log.Info("ingest stopped cleanly")
}
