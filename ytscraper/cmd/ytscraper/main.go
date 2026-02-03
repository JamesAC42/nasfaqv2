package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"

	"nasfaqv2/brokerbot/ytscraper/internal/db"
	"nasfaqv2/brokerbot/ytscraper/internal/livestreams"
	"nasfaqv2/brokerbot/ytscraper/internal/youtube"
)

type Config struct {
	DatabaseURL      string
	RedisURL         string
	RedisPassword    string
	YouTubeAPIKey    string
	ScrapeAtUTCHour  int
	ScrapeAtUTCMin   int
	RequestDelayMS   int
	PerChannelTimout time.Duration

	LivePollInterval   time.Duration
	LiveMaxResults     int
	UpcomingMaxResults int
	EnableLivePoll     bool
	QuotaDailyLimit    int
	UploadsLookback    int
	LogYTStats         bool
}

func main() {
	// Load .env automatically (if present). Real environment variables still override.
	// Optional override: ENV_FILE=path/to/.env
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

	cfg := mustLoadConfig()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	yt := youtube.New(cfg.YouTubeAPIKey)

	rdb, err := newRedisClient(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer func() { _ = rdb.Close() }()
	liveStore := &livestreams.RedisStore{Client: rdb}

	// Run immediately at startup.
	log.Printf("scrape: running immediately on startup")
	if err := scrapeOnce(ctx, pool, yt, cfg); err != nil {
		log.Printf("scrape: startup run failed: %v", err)
	}

	// Livestream polling loop (every N minutes).
	if cfg.EnableLivePoll {
		go pollLivestreamsLoop(ctx, pool, yt, liveStore, cfg)
	} else {
		log.Printf("livestreams: polling disabled via LIVE_POLL_ENABLED")
	}

	// Then run once per day at configured UTC time.
	for {
		next := nextDailyRunUTC(time.Now(), cfg.ScrapeAtUTCHour, cfg.ScrapeAtUTCMin)
		wait := time.Until(next)
		log.Printf("scrape: next run scheduled at %s (in %s)", next.UTC().Format(time.RFC3339), wait.Round(time.Second))

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			log.Printf("shutdown: %v", ctx.Err())
			return
		case <-timer.C:
		}

		log.Printf("scrape: starting scheduled run")
		if err := scrapeOnce(ctx, pool, yt, cfg); err != nil {
			log.Printf("scrape: scheduled run failed: %v", err)
		}
	}
}

func pollLivestreamsLoop(ctx context.Context, pool *pgxpool.Pool, yt *youtube.Client, store *livestreams.RedisStore, cfg Config) {
	// Run immediately, then on an interval.
	run := func() {
		if err := pollLivestreamsOnce(ctx, pool, yt, store, cfg); err != nil {
			log.Printf("livestreams: poll failed: %v", err)
		}
	}
	log.Printf("livestreams: polling enabled (interval=%s)", cfg.LivePollInterval)
	run()

	t := time.NewTicker(cfg.LivePollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			run()
		}
	}
}

func pollLivestreamsOnce(ctx context.Context, pool *pgxpool.Pool, yt *youtube.Client, store *livestreams.RedisStore, cfg Config) error {
	channels, err := db.ListActiveChannels(ctx, pool)
	if err != nil {
		return err
	}
	if len(channels) == 0 {
		return nil
	}

	now := time.Now().UTC()
	var fail int

	for i, ch := range channels {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		cctx, cancel := context.WithTimeout(ctx, cfg.PerChannelTimout)

		liveIDs, err := yt.SearchEventVideoIDs(cctx, ch.YouTubeChannelID, "live", cfg.LiveMaxResults)
		if err != nil {
			cancel()
			fail++
			log.Printf("livestreams: channel=%s live search error: %v", ch.YouTubeChannelID, err)
			continue
		}

		upcomingIDs, err := yt.SearchEventVideoIDs(cctx, ch.YouTubeChannelID, "upcoming", cfg.UpcomingMaxResults)
		cancel()
		if err != nil {
			fail++
			log.Printf("livestreams: channel=%s upcoming search error: %v", ch.YouTubeChannelID, err)
			continue
		}

		combined := append([]string{}, liveIDs...)
		combined = append(combined, upcomingIDs...)

		vidCtx, vidCancel := context.WithTimeout(ctx, cfg.PerChannelTimout)
		videos, err := yt.FetchVideos(vidCtx, combined)
		vidCancel()
		if err != nil {
			fail++
			log.Printf("livestreams: channel=%s videos.list error: %v", ch.YouTubeChannelID, err)
			continue
		}

		liveSet := make(map[string]struct{}, len(liveIDs))
		for _, id := range liveIDs {
			liveSet[id] = struct{}{}
		}

		var icon *string
		if ch.Icon != nil && *ch.Icon != "" {
			icon = ch.Icon
		}

		out := make([]livestreams.Stream, 0, len(videos))
		for _, v := range videos {
			status := livestreams.StatusUpcoming
			if _, ok := liveSet[v.VideoID]; ok {
				status = livestreams.StatusLive
			}

			st := livestreams.Stream{
				VideoID:      v.VideoID,
				VideoURL:     "https://www.youtube.com/watch?v=" + v.VideoID,
				Status:       status,
				Title:        v.Title,
				ThumbnailURL: v.ThumbnailURL,
				ChannelID:    ch.YouTubeChannelID,
				ChannelName:  ch.Name,
				ChannelIcon:  icon,
				UpdatedAt:    now,
			}

			st.ScheduledStartTime = v.ScheduledStartTime
			st.ActualStartTime = v.ActualStartTime
			st.ConcurrentViewers = v.ConcurrentViewers

			out = append(out, st)
		}

		if err := store.UpsertChannelStreams(ctx, ch.YouTubeChannelID, out); err != nil {
			fail++
			log.Printf("livestreams: channel=%s redis error: %v", ch.YouTubeChannelID, err)
			continue
		}

		log.Printf("livestreams: ok (%d/%d) channel=%s live=%d upcoming=%d", i+1, len(channels), ch.YouTubeChannelID, len(liveIDs), len(upcomingIDs))

		if cfg.RequestDelayMS > 0 && i < len(channels)-1 {
			time.Sleep(time.Duration(cfg.RequestDelayMS) * time.Millisecond)
		}
	}

	if fail > 0 {
		return fmt.Errorf("livestream poll completed with %d/%d channel failures", fail, len(channels))
	}
	return nil
}

func scrapeOnce(ctx context.Context, pool *pgxpool.Pool, yt *youtube.Client, cfg Config) error {
	day := utcMidnight(time.Now())
	scrapedAt := time.Now().UTC()

	channels, err := db.ListActiveChannels(ctx, pool)
	if err != nil {
		return err
	}
	if len(channels) == 0 {
		log.Printf("scrape: no active channels in yt.youtube_channels")
		return nil
	}

	existing, err := db.ExistingDailyStatsChannelIDs(ctx, pool, day)
	if err != nil {
		return err
	}

	var failCount int
	toProcess := make([]db.Channel, 0, len(channels))
	for _, ch := range channels {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		if _, ok := existing[ch.YouTubeChannelID]; ok {
			log.Printf("scrape: skip channel=%s (already have stats for %s)", ch.YouTubeChannelID, day.Format("2006-01-02"))
			continue
		}
		toProcess = append(toProcess, ch)
	}

	if len(toProcess) == 0 {
		log.Printf("scrape: all active channels already have stats for %s", day.Format("2006-01-02"))
		return nil
	}

	if cfg.QuotaDailyLimit > 0 {
		log.Printf("scrape: quota limit configured at %d units/day", cfg.QuotaDailyLimit)
	}

	total := len(toProcess)
	var channelsListCalls int
	var playlistItemsCalls int
	var videosListCalls int
	for batchStart := 0; batchStart < total; batchStart += 50 {
		batchEnd := batchStart + 50
		if batchEnd > total {
			batchEnd = total
		}
		batch := toProcess[batchStart:batchEnd]
		log.Printf("scrape: batch %d-%d of %d channels", batchStart+1, batchEnd, total)
		ids := make([]string, 0, len(batch))
		for _, ch := range batch {
			ids = append(ids, ch.YouTubeChannelID)
		}

		channelsListCalls++
		bctx, bcancel := context.WithTimeout(ctx, cfg.PerChannelTimout)
		infoMap, err := yt.FetchChannelInfos(bctx, ids)
		bcancel()
		if err != nil {
			failCount += len(batch)
			log.Printf("scrape: channel batch stats error: %v", err)
			continue
		}

		for i, ch := range batch {
			if ctx.Err() != nil {
				return ctx.Err()
			}

			info, ok := infoMap[ch.YouTubeChannelID]
			if !ok {
				failCount++
				log.Printf("scrape: channel=%s stats missing in batch response", ch.YouTubeChannelID)
				continue
			}

			playlistItemsCalls++
			videosListCalls++
			cctx, cancel := context.WithTimeout(ctx, cfg.PerChannelTimout)
			lastUpload, lastLive, err := yt.FetchRecentFromUploads(cctx, info.UploadsPlaylistID, cfg.UploadsLookback)
			cancel()
			if err != nil {
				failCount++
				log.Printf("scrape: channel=%s recent error: %v", ch.YouTubeChannelID, err)
				continue
			}

			var lastUploadAt *time.Time
			var lastUploadVideoID *string
			if lastUpload != nil {
				t := lastUpload.PublishedAt.UTC()
				lastUploadAt = &t
				id := lastUpload.VideoID
				lastUploadVideoID = &id
			}
			var lastLiveAt *time.Time
			var lastLiveVideoID *string
			if lastLive != nil {
				t := lastLive.PublishedAt.UTC()
				lastLiveAt = &t
				id := lastLive.VideoID
				lastLiveVideoID = &id
			}

			row := db.DailyStats{
				Time:             day,
				YouTubeChannelID: ch.YouTubeChannelID,

				SubscriberCount:       info.Stats.SubscriberCount,
				ViewCount:             info.Stats.ViewCount,
				VideoCount:            info.Stats.VideoCount,
				HiddenSubscriberCount: info.Stats.HiddenSubscriberCount,

				LastUploadAt:      lastUploadAt,
				LastUploadVideoID: lastUploadVideoID,
				LastLiveAt:        lastLiveAt,
				LastLiveVideoID:   lastLiveVideoID,

				Country:   info.Stats.Country,
				ScrapedAt: scrapedAt,
			}

			if err := db.UpsertDailyStats(ctx, pool, row); err != nil {
				failCount++
				log.Printf("scrape: channel=%s upsert error: %v", ch.YouTubeChannelID, err)
				continue
			}

			if cfg.LogYTStats {
				log.Printf(
					"scrape: channel=%s stats subs=%v views=%v videos=%v last_upload=%v last_live=%v",
					ch.YouTubeChannelID,
					info.Stats.SubscriberCount,
					info.Stats.ViewCount,
					info.Stats.VideoCount,
					lastUploadVideoID,
					lastLiveVideoID,
				)
			}

			log.Printf("scrape: ok (%d/%d) channel=%s subs=%v views=%v videos=%v", batchStart+i+1, total, ch.YouTubeChannelID, info.Stats.SubscriberCount, info.Stats.ViewCount, info.Stats.VideoCount)

			if cfg.RequestDelayMS > 0 && (batchStart+i) < total-1 {
				time.Sleep(time.Duration(cfg.RequestDelayMS) * time.Millisecond)
			}
		}
	}

	if failCount > 0 {
		return fmt.Errorf("scrape completed with %d/%d channel failures", failCount, len(channels))
	}
	estimatedUnits := channelsListCalls + playlistItemsCalls + videosListCalls
	log.Printf("scrape: estimated quota used this run=%d units (channels.list=%d, playlistItems.list=%d, videos.list=%d)", estimatedUnits, channelsListCalls, playlistItemsCalls, videosListCalls)
	return nil
}

func utcMidnight(t time.Time) time.Time {
	u := t.UTC()
	return time.Date(u.Year(), u.Month(), u.Day(), 0, 0, 0, 0, time.UTC)
}

func nextDailyRunUTC(now time.Time, hour, min int) time.Time {
	n := now.UTC()
	cand := time.Date(n.Year(), n.Month(), n.Day(), hour, min, 0, 0, time.UTC)
	if !cand.After(n) {
		cand = cand.Add(24 * time.Hour)
	}
	return cand
}

func mustLoadConfig() Config {
	getInt := func(key string, def int) int {
		v := os.Getenv(key)
		if v == "" {
			return def
		}
		i, err := strconv.Atoi(v)
		if err != nil {
			log.Fatalf("invalid %s=%q: %v", key, v, err)
		}
		return i
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}
	apiKey := os.Getenv("YOUTUBE_API_KEY")
	if apiKey == "" {
		log.Fatalf("missing YOUTUBE_API_KEY")
	}
	redisURL := os.Getenv("REDIS_URL")
	if redisURL == "" {
		log.Fatalf("missing REDIS_URL")
	}
	redisPassword := os.Getenv("REDIS_PASSWORD")

	return Config{
		DatabaseURL:        dbURL,
		RedisURL:           redisURL,
		RedisPassword:      redisPassword,
		YouTubeAPIKey:      apiKey,
		ScrapeAtUTCHour:    getInt("SCRAPE_AT_UTC_HOUR", 3),
		ScrapeAtUTCMin:     getInt("SCRAPE_AT_UTC_MIN", 0),
		RequestDelayMS:     getInt("REQUEST_DELAY_MS", 150),
		PerChannelTimout:   20 * time.Second,
		LivePollInterval:   time.Duration(getInt("LIVE_POLL_SECONDS", 300)) * time.Second,
		LiveMaxResults:     getInt("LIVE_MAX_RESULTS", 3),
		UpcomingMaxResults: getInt("UPCOMING_MAX_RESULTS", 3),
		EnableLivePoll:     strings.ToLower(os.Getenv("LIVE_POLL_ENABLED")) != "false",
		QuotaDailyLimit:    getInt("YOUTUBE_DAILY_QUOTA_LIMIT", 0),
		UploadsLookback:    getInt("UPLOADS_LOOKBACK", 25),
		LogYTStats:         strings.ToLower(os.Getenv("LOG_YT_STATS")) == "true",
	}
}

func newRedisClient(redisURL, redisPassword string) (*redis.Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
	}
	if redisPassword != "" {
		opt.Password = redisPassword
	}
	rdb := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping: %w", err)
	}
	return rdb, nil
}
