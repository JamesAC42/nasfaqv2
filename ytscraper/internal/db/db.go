package db

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Channel struct {
	YouTubeChannelID string
	Name             string
	Symbol           *string
	Icon             *string
}

type DailyStats struct {
	Time             time.Time
	YouTubeChannelID string

	SubscriberCount       *int64
	ViewCount             *int64
	VideoCount            *int64
	HiddenSubscriberCount *bool

	LastUploadAt      *time.Time
	LastUploadVideoID *string
	LastLiveAt        *time.Time
	LastLiveVideoID   *string

	Country *string

	ScrapedAt time.Time
}

func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	normalizedURL, schema := normalizeDatabaseURL(databaseURL)
	cfg, err := pgxpool.ParseConfig(normalizedURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	if schema != "" {
		if cfg.ConnConfig.RuntimeParams == nil {
			cfg.ConnConfig.RuntimeParams = map[string]string{}
		}
		cfg.ConnConfig.RuntimeParams["search_path"] = schema
	}
	// We intentionally use the SimpleProtocol so we can run multi-statement schema SQL.
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	return p, nil
}

func normalizeDatabaseURL(databaseURL string) (string, string) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return databaseURL, ""
	}
	q := u.Query()
	schema := q.Get("schema")
	if schema == "" {
		return databaseURL, ""
	}
	q.Del("schema")
	u.RawQuery = q.Encode()
	return u.String(), schema
}

func ApplySchema(ctx context.Context, pool *pgxpool.Pool) error {
	if pool == nil {
		return fmt.Errorf("nil pool")
	}
	if _, err := pool.Exec(ctx, SchemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}

func ListActiveChannels(ctx context.Context, pool *pgxpool.Pool) ([]Channel, error) {
	rows, err := pool.Query(ctx, `
		SELECT youtube_channel_id, name, symbol, icon
		FROM yt.youtube_channels
		WHERE is_active = true
		ORDER BY name ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query active channels: %w", err)
	}
	defer rows.Close()

	var out []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.YouTubeChannelID, &c.Name, &c.Symbol, &c.Icon); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		out = append(out, c)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate channels: %w", rows.Err())
	}
	return out, nil
}

func UpsertDailyStats(ctx context.Context, pool *pgxpool.Pool, s DailyStats) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO yt.youtube_channel_daily_stats (
			time,
			youtube_channel_id,
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
		) VALUES (
			$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12
		)
		ON CONFLICT (youtube_channel_id, time)
		DO UPDATE SET
			subscriber_count = EXCLUDED.subscriber_count,
			view_count = EXCLUDED.view_count,
			video_count = EXCLUDED.video_count,
			hidden_subscriber_count = EXCLUDED.hidden_subscriber_count,
			last_upload_at = EXCLUDED.last_upload_at,
			last_upload_video_id = EXCLUDED.last_upload_video_id,
			last_live_at = EXCLUDED.last_live_at,
			last_live_video_id = EXCLUDED.last_live_video_id,
			country = EXCLUDED.country,
			scraped_at = EXCLUDED.scraped_at
	`, s.Time, s.YouTubeChannelID, s.SubscriberCount, s.ViewCount, s.VideoCount, s.HiddenSubscriberCount,
		s.LastUploadAt, s.LastUploadVideoID, s.LastLiveAt, s.LastLiveVideoID, s.Country, s.ScrapedAt)
	if err != nil {
		return fmt.Errorf("upsert stats (channel=%s time=%s): %w", s.YouTubeChannelID, s.Time.Format(time.RFC3339), err)
	}
	return nil
}

func UpsertChannel(ctx context.Context, pool *pgxpool.Pool, c Channel) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO yt.youtube_channels (
			youtube_channel_id,
			name,
			symbol,
			icon,
			is_active,
			updated_at
		) VALUES ($1,$2,$3,$4,TRUE,now())
		ON CONFLICT (youtube_channel_id)
		DO UPDATE SET
			name = EXCLUDED.name,
			symbol = EXCLUDED.symbol,
			icon = EXCLUDED.icon,
			is_active = TRUE,
			updated_at = now()
	`, c.YouTubeChannelID, c.Name, c.Symbol, c.Icon)
	if err != nil {
		return fmt.Errorf("upsert channel (id=%s): %w", c.YouTubeChannelID, err)
	}
	return nil
}

func ExistingDailyStatsChannelIDs(ctx context.Context, pool *pgxpool.Pool, day time.Time) (map[string]struct{}, error) {
	rows, err := pool.Query(ctx, `
		SELECT youtube_channel_id
		FROM yt.youtube_channel_daily_stats
		WHERE time = $1
	`, day)
	if err != nil {
		return nil, fmt.Errorf("query existing daily stats ids: %w", err)
	}
	defer rows.Close()

	out := make(map[string]struct{})
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan existing id: %w", err)
		}
		out[id] = struct{}{}
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate existing ids: %w", rows.Err())
	}
	return out, nil
}
