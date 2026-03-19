package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
)

type channelRow struct {
	YouTubeChannelID string
	NameShort        string
	NameEnglish      *string
}

func main() {
	databaseURLFlag := flag.String("database-url", "", "Postgres connection string (defaults to DATABASE_URL)")
	timeout := flag.Duration("timeout", 30*time.Second, "Database connection timeout")
	dryRun := flag.Bool("dry-run", false, "Print changes without writing them")
	flag.Parse()

	if envFile := strings.TrimSpace(os.Getenv("ENV_FILE")); envFile != "" {
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

	databaseURL := strings.TrimSpace(*databaseURLFlag)
	if databaseURL == "" {
		databaseURL = strings.TrimSpace(os.Getenv("DATABASE_URL"))
	}
	if databaseURL == "" {
		log.Fatal("missing database URL: pass -database-url or set DATABASE_URL")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	pool, err := newPool(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer pool.Close()

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		log.Fatalf("begin transaction: %v", err)
	}
	defer func() {
		_ = tx.Rollback(context.Background())
	}()

	rows, err := listChannelsMissingSymbols(ctx, tx)
	if err != nil {
		log.Fatalf("query channels: %v", err)
	}

	var updated int
	var skipped int

	for _, row := range rows {
		symbol := defaultSymbol(row.NameEnglish, row.NameShort)
		if symbol == "" {
			skipped++
			log.Printf("skip channel without derivable symbol: %s (%s)", row.YouTubeChannelID, row.NameShort)
			continue
		}

		if *dryRun {
			log.Printf("would set symbol %s -> %s", row.YouTubeChannelID, symbol)
			updated++
			continue
		}

		tag, err := tx.Exec(ctx, `
			UPDATE yt.youtube_channels
			SET symbol = $2,
			    updated_at = now()
			WHERE youtube_channel_id = $1
			  AND (symbol IS NULL OR btrim(symbol) = '')
		`, row.YouTubeChannelID, symbol)
		if err != nil {
			log.Fatalf("update symbol for %s: %v", row.YouTubeChannelID, err)
		}
		if tag.RowsAffected() == 1 {
			updated++
		}
	}

	if *dryRun {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Fatalf("rollback dry run: %v", err)
		}
		log.Printf("dry run complete: candidates=%d updated=%d skipped=%d", len(rows), updated, skipped)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("commit transaction: %v", err)
	}

	log.Printf("backfill complete: candidates=%d updated=%d skipped=%d", len(rows), updated, skipped)
}

func listChannelsMissingSymbols(ctx context.Context, tx pgx.Tx) ([]channelRow, error) {
	rows, err := tx.Query(ctx, `
		SELECT youtube_channel_id, name_short, name_english
		FROM yt.youtube_channels
		WHERE symbol IS NULL OR btrim(symbol) = ''
		ORDER BY name_short ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []channelRow
	for rows.Next() {
		var row channelRow
		if err := rows.Scan(&row.YouTubeChannelID, &row.NameShort, &row.NameEnglish); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func defaultSymbol(nameEnglish *string, nameShort string) string {
	source := strings.TrimSpace(nameShort)
	if nameEnglish != nil && strings.TrimSpace(*nameEnglish) != "" {
		fields := strings.Fields(strings.TrimSpace(*nameEnglish))
		if len(fields) > 0 {
			source = fields[len(fields)-1]
		}
	}

	letters := strings.Map(func(r rune) rune {
		if r >= 'A' && r <= 'Z' {
			return r + ('a' - 'A')
		}
		if r >= 'a' && r <= 'z' {
			return r
		}
		return -1
	}, source)
	if letters == "" {
		return ""
	}

	nonVowels := strings.Map(func(r rune) rune {
		switch r {
		case 'a', 'e', 'i', 'o', 'u':
			return -1
		default:
			return r
		}
	}, letters)

	symbol := nonVowels
	if len(symbol) < 3 {
		symbol = letters
	}
	if len(symbol) > 3 {
		symbol = symbol[:3]
	}
	return strings.ToUpper(symbol)
}

func newPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
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
	return pgxpool.NewWithConfig(ctx, cfg)
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
