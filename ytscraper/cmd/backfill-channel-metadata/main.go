package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/youtube"
)

func main() {
	var dryRun bool
	flag.BoolVar(&dryRun, "dry-run", false, "fetch channel metadata but do not write to the database")
	flag.Parse()

	loadEnv()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}
	apiKey := os.Getenv("YOUTUBE_API_KEY")
	if apiKey == "" {
		log.Fatalf("missing YOUTUBE_API_KEY")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.NewPool(ctx, dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	channels, err := db.ListChannels(ctx, pool)
	if err != nil {
		log.Fatalf("list channels: %v", err)
	}
	if len(channels) == 0 {
		log.Printf("no channels found in yt.youtube_channels")
		return
	}

	yt := youtube.New(apiKey)

	var updated int
	for start := 0; start < len(channels); start += 50 {
		end := start + 50
		if end > len(channels) {
			end = len(channels)
		}

		channelIDs := make([]string, 0, end-start)
		for _, ch := range channels[start:end] {
			channelIDs = append(channelIDs, ch.YouTubeChannelID)
		}

		metaByChannelID, err := yt.FetchChannelMetadataBatch(ctx, channelIDs)
		if err != nil {
			log.Fatalf("fetch channel metadata batch starting at %d: %v", start, err)
		}

		for _, ch := range channels[start:end] {
			meta, ok := metaByChannelID[ch.YouTubeChannelID]
			if !ok {
				log.Printf("skip channel=%s name=%q: metadata not returned by youtube api", ch.YouTubeChannelID, ch.NameShort)
				continue
			}

			if dryRun {
				log.Printf(
					"dry-run channel=%s name=%q icon_url=%q banner_url=%q description_len=%d",
					ch.YouTubeChannelID,
					ch.NameShort,
					stringValue(meta.IconURL),
					stringValue(meta.BannerURL),
					len(stringValue(meta.Description)),
				)
				updated++
				continue
			}

			if err := db.UpdateChannelYouTubeMetadata(ctx, pool, ch.YouTubeChannelID, meta.IconURL, meta.BannerURL, meta.Description); err != nil {
				log.Fatalf("update channel=%s: %v", ch.YouTubeChannelID, err)
			}
			updated++
			log.Printf("updated channel=%s name=%q", ch.YouTubeChannelID, ch.NameShort)
		}
	}

	if dryRun {
		log.Printf("dry run complete: fetched metadata for %d channels", updated)
		return
	}
	log.Printf("backfill complete: updated %d channels", updated)
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

func stringValue(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
