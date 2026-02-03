package livestreams

import "time"

type StreamStatus string

const (
	StatusLive     StreamStatus = "live"
	StatusUpcoming StreamStatus = "upcoming"
)

type Stream struct {
	VideoID      string       `json:"video_id"`
	VideoURL     string       `json:"video_url"`
	Status       StreamStatus `json:"status"`
	Title        string       `json:"title"`
	ThumbnailURL string       `json:"thumbnail_url"`

	ChannelID   string  `json:"channel_id"`
	ChannelName string  `json:"channel_name"`
	ChannelIcon *string `json:"channel_icon,omitempty"`

	ScheduledStartTime *time.Time `json:"scheduled_start_time,omitempty"`
	ActualStartTime    *time.Time `json:"actual_start_time,omitempty"`

	ConcurrentViewers *int64 `json:"concurrent_viewers,omitempty"`

	UpdatedAt time.Time `json:"updated_at"`
}


