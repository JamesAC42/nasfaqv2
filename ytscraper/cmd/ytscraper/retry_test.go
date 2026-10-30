package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
)

func mustLocation(t *testing.T, name string) *time.Location {
	t.Helper()
	loc, err := time.LoadLocation(name)
	if err != nil {
		t.Fatalf("load %s: %v", name, err)
	}
	return loc
}

func TestNextLocalMidnight(t *testing.T) {
	ny := mustLocation(t, "America/New_York")
	cases := []struct {
		now  time.Time
		want time.Time
	}{
		{time.Date(2026, 11, 12, 0, 5, 0, 0, ny), time.Date(2026, 11, 13, 0, 0, 0, 0, ny)},
		{time.Date(2026, 11, 12, 23, 59, 0, 0, ny), time.Date(2026, 11, 13, 0, 0, 0, 0, ny)},
		// The day the clocks go back is 25 hours long.
		{time.Date(2026, 11, 1, 0, 5, 0, 0, ny), time.Date(2026, 11, 2, 0, 0, 0, 0, ny)},
	}
	for _, c := range cases {
		if got := nextLocalMidnight(c.now, ny); !got.Equal(c.want) {
			t.Errorf("nextLocalMidnight(%s) = %s, want %s", c.now, got, c.want)
		}
	}
}

func TestNextRetry(t *testing.T) {
	ny := mustLocation(t, "America/New_York")
	la := mustLocation(t, "America/Los_Angeles")
	day := time.Date(2026, 11, 12, 0, 0, 0, 0, ny)
	at := func(hour, minute int) time.Time { return time.Date(2026, 11, 12, hour, minute, 0, 0, ny) }

	cases := []struct {
		name   string
		now    time.Time
		quota  bool
		want   time.Time
		wantOK bool
	}{
		{"an hour after a failed run", at(0, 6), false, at(1, 6), true},
		{"late in the day", at(22, 30), false, at(23, 30), true},
		{"no retry past the end of the day", at(23, 10), false, time.Time{}, false},
		// 00:06 New York is 21:06 the evening before in Los Angeles: the quota resets at 03:00 New York.
		{"quota used up: wait for the reset", at(0, 6), true, at(3, 5), true},
		{"quota used up with the reset less than an hour off: wait the hour", at(2, 30), true, at(3, 30), true},
		{"quota gone again after today's reset: nothing until tomorrow", at(4, 0), true, time.Time{}, false},
	}
	for _, c := range cases {
		got, ok := nextRetry(c.now, day, ny, time.Hour, c.quota, la)
		if ok != c.wantOK || !got.Equal(c.want) {
			t.Errorf("%s: nextRetry(%s) = %s, %v; want %s, %v", c.name, c.now.Format(time.Kitchen), got, ok, c.want, c.wantOK)
		}
	}
}

func TestDailyRetryAfterRun(t *testing.T) {
	ny := mustLocation(t, "America/New_York")
	la := mustLocation(t, "America/Los_Angeles")
	r := &dailyRetry{cfg: Config{ScrapeLocation: ny, RetryInterval: time.Hour}, quotaLoc: la}
	ctx := context.Background()
	day := time.Date(2026, 11, 12, 0, 0, 0, 0, ny)
	missing := []db.Channel{{YouTubeChannelID: "UCSjQDxud2HkAO2DVD3lwxmw", NameShort: "Kyoko"}}

	r.afterRun(ctx, time.Date(2026, 11, 12, 0, 6, 0, 0, ny), scrapeResult{Day: day, Missing: missing}, errors.New("scrape completed with 1/80 channel failures"))
	if want := time.Date(2026, 11, 12, 1, 6, 0, 0, ny); !r.NextAt.Equal(want) || r.attempts != 1 {
		t.Fatalf("after the daily run: next %s (attempt %d), want %s (attempt 1)", r.NextAt, r.attempts, want)
	}

	r.afterRun(ctx, time.Date(2026, 11, 12, 1, 7, 0, 0, ny), scrapeResult{Day: day}, nil)
	if !r.NextAt.IsZero() || r.attempts != 2 {
		t.Fatalf("once everything's in: next %s (attempt %d), want none (attempt 2)", r.NextAt, r.attempts)
	}

	// A failure before the run knew what was missing (the database was down) is retried too.
	r.afterRun(ctx, time.Date(2026, 11, 13, 0, 6, 0, 0, ny), scrapeResult{}, errors.New("db: connection refused"))
	if want := time.Date(2026, 11, 13, 1, 6, 0, 0, ny); !r.NextAt.Equal(want) || r.attempts != 1 {
		t.Fatalf("a new day starts counting again: next %s (attempt %d), want %s (attempt 1)", r.NextAt, r.attempts, want)
	}
}
