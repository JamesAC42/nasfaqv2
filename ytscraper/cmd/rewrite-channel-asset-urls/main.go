package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"

	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
)

const (
	defaultCDNBaseURL = "https://images.nasfaq.biz"
	defaultAssetPrefix = "channel-assets"
)

func main() {
	var dryRun bool
	flag.BoolVar(&dryRun, "dry-run", false, "show the rewritten asset urls without updating the database")
	flag.Parse()

	loadEnv()

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}

	baseURL := normalizeBaseURL(os.Getenv("CHANNEL_ASSETS_PUBLIC_BASE_URL"))
	prefix := normalizePrefix(os.Getenv("CHANNEL_ASSETS_S3_PREFIX"))

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.NewPool(ctx, databaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	channels, err := db.ListChannelsForAssetBackfill(ctx, pool)
	if err != nil {
		log.Fatalf("list channels: %v", err)
	}
	if len(channels) == 0 {
		log.Printf("no channels found in yt.youtube_channels")
		return
	}

	var rewritten int
	var skipped int

	for _, ch := range channels {
		nextIconURL, iconChanged := rewriteStoredURL(ch.ChannelAssetIconURL, baseURL, prefix)
		nextBannerURL, bannerChanged := rewriteStoredURL(ch.ChannelAssetBannerURL, baseURL, prefix)

		if !iconChanged && !bannerChanged {
			skipped++
			continue
		}

		if dryRun {
			log.Printf(
				"dry-run channel=%s name=%q profile=%q banner=%q",
				ch.YouTubeChannelID,
				ch.NameShort,
				stringValue(nextIconURL),
				stringValue(nextBannerURL),
			)
		} else {
			if err := db.UpdateChannelAssetURLs(ctx, pool, ch.YouTubeChannelID, nextIconURL, nextBannerURL); err != nil {
				log.Fatalf("update channel=%s: %v", ch.YouTubeChannelID, err)
			}
			log.Printf("rewrote channel=%s name=%q", ch.YouTubeChannelID, ch.NameShort)
		}

		rewritten++
	}

	if dryRun {
		log.Printf("dry run complete: would rewrite %d channel(s), skipped %d", rewritten, skipped)
		return
	}
	log.Printf("rewrite complete: updated %d channel(s), skipped %d", rewritten, skipped)
}

func loadEnv() {
	if envFile := os.Getenv("ENV_FILE"); envFile != "" {
		if err := godotenv.Overload(envFile); err != nil {
			log.Printf("env: failed to load ENV_FILE=%q: %v", envFile, err)
		} else {
			log.Printf("env: loaded %s", envFile)
		}
		return
	}
	if err := godotenv.Load(); err == nil {
		log.Printf("env: loaded .env")
	}
}

func normalizeBaseURL(raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return defaultCDNBaseURL
	}
	return trimmed
}

func normalizePrefix(raw string) string {
	trimmed := strings.Trim(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return defaultAssetPrefix
	}
	return trimmed
}

func rewriteStoredURL(raw *string, baseURL string, prefix string) (*string, bool) {
	current := strings.TrimSpace(stringValue(raw))
	if current == "" {
		return nil, false
	}

	filename, ok := extractAssetFilename(current)
	if !ok {
		return nil, false
	}

	next := fmt.Sprintf("%s/%s/%s", baseURL, prefix, escapePathSegment(filename))
	if next == current {
		return nil, false
	}
	return &next, true
}

func extractAssetFilename(raw string) (string, bool) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", false
	}

	filename := path.Base(parsed.Path)
	filename = strings.TrimSpace(filename)
	if filename == "" || filename == "." || filename == "/" {
		return "", false
	}
	unescaped, err := url.PathUnescape(filename)
	if err == nil && strings.TrimSpace(unescaped) != "" {
		filename = unescaped
	}
	return filename, true
}

func escapePathSegment(segment string) string {
	return url.PathEscape(strings.TrimSpace(segment))
}

func stringValue(v *string) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}
