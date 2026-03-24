package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"sort"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
)

type statsRow struct {
	YouTubeChannelID       string
	SnapshotDate           time.Time
	SubscriberCount        *int64
	ViewCount              *int64
	VideoCount             *int64
	HiddenSubscriberCount  *bool
	LastUploadAt           *time.Time
	LastUploadVideoID      *string
	LastLiveAt             *time.Time
	LastLiveVideoID        *string
	Country                *string
	ScrapedAt              time.Time
}

func main() {
	var (
		activeOnly = flag.Bool("active-only", true, "limit to active channels")
		dryRun     = flag.Bool("dry-run", false, "log inserts without writing")
		fromFlag   = flag.String("from", "", "optional YYYY-MM-DD lower bound")
		toFlag     = flag.String("to", "", "optional YYYY-MM-DD upper bound")
	)
	flag.Parse()

	loadEnv()

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.NewPool(ctx, dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	from, err := optionalDate(*fromFlag)
	if err != nil {
		log.Fatalf("parse --from: %v", err)
	}
	to, err := optionalDate(*toFlag)
	if err != nil {
		log.Fatalf("parse --to: %v", err)
	}

	channelIDs, err := listTargetChannels(ctx, pool, *activeOnly)
	if err != nil {
		log.Fatalf("list target channels: %v", err)
	}
	if len(channelIDs) == 0 {
		log.Fatalf("no target channels found")
	}

	globalMin, globalMax, err := getGlobalDateRange(ctx, pool, channelIDs, from, to)
	if err != nil {
		log.Fatalf("get date range: %v", err)
	}
	if globalMin.IsZero() || globalMax.IsZero() {
		log.Fatalf("no daily stats found for selected channels")
	}

	log.Printf("backfill range: %s -> %s (%d channels)", dateKey(globalMin), dateKey(globalMax), len(channelIDs))

	rowsByChannel, err := loadExistingPerDayRows(ctx, pool, channelIDs, globalMin, globalMax)
	if err != nil {
		log.Fatalf("load existing rows: %v", err)
	}

	var inserted int
	var channelMissing int

	for _, channelID := range channelIDs {
		existing := rowsByChannel[channelID]
		if len(existing) == 0 {
			log.Printf("skip channel=%s: no source rows in selected/global range", channelID)
			continue
		}

		missing, err := buildMissingRows(channelID, existing, globalMin, globalMax)
		if err != nil {
			log.Fatalf("build missing rows channel=%s: %v", channelID, err)
		}
		if len(missing) == 0 {
			continue
		}

		channelMissing += 1
		if *dryRun {
			log.Printf("channel=%s missing_days=%d (dry run)", channelID, len(missing))
			inserted += len(missing)
			continue
		}

		for _, row := range missing {
			if err := db.UpsertDailyStats(ctx, pool, toDailyStats(row)); err != nil {
				log.Fatalf("upsert missing row channel=%s date=%s: %v", channelID, dateKey(row.SnapshotDate), err)
			}
		}
		log.Printf("channel=%s inserted_missing_days=%d", channelID, len(missing))
		inserted += len(missing)
	}

	if *dryRun {
		log.Printf("dry run complete: would insert %d rows across %d channels", inserted, channelMissing)
		return
	}

	log.Printf("backfill complete: inserted %d rows across %d channels", inserted, channelMissing)
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

func optionalDate(value string) (time.Time, error) {
	if value == "" {
		return time.Time{}, nil
	}
	t, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func dateKey(t time.Time) string {
	return t.UTC().Format("2006-01-02")
}

func parseDateKey(value string) (time.Time, error) {
	t, err := time.Parse("2006-01-02", value)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func addDays(t time.Time, days int) time.Time {
	return t.AddDate(0, 0, days).UTC()
}

func listTargetChannels(ctx context.Context, pool *pgxpool.Pool, activeOnly bool) ([]string, error) {
	query := `
		SELECT youtube_channel_id
		FROM yt.youtube_channels
		WHERE ($1::boolean IS FALSE OR is_active = true)
		ORDER BY youtube_channel_id ASC
	`
	rows, err := pool.Query(ctx, query, activeOnly)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return out, nil
}

func getGlobalDateRange(ctx context.Context, pool *pgxpool.Pool, channelIDs []string, from, to time.Time) (time.Time, time.Time, error) {
	query := `
		SELECT
			MIN(time::date)::text AS min_date,
			MAX(time::date)::text AS max_date
		FROM yt.youtube_channel_daily_stats
		WHERE youtube_channel_id = ANY($1)
		  AND ($2::date IS NULL OR time::date >= $2::date)
		  AND ($3::date IS NULL OR time::date <= $3::date)
	`
	var minDate, maxDate *string
	err := pool.QueryRow(ctx, query, channelIDs, nullableDate(from), nullableDate(to)).Scan(&minDate, &maxDate)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	if minDate == nil || maxDate == nil {
		return time.Time{}, time.Time{}, nil
	}

	minParsed, err := parseDateKey(*minDate)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	maxParsed, err := parseDateKey(*maxDate)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	return minParsed, maxParsed, nil
}

func nullableDate(value time.Time) *time.Time {
	if value.IsZero() {
		return nil
	}
	v := value.UTC()
	return &v
}

func loadExistingPerDayRows(ctx context.Context, pool *pgxpool.Pool, channelIDs []string, from, to time.Time) (map[string][]statsRow, error) {
	query := `
		WITH ranked AS (
			SELECT DISTINCT ON (youtube_channel_id, time::date)
				youtube_channel_id,
				time::date AS snapshot_date,
				subscriber_count,
				view_count,
				video_count,
				hidden_subscriber_count,
				last_upload_at,
				last_upload_video_id,
				last_live_at,
				last_live_video_id,
				country,
				scraped_at
			FROM yt.youtube_channel_daily_stats
			WHERE youtube_channel_id = ANY($1)
			  AND time::date >= $2::date
			  AND time::date <= $3::date
			ORDER BY youtube_channel_id, time::date, time DESC
		)
		SELECT
			youtube_channel_id,
			snapshot_date::text,
			subscriber_count,
			view_count,
			video_count,
			hidden_subscriber_count,
			last_upload_at,
			last_upload_video_id,
			last_live_at,
			last_live_video_id,
			country,
			scraped_at
		FROM ranked
		ORDER BY youtube_channel_id ASC, snapshot_date ASC
	`
	rows, err := pool.Query(ctx, query, channelIDs, from, to)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string][]statsRow)
	for rows.Next() {
		var (
			channelID              string
			snapshotDateText       string
			row                    statsRow
		)
		if err := rows.Scan(
			&channelID,
			&snapshotDateText,
			&row.SubscriberCount,
			&row.ViewCount,
			&row.VideoCount,
			&row.HiddenSubscriberCount,
			&row.LastUploadAt,
			&row.LastUploadVideoID,
			&row.LastLiveAt,
			&row.LastLiveVideoID,
			&row.Country,
			&row.ScrapedAt,
		); err != nil {
			return nil, err
		}
		snapshotDate, err := parseDateKey(snapshotDateText)
		if err != nil {
			return nil, err
		}
		row.YouTubeChannelID = channelID
		row.SnapshotDate = snapshotDate
		out[channelID] = append(out[channelID], row)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return out, nil
}

func buildMissingRows(channelID string, existing []statsRow, globalMin, globalMax time.Time) ([]statsRow, error) {
	sort.Slice(existing, func(i, j int) bool {
		return existing[i].SnapshotDate.Before(existing[j].SnapshotDate)
	})

	byDate := make(map[string]statsRow, len(existing))
	for _, row := range existing {
		byDate[dateKey(row.SnapshotDate)] = row
	}

	firstRow := existing[0]
	lastKnown := firstRow
	var missing []statsRow

	for day := globalMin; !day.After(globalMax); day = addDays(day, 1) {
		key := dateKey(day)
		if row, ok := byDate[key]; ok {
			lastKnown = row
			continue
		}

		source := lastKnown
		if day.Before(firstRow.SnapshotDate) {
			source = firstRow
		}

		missing = append(missing, cloneForDate(channelID, source, day))
	}
	return missing, nil
}

func cloneForDate(channelID string, source statsRow, day time.Time) statsRow {
	return statsRow{
		YouTubeChannelID:      channelID,
		SnapshotDate:          day.UTC(),
		SubscriberCount:       source.SubscriberCount,
		ViewCount:             source.ViewCount,
		VideoCount:            source.VideoCount,
		HiddenSubscriberCount: source.HiddenSubscriberCount,
		LastUploadAt:          source.LastUploadAt,
		LastUploadVideoID:     source.LastUploadVideoID,
		LastLiveAt:            source.LastLiveAt,
		LastLiveVideoID:       source.LastLiveVideoID,
		Country:               source.Country,
		ScrapedAt:             source.ScrapedAt,
	}
}

func toDailyStats(row statsRow) db.DailyStats {
	insertTime := time.Date(row.SnapshotDate.Year(), row.SnapshotDate.Month(), row.SnapshotDate.Day(), 0, 0, 0, 0, time.UTC)
	return db.DailyStats{
		Time:                  insertTime,
		YouTubeChannelID:      row.YouTubeChannelID,
		SubscriberCount:       row.SubscriberCount,
		ViewCount:             row.ViewCount,
		VideoCount:            row.VideoCount,
		HiddenSubscriberCount: row.HiddenSubscriberCount,
		LastUploadAt:          row.LastUploadAt,
		LastUploadVideoID:     row.LastUploadVideoID,
		LastLiveAt:            row.LastLiveAt,
		LastLiveVideoID:       row.LastLiveVideoID,
		Country:               row.Country,
		ScrapedAt:             row.ScrapedAt,
	}
}

func init() {
	flag.Usage = func() {
		fmt.Fprintf(flag.CommandLine.Output(), "Backfill missing yt.youtube_channel_daily_stats rows by copying nearest known values per channel.\n\n")
		fmt.Fprintf(flag.CommandLine.Output(), "Behavior:\n")
		fmt.Fprintf(flag.CommandLine.Output(), "  - earliest day = earliest day observed across selected channels\n")
		fmt.Fprintf(flag.CommandLine.Output(), "  - before a channel's first observed day, copy backward from its first row\n")
		fmt.Fprintf(flag.CommandLine.Output(), "  - after that, carry forward the last known row across gaps\n\n")
		fmt.Fprintf(flag.CommandLine.Output(), "Usage:\n  %s [flags]\n\nFlags:\n", os.Args[0])
		flag.PrintDefaults()
	}
}
