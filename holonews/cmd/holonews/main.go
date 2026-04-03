package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"html"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/JamesAC42/nasfaqv2/holonews/internal/thumbs"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/joho/godotenv"
	"github.com/redis/go-redis/v9"
)

const (
	redisItemsKey        = "nasfaq_holonews:items"
	redisHeadlineHashKey = "nasfaq_holonews:headline_hashes"
	redisMetaKey         = "nasfaq_holonews:meta"
	redisThreadKey       = "nasfaq_holonews:active_thread"
	defaultSectionHeader = "holopro"
	defaultThumbnailCDN  = "https://images.nasfaq.biz"
)

const memberNewsSchemaSQL = `
CREATE SCHEMA IF NOT EXISTS info;

CREATE TABLE IF NOT EXISTS info.member_news (
  id BIGSERIAL PRIMARY KEY,
  headline TEXT NOT NULL,
  thumbnail_url TEXT NULL,
  date DATE NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS member_news_headline_date_uidx
  ON info.member_news (headline, date);

CREATE INDEX IF NOT EXISTS member_news_date_desc_idx
  ON info.member_news (date DESC, id DESC);

CREATE TABLE IF NOT EXISTS info.member_news_channels (
  news_id BIGINT NOT NULL REFERENCES info.member_news(id) ON DELETE CASCADE,
  youtube_channel_id TEXT NOT NULL REFERENCES yt.youtube_channels(youtube_channel_id) ON DELETE CASCADE,
  PRIMARY KEY (news_id, youtube_channel_id)
);

CREATE INDEX IF NOT EXISTS member_news_channels_channel_idx
  ON info.member_news_channels (youtube_channel_id, news_id DESC);
`

type Config struct {
	DatabaseURL             string
	RedisURL                string
	RedisPassword           string
	GeminiAPIKey            string
	GeminiTextModel         string
	GeminiImageModel        string
	AWSAccessKeyID          string
	AWSSecretAccessKey      string
	AWSRegion               string
	AWSBucket               string
	Board                   string
	PollInterval            time.Duration
	RequestTimeout          time.Duration
	GeminiTimeout           time.Duration
	SectionSearchPosts      int
	TopNewsCount            int
	ReferenceImagesS3Prefix string
	ReferenceImagesBaseURL  string
	ThumbnailS3Prefix       string
	ThumbnailCDNBaseURL     string
}

type catalogPage struct {
	Page    int             `json:"page"`
	Threads []catalogThread `json:"threads"`
}

type catalogThread struct {
	No  int64  `json:"no"`
	Sub string `json:"sub"`
	Com string `json:"com"`
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

type storedHeadline struct {
	Headline       string   `json:"headline"`
	Characters     []string `json:"characters,omitempty"`
	Rank           *int     `json:"rank,omitempty"`
	ThumbnailS3Key *string  `json:"thumbnail_s3_key,omitempty"`
}

type storedPayload struct {
	ThreadID   int64            `json:"thread_id"`
	SourcePost int64            `json:"source_post"`
	UpdatedAt  string           `json:"updated_at"`
	Items      []storedHeadline `json:"items"`
}

type rankedHeadline struct {
	Rank     int    `json:"rank"`
	Headline string `json:"headline"`
}

type promptResult struct {
	ImagePrompt string   `json:"image_prompt"`
	Characters  []string `json:"characters"`
}

type geminiResponse struct {
	Candidates []struct {
		Content struct {
			Parts []struct {
				Text       string `json:"text,omitempty"`
				InlineData *struct {
					MIMEType string `json:"mimeType"`
					Data     string `json:"data"`
				} `json:"inlineData,omitempty"`
			} `json:"parts"`
		} `json:"content"`
	} `json:"candidates"`
}

type headlineExtraction struct {
	PostID     int64
	SectionKey string
	Headlines  []string
}

func main() {
	loadEnv()
	cfg := mustLoadConfig()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	rdb, err := newRedisClient(cfg.RedisURL, cfg.RedisPassword)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer func() { _ = rdb.Close() }()

	pool, err := newDBPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("postgres: %v", err)
	}
	defer pool.Close()
	if err := applyMemberNewsSchema(ctx, pool); err != nil {
		log.Fatalf("postgres schema: %v", err)
	}

	s3Client, err := newS3Client(ctx, cfg)
	if err != nil {
		log.Fatalf("s3: %v", err)
	}

	fetchClient := &http.Client{Timeout: cfg.RequestTimeout}
	geminiClient := &http.Client{Timeout: cfg.GeminiTimeout}

	resetAll := flag.Bool("reset-all", false, "Clear stored holonews state in Redis")
	skipThumbnailGeneration := flag.Bool("skip-thumbnail-generation", false, "Reuse existing thumbnails for matching headlines and skip new thumbnail generation")
	flag.Parse()
	if *resetAll {
		if err := resetRedisState(ctx, rdb); err != nil {
			log.Fatalf("reset: %v", err)
		}
		log.Printf("reset: completed")
		return
	}

	if err := backfillRedisNewsToDB(ctx, pool, rdb, cfg); err != nil {
		log.Fatalf("startup redis backfill: %v", err)
	}

	run := func() {
		if err := scrapeOnce(ctx, fetchClient, geminiClient, s3Client, pool, rdb, cfg, *skipThumbnailGeneration); err != nil {
			log.Printf("scrape: %v", err)
		}
	}

	log.Printf("holonews: running immediately")
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

func loadEnv() {
	if envFile := os.Getenv("ENV_FILE"); envFile != "" {
		if err := godotenv.Overload(envFile); err != nil {
			log.Printf("env: failed to load ENV_FILE=%q: %v", envFile, err)
		} else {
			log.Printf("env: loaded %s", envFile)
		}
		return
	}

	if err := godotenv.Load(); err == nil {
		log.Printf("env: loaded .env")
	}
}

func mustLoadConfig() Config {
	getEnv := func(key, fallback string) string {
		if v := strings.TrimSpace(os.Getenv(key)); v != "" {
			return v
		}
		return fallback
	}

	cfg := Config{
		DatabaseURL:             getEnv("DATABASE_URL", ""),
		RedisURL:                getEnv("REDIS_URL", ""),
		RedisPassword:           getEnv("REDIS_PASSWORD", ""),
		GeminiAPIKey:            getEnv("GEMINI_API_KEY", ""),
		GeminiTextModel:         getEnv("GEMINI_TEXT_MODEL", "gemini-3-flash-preview"),
		GeminiImageModel:        getEnv("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image-preview"),
		AWSAccessKeyID:          getEnv("AWS_ACCESS_KEY_ID", ""),
		AWSSecretAccessKey:      getEnv("AWS_SECRET_ACCESS_KEY", ""),
		AWSRegion:               getEnv("AWS_REGION", ""),
		AWSBucket:               getEnv("AWS_SW_BUCKET", ""),
		Board:                   getEnv("FOURCHAN_BOARD", "vt"),
		PollInterval:            time.Duration(parseEnvInt("POLL_INTERVAL_SECONDS", 600)) * time.Second,
		RequestTimeout:          time.Duration(parseEnvInt("REQUEST_TIMEOUT_SECONDS", 20)) * time.Second,
		GeminiTimeout:           time.Duration(parseEnvInt("GEMINI_TIMEOUT_SECONDS", 90)) * time.Second,
		SectionSearchPosts:      parseEnvInt("SECTION_SEARCH_POSTS", 5),
		TopNewsCount:            parseEnvInt("TOP_NEWS_COUNT", 3),
		ReferenceImagesS3Prefix: strings.Trim(getEnv("REFERENCE_IMAGES_S3_PREFIX", "reference-images"), "/"),
		ReferenceImagesBaseURL:  strings.TrimRight(getEnv("REFERENCE_IMAGES_BASE_URL", "https://images.nasfaq.biz/reference-images"), "/"),
		ThumbnailS3Prefix:       strings.Trim(getEnv("THUMBNAIL_S3_PREFIX", "thumbnails"), "/"),
		ThumbnailCDNBaseURL:     strings.TrimRight(getEnv("THUMBNAIL_CDN_BASE_URL", defaultThumbnailCDN), "/"),
	}

	if cfg.SectionSearchPosts < 1 {
		cfg.SectionSearchPosts = 5
	}
	if cfg.TopNewsCount < 1 {
		cfg.TopNewsCount = 3
	}

	var missing []string
	for key, value := range map[string]string{
		"DATABASE_URL":          cfg.DatabaseURL,
		"REDIS_URL":             cfg.RedisURL,
		"GEMINI_API_KEY":        cfg.GeminiAPIKey,
		"AWS_ACCESS_KEY_ID":     cfg.AWSAccessKeyID,
		"AWS_SECRET_ACCESS_KEY": cfg.AWSSecretAccessKey,
		"AWS_REGION":            cfg.AWSRegion,
		"AWS_SW_BUCKET":         cfg.AWSBucket,
	} {
		if value == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
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
		return nil, fmt.Errorf("parse REDIS_URL: %w", err)
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

func newDBPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	return pgxpool.NewWithConfig(ctx, cfg)
}

func applyMemberNewsSchema(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, memberNewsSchemaSQL); err != nil {
		return fmt.Errorf("apply member_news schema: %w", err)
	}
	return nil
}

func newS3Client(ctx context.Context, cfg Config) (*s3.Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(cfg.AWSRegion),
		awsconfig.WithCredentialsProvider(credentials.NewStaticCredentialsProvider(
			cfg.AWSAccessKeyID,
			cfg.AWSSecretAccessKey,
			"",
		)),
	)
	if err != nil {
		return nil, err
	}
	return s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.UsePathStyle = false
	}), nil
}

func scrapeOnce(ctx context.Context, fetchClient, geminiClient *http.Client, s3Client *s3.Client, pool *pgxpool.Pool, rdb *redis.Client, cfg Config, skipThumbnailGeneration bool) error {
	threadID, err := findNewsThread(ctx, fetchClient, rdb, cfg.Board)
	if err != nil {
		return err
	}
	if threadID == 0 {
		log.Printf("holonews: no active /news/ thread found on /%s/", cfg.Board)
		return nil
	}

	posts, err := fetchThread(ctx, fetchClient, cfg.Board, threadID)
	if err != nil {
		return fmt.Errorf("fetch thread %d: %w", threadID, err)
	}
	log.Printf("holonews: fetched thread %d with %d posts", threadID, len(posts))

	extraction, err := extractHeadlines(posts, cfg.SectionSearchPosts)
	if err != nil {
		return fmt.Errorf("extract headlines: %w", err)
	}
	if len(extraction.Headlines) == 0 {
		log.Printf("holonews: no HoloPro headlines found in first %d posts of thread %d", cfg.SectionSearchPosts, threadID)
		return nil
	}

	changed, err := headlinesChanged(ctx, rdb, extraction.Headlines)
	if err != nil {
		return fmt.Errorf("redis compare: %w", err)
	}
	if !changed {
		log.Printf("holonews: no new articles in thread %d", threadID)
		return nil
	}

	log.Printf("holonews: new articles detected in thread %d from post %d", threadID, extraction.PostID)
	for i, headline := range extraction.Headlines {
		log.Printf("holonews: headline %d: %s", i+1, headline)
	}

	memberNames, err := loadValidMemberNames(ctx, pool)
	if err != nil {
		return fmt.Errorf("load valid members: %w", err)
	}

	existingItems, err := loadExistingHeadlineMap(ctx, rdb)
	if err != nil {
		return fmt.Errorf("load existing holonews state: %w", err)
	}

	ranked, err := rankHeadlines(ctx, geminiClient, cfg, extraction.Headlines)
	if err != nil {
		return fmt.Errorf("rank headlines: %w", err)
	}

	items := make([]storedHeadline, 0, len(extraction.Headlines))
	byHeadline := make(map[string]*storedHeadline, len(extraction.Headlines))
	for _, headline := range extraction.Headlines {
		item := storedHeadline{Headline: headline}
		if existing, ok := existingItems[headline]; ok {
			item.Characters = append([]string(nil), existing.Characters...)
			item.ThumbnailS3Key = existing.ThumbnailS3Key
		}
		items = append(items, item)
		byHeadline[headline] = &items[len(items)-1]
	}

	for _, headline := range extraction.Headlines {
		entry := byHeadline[headline]
		if entry == nil {
			continue
		}

		characters, err := extractHeadlineCharacters(ctx, geminiClient, cfg, headline, memberNames)
		if err != nil {
			log.Printf("holonews: character extraction failed for headline=%q: %v", headline, err)
			continue
		}
		entry.Characters = characters
	}

	for _, rankedItem := range ranked {
		entry := byHeadline[rankedItem.Headline]
		if entry == nil {
			continue
		}
		rank := rankedItem.Rank
		entry.Rank = &rank

		promptData, err := generateThumbnailPrompt(ctx, geminiClient, cfg, rankedItem.Headline, memberNames)
		if err != nil {
			log.Printf("holonews: prompt generation failed for rank=%d headline=%q: %v", rankedItem.Rank, rankedItem.Headline, err)
			continue
		}
		if len(promptData.Characters) > 0 {
			entry.Characters = append([]string(nil), promptData.Characters...)
		}

		if skipThumbnailGeneration {
			if entry.ThumbnailS3Key != nil {
				log.Printf("holonews: skip thumbnail generation rank=%d headline=%q reusing s3_key=%s", rankedItem.Rank, rankedItem.Headline, *entry.ThumbnailS3Key)
			} else {
				log.Printf("holonews: skip thumbnail generation rank=%d headline=%q no existing thumbnail to reuse", rankedItem.Rank, rankedItem.Headline)
			}
			continue
		}

		log.Printf("holonews: thumbnail prompt rank=%d headline=%q prompt=%s", rankedItem.Rank, rankedItem.Headline, promptData.ImagePrompt)

		refImages, err := loadReferenceImagesFromCDN(ctx, fetchClient, cfg, promptData.Characters)
		if err != nil {
			log.Printf("holonews: reference image loading failed for rank=%d headline=%q: %v", rankedItem.Rank, rankedItem.Headline, err)
		}

		img, mimeType, err := generateThumbnail(ctx, geminiClient, cfg, promptData.ImagePrompt, promptData.Characters, refImages)
		if err != nil {
			log.Printf("holonews: thumbnail generation failed for rank=%d headline=%q: %v", rankedItem.Rank, rankedItem.Headline, err)
			continue
		}

		s3Key, err := uploadThumbnail(ctx, s3Client, cfg, rankedItem.Headline, rankedItem.Rank, img, mimeType)
		if err != nil {
			log.Printf("holonews: thumbnail upload failed for rank=%d headline=%q: %v", rankedItem.Rank, rankedItem.Headline, err)
			continue
		}
		entry.ThumbnailS3Key = &s3Key
	}

	payload := storedPayload{
		ThreadID:   threadID,
		SourcePost: extraction.PostID,
		UpdatedAt:  time.Now().UTC().Format(time.RFC3339),
		Items:      items,
	}
	if err := upsertStoredPayloadToDB(ctx, pool, cfg, payload); err != nil {
		return fmt.Errorf("database store: %w", err)
	}
	if err := replaceRedisState(ctx, rdb, payload); err != nil {
		return fmt.Errorf("redis store: %w", err)
	}

	log.Printf("holonews: stored %d headlines", len(payload.Items))
	for _, item := range payload.Items {
		if item.ThumbnailS3Key != nil {
			log.Printf("holonews: stored headline=%q rank=%d characters=%v s3_key=%s", item.Headline, derefInt(item.Rank), item.Characters, *item.ThumbnailS3Key)
			continue
		}
		log.Printf("holonews: stored headline=%q rank=%d characters=%v s3_key=", item.Headline, derefInt(item.Rank), item.Characters)
	}

	return nil
}

func findNewsThread(ctx context.Context, client *http.Client, rdb *redis.Client, board string) (int64, error) {
	pages, err := fetchCatalog(ctx, client, board)
	if err != nil {
		return 0, err
	}

	var threadID int64
	for _, page := range pages {
		for _, thread := range page.Threads {
			subject := strings.ToLower(html.UnescapeString(strings.TrimSpace(thread.Sub)))
			if strings.Contains(subject, "/news/") {
				log.Printf("holonews: matched /news/ thread id=%d subject=%q page=%d", thread.No, thread.Sub, page.Page)
				threadID = thread.No
				break
			}
		}
		if threadID != 0 {
			break
		}
	}

	currentStr, _ := rdb.Get(ctx, redisThreadKey).Result()
	currentID, _ := strconv.ParseInt(currentStr, 10, 64)
	if threadID != 0 && threadID != currentID {
		if err := rdb.Set(ctx, redisThreadKey, threadID, 0).Err(); err != nil {
			return 0, err
		}
		return threadID, nil
	}
	if threadID != 0 {
		return threadID, nil
	}
	if currentID != 0 {
		_ = rdb.Del(ctx, redisThreadKey).Err()
	}
	return 0, nil
}

func fetchCatalog(ctx context.Context, client *http.Client, board string) ([]catalogPage, error) {
	body, err := fetch(ctx, client, fmt.Sprintf("https://a.4cdn.org/%s/catalog.json", board))
	if err != nil {
		return nil, err
	}
	var pages []catalogPage
	if err := json.Unmarshal(body, &pages); err != nil {
		return nil, err
	}
	return pages, nil
}

func fetchThread(ctx context.Context, client *http.Client, board string, threadID int64) ([]post, error) {
	body, err := fetch(ctx, client, fmt.Sprintf("https://a.4cdn.org/%s/thread/%d.json", board, threadID))
	if err != nil {
		return nil, err
	}
	var resp threadResponse
	if err := json.Unmarshal(body, &resp); err != nil {
		return nil, err
	}
	return resp.Posts, nil
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

func extractHeadlines(posts []post, maxPosts int) (headlineExtraction, error) {
	if maxPosts > len(posts) {
		maxPosts = len(posts)
	}
	for i := 0; i < maxPosts; i++ {
		logPostInspection(posts[i], i)
		headlines := extractHeadlinesFromPost(posts[i])
		if len(headlines) == 0 {
			continue
		}
		log.Printf("holonews: extracted %d headlines from post %d", len(headlines), posts[i].No)
		return headlineExtraction{
			PostID:     posts[i].No,
			SectionKey: defaultSectionHeader,
			Headlines:  headlines,
		}, nil
	}
	return headlineExtraction{}, fmt.Errorf("no %s section found", defaultSectionHeader)
}

func extractHeadlinesFromPost(p post) []string {
	text := normalizePostText(p.Com)
	if text == "" {
		text = normalizePostText(p.Sub)
	}
	if text == "" {
		return nil
	}

	lines := splitLines(text)
	for i, line := range lines {
		if strings.Contains(strings.ToLower(strings.TrimSpace(line)), defaultSectionHeader) {
			log.Printf("holonews: post %d candidate section line %d raw=%q", p.No, i+1, line)
		}
		if !strings.EqualFold(strings.TrimSpace(line), defaultSectionHeader) {
			continue
		}

		start := i + 1
		for start < len(lines) && strings.TrimSpace(lines[start]) == "" {
			start++
		}
		if start >= len(lines) {
			log.Printf("holonews: post %d found HoloPro but no lines followed it", p.No)
			return nil
		}

		mode := "plain"
		if strings.HasPrefix(strings.TrimSpace(lines[start]), ">") {
			mode = "quoted"
		}
		log.Printf("holonews: post %d parsing HoloPro section in %s mode starting at line %d", p.No, mode, start+1)

		var headlines []string
		for _, next := range lines[start:] {
			trimmed := strings.TrimSpace(next)
			if trimmed == "" {
				if len(headlines) > 0 {
					log.Printf("holonews: post %d stopping section parse on blank line after %d headlines", p.No, len(headlines))
					break
				}
				continue
			}

			if mode == "quoted" {
				if !strings.HasPrefix(trimmed, ">") {
					log.Printf("holonews: post %d stopping quoted section parse on non-headline line %q", p.No, trimmed)
					break
				}
			} else if looksLikeSectionHeader(trimmed) {
				log.Printf("holonews: post %d stopping plain section parse on likely section header %q", p.No, trimmed)
				break
			}

			headline := trimmed
			if mode == "quoted" {
				headline = strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))
			}
			if headline == "" {
				continue
			}
			headlines = append(headlines, headline)
		}
		if len(headlines) > 0 {
			return dedupeStrings(headlines)
		}
	}

	return nil
}

func looksLikeSectionHeader(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return false
	}
	if strings.Contains(trimmed, " ANCHOR") {
		return true
	}
	if strings.HasSuffix(trimmed, ":") && len(trimmed) <= 80 {
		return true
	}
	if strings.EqualFold(trimmed, "HoloPro") {
		return true
	}
	return false
}

func logPostInspection(p post, index int) {
	text := normalizePostText(p.Com)
	source := "com"
	if text == "" {
		text = normalizePostText(p.Sub)
		source = "sub"
	}
	if text == "" {
		log.Printf("holonews: inspect post index=%d id=%d source=empty", index, p.No)
		return
	}

	lines := splitLines(text)
	previewCount := len(lines)
	if previewCount > 12 {
		previewCount = 12
	}
	log.Printf("holonews: inspect post index=%d id=%d source=%s total_lines=%d preview=%q", index, p.No, source, len(lines), strings.Join(lines[:previewCount], " | "))
}

func normalizePostText(raw string) string {
	if raw == "" {
		return ""
	}
	text := html.UnescapeString(raw)
	text = strings.ReplaceAll(text, "<br>", "\n")
	text = strings.ReplaceAll(text, "<br/>", "\n")
	text = strings.ReplaceAll(text, "<br />", "\n")
	text = strings.ReplaceAll(text, "</p>", "\n")
	text = stripTags(text)
	return strings.TrimSpace(text)
}

func stripTags(s string) string {
	var b strings.Builder
	inTag := false
	for _, r := range s {
		switch r {
		case '<':
			inTag = true
		case '>':
			inTag = false
		default:
			if !inTag {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

func splitLines(s string) []string {
	rawLines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	out := make([]string, 0, len(rawLines))
	for _, line := range rawLines {
		out = append(out, strings.TrimSpace(line))
	}
	return out
}

func dedupeStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	out := make([]string, 0, len(items))
	for _, item := range items {
		if _, ok := seen[item]; ok {
			continue
		}
		seen[item] = struct{}{}
		out = append(out, item)
	}
	return out
}

func headlinesChanged(ctx context.Context, rdb *redis.Client, headlines []string) (bool, error) {
	current, err := rdb.HGetAll(ctx, redisHeadlineHashKey).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return false, err
	}

	next := make(map[string]string, len(headlines))
	for _, headline := range headlines {
		next[headline] = headlineDigest(headline)
	}

	if len(current) != len(next) {
		return true, nil
	}
	for headline, digest := range next {
		if current[headline] != digest {
			return true, nil
		}
	}
	return false, nil
}

func headlineDigest(headline string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(headline)))
	return hex.EncodeToString(sum[:])
}

func loadValidMemberNames(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT DISTINCT btrim(name_english)
		FROM yt.youtube_channels
		WHERE is_active = true
		  AND name_english IS NOT NULL
		  AND btrim(name_english) <> ''
		ORDER BY btrim(name_english) ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		out = append(out, name)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return out, nil
}

func loadChannelIDsByEnglishName(ctx context.Context, pool *pgxpool.Pool) (map[string][]string, error) {
	rows, err := pool.Query(ctx, `
		SELECT btrim(name_english), youtube_channel_id
		FROM yt.youtube_channels
		WHERE name_english IS NOT NULL
		  AND btrim(name_english) <> ''
		ORDER BY btrim(name_english) ASC, youtube_channel_id ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string][]string{}
	for rows.Next() {
		var name string
		var channelID string
		if err := rows.Scan(&name, &channelID); err != nil {
			return nil, err
		}
		key := strings.ToLower(strings.TrimSpace(name))
		if key == "" {
			continue
		}
		existing := out[key]
		alreadyPresent := false
		for _, current := range existing {
			if current == channelID {
				alreadyPresent = true
				break
			}
		}
		if alreadyPresent {
			continue
		}
		out[key] = append(existing, channelID)
	}
	if rows.Err() != nil {
		return nil, rows.Err()
	}
	return out, nil
}

func rankHeadlines(ctx context.Context, client *http.Client, cfg Config, headlines []string) ([]rankedHeadline, error) {
	var b strings.Builder
	b.WriteString("Task: select and rank the most interesting and newsworthy Hololive headlines.\n")
	b.WriteString("Select exactly ")
	b.WriteString(strconv.Itoa(cfg.TopNewsCount))
	b.WriteString(" headlines from the list below.\n")
	b.WriteString("Assign ranks 1 through ")
	b.WriteString(strconv.Itoa(cfg.TopNewsCount))
	b.WriteString(", where 1 is the most newsworthy.\n")
	b.WriteString("Hard rules:\n")
	b.WriteString("- Use only headlines exactly as written in the provided list.\n")
	b.WriteString("- Do not rewrite, summarize, explain, or comment.\n")
	b.WriteString("- Choose the most interesting and newsworthy headlines, that are relevant to specific people and not vague.\n")
	b.WriteString("- The headlines will be used to generate thumbnails, so pick ones that would have an obvious or interesting visual.\n")
	b.WriteString("- Output JSON only.\n")
	b.WriteString("- Output one single line.\n")
	b.WriteString("- Output exactly this schema and no extra fields:\n")
	b.WriteString("{\"ranked\":[{\"rank\":1,\"headline\":\"exact headline from list\"},{\"rank\":2,\"headline\":\"exact headline from list\"},{\"rank\":3,\"headline\":\"exact headline from list\"}]}\n")
	b.WriteString("Available headlines:\n")
	for i, headline := range headlines {
		b.WriteString(strconv.Itoa(i + 1))
		b.WriteString(". ")
		b.WriteString(headline)
		b.WriteString("\n")
	}
	basePrompt := b.String()

	var parsed struct {
		Ranked []rankedHeadline `json:"ranked"`
	}
	var lastErr error
	for attempt := 1; attempt <= 3; attempt++ {
		prompt := basePrompt
		if attempt > 1 {
			prompt += "\nIMPORTANT RETRY INSTRUCTION: Your previous response was invalid. Return one single line of valid JSON only. No markdown. No prose. No code fences. No explanation. Use exactly this shape: {\"ranked\":[{\"rank\":1,\"headline\":\"exact headline from list\"},{\"rank\":2,\"headline\":\"exact headline from list\"},{\"rank\":3,\"headline\":\"exact headline from list\"}]}"
		}

		text, err := callGeminiText(ctx, client, cfg.GeminiAPIKey, cfg.GeminiTextModel, prompt)
		if err != nil {
			lastErr = err
			log.Printf("holonews: rank headlines attempt=%d failed: %v", attempt, err)
			continue
		}

		if err := json.Unmarshal([]byte(extractJSON(text)), &parsed); err != nil {
			lastErr = fmt.Errorf("parse ranking JSON: %w", err)
			log.Printf("holonews: rank headlines attempt=%d returned invalid JSON: %v raw=%q", attempt, err, text)
			continue
		}

		lastErr = nil
		break
	}
	if lastErr != nil {
		return nil, lastErr
	}

	valid := make(map[string]struct{}, len(headlines))
	for _, headline := range headlines {
		valid[headline] = struct{}{}
	}

	seenRank := make(map[int]struct{}, len(parsed.Ranked))
	seenHeadline := make(map[string]struct{}, len(parsed.Ranked))
	out := make([]rankedHeadline, 0, cfg.TopNewsCount)
	for _, item := range parsed.Ranked {
		if item.Rank < 1 || item.Rank > cfg.TopNewsCount {
			continue
		}
		if _, ok := valid[item.Headline]; !ok {
			continue
		}
		if _, ok := seenRank[item.Rank]; ok {
			continue
		}
		if _, ok := seenHeadline[item.Headline]; ok {
			continue
		}
		seenRank[item.Rank] = struct{}{}
		seenHeadline[item.Headline] = struct{}{}
		out = append(out, item)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Rank < out[j].Rank })
	if len(out) == 0 {
		return nil, fmt.Errorf("model returned no usable ranked headlines")
	}
	return out, nil
}

func generateThumbnailPrompt(ctx context.Context, client *http.Client, cfg Config, headline string, validMembers []string) (promptResult, error) {
	var b strings.Builder
	b.WriteString("Return JSON only in this shape: {\"image_prompt\":\"...\",\"characters\":[\"Exact Member Name\"]}\n")
	b.WriteString("The character names array must contain only exact values from the valid member list below.\n")
	b.WriteString("Use an empty array if the headline does not clearly refer to a member.\n\n")
	b.WriteString("Act as an expert VTuber Thumbnail Illustrator. I will give you a video headline. You must translate the core concept into a fun, visually clear prompt for an image generator.\n")
	b.WriteString("DEFAULT TONE: cute, playful, lively, charming, humorous, and expressive. The image should usually feel fun or endearing, not threatening, sinister, manic, or evil.\n")
	b.WriteString("Only use extreme chaos, panic, or manic comedy when the headline clearly calls for it and it would be funny.\n")
	b.WriteString("CRITICAL RULES YOU MUST FOLLOW:\n")
	b.WriteString("1. NO TEXT OR LABELS: You are strictly forbidden from asking for words, letters, logos, or signs. Represent concepts with physical props only.\n")
	b.WriteString("2. STRICT ART STYLE FORMULA: Your 'image_prompt' MUST ALWAYS begin with this exact phrase: '2D flat anime illustration, cel-shaded, official studio key visual, clean crisp lineart, vibrant colors, aesthetic anime screencap, '\n")
	b.WriteString("3. BANNED WORDS: Never use the words: 3D, realistic, hyper-detailed, cinematic, text, negative space, empty space. We are NOT adding text to these images.\n")
	b.WriteString("4. CAMERA & POSING: Prefer lively, appealing compositions such as close-up, medium close-up, slight Dutch angle, energetic pose, cheerful lean toward camera, or playful foreshortening. Avoid describing the character as aggressive, menacing, threatening, or attacking unless the headline specifically implies that tone.\n")
	b.WriteString("5. EXPRESSIONS: Favor bright, cute, funny, confident, surprised, determined, embarrassed, pouty, excited, or mischievous expressions. Use extreme or deranged expressions only if the joke or headline clearly supports it.\n")
	b.WriteString("6. ACTION WITH PROPS: Don't just place props in the background. Make the characters actively interact with them in a playful or visually clear way, such as hugging, presenting, pointing at, reacting to, or struggling comedically with the object.\n\n")
	b.WriteString("7. SAFE ANATOMY ANCHORING: To prevent AI anatomy errors, strictly favor 'upper body shot' or 'cowboy shot' (hips up) to avoid rendering complex leg poses. When interacting with props, prefer phrases like 'holding [prop] with both hands' or 'one hand on [prop], one hand pointing' to anchor the limbs and prevent extra arms.\n")
	b.WriteString("Here is the headline: ")
	b.WriteString(headline)
	b.WriteString("\n\nValid members:\n")
	for _, name := range validMembers {
		b.WriteString("- ")
		b.WriteString(name)
		b.WriteString("\n")
	}

	text, err := callGeminiText(ctx, client, cfg.GeminiAPIKey, cfg.GeminiTextModel, b.String())
	if err != nil {
		return promptResult{}, err
	}

	var parsed promptResult
	if err := json.Unmarshal([]byte(extractJSON(text)), &parsed); err != nil {
		return promptResult{}, fmt.Errorf("parse prompt JSON: %w", err)
	}
	parsed.ImagePrompt = strings.TrimSpace(parsed.ImagePrompt)
	if parsed.ImagePrompt == "" {
		return promptResult{}, fmt.Errorf("empty image prompt")
	}

	validSet := make(map[string]struct{}, len(validMembers))
	for _, name := range validMembers {
		validSet[name] = struct{}{}
	}
	filtered := make([]string, 0, len(parsed.Characters))
	for _, name := range parsed.Characters {
		if _, ok := validSet[name]; ok {
			filtered = append(filtered, name)
		}
	}
	parsed.Characters = dedupeStrings(filtered)
	return parsed, nil
}

func extractHeadlineCharacters(ctx context.Context, client *http.Client, cfg Config, headline string, validMembers []string) ([]string, error) {
	var b strings.Builder
	b.WriteString("Return JSON only in this shape: {\"characters\":[\"Exact Member Name\"]}\n")
	b.WriteString("Identify which Hololive member names are clearly relevant to the headline.\n")
	b.WriteString("Rules:\n")
	b.WriteString("- Use only exact names from the valid member list below.\n")
	b.WriteString("- Return an empty array if no member is clearly referenced.\n")
	b.WriteString("- Do not guess beyond what is clearly implied by the headline.\n")
	b.WriteString("- Output JSON only, no markdown or commentary.\n")
	b.WriteString("Headline: ")
	b.WriteString(headline)
	b.WriteString("\nValid members:\n")
	for _, name := range validMembers {
		b.WriteString("- ")
		b.WriteString(name)
		b.WriteString("\n")
	}

	text, err := callGeminiText(ctx, client, cfg.GeminiAPIKey, cfg.GeminiTextModel, b.String())
	if err != nil {
		return nil, err
	}

	var parsed struct {
		Characters []string `json:"characters"`
	}
	if err := json.Unmarshal([]byte(extractJSON(text)), &parsed); err != nil {
		return nil, fmt.Errorf("parse character JSON: %w", err)
	}

	validSet := make(map[string]struct{}, len(validMembers))
	for _, name := range validMembers {
		validSet[name] = struct{}{}
	}
	filtered := make([]string, 0, len(parsed.Characters))
	for _, name := range parsed.Characters {
		if _, ok := validSet[name]; ok {
			filtered = append(filtered, name)
		}
	}
	return dedupeStrings(filtered), nil
}

type referenceImage struct {
	Name     string
	MIMEType string
	Data     []byte
}

func loadReferenceImagesFromCDN(ctx context.Context, client *http.Client, cfg Config, names []string) ([]referenceImage, error) {
	if len(names) == 0 {
		return nil, nil
	}
	var out []referenceImage
	var errs []string
	for _, name := range names {
		slug := strings.ToLower(strings.ReplaceAll(name, " ", "-"))
		imageURL := fmt.Sprintf("%s/%s.jpg", cfg.ReferenceImagesBaseURL, slug)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s (%v)", imageURL, err))
			continue
		}
		resp, err := client.Do(req)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s (%v)", imageURL, err))
			continue
		}
		data, readErr := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			errs = append(errs, fmt.Sprintf("%s (http %d)", imageURL, resp.StatusCode))
			continue
		}
		if readErr != nil {
			errs = append(errs, fmt.Sprintf("%s (%v)", imageURL, readErr))
			continue
		}
		out = append(out, referenceImage{
			Name:     name,
			MIMEType: "image/jpeg",
			Data:     data,
		})
	}
	if len(errs) > 0 {
		return out, fmt.Errorf("missing reference images: %s", strings.Join(errs, "; "))
	}
	return out, nil
}

func generateThumbnail(ctx context.Context, client *http.Client, cfg Config, imagePrompt string, characters []string, refs []referenceImage) ([]byte, string, error) {
	prompt := imagePrompt
	if len(characters) > 0 {
		prompt = prompt + "\nUse these attached reference images only for character design consistency for: " + strings.Join(characters, ", ") + "."
	}

	parts := make([]map[string]any, 0, len(refs)+1)
	parts = append(parts, map[string]any{"text": prompt})
	for _, ref := range refs {
		parts = append(parts, map[string]any{
			"inline_data": map[string]any{
				"mime_type": ref.MIMEType,
				"data":      base64.StdEncoding.EncodeToString(ref.Data),
			},
		})
	}

	payload := map[string]any{
		"contents": []map[string]any{
			{
				"role":  "user",
				"parts": parts,
			},
		},
		"generationConfig": map[string]any{
			"temperature":        0.9,
			"responseModalities": []string{"IMAGE"},
			"imageConfig": map[string]any{
				"aspectRatio": "16:9",
				"imageSize":   "2K",
			},
		},
	}

	resp, err := callGemini(ctx, client, cfg.GeminiAPIKey, cfg.GeminiImageModel, payload)
	if err != nil {
		return nil, "", err
	}
	var textParts []string
	for _, candidate := range resp.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.InlineData == nil || part.InlineData.Data == "" {
				if strings.TrimSpace(part.Text) != "" {
					textParts = append(textParts, strings.TrimSpace(part.Text))
				}
				continue
			}
			data, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
			if err != nil {
				return nil, "", err
			}
			return data, part.InlineData.MIMEType, nil
		}
	}
	if len(textParts) > 0 {
		log.Printf("holonews: gemini image response contained text only: %s", strings.Join(textParts, " | "))
	}
	return nil, "", fmt.Errorf("gemini image response missing inline image data")
}

func uploadThumbnail(ctx context.Context, client *s3.Client, cfg Config, headline string, rank int, data []byte, mimeType string) (string, error) {
	ext := mimeExtension(mimeType)
	timestampKey := time.Now().UTC().Format("2006-01-02-150405")
	dataHash := sha256.Sum256(data)
	shortHash := hex.EncodeToString(dataHash[:])[:12]
	key := fmt.Sprintf("%s/%s-%d-%s%s", cfg.ThumbnailS3Prefix, timestampKey, rank, shortHash, ext)

	metadata := map[string]string{
		"headline": headline,
	}
	if err := putImageObject(ctx, client, cfg.AWSBucket, key, data, mimeType, metadata); err != nil {
		return "", err
	}

	thumbnailData, thumbnailMIMEType, err := thumbs.SquareJPEG(data, thumbs.DefaultSize)
	if err != nil {
		return "", fmt.Errorf("build thumbnail resize: %w", err)
	}

	thumbnailKey := thumbs.VariantKey(key)
	thumbnailMetadata := copyMetadata(metadata)
	thumbnailMetadata["source-key"] = key
	thumbnailMetadata["variant"] = "thumbnail"
	if err := putImageObject(ctx, client, cfg.AWSBucket, thumbnailKey, thumbnailData, thumbnailMIMEType, thumbnailMetadata); err != nil {
		return "", fmt.Errorf("upload thumbnail resize: %w", err)
	}
	return key, nil
}

func putImageObject(ctx context.Context, client *s3.Client, bucket, key string, data []byte, mimeType string, metadata map[string]string) error {
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(bucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(mimeType),
		Metadata:    metadata,
	})
	return err
}

func copyMetadata(in map[string]string) map[string]string {
	if len(in) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		out[key] = value
	}
	return out
}

func mimeExtension(mimeType string) string {
	if exts, _ := mime.ExtensionsByType(mimeType); len(exts) > 0 {
		return exts[0]
	}
	switch strings.ToLower(mimeType) {
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	default:
		return ".bin"
	}
}

func replaceRedisState(ctx context.Context, rdb *redis.Client, payload storedPayload) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	pipe := rdb.TxPipeline()
	pipe.Del(ctx, redisItemsKey, redisHeadlineHashKey)
	for _, item := range payload.Items {
		itemJSON, err := json.Marshal(item)
		if err != nil {
			return err
		}
		pipe.RPush(ctx, redisItemsKey, itemJSON)
		pipe.HSet(ctx, redisHeadlineHashKey, item.Headline, headlineDigest(item.Headline))
	}
	pipe.Set(ctx, redisMetaKey, payloadJSON, 0)
	pipe.Set(ctx, redisThreadKey, payload.ThreadID, 0)
	_, err = pipe.Exec(ctx)
	return err
}

func loadStoredPayloadFromRedis(ctx context.Context, rdb *redis.Client) (storedPayload, bool, error) {
	rawMeta, err := rdb.Get(ctx, redisMetaKey).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return storedPayload{}, false, err
	}

	var payload storedPayload
	if strings.TrimSpace(rawMeta) != "" {
		if err := json.Unmarshal([]byte(rawMeta), &payload); err == nil {
			return payload, len(payload.Items) > 0, nil
		}
	}

	rawItems, err := rdb.LRange(ctx, redisItemsKey, 0, -1).Result()
	if err != nil && !errors.Is(err, redis.Nil) {
		return storedPayload{}, false, err
	}

	payload.Items = make([]storedHeadline, 0, len(rawItems))
	for _, raw := range rawItems {
		var item storedHeadline
		if err := json.Unmarshal([]byte(raw), &item); err != nil {
			continue
		}
		payload.Items = append(payload.Items, item)
	}
	return payload, len(payload.Items) > 0, nil
}

func loadExistingHeadlineMap(ctx context.Context, rdb *redis.Client) (map[string]storedHeadline, error) {
	payload, _, err := loadStoredPayloadFromRedis(ctx, rdb)
	if err != nil {
		return nil, err
	}

	out := make(map[string]storedHeadline, len(payload.Items))
	for _, item := range payload.Items {
		out[item.Headline] = item
	}
	return out, nil
}

func backfillRedisNewsToDB(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, cfg Config) error {
	payload, ok, err := loadStoredPayloadFromRedis(ctx, rdb)
	if err != nil {
		return fmt.Errorf("load redis payload: %w", err)
	}
	if !ok {
		return nil
	}
	if err := upsertStoredPayloadToDB(ctx, pool, cfg, payload); err != nil {
		return fmt.Errorf("upsert redis payload to db: %w", err)
	}
	log.Printf("holonews: backfilled %d redis headlines into database state", len(payload.Items))
	return nil
}

func upsertStoredPayloadToDB(ctx context.Context, pool *pgxpool.Pool, cfg Config, payload storedPayload) error {
	if len(payload.Items) == 0 {
		return nil
	}

	newsDate := payloadDate(payload)
	channelIDsByName, err := loadChannelIDsByEnglishName(ctx, pool)
	if err != nil {
		return fmt.Errorf("load channel ids by english name: %w", err)
	}

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, item := range payload.Items {
		headline := strings.TrimSpace(item.Headline)
		if headline == "" {
			continue
		}

		var newsID int64
		if err := tx.QueryRow(ctx, `
			INSERT INTO info.member_news (headline, thumbnail_url, date)
			VALUES ($1, $2, $3)
			ON CONFLICT (headline, date)
			DO UPDATE SET
				thumbnail_url = COALESCE(EXCLUDED.thumbnail_url, info.member_news.thumbnail_url)
			RETURNING id
		`, headline, thumbnailURL(cfg, item.ThumbnailS3Key), newsDate).Scan(&newsID); err != nil {
			return fmt.Errorf("upsert member_news headline=%q: %w", headline, err)
		}

		for _, channelID := range channelIDsForItem(item, channelIDsByName) {
			if _, err := tx.Exec(ctx, `
				INSERT INTO info.member_news_channels (news_id, youtube_channel_id)
				VALUES ($1, $2)
				ON CONFLICT DO NOTHING
			`, newsID, channelID); err != nil {
				return fmt.Errorf("upsert member_news_channels headline=%q channel=%s: %w", headline, channelID, err)
			}
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit member_news tx: %w", err)
	}
	return nil
}

func payloadDate(payload storedPayload) time.Time {
	updatedAt := strings.TrimSpace(payload.UpdatedAt)
	if updatedAt != "" {
		if parsed, err := time.Parse(time.RFC3339, updatedAt); err == nil {
			utc := parsed.UTC()
			return time.Date(utc.Year(), utc.Month(), utc.Day(), 0, 0, 0, 0, time.UTC)
		}
	}
	now := time.Now().UTC()
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

func thumbnailURL(cfg Config, s3Key *string) *string {
	if s3Key == nil {
		return nil
	}
	key := strings.TrimSpace(*s3Key)
	if key == "" {
		return nil
	}
	segments := strings.Split(key, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	url := fmt.Sprintf("%s/%s", cfg.ThumbnailCDNBaseURL, strings.Join(segments, "/"))
	return &url
}

func channelIDsForItem(item storedHeadline, channelIDsByName map[string][]string) []string {
	var out []string
	seen := map[string]struct{}{}
	for _, character := range item.Characters {
		key := strings.ToLower(strings.TrimSpace(character))
		if key == "" {
			continue
		}
		for _, channelID := range channelIDsByName[key] {
			if _, ok := seen[channelID]; ok {
				continue
			}
			seen[channelID] = struct{}{}
			out = append(out, channelID)
		}
	}
	return out
}

func callGeminiText(ctx context.Context, client *http.Client, apiKey, model, prompt string) (string, error) {
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
			"temperature":      0.3,
			"maxOutputTokens":  4096,
			"responseMimeType": "application/json",
		},
	}
	resp, err := callGemini(ctx, client, apiKey, model, payload)
	if err != nil {
		return "", err
	}
	for _, candidate := range resp.Candidates {
		for _, part := range candidate.Content.Parts {
			if strings.TrimSpace(part.Text) != "" {
				return strings.TrimSpace(part.Text), nil
			}
		}
	}
	return "", fmt.Errorf("gemini text response missing content")
}

func callGemini(ctx context.Context, client *http.Client, apiKey, model string, payload map[string]any) (geminiResponse, error) {
	var out geminiResponse

	body, err := json.Marshal(payload)
	if err != nil {
		return out, err
	}

	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent", url.PathEscape(model))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-goog-api-key", apiKey)

	resp, err := client.Do(req)
	if err != nil {
		if isTimeoutErr(err) {
			return out, fmt.Errorf("gemini request timeout")
		}
		return out, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return out, fmt.Errorf("gemini http %d: %s", resp.StatusCode, strings.TrimSpace(string(data)))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(data, &out); err != nil {
		return out, err
	}
	if len(out.Candidates) == 0 {
		return out, fmt.Errorf("gemini response missing candidates")
	}
	return out, nil
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
	return trimmed
}

func isTimeoutErr(err error) bool {
	if err == nil {
		return false
	}
	var netErr net.Error
	if errors.As(err, &netErr) && netErr.Timeout() {
		return true
	}
	return errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timeout")
}

func derefInt(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func resetRedisState(ctx context.Context, rdb *redis.Client) error {
	return rdb.Del(ctx, redisItemsKey, redisHeadlineHashKey, redisMetaKey, redisThreadKey).Err()
}
