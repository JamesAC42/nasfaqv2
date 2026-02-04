package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

type Config struct {
	RedisURL       string
	RedisPassword  string
	GeminiAPIKey   string
	Board          string
	PollInterval   time.Duration
	RequestTimeout time.Duration
	GeminiTimeout  time.Duration
}

type Target struct {
	Name  string
	Match string
}

const (
	analysisKey = "nasfaq_4chan_analysis"
)

var (
	stripTags = regexp.MustCompile("<[^>]+>")
	spaceRe   = regexp.MustCompile(`\s+`)
)

func main() {
	// Load .env automatically (if present). Real environment variables still override.
	// Optional override: ENV_FILE=path/to/.env
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

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	rdb, err := newRedisClient(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer func() { _ = rdb.Close() }()

	fetchClient := &http.Client{Timeout: cfg.RequestTimeout}
	geminiClient := &http.Client{Timeout: cfg.GeminiTimeout}

	resetAll := flag.Bool("reset-all", false, "Clear stored 4chan scraper state in Redis")
	flag.Parse()
	if *resetAll {
		if err := resetRedisState(ctx, rdb); err != nil {
			log.Fatalf("reset: %v", err)
		}
		log.Printf("reset: completed")
		return
	}

	targets := []Target{
		{Name: "nasfaqg", Match: "/nasfaqg/"},
		{Name: "pound", Match: "/#/"},
	}

	run := func() {
		if err := scrapeOnce(ctx, fetchClient, geminiClient, rdb, cfg, targets); err != nil {
			log.Printf("scrape: %v", err)
		}
	}

	log.Printf("scrape: running immediately")
	run()

	ticker := time.NewTicker(cfg.PollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			log.Printf("shutdown: %v", ctx.Err())
			return
		case <-ticker.C:
			run()
		}
	}
}

func mustLoadConfig() Config {
	getEnv := func(key, fallback string) string {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
		return fallback
	}

	pollSeconds := parseEnvInt("POLL_INTERVAL_SECONDS", 600)
	timeoutSeconds := parseEnvInt("REQUEST_TIMEOUT_SECONDS", 15)
	geminiTimeoutSeconds := parseEnvInt("GEMINI_TIMEOUT_SECONDS", 60)

	cfg := Config{
		RedisURL:       getEnv("REDIS_URL", ""),
		RedisPassword:  getEnv("REDIS_PASSWORD", ""),
		GeminiAPIKey:   getEnv("GEMINI_API_KEY", ""),
		Board:          getEnv("FOURCHAN_BOARD", "vt"),
		PollInterval:   time.Duration(pollSeconds) * time.Second,
		RequestTimeout: time.Duration(timeoutSeconds) * time.Second,
		GeminiTimeout:  time.Duration(geminiTimeoutSeconds) * time.Second,
	}

	var missing []string
	if cfg.RedisURL == "" {
		missing = append(missing, "REDIS_URL")
	}
	if cfg.GeminiAPIKey == "" {
		missing = append(missing, "GEMINI_API_KEY")
	}
	if len(missing) > 0 {
		log.Fatalf("missing required env vars: %s", strings.Join(missing, ", "))
	}
	return cfg
}

func parseEnvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	out, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return out
}

func newRedisClient(redisURL, redisPassword string) (*redis.Client, error) {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return nil, err
	}
	if redisPassword != "" {
		opt.Password = redisPassword
	}
	client := redis.NewClient(opt)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, err
	}
	return client, nil
}

type catalogPage struct {
	Page    int             `json:"page"`
	Threads []catalogThread `json:"threads"`
}

type catalogThread struct {
	No          int64  `json:"no"`
	Sub         string `json:"sub"`
	Com         string `json:"com"`
	SemanticURL string `json:"semantic_url"`
}

type threadResponse struct {
	Posts []post `json:"posts"`
}

type post struct {
	No    int64  `json:"no"`
	Resto int64  `json:"resto"`
	Sub   string `json:"sub"`
	Com   string `json:"com"`
	Time  int64  `json:"time"`
	Name  string `json:"name"`
}

func scrapeOnce(ctx context.Context, fetchClient *http.Client, geminiClient *http.Client, rdb *redis.Client, cfg Config, targets []Target) error {
	catalog, err := fetchCatalog(ctx, fetchClient, cfg.Board)
	if err != nil {
		return err
	}

	for _, target := range targets {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		foundID := findThreadID(catalog, target.Match)
		threadID, ok, err := resolveThreadID(ctx, rdb, target, foundID)
		if err != nil {
			log.Printf("thread resolve %s: %v", target.Name, err)
			continue
		}
		if !ok {
			log.Printf("thread %s: no active thread found", target.Name)
			continue
		}

		posts, err := fetchThread(ctx, fetchClient, cfg.Board, threadID)
		if err != nil {
			log.Printf("thread %s/%d: %v", target.Name, threadID, err)
			continue
		}

		newPosts, newIDs, err := filterNewPosts(ctx, rdb, threadID, posts)
		if err != nil {
			log.Printf("thread %s/%d: %v", target.Name, threadID, err)
			continue
		}
		if len(newPosts) == 0 {
			continue
		}

		logPosts := formatPostsForLog(newPosts)
		log.Printf("gemini input %s/%d: %d posts\n%s", target.Name, threadID, len(newPosts), logPosts)

		prompt := buildPrompt(cfg.Board, target, threadID, newPosts)
		analysisText, err := callGemini(ctx, geminiClient, cfg.GeminiAPIKey, prompt)
		if err != nil {
			log.Printf("gemini %s/%d: %v", target.Name, threadID, err)
			continue
		}
		if !isValidJSONResponse(analysisText) {
			log.Printf("gemini output %s/%d: invalid JSON, retrying with compact response", target.Name, threadID)
			compactPrompt := buildPrompt(cfg.Board, target, threadID, newPosts) + "\nIMPORTANT: Output must be valid JSON on a single line, no extra text. Keep it compact."
			analysisText, err = callGemini(ctx, geminiClient, cfg.GeminiAPIKey, compactPrompt)
			if err != nil {
				log.Printf("gemini retry %s/%d: %v", target.Name, threadID, err)
				continue
			}
		}
		log.Printf("gemini output %s/%d:\n%s", target.Name, threadID, analysisText)

		entryJSON, shouldStore, err := buildAnalysisEntry(target, threadID, newIDs, analysisText)
		if err != nil {
			log.Printf("analysis %s/%d: %v", target.Name, threadID, err)
			continue
		}
		if !shouldStore {
			log.Printf("analysis %s/%d: model reported no relevant data, skipping", target.Name, threadID)
			continue
		}
		if err := storeAnalysis(ctx, rdb, entryJSON); err != nil {
			log.Printf("analysis store %s/%d: %v", target.Name, threadID, err)
			continue
		}
	}

	return nil
}

func fetchCatalog(ctx context.Context, client *http.Client, board string) ([]catalogPage, error) {
	url := fmt.Sprintf("https://a.4cdn.org/%s/catalog.json", board)
	body, err := fetch(ctx, client, url)
	if err != nil {
		return nil, err
	}
	var pages []catalogPage
	if err := json.Unmarshal(body, &pages); err != nil {
		return nil, err
	}
	return pages, nil
}

func findThreadID(pages []catalogPage, match string) int64 {
	needle := strings.ToLower(match)
	for _, page := range pages {
		for _, th := range page.Threads {
			source := th.Sub
			if strings.TrimSpace(source) == "" {
				source = th.Com
			}
			text := strings.ToLower(cleanText(source))
			if strings.Contains(text, needle) {
				return th.No
			}
		}
	}
	return 0
}

func resolveThreadID(ctx context.Context, rdb *redis.Client, target Target, foundID int64) (int64, bool, error) {
	key := activeThreadKey(target.Name)
	currentStr, _ := rdb.Get(ctx, key).Result()
	currentID, _ := strconv.ParseInt(currentStr, 10, 64)

	if foundID != 0 {
		if currentID != 0 && currentID != foundID {
			_ = rdb.Del(ctx, seenKey(currentID)).Err()
		}
		if err := rdb.Set(ctx, key, foundID, 0).Err(); err != nil {
			return 0, false, err
		}
		return foundID, true, nil
	}

	if currentID != 0 {
		return currentID, true, nil
	}
	return 0, false, nil
}

func fetchThread(ctx context.Context, client *http.Client, board string, threadID int64) ([]post, error) {
	url := fmt.Sprintf("https://a.4cdn.org/%s/thread/%d.json", board, threadID)
	body, err := fetch(ctx, client, url)
	if err != nil {
		return nil, err
	}
	var resp threadResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	return resp.Posts, nil
}

func filterNewPosts(ctx context.Context, rdb *redis.Client, threadID int64, posts []post) ([]post, []int64, error) {
	if len(posts) == 0 {
		return nil, nil, nil
	}

	key := seenKey(threadID)
	ids := make([]string, 0, len(posts))
	for _, p := range posts {
		ids = append(ids, strconv.FormatInt(p.No, 10))
	}

	members := make([]interface{}, 0, len(ids))
	for _, id := range ids {
		members = append(members, id)
	}

	seen, err := rdb.SMIsMember(ctx, key, members...).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		if strings.Contains(strings.ToLower(err.Error()), "unknown command") {
			seen, err = fallbackSMembers(ctx, rdb, key, ids)
		}
	}
	if err != nil && !errors.Is(err, redis.Nil) {
		return nil, nil, err
	}
	if len(seen) != len(ids) {
		seen = make([]bool, len(ids))
	}

	newPosts := make([]post, 0)
	newIDs := make([]int64, 0)
	for i, p := range posts {
		if !seen[i] {
			newPosts = append(newPosts, p)
			newIDs = append(newIDs, p.No)
		}
	}

	if len(newIDs) == 0 {
		return nil, nil, nil
	}

	pipe := rdb.Pipeline()
	for _, id := range newIDs {
		pipe.SAdd(ctx, key, strconv.FormatInt(id, 10))
	}
	pipe.Expire(ctx, key, 7*24*time.Hour)
	if _, err := pipe.Exec(ctx); err != nil {
		return nil, nil, err
	}

	return newPosts, newIDs, nil
}

func buildPrompt(board string, target Target, threadID int64, posts []post) string {
	var b strings.Builder
	b.WriteString("You are a financial investor scanning online communities for alpha.\n")
	b.WriteString("Treat vtuber YouTube channels as stocks.\n")
	b.WriteString("ONLY pay attention to Hololive vtubers and Hololive-related topics. Ignore everyone else.\n")
	b.WriteString("Do not mention non-Hololive talents, companies, or events even for comparison.\n")
	b.WriteString("If no Hololive-relevant signals appear in the posts, return JSON with {\"skip\": true, \"reason\": \"no relevant data\"} and nothing else.\n")
	b.WriteString("Summarize the sentiment, catalysts, risks, volatility, and buy/sell signals based on the posts.\n")
	b.WriteString("Return JSON ONLY. Do not include markdown fences or extra text.\n")
	b.WriteString("Required JSON shape:\n")
	b.WriteString("{\n")
	b.WriteString("  \"skip\": false,\n")
	b.WriteString("  \"market_report\": {\n")
	b.WriteString("    \"summary\": string,\n")
	b.WriteString("    \"top_alpha\": [\n")
	b.WriteString("      {\n")
	b.WriteString("        \"talent\": string,\n")
	b.WriteString("        \"ticker\": string,\n")
	b.WriteString("        \"action\": \"STRONG BUY\" | \"BUY\" | \"HOLD\" | \"SELL\" | \"WATCH\",\n")
	b.WriteString("        \"reasoning\": string\n")
	b.WriteString("      }\n")
	b.WriteString("    ],\n")
	b.WriteString("    \"ccv_performance_tally\": {\n")
	b.WriteString("      \"gold\": string,\n")
	b.WriteString("      \"silver\": string,\n")
	b.WriteString("      \"bronze\": string\n")
	b.WriteString("    },\n")
	b.WriteString("    \"merch_inventory_stats\": {\n")
	b.WriteString("      \"context\": string,\n")
	b.WriteString("      \"low_stock_high_demand\": [{\"name\": string, \"stock_remaining\": number}],\n")
	b.WriteString("      \"high_stock_low_velocity\": [{\"name\": string, \"stock_remaining\": number}]\n")
	b.WriteString("    },\n")
	b.WriteString("    \"sentiment_analysis\": {\n")
	b.WriteString("      \"hololive_en\": string,\n")
	b.WriteString("      \"hololive_jp\": string,\n")
	b.WriteString("      \"hololive_id\": string\n")
	b.WriteString("    },\n")
	b.WriteString("    \"risk_factors\": [{\"type\": string, \"details\": string}]\n")
	b.WriteString("  }\n")
	b.WriteString("}\n")
	b.WriteString("\n")
	b.WriteString("Context: 4chan board /")
	b.WriteString(board)
	b.WriteString("/, thread title match ")
	b.WriteString(target.Match)
	b.WriteString(", thread id ")
	b.WriteString(strconv.FormatInt(threadID, 10))
	b.WriteString(".\n")
	b.WriteString("New posts:\n")

	for _, p := range posts {
		text := cleanText(postText(p))
		if text == "" {
			continue
		}
		b.WriteString("-")
		b.WriteString(strconv.FormatInt(p.No, 10))
		b.WriteString(": ")
		b.WriteString(text)
		b.WriteString("\n")
	}

	return b.String()
}

func postText(p post) string {
	if p.Sub != "" && p.Com != "" {
		return p.Sub + " - " + p.Com
	}
	if p.Sub != "" {
		return p.Sub
	}
	return p.Com
}

func formatPostsForLog(posts []post) string {
	var b strings.Builder
	for _, p := range posts {
		text := cleanText(postText(p))
		if text == "" {
			continue
		}
		b.WriteString("- ")
		b.WriteString(strconv.FormatInt(p.No, 10))
		b.WriteString(": ")
		b.WriteString(text)
		b.WriteString("\n")
	}
	return strings.TrimSpace(b.String())
}

func cleanText(s string) string {
	if s == "" {
		return ""
	}
	unescaped := html.UnescapeString(s)
	stripped := stripTags.ReplaceAllString(unescaped, " ")
	trimmed := strings.TrimSpace(spaceRe.ReplaceAllString(stripped, " "))
	return trimmed
}

func callGemini(ctx context.Context, client *http.Client, apiKey, prompt string) (string, error) {
	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-preview:generateContent?key=%s", apiKey)
	payload := map[string]any{
		"contents": []map[string]any{
			{
				"role": "user",
				"parts": []map[string]any{
					{"text": prompt},
				},
			},
		},
		"generationConfig": map[string]any{
			"temperature":      0.4,
			"maxOutputTokens":  4096,
			"responseMimeType": "application/json",
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		if isTimeoutErr(err) {
			return "", fmt.Errorf("gemini request timeout")
		}
		return "", err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("gemini http %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.Unmarshal(data, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Candidates) == 0 || len(parsed.Candidates[0].Content.Parts) == 0 {
		return "", fmt.Errorf("gemini response missing content")
	}

	return strings.TrimSpace(parsed.Candidates[0].Content.Parts[0].Text), nil
}

type analysisEntry struct {
	Timestamp   string          `json:"timestamp"`
	ThreadTag   string          `json:"thread_tag"`
	ThreadMatch string          `json:"thread_match"`
	ThreadID    int64           `json:"thread_id"`
	NewPostIDs  []int64         `json:"new_post_ids"`
	Analysis    json.RawMessage `json:"analysis,omitempty"`
	AnalysisRaw string          `json:"analysis_raw,omitempty"`
}

func buildAnalysisEntry(target Target, threadID int64, postIDs []int64, analysisText string) (string, bool, error) {
	jsonText := extractJSON(analysisText)
	entry := analysisEntry{
		Timestamp:   time.Now().UTC().Format(time.RFC3339),
		ThreadTag:   target.Name,
		ThreadMatch: target.Match,
		ThreadID:    threadID,
		NewPostIDs:  postIDs,
	}

	if jsonText != "" {
		var tmp json.RawMessage
		if json.Unmarshal([]byte(jsonText), &tmp) == nil {
			var payload map[string]any
			if json.Unmarshal(tmp, &payload) == nil {
				if skip, ok := payload["skip"].(bool); ok && skip {
					return "", false, nil
				}
				if _, ok := payload["market_report"]; !ok {
					return "", false, nil
				}
			}
			entry.Analysis = tmp
		} else {
			entry.AnalysisRaw = analysisText
		}
	} else {
		entry.AnalysisRaw = analysisText
	}

	out, err := json.Marshal(entry)
	if err != nil {
		return "", false, err
	}
	return string(out), true, nil
}

func extractJSON(s string) string {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "{") && strings.HasSuffix(trimmed, "}") {
		return trimmed
	}
	start := strings.Index(trimmed, "{")
	end := strings.LastIndex(trimmed, "}")
	if start >= 0 && end > start {
		return trimmed[start : end+1]
	}
	return ""
}

func isValidJSONResponse(s string) bool {
	jsonText := extractJSON(s)
	if jsonText == "" {
		return false
	}
	return json.Valid([]byte(jsonText))
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "client.timeout") || strings.Contains(msg, "timeout")
}

func storeAnalysis(ctx context.Context, rdb *redis.Client, entry string) error {
	now := time.Now().UTC()
	cutoff := now.Add(-24 * time.Hour).Unix()

	pipe := rdb.Pipeline()
	pipe.ZAdd(ctx, analysisKey, redis.Z{Score: float64(now.Unix()), Member: entry})
	pipe.ZRemRangeByScore(ctx, analysisKey, "-inf", fmt.Sprintf("%d", cutoff))
	pipe.Expire(ctx, analysisKey, 25*time.Hour)
	_, err := pipe.Exec(ctx)
	return err
}

func activeThreadKey(tag string) string {
	return fmt.Sprintf("nasfaq_4chan_active_thread:%s", tag)
}

func seenKey(threadID int64) string {
	return fmt.Sprintf("nasfaq_4chan_seen:%d", threadID)
}

func fetch(ctx context.Context, client *http.Client, url string) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		data, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("http %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}
	return io.ReadAll(resp.Body)
}

func resetRedisState(ctx context.Context, rdb *redis.Client) error {
	patterns := []string{
		"nasfaq_4chan_active_thread:*",
		"nasfaq_4chan_seen:*",
		analysisKey,
	}
	for _, pattern := range patterns {
		iter := rdb.Scan(ctx, 0, pattern, 200).Iterator()
		for iter.Next(ctx) {
			if err := rdb.Del(ctx, iter.Val()).Err(); err != nil {
				return err
			}
		}
		if err := iter.Err(); err != nil {
			return err
		}
	}
	return nil
}
func fallbackSMembers(ctx context.Context, rdb *redis.Client, key string, ids []string) ([]bool, error) {
	pipe := rdb.Pipeline()
	cmds := make([]*redis.BoolCmd, 0, len(ids))
	for _, id := range ids {
		cmds = append(cmds, pipe.SIsMember(ctx, key, id))
	}
	if _, err := pipe.Exec(ctx); err != nil && !errors.Is(err, redis.Nil) {
		return nil, err
	}
	out := make([]bool, 0, len(cmds))
	for _, cmd := range cmds {
		val, err := cmd.Result()
		if err != nil && !errors.Is(err, redis.Nil) {
			return nil, err
		}
		out = append(out, val)
	}
	return out, nil
}
