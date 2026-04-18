package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/JamesAC42/nasfaqv2/brokerbot/channelscraper/internal/scraper"
)

type stringListFlag []string

func (s *stringListFlag) String() string {
	return fmt.Sprintf("%v", []string(*s))
}

func (s *stringListFlag) Set(value string) error {
	*s = append(*s, value)
	return nil
}

func main() {
	listURL := flag.String("list-url", scraper.DefaultListURL, "Talent listing page to scrape")
	birthdayYear := flag.Int("birthday-year", 2000, "Placeholder year used when converting month/day birthdays to ISO dates")
	timeout := flag.Duration("timeout", 20*time.Second, "HTTP timeout per request")
	delay := flag.Duration("delay", 0, "Delay between profile page requests")
	concurrency := flag.Int("concurrency", 8, "Number of profile pages to scrape concurrently")
	var skipProfileIDs stringListFlag
	flag.Var(&skipProfileIDs, "skip-profile-id", "Profile ID to skip (repeatable)")
	flag.Parse()

	rows, err := scraper.Scrape(context.Background(), scraper.NewHTTPClient(*timeout), scraper.Options{
		ListURL:        *listURL,
		BirthdayYear:   *birthdayYear,
		Delay:          *delay,
		Concurrency:    *concurrency,
		SkipProfileIDs: skipProfileIDs,
		ContinueOnProfileError: true,
	})
	if err != nil {
		log.Fatalf("detect channels: %v", err)
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(rows); err != nil {
		log.Fatalf("encode channels json: %v", err)
	}
}
