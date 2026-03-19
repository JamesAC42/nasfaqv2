package main

import (
	"context"
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/youtube"
)

func main() {
	dryRun := flag.Bool("dry-run", false, "log sessions that would be deleted without deleting them")
	flag.Parse()

	if envFile := os.Getenv("ENV_FILE"); envFile != "" {
		if err := godotenv.Overload(envFile); err != nil {
			log.Printf("env: failed to load ENV_FILE=%q: %v", envFile, err)
		} else {
			log.Printf("env: loaded %s", envFile)
		}
	} else {
		if err := godotenv.Load(); err == nil {
			log.Printf("env: loaded .env")
		}
	}

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

	yt := youtube.New(apiKey)

	sessions, err := db.ListLivestreamSessionsByStatus(ctx, pool, "upcoming")
	if err != nil {
		log.Fatalf("list upcoming sessions: %v", err)
	}
	if len(sessions) == 0 {
		log.Printf("cleanup: no upcoming livestream sessions found")
		return
	}

	log.Printf("cleanup: inspecting %d upcoming livestream session(s)", len(sessions))

	var checked int
	var finished int
	var deleted int
	for _, batch := range chunkSessions(sessions, 50) {
		if ctx.Err() != nil {
			log.Fatalf("cleanup canceled: %v", ctx.Err())
		}

		videoIDs := make([]string, 0, len(batch))
		for _, s := range batch {
			videoIDs = append(videoIDs, s.VideoID)
		}

		reqCtx, reqCancel := context.WithTimeout(ctx, 45*time.Second)
		videos, err := yt.FetchVideos(reqCtx, videoIDs)
		reqCancel()
		if err != nil {
			log.Fatalf("fetch videos: %v", err)
		}

		videoMap := make(map[string]youtube.Video, len(videos))
		for _, v := range videos {
			videoMap[v.VideoID] = v
		}

		for _, s := range batch {
			checked++
			v, ok := videoMap[s.VideoID]
			if !ok || v.ActualEndTime == nil {
				continue
			}

			finished++
			title := strings.TrimSpace(valueOrEmpty(s.VideoTitle))
			if title == "" {
				title = "(untitled)"
			}

			if *dryRun {
				log.Printf("cleanup: would delete video_id=%s channel=%s ended_at=%s title=%q", s.VideoID, s.YouTubeChannelID, v.ActualEndTime.UTC().Format(time.RFC3339), title)
				continue
			}

			removed, err := db.DeleteLivestreamSessionIfNoBuckets(ctx, pool, s.VideoID)
			if err != nil {
				log.Printf("cleanup: delete failed video_id=%s: %v", s.VideoID, err)
				continue
			}
			if !removed {
				log.Printf("cleanup: skipped video_id=%s because it no longer matches or has viewer buckets", s.VideoID)
				continue
			}

			deleted++
			log.Printf("cleanup: deleted video_id=%s channel=%s ended_at=%s title=%q", s.VideoID, s.YouTubeChannelID, v.ActualEndTime.UTC().Format(time.RFC3339), title)
		}
	}

	if *dryRun {
		log.Printf("cleanup: checked=%d finished_candidates=%d", checked, finished)
		return
	}
	log.Printf("cleanup: checked=%d finished=%d deleted=%d", checked, finished, deleted)
}

func chunkSessions(in []db.LivestreamSessionSummary, size int) [][]db.LivestreamSessionSummary {
	if size <= 0 {
		size = 50
	}
	out := make([][]db.LivestreamSessionSummary, 0, (len(in)+size-1)/size)
	for start := 0; start < len(in); start += size {
		end := start + size
		if end > len(in) {
			end = len(in)
		}
		out = append(out, in[start:end])
	}
	return out
}

func valueOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
