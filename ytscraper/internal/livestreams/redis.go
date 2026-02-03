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


