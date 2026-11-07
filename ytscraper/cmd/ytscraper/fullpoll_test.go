package main

import (
	"testing"
	"time"
)

func TestFirstFullPollDelay(t *testing.T) {
	interval := 30 * time.Minute
	now := time.Date(2026, 11, 6, 23, 45, 0, 0, time.UTC)
	cases := []struct {
		name      string
		lastStart time.Time
		want      time.Duration
	}{
		{"never recorded: poll at once", time.Time{}, 0},
		{"15 minutes ago: keep its schedule", now.Add(-15 * time.Minute), 15 * time.Minute},
		{"just now", now, interval},
		{"exactly one interval ago: due", now.Add(-interval), 0},
		{"overdue", now.Add(-50 * time.Minute), 0},
		{"in the future (clock skew): poll at once", now.Add(5 * time.Minute), 0},
	}
	for _, c := range cases {
		if got := firstFullPollDelay(now, c.lastStart, interval); got != c.want {
			t.Errorf("%s: firstFullPollDelay = %s, want %s", c.name, got, c.want)
		}
	}
	if got := firstFullPollDelay(now, now.Add(-time.Minute), 0); got != 0 {
		t.Errorf("no interval configured: firstFullPollDelay = %s, want 0", got)
	}
}

func TestParseFullPollMarker(t *testing.T) {
	at := time.Date(2026, 11, 6, 23, 30, 0, 123456789, time.UTC)
	if got := parseFullPollMarker(at.Format(time.RFC3339Nano)); !got.Equal(at) {
		t.Errorf("round trip: got %s, want %s", got, at)
	}
	for _, bad := range []string{"", "yesterday", "1730935800"} {
		if got := parseFullPollMarker(bad); !got.IsZero() {
			t.Errorf("parseFullPollMarker(%q) = %s, want zero", bad, got)
		}
	}
}

// fullPollTimes plays a series of restarts: each process schedules its first full poll with
// firstDelay, then polls every interval until the next restart kills it. Polls finish at once and
// are recorded. It returns when every full poll ran, starting from the one at lastStart.
func fullPollTimes(lastStart time.Time, restarts []time.Time, end time.Time, interval time.Duration, firstDelay func(now, lastStart time.Time) time.Duration) []time.Time {
	polls := []time.Time{lastStart}
	for i, start := range restarts {
		stop := end
		if i+1 < len(restarts) {
			stop = restarts[i+1]
		}
		for at := start.Add(firstDelay(start, lastStart)); at.Before(stop); at = at.Add(interval) {
			polls = append(polls, at)
			lastStart = at
		}
	}
	return polls
}

func longestGap(polls []time.Time) (time.Duration, time.Time) {
	var gap time.Duration
	var after time.Time
	for i := 1; i < len(polls); i++ {
		if d := polls[i].Sub(polls[i-1]); d > gap {
			gap, after = d, polls[i-1]
		}
	}
	return gap, after
}

// The audit's case (GO1): the last full poll ran at 23:30, then releases restarted the scraper at
// 23:45, 23:58, 00:10, 00:22 and 00:35. A full poll still has to run at least every 30 minutes.
func TestReleaseBurstKeepsTheFullPollSchedule(t *testing.T) {
	interval := 30 * time.Minute
	ny := mustLocation(t, "America/New_York")
	at := func(day, hour, minute int) time.Time { return time.Date(2026, 11, day, hour, minute, 0, 0, ny) }
	last := at(5, 23, 30)
	restarts := []time.Time{at(5, 23, 45), at(5, 23, 58), at(6, 0, 10), at(6, 0, 22), at(6, 0, 35)}
	end := at(6, 2, 0)

	polls := fullPollTimes(last, restarts, end, interval, func(now, lastStart time.Time) time.Duration {
		return firstFullPollDelay(now, lastStart, interval)
	})
	if gap, after := longestGap(polls); gap > interval {
		t.Fatalf("no full poll for %s after the one at %s; polls: %v", gap, after.Format("15:04"), polls)
	}
	if !polls[1].Equal(at(6, 0, 0)) {
		t.Errorf("the first full poll after 23:30 ran at %s, want 00:00", polls[1].Format("15:04"))
	}

	// The rule this replaces skipped the startup poll and waited a whole interval from each restart
	// (whenever Redis held a fresh stream, which a priority poll keeps true): the same burst left
	// 23:30 to 01:05 without one.
	old := fullPollTimes(last, restarts, end, interval, func(time.Time, time.Time) time.Duration { return interval })
	if gap, _ := longestGap(old); gap != 95*time.Minute {
		t.Errorf("the old schedule's longest gap is %s; the simulation should show the 95-minute hole", gap)
	}
}

// A restart in the middle of a full poll: the cut-off poll records nothing, so the next process
// counts from the last poll that finished and polls at once if that's an interval ago.
func TestCutOffPollIsNotCounted(t *testing.T) {
	interval := 30 * time.Minute
	lastFinished := time.Date(2026, 11, 6, 4, 0, 0, 0, time.UTC)
	// The 04:30 poll was under way when the pod was replaced at 04:33.
	restart := lastFinished.Add(33 * time.Minute)
	if got := firstFullPollDelay(restart, lastFinished, interval); got != 0 {
		t.Errorf("after a cut-off poll the next process should poll at once, waits %s", got)
	}
}
