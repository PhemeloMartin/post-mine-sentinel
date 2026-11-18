// Package config loads twelve-factor settings from the environment and fails fast on
// missing or malformed values (a misconfigured ingest service must not start half-working).
package config

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"time"

	"github.com/PhemeloMartin/post-mine-sentinel/services/ingest/internal/pipeline"
)

type Config struct {
	MQTTAddr     string
	MQTTUser     string
	MQTTPassword string
	MQTTTopic    string
	ClientID     string
	APIURL       string
	APIToken     string
	DeadLetter   string
	MetricsAddr  string
	Grace        time.Duration
	Sites        map[uint16]pipeline.Site
}

type siteEntry struct {
	SiteID uint16 `json:"site_id"`
	MineID string `json:"mine_id"`
	KeyHex string `json:"key_hex"`
}

func get(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

// Load reads SENTINEL_INGEST_* variables. Site keys come from a JSON file mounted from
// Azure Key Vault via the Secrets Store CSI driver (never baked into images).
func Load() (Config, error) {
	c := Config{
		MQTTAddr:     get("SENTINEL_INGEST_MQTT_ADDR", "localhost:1883"),
		MQTTUser:     get("SENTINEL_INGEST_MQTT_USER", ""),
		MQTTPassword: get("SENTINEL_INGEST_MQTT_PASSWORD", ""),
		MQTTTopic:    get("SENTINEL_INGEST_MQTT_TOPIC", "silknet/+/up"),
		ClientID:     get("SENTINEL_INGEST_CLIENT_ID", "sentinel-ingest"),
		APIURL:       get("SENTINEL_INGEST_API_URL", "http://localhost:8000/api/v1/ingest/windows"),
		APIToken:     get("SENTINEL_INGEST_TOKEN", ""),
		DeadLetter:   get("SENTINEL_INGEST_DLQ", "dead-letter.jsonl"),
		MetricsAddr:  get("SENTINEL_INGEST_METRICS_ADDR", ":9102"),
	}
	graceMs, err := strconv.Atoi(get("SENTINEL_INGEST_GRACE_MS", "2500"))
	if err != nil || graceMs < 100 || graceMs > 30_000 {
		return c, fmt.Errorf("SENTINEL_INGEST_GRACE_MS must be 100–30000, got %q", get("SENTINEL_INGEST_GRACE_MS", ""))
	}
	c.Grace = time.Duration(graceMs) * time.Millisecond
	if c.APIToken == "" {
		return c, errors.New("SENTINEL_INGEST_TOKEN is required")
	}
	path := get("SENTINEL_INGEST_SITES_FILE", "sites.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return c, fmt.Errorf("read site keys %s: %w", path, err)
	}
	var entries []siteEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return c, fmt.Errorf("parse site keys: %w", err)
	}
	c.Sites = make(map[uint16]pipeline.Site, len(entries))
	for _, e := range entries {
		key, err := hex.DecodeString(e.KeyHex)
		if err != nil || len(key) != 16 {
			return c, fmt.Errorf("site %d: key must be 32 hex characters", e.SiteID)
		}
		if _, dup := c.Sites[e.SiteID]; dup {
			return c, fmt.Errorf("duplicate site_id %d", e.SiteID)
		}
		c.Sites[e.SiteID] = pipeline.Site{MineID: e.MineID, Key: key}
	}
	if len(c.Sites) == 0 {
		return c, errors.New("no sites configured")
	}
	return c, nil
}
