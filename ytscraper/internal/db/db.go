package db

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Channel struct {
	YouTubeChannelID   string
	NameShort          string
	NameEnglish        *string
	NameJapanese       *string
	Symbol             *string
	Icon               *string
	YouTubeIconURL     *string
	YouTubeBannerURL   *string
	YouTubeDescription *string
	Color              *string
	TwitterID          *string
	ProfileID          *string
	Birthday           *time.Time
	Height             *string
	Unit               *string
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

type LivestreamSessionSummary struct {
	YouTubeChannelID  string
	VideoID           string
	Status            string
	VideoTitle        *string
	ScheduledStartAt  *time.Time
	ActualStartAt     *time.Time
	FirstSeenAt       time.Time
	LastSeenAt        time.Time
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
		SELECT youtube_channel_id, name_short, symbol, icon, color
		FROM yt.youtube_channels
		WHERE is_active = true
		ORDER BY name_short ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query active channels: %w", err)
	}
	defer rows.Close()

	var out []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.YouTubeChannelID, &c.NameShort, &c.Symbol, &c.Icon, &c.Color); err != nil {
			return nil, fmt.Errorf("scan channel: %w", err)
		}
		out = append(out, c)
	}
	if rows.Err() != nil {
		return nil, fmt.Errorf("iterate channels: %w", rows.Err())
	}
	return out, nil
}

func ListChannels(ctx context.Context, pool *pgxpool.Pool) ([]Channel, error) {
	rows, err := pool.Query(ctx, `
		SELECT youtube_channel_id, name_short
		FROM yt.youtube_channels
		ORDER BY name_short ASC, youtube_channel_id ASC
	`)
	if err != nil {
		return nil, fmt.Errorf("query channels: %w", err)
	}
	defer rows.Close()

	var out []Channel
	for rows.Next() {
		var c Channel
		if err := rows.Scan(&c.YouTubeChannelID, &c.NameShort); err != nil {
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
			name_short,
			name_english,
			name_japanese,
			symbol,
			icon,
			youtube_channel_icon_url,
			youtube_channel_banner_url,
			youtube_channel_description,
			color,
			twitter_id,
			profile_id,
			birthday,
			height,
			unit,
			is_active,
			updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,TRUE,now())
		ON CONFLICT (youtube_channel_id)
		DO UPDATE SET
			name_short = EXCLUDED.name_short,
			name_english = EXCLUDED.name_english,
			name_japanese = EXCLUDED.name_japanese,
			symbol = EXCLUDED.symbol,
			icon = EXCLUDED.icon,
			youtube_channel_icon_url = EXCLUDED.youtube_channel_icon_url,
			youtube_channel_banner_url = EXCLUDED.youtube_channel_banner_url,
			youtube_channel_description = EXCLUDED.youtube_channel_description,
			color = EXCLUDED.color,
			twitter_id = EXCLUDED.twitter_id,
			profile_id = EXCLUDED.profile_id,
			birthday = EXCLUDED.birthday,
			height = EXCLUDED.height,
			unit = EXCLUDED.unit,
			is_active = TRUE,
			updated_at = now()
	`, c.YouTubeChannelID, c.NameShort, c.NameEnglish, c.NameJapanese, c.Symbol, c.Icon, c.YouTubeIconURL, c.YouTubeBannerURL, c.YouTubeDescription, c.Color, c.TwitterID, c.ProfileID, c.Birthday, c.Height, c.Unit)
	if err != nil {
		return fmt.Errorf("upsert channel (id=%s): %w", c.YouTubeChannelID, err)
	}
	return nil
}

func UpdateChannelYouTubeMetadata(ctx context.Context, pool *pgxpool.Pool, channelID string, iconURL, bannerURL, description *string) error {
	_, err := pool.Exec(ctx, `
		UPDATE yt.youtube_channels
		SET
			youtube_channel_icon_url = $2,
			youtube_channel_banner_url = $3,
			youtube_channel_description = $4,
			updated_at = now()
		WHERE youtube_channel_id = $1
	`, channelID, iconURL, bannerURL, description)
	if err != nil {
		return fmt.Errorf("update youtube channel metadata (id=%s): %w", channelID, err)
	}
	return nil
}

func ExistingDailyStatsChannelIDs(ctx context.Context, pool *pgxpool.Pool, day time.Time, timeZone string) (map[string]struct{}, error) {
	rows, err := pool.Query(ctx, `
		SELECT youtube_channel_id
		FROM yt.youtube_channel_daily_stats
		WHERE (time AT TIME ZONE $2)::date = ($1 AT TIME ZONE $2)::date
	`, day, timeZone)
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

// Livestream session and viewer bucket types (for DB persistence).

type LivestreamSession struct {
	YouTubeChannelID string
	VideoID          string

	Status       string // "upcoming" | "live" | "ended"
	VideoTitle   *string
	ThumbnailURL *string

	ScheduledStartAt *time.Time
	ActualStartAt    *time.Time

	FirstSeenAt time.Time
	LastSeenAt  time.Time
	EndedAt     *time.Time
	EndReason   *string
	TotalViews  *int64

	AvgConcurrentViewers   *int64
	MaxConcurrentViewers   *int64
	MaxConcurrentViewersAt *time.Time

	UpdatedAt time.Time
}

type ViewerBucket5m struct {
	LivestreamVideoID string
	BucketStart       time.Time
	BucketEnd         time.Time
	DurationSeconds   int
	AvgViewers        *int64
	MaxViewers        *int64
}

func UpsertLivestreamSession(ctx context.Context, pool *pgxpool.Pool, s LivestreamSession) error {
	if s.UpdatedAt.IsZero() {
		s.UpdatedAt = time.Now().UTC()
	}
	_, err := pool.Exec(ctx, `
		INSERT INTO yt.livestream_sessions (
			youtube_channel_id, video_id, status,
			video_title, thumbnail_url,
			scheduled_start_at, actual_start_at,
			first_seen_at, last_seen_at, ended_at, end_reason, total_views,
			avg_concurrent_viewers, max_concurrent_viewers, max_concurrent_viewers_at,
			updated_at
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
		ON CONFLICT (video_id)
		DO UPDATE SET
			status = EXCLUDED.status,
			video_title = EXCLUDED.video_title,
			thumbnail_url = EXCLUDED.thumbnail_url,
			scheduled_start_at = EXCLUDED.scheduled_start_at,
			actual_start_at = EXCLUDED.actual_start_at,
			last_seen_at = EXCLUDED.last_seen_at,
			ended_at = EXCLUDED.ended_at,
			end_reason = EXCLUDED.end_reason,
			total_views = EXCLUDED.total_views,
			avg_concurrent_viewers = EXCLUDED.avg_concurrent_viewers,
			max_concurrent_viewers = EXCLUDED.max_concurrent_viewers,
			max_concurrent_viewers_at = EXCLUDED.max_concurrent_viewers_at,
			updated_at = EXCLUDED.updated_at
	`,
		s.YouTubeChannelID, s.VideoID, s.Status,
		s.VideoTitle, s.ThumbnailURL,
		s.ScheduledStartAt, s.ActualStartAt,
		s.FirstSeenAt, s.LastSeenAt, s.EndedAt, s.EndReason, s.TotalViews,
		s.AvgConcurrentViewers, s.MaxConcurrentViewers, s.MaxConcurrentViewersAt,
		s.UpdatedAt)
	if err != nil {
		return fmt.Errorf("upsert livestream session video_id=%s: %w", s.VideoID, err)
	}
	return nil
}

func ListOpenLivestreamSessionIDsByChannel(ctx context.Context, pool *pgxpool.Pool, youtubeChannelID string) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT video_id
		FROM yt.livestream_sessions
		WHERE youtube_channel_id = $1
		  AND status IN ('upcoming', 'live')
	`, youtubeChannelID)
	if err != nil {
		return nil, fmt.Errorf("list open livestream sessions channel_id=%s: %w", youtubeChannelID, err)
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var videoID string
		if err := rows.Scan(&videoID); err != nil {
			return nil, fmt.Errorf("scan open livestream sessions channel_id=%s: %w", youtubeChannelID, err)
		}
		if videoID != "" {
			out = append(out, videoID)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate open livestream sessions channel_id=%s: %w", youtubeChannelID, err)
	}
	return out, nil
}

func ListLivestreamSessionsByStatus(ctx context.Context, pool *pgxpool.Pool, status string) ([]LivestreamSessionSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			youtube_channel_id,
			video_id,
			status,
			video_title,
			scheduled_start_at,
			actual_start_at,
			first_seen_at,
			last_seen_at
		FROM yt.livestream_sessions
		WHERE status = $1
		ORDER BY COALESCE(scheduled_start_at, first_seen_at) ASC, video_id ASC
	`, status)
	if err != nil {
		return nil, fmt.Errorf("list livestream sessions by status=%s: %w", status, err)
	}
	defer rows.Close()

	var out []LivestreamSessionSummary
	for rows.Next() {
		var s LivestreamSessionSummary
		if err := rows.Scan(
			&s.YouTubeChannelID,
			&s.VideoID,
			&s.Status,
			&s.VideoTitle,
			&s.ScheduledStartAt,
			&s.ActualStartAt,
			&s.FirstSeenAt,
			&s.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("scan livestream session by status=%s: %w", status, err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate livestream sessions by status=%s: %w", status, err)
	}
	return out, nil
}

func ListLivestreamSessionsByStatusWithViewerBuckets(ctx context.Context, pool *pgxpool.Pool, status string) ([]LivestreamSessionSummary, error) {
	rows, err := pool.Query(ctx, `
		SELECT
			s.youtube_channel_id,
			s.video_id,
			s.status,
			s.video_title,
			s.scheduled_start_at,
			s.actual_start_at,
			s.first_seen_at,
			s.last_seen_at
		FROM yt.livestream_sessions s
		WHERE s.status = $1
		  AND EXISTS (
			SELECT 1
			FROM yt.livestream_viewer_buckets_5m b
			WHERE b.livestream_video_id = s.video_id
		  )
		ORDER BY COALESCE(s.scheduled_start_at, s.first_seen_at) ASC, s.video_id ASC
	`, status)
	if err != nil {
		return nil, fmt.Errorf("list livestream sessions by status=%s with buckets: %w", status, err)
	}
	defer rows.Close()

	var out []LivestreamSessionSummary
	for rows.Next() {
		var s LivestreamSessionSummary
		if err := rows.Scan(
			&s.YouTubeChannelID,
			&s.VideoID,
			&s.Status,
			&s.VideoTitle,
			&s.ScheduledStartAt,
			&s.ActualStartAt,
			&s.FirstSeenAt,
			&s.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("scan livestream session by status=%s with buckets: %w", status, err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate livestream sessions by status=%s with buckets: %w", status, err)
	}
	return out, nil
}

func DeleteLivestreamSessionIfNoBuckets(ctx context.Context, pool *pgxpool.Pool, videoID string) (bool, error) {
	tag, err := pool.Exec(ctx, `
		DELETE FROM yt.livestream_sessions s
		WHERE s.video_id = $1
		  AND s.status = 'upcoming'
		  AND NOT EXISTS (
			SELECT 1
			FROM yt.livestream_viewer_buckets_5m b
			WHERE b.livestream_video_id = s.video_id
		  )
	`, videoID)
	if err != nil {
		return false, fmt.Errorf("delete livestream session video_id=%s: %w", videoID, err)
	}
	return tag.RowsAffected() > 0, nil
}

func InsertViewerBucket5m(ctx context.Context, pool *pgxpool.Pool, b ViewerBucket5m) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO yt.livestream_viewer_buckets_5m (
			livestream_video_id, bucket_start, bucket_end, duration_seconds,
			avg_viewers, max_viewers
		) VALUES ($1,$2,$3,$4,$5,$6)
		ON CONFLICT (livestream_video_id, bucket_start)
		DO UPDATE SET
			bucket_end = EXCLUDED.bucket_end,
			duration_seconds = EXCLUDED.duration_seconds,
			avg_viewers = EXCLUDED.avg_viewers,
			max_viewers = EXCLUDED.max_viewers
	`,
		b.LivestreamVideoID, b.BucketStart, b.BucketEnd, b.DurationSeconds,
		b.AvgViewers, b.MaxViewers)
	if err != nil {
		return fmt.Errorf("insert viewer bucket video_id=%s bucket_start=%s: %w", b.LivestreamVideoID, b.BucketStart.Format(time.RFC3339), err)
	}
	return nil
}

// SessionAggregates is the result of aggregating 5-minute buckets for a stream.
type SessionAggregates struct {
	AvgViewers *int64
	MaxViewers *int64
}

func GetSessionAggregatesFromBuckets(ctx context.Context, pool *pgxpool.Pool, videoID string) (SessionAggregates, error) {
	var out SessionAggregates
	err := pool.QueryRow(ctx, `
		SELECT
			AVG(avg_viewers)::BIGINT,
			MAX(max_viewers)
		FROM yt.livestream_viewer_buckets_5m
		WHERE livestream_video_id = $1
	`, videoID).Scan(&out.AvgViewers, &out.MaxViewers)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return SessionAggregates{}, nil
		}
		return SessionAggregates{}, fmt.Errorf("get session aggregates video_id=%s: %w", videoID, err)
	}
	return out, nil
}

// GetMaxViewersAtFromBuckets returns the bucket_end time for the bucket holding the
// highest `max_viewers` (tie-breaker: earliest bucket_end).
func GetMaxViewersAtFromBuckets(ctx context.Context, pool *pgxpool.Pool, videoID string) (*time.Time, error) {
	var t time.Time
	err := pool.QueryRow(ctx, `
		SELECT bucket_end
		FROM yt.livestream_viewer_buckets_5m
		WHERE livestream_video_id = $1
		  AND max_viewers IS NOT NULL
		ORDER BY max_viewers DESC, bucket_end ASC
		LIMIT 1
	`, videoID).Scan(&t)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get max viewers at video_id=%s: %w", videoID, err)
	}
	return &t, nil
}

func EndLivestreamSession(ctx context.Context, pool *pgxpool.Pool, videoID string, endedAt time.Time, avgViewers, maxViewers *int64, maxViewersAt *time.Time) (bool, error) {
	tag, err := pool.Exec(ctx, `
		UPDATE yt.livestream_sessions
		SET status = 'ended', ended_at = $2, end_reason = 'detected_end',
		    avg_concurrent_viewers = $3, max_concurrent_viewers = $4, max_concurrent_viewers_at = $5,
		    updated_at = now()
		WHERE video_id = $1
		  AND status <> 'ended'
	`, videoID, endedAt, avgViewers, maxViewers, maxViewersAt)
	if err != nil {
		return false, fmt.Errorf("end livestream session video_id=%s: %w", videoID, err)
	}
	return tag.RowsAffected() > 0, nil
}

// UpsertChannelLivestreamStatsAfterEnd updates channel rollup when a stream ends.
// streamAvg and streamMax are this stream's avg and max; equal-weight avg is recomputed from sum/count.
func UpsertChannelLivestreamStatsAfterEnd(ctx context.Context, pool *pgxpool.Pool, youtubeChannelID string, streamAvg, streamMax int64) error {
	_, err := pool.Exec(ctx, `
		INSERT INTO yt.youtube_channel_livestream_stats (
			youtube_channel_id,
			ended_streams_count,
			sum_stream_avg_concurrent_viewers,
			sum_stream_max_concurrent_viewers,
			avg_concurrent_viewers_over_streams,
			max_concurrent_viewers_over_streams,
			updated_at
		) VALUES (
			$1,
			1,
			$2, $3,
			$2, $3,
			now()
		)
		ON CONFLICT (youtube_channel_id)
		DO UPDATE SET
			ended_streams_count = yt.youtube_channel_livestream_stats.ended_streams_count + 1,
			sum_stream_avg_concurrent_viewers = yt.youtube_channel_livestream_stats.sum_stream_avg_concurrent_viewers + $2,
			sum_stream_max_concurrent_viewers = yt.youtube_channel_livestream_stats.sum_stream_max_concurrent_viewers + $3,
			avg_concurrent_viewers_over_streams = (yt.youtube_channel_livestream_stats.sum_stream_avg_concurrent_viewers + $2) / (yt.youtube_channel_livestream_stats.ended_streams_count + 1),
			max_concurrent_viewers_over_streams = GREATEST(COALESCE(yt.youtube_channel_livestream_stats.max_concurrent_viewers_over_streams, 0), $3),
			updated_at = now()
	`, youtubeChannelID, streamAvg, streamMax)
	if err != nil {
		return fmt.Errorf("upsert channel livestream stats channel_id=%s: %w", youtubeChannelID, err)
	}
	return nil
}
