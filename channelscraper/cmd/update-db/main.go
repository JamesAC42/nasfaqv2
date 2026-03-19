package main

import (
	"context"
	"encoding/csv"
	"errors"
	"flag"
	"fmt"
	"io"
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
	NameJapanese     *string
	TwitterID        *string
	ProfileID        *string
	Birthday         *time.Time
	Height           *string
	Unit             *string
	Icon             *string
}

func main() {
	csvPath := flag.String("csv", "hololive_channels.csv", "Path to the scraped CSV file")
	databaseURLFlag := flag.String("database-url", "", "Postgres connection string (defaults to DATABASE_URL)")
	timeout := flag.Duration("timeout", 30*time.Second, "Database connection timeout")
	dryRun := flag.Bool("dry-run", false, "Print what would be updated without writing to the database")
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

	rows, err := readCSV(*csvPath)
	if err != nil {
		log.Fatalf("read csv: %v", err)
	}
	if len(rows) == 0 {
		log.Fatalf("csv %s contained no data rows", *csvPath)
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

	existingIDs, err := lookupExistingIDs(ctx, tx, rows)
	if err != nil {
		log.Fatalf("lookup existing channels: %v", err)
	}

	var matched int
	var updated int
	var skipped int

	for _, row := range rows {
		if _, ok := existingIDs[row.YouTubeChannelID]; !ok {
			skipped++
			log.Printf("skip missing channel: %s", row.YouTubeChannelID)
			continue
		}

		matched++
		if *dryRun {
			log.Printf("would update channel: %s (%s)", row.YouTubeChannelID, row.NameShort)
			continue
		}

		tag, err := tx.Exec(ctx, `
			UPDATE yt.youtube_channels
			SET
				name_short = $2,
				name_english = $3,
				name_japanese = $4,
				twitter_id = $5,
				profile_id = $6,
				birthday = $7,
				height = $8,
				unit = $9,
				icon = $10,
				updated_at = now()
			WHERE youtube_channel_id = $1
		`,
			row.YouTubeChannelID,
			row.NameShort,
			row.NameEnglish,
			row.NameJapanese,
			row.TwitterID,
			row.ProfileID,
			row.Birthday,
			row.Height,
			row.Unit,
			row.Icon,
		)
		if err != nil {
			log.Fatalf("update channel %s: %v", row.YouTubeChannelID, err)
		}
		if tag.RowsAffected() == 1 {
			updated++
		}
	}

	if *dryRun {
		if err := tx.Rollback(ctx); err != nil && !errors.Is(err, pgx.ErrTxClosed) {
			log.Fatalf("rollback dry run: %v", err)
		}
		log.Printf("dry run complete: csv_rows=%d matched=%d skipped_missing=%d", len(rows), matched, skipped)
		return
	}

	if err := tx.Commit(ctx); err != nil {
		log.Fatalf("commit transaction: %v", err)
	}

	log.Printf("update complete: csv_rows=%d matched=%d updated=%d skipped_missing=%d", len(rows), matched, updated, skipped)
}

func readCSV(path string) ([]channelRow, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open file: %w", err)
	}
	defer f.Close()

	r := csv.NewReader(f)

	header, err := r.Read()
	if err != nil {
		return nil, fmt.Errorf("read header: %w", err)
	}

	indexByName := make(map[string]int, len(header))
	for i, name := range header {
		indexByName[strings.TrimSpace(name)] = i
	}

	required := []string{
		"youtube_channel_id",
		"name_short",
		"name_english",
		"name_japanese",
		"twitter_id",
		"profile_id",
		"birthday",
		"height",
		"unit",
	}
	for _, name := range required {
		if _, ok := indexByName[name]; !ok {
			return nil, fmt.Errorf("missing required csv column %q", name)
		}
	}

	var rows []channelRow
	seen := make(map[string]struct{})

	for {
		record, err := r.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("read csv row: %w", err)
		}

		row, err := parseRow(indexByName, record)
		if err != nil {
			return nil, err
		}
		if row.YouTubeChannelID == "" {
			continue
		}
		if _, exists := seen[row.YouTubeChannelID]; exists {
			return nil, fmt.Errorf("duplicate youtube_channel_id in csv: %s", row.YouTubeChannelID)
		}
		seen[row.YouTubeChannelID] = struct{}{}
		rows = append(rows, row)
	}

	return rows, nil
}

func parseRow(indexByName map[string]int, record []string) (channelRow, error) {
	birthday, err := parseOptionalDate(csvValue(indexByName, record, "birthday"))
	if err != nil {
		return channelRow{}, fmt.Errorf("parse birthday for %q: %w", csvValue(indexByName, record, "youtube_channel_id"), err)
	}

	return channelRow{
		YouTubeChannelID: strings.TrimSpace(csvValue(indexByName, record, "youtube_channel_id")),
		NameShort:        strings.TrimSpace(csvValue(indexByName, record, "name_short")),
		NameEnglish:      optionalString(csvValue(indexByName, record, "name_english")),
		NameJapanese:     optionalString(csvValue(indexByName, record, "name_japanese")),
		TwitterID:        optionalString(csvValue(indexByName, record, "twitter_id")),
		ProfileID:        optionalString(csvValue(indexByName, record, "profile_id")),
		Birthday:         birthday,
		Height:           optionalString(csvValue(indexByName, record, "height")),
		Unit:             optionalString(csvValue(indexByName, record, "unit")),
		Icon:             defaultIcon(optionalString(csvValue(indexByName, record, "name_english")), strings.TrimSpace(csvValue(indexByName, record, "name_short"))),
	}, nil
}

func csvValue(indexByName map[string]int, record []string, name string) string {
	idx, ok := indexByName[name]
	if !ok || idx >= len(record) {
		return ""
	}
	return record[idx]
}

func optionalString(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func parseOptionalDate(value string) (*time.Time, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil, nil
	}
	parsed, err := time.Parse("2006-01-02", trimmed)
	if err != nil {
		return nil, err
	}
	utc := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, time.UTC)
	return &utc, nil
}

func defaultIcon(nameEnglish *string, nameShort string) *string {
	source := strings.TrimSpace(nameShort)
	if nameEnglish != nil && strings.TrimSpace(*nameEnglish) != "" {
		fields := strings.Fields(strings.TrimSpace(*nameEnglish))
		if len(fields) > 0 {
			source = fields[len(fields)-1]
		}
	}

	var b strings.Builder
	for _, r := range strings.ToLower(source) {
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r)
		}
	}

	icon := b.String()
	if icon == "" {
		return nil
	}
	return &icon
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

func lookupExistingIDs(ctx context.Context, tx pgx.Tx, rows []channelRow) (map[string]struct{}, error) {
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		if row.YouTubeChannelID != "" {
			ids = append(ids, row.YouTubeChannelID)
		}
	}

	result := make(map[string]struct{}, len(ids))
	queryRows, err := tx.Query(ctx, `
		SELECT youtube_channel_id
		FROM yt.youtube_channels
		WHERE youtube_channel_id = ANY($1)
	`, ids)
	if err != nil {
		return nil, err
	}
	defer queryRows.Close()

	for queryRows.Next() {
		var id string
		if err := queryRows.Scan(&id); err != nil {
			return nil, err
		}
		result[id] = struct{}{}
	}
	if err := queryRows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}
