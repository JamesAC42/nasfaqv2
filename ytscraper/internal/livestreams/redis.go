package livestreams

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type RedisStore struct {
	Client *redis.Client
}

// ChannelViewerUpdates is the Redis pub/sub channel for live viewer count updates.
// Subscribers receive JSON: { "at": "ISO8601", "live": [ Stream, ... ] }.
const ChannelViewerUpdates = "nasfaq_livestreams:viewer_updates"

// ChannelBucketUpdates is the Redis pub/sub channel for 5-minute bucket inserts.
// Subscribers receive JSON: { "video_id": "...", "bucket_start": "...", "bucket_end": "...", "avg_viewers": 123, "max_viewers": 456 }.
const ChannelBucketUpdates = "nasfaq_livestreams:bucket_updates"

func KeyForChannel(channelID string) string {
	// Use {...} so Redis Cluster users get stable hash slotting per channel key.
	return fmt.Sprintf("nasfaq_livestreams:{%s}", channelID)
}

func (s *RedisStore) UpsertChannelStreams(ctx context.Context, channelID string, streams []Stream) error {
	if s == nil || s.Client == nil {
		return fmt.Errorf("nil redis client")
	}

	key := KeyForChannel(channelID)

	// We keep only currently-relevant items (live + upcoming). Anything not in `streams`
	// is removed, so the hash remains a clean "current view".
	existing, err := s.Client.HKeys(ctx, key).Result()
	if err != nil {
		return fmt.Errorf("redis HKEYS %s: %w", key, err)
	}

	pipe := s.Client.Pipeline()

	keep := make(map[string]struct{}, len(streams))
	for _, st := range streams {
		keep[st.VideoID] = struct{}{}
		b, err := json.Marshal(st)
		if err != nil {
			return fmt.Errorf("marshal stream %s: %w", st.VideoID, err)
		}
		// Use single-field HSET calls for maximum compatibility (older Redis servers
		// may not support multi-field HSET).
		// HSET key field value
		pipe.HSet(ctx, key, st.VideoID, string(b))
	}

	var toDelete []string
	for _, field := range existing {
		if _, ok := keep[field]; !ok {
			toDelete = append(toDelete, field)
		}
	}
	if len(toDelete) > 0 {
		pipe.HDel(ctx, key, toDelete...)
	}

	// Keep data around for a week (upcoming streams can be days away). Each update refreshes TTL.
	pipe.Expire(ctx, key, 7*24*time.Hour)

	if _, err := pipe.Exec(ctx); err != nil {
		return fmt.Errorf("redis pipeline exec %s: %w", key, err)
	}
	return nil
}

// GetChannelStreams returns all streams currently stored for the channel (live + upcoming).
func (s *RedisStore) GetChannelStreams(ctx context.Context, channelID string) ([]Stream, error) {
	if s == nil || s.Client == nil {
		return nil, fmt.Errorf("nil redis client")
	}
	key := KeyForChannel(channelID)
	pairs, err := s.Client.HGetAll(ctx, key).Result()
	if err != nil {
		return nil, fmt.Errorf("redis HGETALL %s: %w", key, err)
	}
	out := make([]Stream, 0, len(pairs))
	for _, v := range pairs {
		var st Stream
		if err := json.Unmarshal([]byte(v), &st); err != nil {
			continue
		}
		out = append(out, st)
	}
	return out, nil
}

// ViewerUpdatePayload is the message published to ChannelViewerUpdates.
type ViewerUpdatePayload struct {
	At   time.Time `json:"at"`
	Live []Stream  `json:"live"`
}

// PublishViewerUpdate publishes the current live streams with viewer counts so API/clients can push via WebSocket.
func PublishViewerUpdate(ctx context.Context, client *redis.Client, payload ViewerUpdatePayload) error {
	if client == nil {
		return nil
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return client.Publish(ctx, ChannelViewerUpdates, string(b)).Err()
}

type BucketUpdatePayload struct {
	VideoID     string    `json:"video_id"`
	BucketStart time.Time `json:"bucket_start"`
	BucketEnd   time.Time `json:"bucket_end"`
	AvgViewers  *int64    `json:"avg_viewers,omitempty"`
	MaxViewers  *int64    `json:"max_viewers,omitempty"`
}

func PublishBucketUpdate(ctx context.Context, client *redis.Client, payload BucketUpdatePayload) error {
	if client == nil {
		return nil
	}
	if payload.VideoID == "" {
		return nil
	}
	b, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return client.Publish(ctx, ChannelBucketUpdates, string(b)).Err()
}


