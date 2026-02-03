package youtube

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type Client struct {
	APIKey     string
	HTTPClient *http.Client
}

func New(apiKey string) *Client {
	return &Client{
		APIKey: apiKey,
		HTTPClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

type ChannelStats struct {
	SubscriberCount       *int64
	ViewCount             *int64
	VideoCount            *int64
	HiddenSubscriberCount *bool
	Country               *string
}

type ChannelInfo struct {
	ChannelID         string
	Stats             ChannelStats
	UploadsPlaylistID string
}

type RecentPointer struct {
	VideoID      string
	PublishedAt  time.Time
	IsLiveStream bool
}

type Video struct {
	VideoID      string
	Title        string
	ThumbnailURL string
	ChannelID    string

	ScheduledStartTime *time.Time
	ActualStartTime    *time.Time
	ConcurrentViewers  *int64
}

func (c *Client) FetchChannelStats(ctx context.Context, channelID string) (ChannelStats, error) {
	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/channels")
	q := u.Query()
	q.Set("part", "statistics,snippet")
	q.Set("id", channelID)
	q.Set("key", c.APIKey)
	u.RawQuery = q.Encode()

	var resp struct {
		Items []struct {
			Snippet struct {
				Country *string `json:"country"`
			} `json:"snippet"`
			Statistics struct {
				SubscriberCount       *string `json:"subscriberCount"`
				ViewCount             *string `json:"viewCount"`
				VideoCount            *string `json:"videoCount"`
				HiddenSubscriberCount *bool   `json:"hiddenSubscriberCount"`
			} `json:"statistics"`
		} `json:"items"`
	}

	if err := c.getJSON(ctx, u.String(), &resp); err != nil {
		return ChannelStats{}, err
	}
	if len(resp.Items) == 0 {
		return ChannelStats{}, fmt.Errorf("channel not found or inaccessible: %s", channelID)
	}

	item := resp.Items[0]
	out := ChannelStats{
		HiddenSubscriberCount: item.Statistics.HiddenSubscriberCount,
		Country:               item.Snippet.Country,
	}

	out.SubscriberCount = parseInt64Ptr(item.Statistics.SubscriberCount)
	out.ViewCount = parseInt64Ptr(item.Statistics.ViewCount)
	out.VideoCount = parseInt64Ptr(item.Statistics.VideoCount)

	return out, nil
}

// FetchChannelInfos fetches stats + uploads playlist ids for up to 50 channels in one call.
func (c *Client) FetchChannelInfos(ctx context.Context, channelIDs []string) (map[string]ChannelInfo, error) {
	if len(channelIDs) == 0 {
		return map[string]ChannelInfo{}, nil
	}
	if len(channelIDs) > 50 {
		return nil, fmt.Errorf("FetchChannelInfos expects <=50 channel IDs, got %d", len(channelIDs))
	}

	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/channels")
	q := u.Query()
	q.Set("part", "statistics,snippet,contentDetails")
	q.Set("id", strings.Join(channelIDs, ","))
	q.Set("key", c.APIKey)
	u.RawQuery = q.Encode()

	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Country *string `json:"country"`
			} `json:"snippet"`
			Statistics struct {
				SubscriberCount       *string `json:"subscriberCount"`
				ViewCount             *string `json:"viewCount"`
				VideoCount            *string `json:"videoCount"`
				HiddenSubscriberCount *bool   `json:"hiddenSubscriberCount"`
			} `json:"statistics"`
			ContentDetails struct {
				RelatedPlaylists struct {
					Uploads string `json:"uploads"`
				} `json:"relatedPlaylists"`
			} `json:"contentDetails"`
		} `json:"items"`
	}

	if err := c.getJSON(ctx, u.String(), &resp); err != nil {
		return nil, err
	}

	out := make(map[string]ChannelInfo, len(resp.Items))
	for _, item := range resp.Items {
		if item.ID == "" {
			continue
		}
		stats := ChannelStats{
			HiddenSubscriberCount: item.Statistics.HiddenSubscriberCount,
			Country:               item.Snippet.Country,
		}
		stats.SubscriberCount = parseInt64Ptr(item.Statistics.SubscriberCount)
		stats.ViewCount = parseInt64Ptr(item.Statistics.ViewCount)
		stats.VideoCount = parseInt64Ptr(item.Statistics.VideoCount)

		out[item.ID] = ChannelInfo{
			ChannelID:         item.ID,
			Stats:             stats,
			UploadsPlaylistID: item.ContentDetails.RelatedPlaylists.Uploads,
		}
	}

	return out, nil
}

// FetchRecent finds:
// - the most recent upload (type=video, order=date)
// - the most recent completed livestream (eventType=completed)
//
// NOTE: search.list is expensive in quota; this is the most reliable way to get
// last-livestream pointers without extra assumptions. If quota is an issue, we
// can switch to activities.list in a follow-up.
func (c *Client) FetchRecent(ctx context.Context, channelID string) (lastUpload *RecentPointer, lastLive *RecentPointer, err error) {
	upload, err := c.searchLatest(ctx, channelID, nil)
	if err != nil {
		return nil, nil, err
	}

	eventType := "completed"
	live, err := c.searchLatest(ctx, channelID, &eventType)
	if err != nil {
		return upload, nil, err
	}
	if live != nil {
		live.IsLiveStream = true
	}
	return upload, live, nil
}

// FetchRecentFromUploads uses the uploads playlist to find the most recent upload and livestream.
// This avoids search.list quota costs (uses playlistItems.list + videos.list).
func (c *Client) FetchRecentFromUploads(ctx context.Context, uploadsPlaylistID string, maxItems int) (lastUpload *RecentPointer, lastLive *RecentPointer, err error) {
	if uploadsPlaylistID == "" {
		return nil, nil, nil
	}
	if maxItems <= 0 {
		maxItems = 8
	}

	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/playlistItems")
	q := u.Query()
	q.Set("part", "contentDetails")
	q.Set("playlistId", uploadsPlaylistID)
	q.Set("maxResults", strconv.Itoa(maxItems))
	q.Set("key", c.APIKey)
	u.RawQuery = q.Encode()

	var resp struct {
		Items []struct {
			ContentDetails struct {
				VideoID          string `json:"videoId"`
				VideoPublishedAt string `json:"videoPublishedAt"`
			} `json:"contentDetails"`
		} `json:"items"`
	}
	if err := c.getJSON(ctx, u.String(), &resp); err != nil {
		if isPlaylistNotFoundError(err) {
			return nil, nil, nil
		}
		return nil, nil, err
	}
	if len(resp.Items) == 0 {
		return nil, nil, nil
	}

	type item struct {
		VideoID     string
		PublishedAt time.Time
	}
	items := make([]item, 0, len(resp.Items))
	for _, it := range resp.Items {
		if it.ContentDetails.VideoID == "" || it.ContentDetails.VideoPublishedAt == "" {
			continue
		}
		t, err := time.Parse(time.RFC3339, it.ContentDetails.VideoPublishedAt)
		if err != nil {
			continue
		}
		items = append(items, item{
			VideoID:     it.ContentDetails.VideoID,
			PublishedAt: t.UTC(),
		})
	}
	if len(items) == 0 {
		return nil, nil, nil
	}

	lastUpload = &RecentPointer{
		VideoID:     items[0].VideoID,
		PublishedAt: items[0].PublishedAt,
	}

	ids := make([]string, 0, len(items))
	for _, it := range items {
		ids = append(ids, it.VideoID)
	}
	videos, err := c.FetchVideos(ctx, ids)
	if err != nil {
		return lastUpload, nil, err
	}
	videoMap := make(map[string]Video, len(videos))
	for _, v := range videos {
		videoMap[v.VideoID] = v
	}

	var best *RecentPointer
	for _, it := range items {
		v, ok := videoMap[it.VideoID]
		if !ok || v.ActualStartTime == nil {
			continue
		}
		ts := v.ActualStartTime.UTC()
		if best == nil || ts.After(best.PublishedAt) {
			best = &RecentPointer{
				VideoID:      it.VideoID,
				PublishedAt:  ts,
				IsLiveStream: true,
			}
		}
	}

	return lastUpload, best, nil
}

func isPlaylistNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "playlistnotfound") || strings.Contains(msg, "playlistid") && strings.Contains(msg, "404")
}

func (c *Client) SearchEventVideoIDs(ctx context.Context, channelID string, eventType string, maxResults int) ([]string, error) {
	if maxResults <= 0 {
		maxResults = 5
	}
	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/search")
	q := u.Query()
	q.Set("part", "id")
	q.Set("channelId", channelID)
	q.Set("maxResults", strconv.Itoa(maxResults))
	q.Set("order", "date")
	q.Set("type", "video")
	q.Set("eventType", eventType) // live | upcoming | completed
	q.Set("key", c.APIKey)
	u.RawQuery = q.Encode()

	var resp struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
		} `json:"items"`
	}
	if err := c.getJSON(ctx, u.String(), &resp); err != nil {
		return nil, err
	}
	out := make([]string, 0, len(resp.Items))
	for _, it := range resp.Items {
		if it.ID.VideoID != "" {
			out = append(out, it.ID.VideoID)
		}
	}
	return out, nil
}

func (c *Client) FetchVideos(ctx context.Context, videoIDs []string) ([]Video, error) {
	if len(videoIDs) == 0 {
		return nil, nil
	}
	// videos.list accepts up to 50 ids.
	if len(videoIDs) > 50 {
		videoIDs = videoIDs[:50]
	}

	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/videos")
	q := u.Query()
	q.Set("part", "snippet,liveStreamingDetails")
	q.Set("id", strings.Join(videoIDs, ","))
	q.Set("key", c.APIKey)
	u.RawQuery = q.Encode()

	var resp struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title     string `json:"title"`
				ChannelID string `json:"channelId"`
				Thumbnails struct {
					Maxres struct{ URL string `json:"url"` } `json:"maxres"`
					High   struct{ URL string `json:"url"` } `json:"high"`
					Medium struct{ URL string `json:"url"` } `json:"medium"`
					Default struct{ URL string `json:"url"` } `json:"default"`
				} `json:"thumbnails"`
			} `json:"snippet"`
			LiveStreamingDetails struct {
				ScheduledStartTime string  `json:"scheduledStartTime"`
				ActualStartTime    string  `json:"actualStartTime"`
				ConcurrentViewers  *string `json:"concurrentViewers"`
			} `json:"liveStreamingDetails"`
		} `json:"items"`
	}
	if err := c.getJSON(ctx, u.String(), &resp); err != nil {
		return nil, err
	}

	out := make([]Video, 0, len(resp.Items))
	for _, it := range resp.Items {
		v := Video{
			VideoID:    it.ID,
			Title:      it.Snippet.Title,
			ChannelID:  it.Snippet.ChannelID,
			ThumbnailURL: pickThumb(it.Snippet.Thumbnails),
		}
		if ts := parseTimePtr(it.LiveStreamingDetails.ScheduledStartTime); ts != nil {
			v.ScheduledStartTime = ts
		}
		if ts := parseTimePtr(it.LiveStreamingDetails.ActualStartTime); ts != nil {
			v.ActualStartTime = ts
		}
		v.ConcurrentViewers = parseInt64Ptr(it.LiveStreamingDetails.ConcurrentViewers)
		if v.VideoID != "" {
			out = append(out, v)
		}
	}
	return out, nil
}

func (c *Client) searchLatest(ctx context.Context, channelID string, eventType *string) (*RecentPointer, error) {
	u, _ := url.Parse("https://www.googleapis.com/youtube/v3/search")
	q := u.Query()
	q.Set("part", "snippet")
	q.Set("channelId", channelID)
	q.Set("maxResults", "1")
	q.Set("order", "date")
	q.Set("type", "video")
	if eventType != nil {
		q.Set("eventType", *eventType)
	}
	q.Set("key", c.APIKey)
	u.RawQuery = q.Encode()

	var resp struct {
		Items []struct {
			ID struct {
				VideoID string `json:"videoId"`
			} `json:"id"`
			Snippet struct {
				PublishedAt string `json:"publishedAt"`
			} `json:"snippet"`
		} `json:"items"`
	}

	if err := c.getJSON(ctx, u.String(), &resp); err != nil {
		return nil, err
	}
	if len(resp.Items) == 0 {
		return nil, nil
	}
	it := resp.Items[0]
	if it.ID.VideoID == "" || it.Snippet.PublishedAt == "" {
		return nil, nil
	}
	t, err := time.Parse(time.RFC3339, it.Snippet.PublishedAt)
	if err != nil {
		return nil, fmt.Errorf("parse publishedAt %q: %w", it.Snippet.PublishedAt, err)
	}
	return &RecentPointer{VideoID: it.ID.VideoID, PublishedAt: t}, nil
}

func (c *Client) getJSON(ctx context.Context, rawURL string, out any) error {
	if c.APIKey == "" {
		return fmt.Errorf("missing YOUTUBE_API_KEY")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	res, err := c.HTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("http request: %w", err)
	}
	defer res.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("youtube api http %d: %s", res.StatusCode, string(body))
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode json: %w", err)
	}
	return nil
}

func parseInt64Ptr(s *string) *int64 {
	if s == nil || *s == "" {
		return nil
	}
	v, err := strconv.ParseInt(*s, 10, 64)
	if err != nil {
		return nil
	}
	return &v
}

func parseTimePtr(s string) *time.Time {
	if s == "" {
		return nil
	}
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		return nil
	}
	tt := t.UTC()
	return &tt
}

func pickThumb(t struct {
	Maxres  struct{ URL string `json:"url"` } `json:"maxres"`
	High    struct{ URL string `json:"url"` } `json:"high"`
	Medium  struct{ URL string `json:"url"` } `json:"medium"`
	Default struct{ URL string `json:"url"` } `json:"default"`
}) string {
	if t.Maxres.URL != "" {
		return t.Maxres.URL
	}
	if t.High.URL != "" {
		return t.High.URL
	}
	if t.Medium.URL != "" {
		return t.Medium.URL
	}
	return t.Default.URL
}
