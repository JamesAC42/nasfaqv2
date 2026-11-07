package main

// When the full livestream detection poll runs. It's the only poll that finds streams the tracker
// doesn't know about yet (priority and early-start polls only cover tracked ones), so it has to
// run at least every LIVE_POLL_SECONDS, restarts included. Every release restarts the scraper.
//
// It used to be skipped at startup whenever Redis held one fresh stream, and the next one came a
// whole interval after the restart. A burst of releases then kept pushing it back: no full poll for
// an hour or more, streams dropped from the tracker lost their viewer samples, and prediction
// markets on them closed early or resolved on a missing peak.
//
// Now each full poll that finishes records when it started (fullPollKey). At startup the first one
// keeps that schedule: due already, it runs at once; otherwise it runs when the last one's interval
// is up. A poll cut off by a shutdown records nothing, so the next process polls straight away.

import (
	"context"
	"errors"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// fullPollKey holds the start time (RFC 3339) of the last full detection poll that finished.
const fullPollKey = "nasfaq:ytscraper:last_full_livestream_poll"

// firstFullPollDelay is how long after startup the first full poll runs, given when the last full
// poll to finish started (zero if unknown).
func firstFullPollDelay(now, lastStart time.Time, interval time.Duration) time.Duration {
	if lastStart.IsZero() || interval <= 0 {
		return 0
	}
	elapsed := now.Sub(lastStart)
	if elapsed < 0 || elapsed >= interval {
		return 0
	}
	return interval - elapsed
}

func parseFullPollMarker(value string) time.Time {
	at, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}
	}
	return at.UTC()
}

// readLastFullPoll is the start of the last full poll that finished, or zero if Redis doesn't say.
func readLastFullPoll(ctx context.Context, rdb *redis.Client) time.Time {
	if rdb == nil {
		return time.Time{}
	}
	rctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	value, err := rdb.Get(rctx, fullPollKey).Result()
	if err != nil {
		if !errors.Is(err, redis.Nil) {
			log.Printf("livestreams: reading the last full poll from redis: %v", err)
		}
		return time.Time{}
	}
	return parseFullPollMarker(value)
}

// recordFullPoll notes that a full poll which started at startedAt has finished.
func recordFullPoll(ctx context.Context, rdb *redis.Client, startedAt time.Time) {
	if rdb == nil || ctx.Err() != nil {
		return
	}
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := rdb.Set(wctx, fullPollKey, startedAt.UTC().Format(time.RFC3339Nano), 24*time.Hour).Err(); err != nil {
		log.Printf("livestreams: recording the full poll in redis: %v", err)
	}
}
