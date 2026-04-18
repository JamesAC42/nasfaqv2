package main

import (
	"context"
	"encoding/csv"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/JamesAC42/nasfaqv2/brokerbot/channelscraper/internal/scraper"
)

func main() {
	outPath := flag.String("out", "hololive_channels.csv", "Path to the output CSV file")
	listURL := flag.String("list-url", scraper.DefaultListURL, "Talent listing page to scrape")
	birthdayYear := flag.Int("birthday-year", 2000, "Placeholder year used when converting month/day birthdays to ISO dates")
	timeout := flag.Duration("timeout", 20*time.Second, "HTTP timeout per request")
	delay := flag.Duration("delay", 250*time.Millisecond, "Delay between profile page requests")
	concurrency := flag.Int("concurrency", 1, "Number of profile pages to scrape concurrently")
	flag.Parse()

	rows, err := scraper.Scrape(context.Background(), scraper.NewHTTPClient(*timeout), scraper.Options{
		ListURL:      *listURL,
		BirthdayYear: *birthdayYear,
		Delay:        *delay,
		Concurrency:  *concurrency,
	})
	if err != nil {
		log.Fatalf("scrape channels: %v", err)
	}

	if err := writeCSV(*outPath, rows); err != nil {
		log.Fatalf("write csv: %v", err)
	}

	log.Printf("wrote %d rows to %s", len(rows), *outPath)
}

func writeCSV(outPath string, rows []scraper.Channel) error {
	if err := os.MkdirAll(filepath.Dir(outPath), 0o755); err != nil {
		return fmt.Errorf("create output directory: %w", err)
	}

	f, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("create file: %w", err)
	}
	defer f.Close()

	w := csv.NewWriter(f)
	defer w.Flush()

	header := []string{
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
	if err := w.Write(header); err != nil {
		return fmt.Errorf("write header: %w", err)
	}

	for _, row := range rows {
		record := []string{
			row.YouTubeChannelID,
			row.NameShort,
			row.NameEnglish,
			row.NameJapanese,
			row.TwitterID,
			row.ProfileID,
			row.Birthday,
			row.Height,
			row.Unit,
		}
		if err := w.Write(record); err != nil {
			return fmt.Errorf("write row for %s: %w", row.ProfileID, err)
		}
	}

	if err := w.Error(); err != nil {
		return fmt.Errorf("flush csv: %w", err)
	}
	return nil
}
