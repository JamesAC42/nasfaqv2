package db

import (
	"context"
	"fmt"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type YouTubeSuperchat struct {
	Date           string
	VideoID        string
	SuperchatTotal int64
	ScrapedAt      time.Time
}

type SuperchatCurrencyBreakdown struct {
	CurrencyName    string
	DonationCount   int64
	TotalInCurrency string
	TotalInYen      int64
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
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, fmt.Errorf("connect postgres: %w", err)
	}
	return pool, nil
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
	if _, err := pool.Exec(ctx, SchemaSQL); err != nil {
		return fmt.Errorf("apply schema: %w", err)
	}
	return nil
}

func ClearYouTubeSuperchatTables(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		TRUNCATE TABLE
			yt.youtube_superchat_currency_breakdowns,
			yt.youtube_superchats
	`); err != nil {
		return fmt.Errorf("truncate youtube superchat tables: %w", err)
	}
	return nil
}

func DropYouTubeSuperchatMetadataColumns(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, `
		ALTER TABLE yt.youtube_superchats
			DROP COLUMN IF EXISTS video_title,
			DROP COLUMN IF EXISTS thumbnail_url
	`); err != nil {
		return fmt.Errorf("drop youtube superchat metadata columns: %w", err)
	}
	return nil
}

func UpsertYouTubeSuperchatWithBreakdowns(ctx context.Context, pool *pgxpool.Pool, row YouTubeSuperchat, breakdowns []SuperchatCurrencyBreakdown) error {
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin superchat tx video_id=%s: %w", row.VideoID, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	_, err = tx.Exec(ctx, `
		INSERT INTO yt.youtube_superchats (
			date,
			video_id,
			superchat_total,
			scraped_at
		) VALUES ($1::date, $2, $3, $4)
		ON CONFLICT (video_id)
		DO UPDATE SET
			date = EXCLUDED.date,
			superchat_total = EXCLUDED.superchat_total,
			scraped_at = EXCLUDED.scraped_at
	`, row.Date, row.VideoID, row.SuperchatTotal, row.ScrapedAt)
	if err != nil {
		return fmt.Errorf("upsert youtube_superchats video_id=%s: %w", row.VideoID, err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM yt.youtube_superchat_currency_breakdowns WHERE video_id = $1`, row.VideoID); err != nil {
		return fmt.Errorf("delete superchat breakdowns video_id=%s: %w", row.VideoID, err)
	}

	for _, breakdown := range breakdowns {
		_, err := tx.Exec(ctx, `
			INSERT INTO yt.youtube_superchat_currency_breakdowns (
				video_id,
				currency_name,
				donation_count,
				total_in_currency,
				total_in_yen
			) VALUES ($1, $2, $3, $4::numeric, $5)
		`, row.VideoID, breakdown.CurrencyName, breakdown.DonationCount, breakdown.TotalInCurrency, breakdown.TotalInYen)
		if err != nil {
			return fmt.Errorf("insert superchat breakdown video_id=%s currency=%s: %w", row.VideoID, breakdown.CurrencyName, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit superchat tx video_id=%s: %w", row.VideoID, err)
	}
	return nil
}
