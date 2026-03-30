package main

import (
	"context"
	"flag"
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

	"github.com/JamesAC42/nasfaqv2/brokerbot/superchatscraper/internal/db"
	"github.com/JamesAC42/nasfaqv2/brokerbot/superchatscraper/internal/hololyzer"
)

type Config struct {
	DatabaseURL       string
	HololyzerBaseURL  string
	ScrapeTimeZone    string
	ScrapeLocation    *time.Location
	ScrapeAtLocalHour int
	ScrapeAtLocalMin  int
	RequestDelayMS    int
	RequestTimeout    time.Duration
	LogSuperchatStats bool
}

type RunMode int

const (
	RunModeService RunMode = iota
	RunModeOnce
	RunModeRange
)

func main() {
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
	mode, rangeStart, rangeEnd := mustParseRunMode(cfg.ScrapeLocation)

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

	client := hololyzer.New(cfg.HololyzerBaseURL)

	switch mode {
	case RunModeOnce:
		targetDate := previousLocalDate(time.Now(), cfg.ScrapeLocation)
		log.Printf("scrape: running once for scrape date %s", targetDate)
		if err := scrapeOnce(ctx, pool, client, cfg, targetDate); err != nil {
			log.Fatalf("scrape: one-shot run failed: %v", err)
		}
	case RunModeRange:
		if err := scrapeRange(ctx, pool, client, cfg, rangeStart, rangeEnd); err != nil {
			log.Fatalf("scrape: range run failed: %v", err)
		}
	default:
		runService(ctx, pool, client, cfg)
	}
}

func runService(ctx context.Context, pool *pgxpool.Pool, client *hololyzer.Client, cfg Config) {
	for {
		next := nextDailyRunInLocation(time.Now(), cfg.ScrapeLocation, cfg.ScrapeAtLocalHour, cfg.ScrapeAtLocalMin)
		wait := time.Until(next)
		targetDate := previousLocalDate(next, cfg.ScrapeLocation)
		log.Printf(
			"scrape: next run scheduled at %s local / %s utc (in %s) for scrape date %s",
			next.In(cfg.ScrapeLocation).Format(time.RFC3339),
			next.UTC().Format(time.RFC3339),
			wait.Round(time.Second),
			targetDate,
		)

		timer := time.NewTimer(wait)
		select {
		case <-ctx.Done():
			timer.Stop()
			log.Printf("shutdown: %v", ctx.Err())
			return
		case <-timer.C:
		}

		log.Printf("scrape: starting scheduled run for %s", targetDate)
		if err := scrapeOnce(ctx, pool, client, cfg, targetDate); err != nil {
			log.Printf("scrape: scheduled run failed for %s: %v", targetDate, err)
		}
	}
}

func scrapeRange(ctx context.Context, pool *pgxpool.Pool, client *hololyzer.Client, cfg Config, start, end time.Time) error {
	for day := start; !day.After(end); day = day.AddDate(0, 0, 1) {
		targetDate := previousLocalDate(day, cfg.ScrapeLocation)
		log.Printf(
			"scrape: running range day %s for scrape date %s",
			day.In(cfg.ScrapeLocation).Format("2006-01-02"),
			targetDate,
		)
		if err := scrapeOnce(ctx, pool, client, cfg, targetDate); err != nil {
			return err
		}
	}
	return nil
}

func scrapeOnce(ctx context.Context, pool *pgxpool.Pool, client *hololyzer.Client, cfg Config, targetDate string) error {
	scrapedAt := time.Now().UTC()

	targets, err := client.FetchDailyArchiveTargets(ctx, targetDate)
	if err != nil {
		return fmt.Errorf("fetch hololyzer daily list for %s: %w", targetDate, err)
	}
	if len(targets) == 0 {
		log.Printf("scrape: no hololyzer superchat archives found for %s", targetDate)
		return nil
	}

	var failCount int
	for i, target := range targets {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		requestCtx, cancel := context.WithTimeout(ctx, cfg.RequestTimeout)
		detail, err := client.FetchSuperchatDetail(requestCtx, target.ArchiveURL)
		cancel()
		if err != nil {
			fallbackDetail, fallbackOK := fallbackDetailFromTarget(target)
			if !fallbackOK {
				failCount++
				log.Printf("scrape: archive=%s parse error without fallback: %v", target.ArchiveURL, err)
				continue
			}
			log.Printf(
				"scrape: archive=%s detail scrape failed, using daily-list fallback total=%d: %v",
				target.ArchiveURL,
				fallbackDetail.SuperchatTotal,
				err,
			)
			detail = fallbackDetail
		}

		breakdowns := make([]db.SuperchatCurrencyBreakdown, 0, len(detail.Breakdowns))
		for _, breakdown := range detail.Breakdowns {
			breakdowns = append(breakdowns, db.SuperchatCurrencyBreakdown{
				CurrencyName:    breakdown.CurrencyName,
				DonationCount:   breakdown.DonationCount,
				TotalInCurrency: breakdown.TotalInCurrency,
				TotalInYen:      breakdown.TotalInYen,
			})
		}

		row := db.YouTubeSuperchat{
			Date:           targetDate,
			VideoID:        detail.VideoID,
			SuperchatTotal: detail.SuperchatTotal,
			ScrapedAt:      scrapedAt,
		}
		if err := db.UpsertYouTubeSuperchatWithBreakdowns(ctx, pool, row, breakdowns); err != nil {
			failCount++
			log.Printf("scrape: video_id=%s upsert error: %v", detail.VideoID, err)
			continue
		}

		if cfg.LogSuperchatStats {
			log.Printf(
				"scrape: video_id=%s total_yen=%d currencies=%d",
				detail.VideoID,
				detail.SuperchatTotal,
				len(detail.Breakdowns),
			)
		}

		log.Printf("scrape: ok (%d/%d) video_id=%s total_yen=%d", i+1, len(targets), detail.VideoID, detail.SuperchatTotal)

		if cfg.RequestDelayMS > 0 && i < len(targets)-1 {
			time.Sleep(time.Duration(cfg.RequestDelayMS) * time.Millisecond)
		}
	}

	if failCount > 0 {
		return fmt.Errorf("scrape completed with %d/%d archive failures for %s", failCount, len(targets), targetDate)
	}
	return nil
}

func fallbackDetailFromTarget(target hololyzer.DailyArchiveTarget) (hololyzer.SuperchatDetail, bool) {
	if target.VideoID == "" {
		return hololyzer.SuperchatDetail{}, false
	}

	return hololyzer.SuperchatDetail{
		VideoID:        target.VideoID,
		SuperchatTotal: target.FallbackSuperchatTotal,
		Breakdowns:     nil,
	}, true
}

func previousLocalDate(now time.Time, loc *time.Location) string {
	return now.In(loc).AddDate(0, 0, -1).Format("2006-01-02")
}

func nextDailyRunInLocation(now time.Time, loc *time.Location, hour, min int) time.Time {
	localNow := now.In(loc)
	candidate := time.Date(localNow.Year(), localNow.Month(), localNow.Day(), hour, min, 0, 0, loc)
	if !candidate.After(localNow) {
		candidate = candidate.Add(24 * time.Hour)
	}
	return candidate.UTC()
}

func mustParseRunMode(loc *time.Location) (RunMode, time.Time, time.Time) {
	runOnce := flag.Bool("once", false, "run the scraper once for the previous local day and exit")
	rangeStartRaw := flag.String("range-start", "", "inclusive local date (YYYY-MM-DD) for range mode; each day scrapes its previous day")
	rangeEndRaw := flag.String("range-end", "", "inclusive local date (YYYY-MM-DD) for range mode; each day scrapes its previous day")
	flag.Parse()

	if *runOnce && (*rangeStartRaw != "" || *rangeEndRaw != "") {
		log.Fatalf("flags: --once cannot be combined with --range-start/--range-end")
	}

	if *runOnce {
		return RunModeOnce, time.Time{}, time.Time{}
	}

	if *rangeStartRaw == "" && *rangeEndRaw == "" {
		return RunModeService, time.Time{}, time.Time{}
	}
	if *rangeStartRaw == "" || *rangeEndRaw == "" {
		log.Fatalf("flags: both --range-start and --range-end are required for range mode")
	}

	start := mustParseLocalDate(*rangeStartRaw, loc, "range-start")
	end := mustParseLocalDate(*rangeEndRaw, loc, "range-end")
	if end.Before(start) {
		log.Fatalf("flags: --range-end must be on or after --range-start")
	}

	return RunModeRange, start, end
}

func mustParseLocalDate(raw string, loc *time.Location, name string) time.Time {
	parsed, err := time.ParseInLocation("2006-01-02", raw, loc)
	if err != nil {
		log.Fatalf("flags: invalid --%s=%q: %v", name, raw, err)
	}
	return parsed
}

func mustLoadConfig() Config {
	getInt := func(key string, def int) int {
		value := os.Getenv(key)
		if value == "" {
			return def
		}
		parsed, err := strconv.Atoi(value)
		if err != nil {
			log.Fatalf("invalid %s=%q: %v", key, value, err)
		}
		return parsed
	}

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}

	scrapeTimeZone := os.Getenv("SCRAPE_TIMEZONE")
	if scrapeTimeZone == "" {
		scrapeTimeZone = "America/New_York"
	}
	scrapeLocation, err := time.LoadLocation(scrapeTimeZone)
	if err != nil {
		log.Fatalf("invalid SCRAPE_TIMEZONE=%q: %v", scrapeTimeZone, err)
	}

	baseURL := os.Getenv("HOLOLYZER_BASE_URL")
	if baseURL == "" {
		baseURL = "https://www.hololyzer.net"
	}

	return Config{
		DatabaseURL:       dbURL,
		HololyzerBaseURL:  baseURL,
		ScrapeTimeZone:    scrapeTimeZone,
		ScrapeLocation:    scrapeLocation,
		ScrapeAtLocalHour: getInt("SCRAPE_AT_LOCAL_HOUR", 8),
		ScrapeAtLocalMin:  getInt("SCRAPE_AT_LOCAL_MIN", 0),
		RequestDelayMS:    getInt("REQUEST_DELAY_MS", 150),
		RequestTimeout:    time.Duration(getInt("REQUEST_TIMEOUT_SECONDS", 20)) * time.Second,
		LogSuperchatStats: strings.ToLower(os.Getenv("LOG_SUPERCHAT_STATS")) == "true",
	}
}
