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
	dryRun := flag.Bool("dry-run", false, "log sessions that would be finalized without updating the database")
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

	sessions, err := db.ListLivestreamSessionsByStatusWithViewerBuckets(ctx, pool, "upcoming")
	if err != nil {
		log.Fatalf("list stuck upcoming sessions: %v", err)
	}
	if len(sessions) == 0 {
		log.Printf("finalize: no upcoming livestream sessions with viewer buckets found")
		return
	}

	log.Printf("finalize: inspecting %d upcoming livestream session(s) with viewer buckets", len(sessions))

	var checked int
	var finished int
	var finalized int
	for _, batch := range chunkSessions(sessions, 50) {
		if ctx.Err() != nil {
			log.Fatalf("finalize canceled: %v", ctx.Err())
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

			agg, err := db.GetSessionAggregatesFromBuckets(ctx, pool, s.VideoID)
			if err != nil {
				log.Printf("finalize: aggregate lookup failed video_id=%s: %v", s.VideoID, err)
				continue
			}
			if agg.AvgViewers == nil || agg.MaxViewers == nil {
				log.Printf("finalize: skipped video_id=%s because bucket aggregates are incomplete", s.VideoID)
				continue
			}

			maxViewersAt, err := db.GetMaxViewersAtFromBuckets(ctx, pool, s.VideoID)
			if err != nil {
				log.Printf("finalize: max_viewers_at lookup failed video_id=%s: %v", s.VideoID, err)
				continue
			}

			finished++
			title := strings.TrimSpace(valueOrEmpty(s.VideoTitle))
			if title == "" {
				title = "(untitled)"
			}
			endedAt := v.ActualEndTime.UTC()

			if *dryRun {
				log.Printf(
					"finalize: would end video_id=%s channel=%s ended_at=%s avg=%d max=%d title=%q",
					s.VideoID,
					s.YouTubeChannelID,
					endedAt.Format(time.RFC3339),
					*agg.AvgViewers,
					*agg.MaxViewers,
					title,
				)
				continue
			}

			updated, err := db.EndLivestreamSession(ctx, pool, s.VideoID, endedAt, agg.AvgViewers, agg.MaxViewers, maxViewersAt)
			if err != nil {
				log.Printf("finalize: end session failed video_id=%s: %v", s.VideoID, err)
				continue
			}
			if !updated {
				log.Printf("finalize: skipped video_id=%s because it was already updated", s.VideoID)
				continue
			}

			if err := db.UpsertChannelLivestreamStatsAfterEnd(ctx, pool, s.YouTubeChannelID, *agg.AvgViewers, *agg.MaxViewers); err != nil {
				log.Printf("finalize: channel stats update failed video_id=%s: %v", s.VideoID, err)
				continue
			}

			finalized++
			log.Printf(
				"finalize: ended video_id=%s channel=%s ended_at=%s avg=%d max=%d title=%q",
				s.VideoID,
				s.YouTubeChannelID,
				endedAt.Format(time.RFC3339),
				*agg.AvgViewers,
				*agg.MaxViewers,
				title,
			)
		}
	}

	if *dryRun {
		log.Printf("finalize: checked=%d finished_candidates=%d", checked, finished)
		return
	}
	log.Printf("finalize: checked=%d finished_candidates=%d finalized=%d", checked, finished, finalized)
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
