package main

// Retrying the daily stats. Settlement (api/src/services/marketScheduler.js) waits until every listed
// talent has a stats row for the day, so one channel the daily run missed would hold up the whole
// market. Channels still missing today's stats are tried again every SCRAPE_RETRY_MINUTES (60) until
// they're in or the day ends. When the API key's quota is used up, the next try waits for the quota
// to reset (midnight Pacific) instead of spending calls that can only fail.
//
// Each run logs what's still missing and writes the same to Redis (dailyStatusKey), where the API's
// scrape-incomplete alert reads it: the alert only fires after the first retry has had its turn,
// and says when the next one is.

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
)

// dailyStatusKey is read by the API watchdog (api/src/services/watchdog.js, checkScrape).
const dailyStatusKey = "nasfaq:ytscraper:daily_stats"

// quotaResetMargin keeps a retry clear of the quota reset itself.
const quotaResetMargin = 5 * time.Minute

// scrapeResult is what a daily stats run left behind.
type scrapeResult struct {
	// Day is the scrape day (its local midnight). Zero when the run failed before it knew.
	Day time.Time
	// Missing are the active channels that still have no stats row for Day.
	Missing []db.Channel
	// QuotaExceeded is set when YouTube said the daily quota is used up.
	QuotaExceeded bool
}

// dailyStatus is the Redis record of today's scrape.
type dailyStatus struct {
	Day           string     `json:"day"`
	Missing       []string   `json:"missing"`
	MissingNames  []string   `json:"missing_names"`
	Attempts      int        `json:"attempts"`
	LastAttemptAt time.Time  `json:"last_attempt_at"`
	NextRetryAt   *time.Time `json:"next_retry_at"`
	QuotaExceeded bool       `json:"quota_exceeded"`
	LastError     string     `json:"last_error,omitempty"`
}

// nextLocalMidnight is the first midnight in loc after t.
func nextLocalMidnight(t time.Time, loc *time.Location) time.Time {
	local := t.In(loc)
	return time.Date(local.Year(), local.Month(), local.Day()+1, 0, 0, 0, 0, loc)
}

// nextRetry is when to try day's missing channels again: interval from now, or just after the quota
// resets (midnight in quotaLoc) if it's used up. ok is false when that's after the day has ended:
// the next day's scheduled run takes over, and the day needs backfill-missing-daily-stats.
func nextRetry(now, day time.Time, loc *time.Location, interval time.Duration, quotaExceeded bool, quotaLoc *time.Location) (at time.Time, ok bool) {
	at = now.Add(interval)
	if quotaExceeded {
		if reset := nextLocalMidnight(now, quotaLoc).Add(quotaResetMargin); reset.After(at) {
			at = reset
		}
	}
	if !at.Before(nextLocalMidnight(day, loc)) {
		return time.Time{}, false
	}
	return at, true
}

// channelLabels names channels for the logs: "UC… (Name)".
func channelLabels(channels []db.Channel) []string {
	out := make([]string, 0, len(channels))
	for _, ch := range channels {
		out = append(out, fmt.Sprintf("%s (%s)", ch.YouTubeChannelID, ch.NameShort))
	}
	return out
}

// dailyRetry keeps track of today's runs and schedules the next retry.
type dailyRetry struct {
	cfg      Config
	quotaLoc *time.Location
	rdb      *redis.Client

	day      time.Time
	attempts int
	// NextAt is when to retry, or zero when there's nothing to retry today.
	NextAt time.Time
}

// afterRun records a run (scheduled, startup or retry) and plans the next retry.
func (r *dailyRetry) afterRun(ctx context.Context, now time.Time, res scrapeResult, runErr error) {
	day := res.Day
	if day.IsZero() {
		day = localMidnight(now, r.cfg.ScrapeLocation)
	}
	if !day.Equal(r.day) {
		r.day = day
		r.attempts = 0
	}
	r.attempts++
	r.NextAt = time.Time{}
	dayKey := day.In(r.cfg.ScrapeLocation).Format("2006-01-02")

	status := dailyStatus{Day: dayKey, Missing: []string{}, MissingNames: []string{}, Attempts: r.attempts, LastAttemptAt: now.UTC(), QuotaExceeded: res.QuotaExceeded}
	for _, ch := range res.Missing {
		status.Missing = append(status.Missing, ch.YouTubeChannelID)
		status.MissingNames = append(status.MissingNames, ch.NameShort)
	}
	if runErr != nil {
		status.LastError = runErr.Error()
	}

	// A run that failed before it could list what's missing (database down) still gets a retry.
	if len(res.Missing) > 0 || (runErr != nil && res.Day.IsZero()) {
		at, ok := nextRetry(now, day, r.cfg.ScrapeLocation, r.cfg.RetryInterval, res.QuotaExceeded, r.quotaLoc)
		why := ""
		if res.QuotaExceeded {
			why = " (YouTube quota used up; it resets at midnight Pacific)"
		}
		missing := "unknown channels"
		if len(res.Missing) > 0 {
			missing = fmt.Sprintf("%d channel(s): %s", len(res.Missing), strings.Join(channelLabels(res.Missing), ", "))
		}
		if ok {
			r.NextAt = at
			status.NextRetryAt = &at
			log.Printf("scrape: %s still missing stats for %s after attempt %d%s; retrying at %s", missing, dayKey, r.attempts, why, at.In(r.cfg.ScrapeLocation).Format(time.RFC3339))
		} else {
			log.Printf("scrape: %s still missing stats for %s after attempt %d%s; no retry left before the day ends (fill them with backfill-missing-daily-stats)", missing, dayKey, r.attempts, why)
		}
	} else if r.attempts > 1 {
		log.Printf("scrape: every active channel has stats for %s (attempt %d)", dayKey, r.attempts)
	}
	r.publish(ctx, status)
}

func (r *dailyRetry) publish(ctx context.Context, status dailyStatus) {
	if r.rdb == nil {
		return
	}
	body, err := json.Marshal(status)
	if err != nil {
		return
	}
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := r.rdb.Set(wctx, dailyStatusKey, body, 48*time.Hour).Err(); err != nil {
		log.Printf("scrape: writing retry status to redis: %v", err)
	}
}
