package main

import (
	"testing"
	"time"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/youtube"
)

func TestWatchedUpcomingOnlyCoversTheWindow(t *testing.T) {
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	tracker := &liveTracker{upcoming: map[string]*upcomingStreamState{
		"soon":        {VideoID: "soon", ChannelID: "a", ScheduledStartTime: now.Add(time.Hour)},
		"edge":        {VideoID: "edge", ChannelID: "a", ScheduledStartTime: now.Add(earlyStartWatchWindow)},
		"far":         {VideoID: "far", ChannelID: "b", ScheduledStartTime: now.Add(earlyStartWatchWindow + time.Minute)},
		"overdue":     {VideoID: "overdue", ChannelID: "c", ScheduledStartTime: now.Add(-time.Minute)},
		"unscheduled": {VideoID: "unscheduled", ChannelID: "d"},
		"nil":         nil,
	}}

	watched := tracker.watchedUpcoming(now, earlyStartWatchWindow)
	if len(watched) != 2 {
		t.Fatalf("watched %d streams, want 2: %v", len(watched), watched)
	}
	for _, id := range []string{"soon", "edge"} {
		if _, ok := watched[id]; !ok {
			t.Errorf("%s should be watched", id)
		}
	}
}

func TestChannelsWithChangedStreams(t *testing.T) {
	now := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	scheduled := now.Add(time.Hour)
	moved := now.Add(30 * time.Minute)
	sameInstant := scheduled.In(time.FixedZone("JST", 9*3600))
	watched := map[string]upcomingStreamState{
		"quiet":   {VideoID: "quiet", ChannelID: "quiet-channel", ScheduledStartTime: scheduled},
		"retimed": {VideoID: "retimed", ChannelID: "retimed-channel", ScheduledStartTime: scheduled},
		"early":   {VideoID: "early", ChannelID: "early-channel", ScheduledStartTime: scheduled},
		"ended":   {VideoID: "ended", ChannelID: "ended-channel", ScheduledStartTime: scheduled},
		"deleted": {VideoID: "deleted", ChannelID: "deleted-channel", ScheduledStartTime: scheduled},
	}
	videos := []youtube.Video{
		{VideoID: "quiet", ScheduledStartTime: &sameInstant},
		{VideoID: "retimed", ScheduledStartTime: &moved},
		{VideoID: "early", ScheduledStartTime: &scheduled, ActualStartTime: &now},
		{VideoID: "ended", ScheduledStartTime: &scheduled, ActualEndTime: &now},
		{VideoID: "unwatched", ActualStartTime: &now},
	}

	changed := channelsWithChangedStreams(watched, videos)
	for _, id := range []string{"retimed-channel", "early-channel", "ended-channel"} {
		if _, ok := changed[id]; !ok {
			t.Errorf("%s should be polled", id)
		}
	}
	if len(changed) != 3 {
		t.Errorf("changed = %v, want exactly 3 channels", changed)
	}
}

func TestMergeChannelsKeepsOneOfEach(t *testing.T) {
	a := db.Channel{YouTubeChannelID: "a"}
	b := db.Channel{YouTubeChannelID: "b"}
	c := db.Channel{YouTubeChannelID: "c"}

	merged := mergeChannels([]db.Channel{a, b}, []db.Channel{b, c, c})
	if len(merged) != 3 {
		t.Fatalf("merged %d channels, want 3: %v", len(merged), merged)
	}
	if got := mergeChannels(nil, nil); len(got) != 0 {
		t.Errorf("merging nothing gave %v", got)
	}
}
