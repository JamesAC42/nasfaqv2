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
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
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
)

type Config struct {
	DatabaseURL        string
	RedisURL           string
	RedisPassword      string
	GeminiAPIKey       string
	GeminiTextModel    string
	GeminiImageModel   string
	AWSAccessKeyID     string
	AWSSecretAccessKey string
	AWSRegion          string
	AWSBucket          string
	Board              string
	PollInterval       time.Duration
	RequestTimeout     time.Duration
	GeminiTimeout      time.Duration
	SectionSearchPosts int
	TopNewsCount       int
	ReferenceImagesDir string
	ThumbnailS3Prefix  string
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
	Headline       string  `json:"headline"`
	Rank           *int    `json:"rank,omitempty"`
	ThumbnailS3Key *string `json:"thumbnail_s3_key,omitempty"`
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
	Reason   string `json:"reason,omitempty"`
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
					MIMEType string `json:"mime_type"`
					Data     string `json:"data"`
				} `json:"inline_data,omitempty"`
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

	s3Client, err := newS3Client(ctx, cfg)
	if err != nil {
		log.Fatalf("s3: %v", err)
	}

	fetchClient := &http.Client{Timeout: cfg.RequestTimeout}
	geminiClient := &http.Client{Timeout: cfg.GeminiTimeout}

	resetAll := flag.Bool("reset-all", false, "Clear stored holonews state in Redis")
	flag.Parse()
	if *resetAll {
		if err := resetRedisState(ctx, rdb); err != nil {
			log.Fatalf("reset: %v", err)
		}
		log.Printf("reset: completed")
		return
	}

	run := func() {
		if err := scrapeOnce(ctx, fetchClient, geminiClient, s3Client, pool, rdb, cfg); err != nil {
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
		DatabaseURL:        getEnv("DATABASE_URL", ""),
		RedisURL:           getEnv("REDIS_URL", ""),
		RedisPassword:      getEnv("REDIS_PASSWORD", ""),
		GeminiAPIKey:       getEnv("GEMINI_API_KEY", ""),
		GeminiTextModel:    getEnv("GEMINI_TEXT_MODEL", "gemini-3.1-flash"),
		GeminiImageModel:   getEnv("GEMINI_IMAGE_MODEL", "gemini-3.1-flash-image-preview"),
		AWSAccessKeyID:     getEnv("AWS_ACCESS_KEY_ID", ""),
		AWSSecretAccessKey: getEnv("AWS_SECRET_ACCESS_KEY", ""),
		AWSRegion:          getEnv("AWS_REGION", ""),
		AWSBucket:          getEnv("AWS_SW_BUCKET", ""),
		Board:              getEnv("FOURCHAN_BOARD", "vt"),
		PollInterval:       time.Duration(parseEnvInt("POLL_INTERVAL_SECONDS", 600)) * time.Second,
		RequestTimeout:     time.Duration(parseEnvInt("REQUEST_TIMEOUT_SECONDS", 20)) * time.Second,
		GeminiTimeout:      time.Duration(parseEnvInt("GEMINI_TIMEOUT_SECONDS", 90)) * time.Second,
		SectionSearchPosts: parseEnvInt("SECTION_SEARCH_POSTS", 5),
		TopNewsCount:       parseEnvInt("TOP_NEWS_COUNT", 3),
		ReferenceImagesDir: getEnv("REFERENCE_IMAGES_DIR", "reference_image_scraper/reference_images"),
		ThumbnailS3Prefix:  strings.Trim(getEnv("THUMBNAIL_S3_PREFIX", "thumbnails"), "/"),
	}

	if cfg.SectionSearchPosts < 1 {
		cfg.SectionSearchPosts = 5
	}
	if cfg.TopNewsCount < 1 {
		cfg.TopNewsCount = 3
	}

	var missing []string
	for key, value := range map[string]string{
		"DATABASE_URL":           cfg.DatabaseURL,
		"REDIS_URL":              cfg.RedisURL,
		"GEMINI_API_KEY":         cfg.GeminiAPIKey,
		"AWS_ACCESS_KEY_ID":      cfg.AWSAccessKeyID,
		"AWS_SECRET_ACCESS_KEY":  cfg.AWSSecretAccessKey,
		"AWS_REGION":             cfg.AWSRegion,
		"AWS_SW_BUCKET":          cfg.AWSBucket,
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
	return pgxpool.NewWithConfig(ctx, cfg)
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

func scrapeOnce(ctx context.Context, fetchClient, geminiClient *http.Client, s3Client *s3.Client, pool *pgxpool.Pool, rdb *redis.Client, cfg Config) error {
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

	ranked, err := rankHeadlines(ctx, geminiClient, cfg, extraction.Headlines)
	if err != nil {
		return fmt.Errorf("rank headlines: %w", err)
	}

	items := make([]storedHeadline, 0, len(extraction.Headlines))
	byHeadline := make(map[string]*storedHeadline, len(extraction.Headlines))
	for _, headline := range extraction.Headlines {
		item := storedHeadline{Headline: headline}
		items = append(items, item)
		byHeadline[headline] = &items[len(items)-1]
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

		log.Printf("holonews: thumbnail prompt rank=%d headline=%q prompt=%s", rankedItem.Rank, rankedItem.Headline, promptData.ImagePrompt)

		refImages, err := loadReferenceImages(cfg.ReferenceImagesDir, promptData.Characters)
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
	if err := replaceRedisState(ctx, rdb, payload); err != nil {
		return fmt.Errorf("redis store: %w", err)
	}

	log.Printf("holonews: stored %d headlines", len(payload.Items))
	for _, item := range payload.Items {
		if item.ThumbnailS3Key != nil {
			log.Printf("holonews: stored headline=%q rank=%d s3_key=%s", item.Headline, derefInt(item.Rank), *item.ThumbnailS3Key)
			continue
		}
		log.Printf("holonews: stored headline=%q rank=%d s3_key=", item.Headline, derefInt(item.Rank))
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
		headlines := extractHeadlinesFromPost(posts[i])
		if len(headlines) == 0 {
			continue
		}
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
		if !strings.EqualFold(strings.TrimSpace(line), defaultSectionHeader) {
			continue
		}

		var headlines []string
		for _, next := range lines[i+1:] {
			trimmed := strings.TrimSpace(next)
			if trimmed == "" {
				if len(headlines) > 0 {
					break
				}
				continue
			}
			if !strings.HasPrefix(trimmed, ">") {
				break
			}

			headline := strings.TrimSpace(strings.TrimPrefix(trimmed, ">"))
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

func rankHeadlines(ctx context.Context, client *http.Client, cfg Config, headlines []string) ([]rankedHeadline, error) {
	var b strings.Builder
	b.WriteString("You are ranking Hololive-related headlines for a current, non-historical news roundup.\n")
	b.WriteString("Choose the ")
	b.WriteString(strconv.Itoa(cfg.TopNewsCount))
	b.WriteString(" most newsworthy headlines from the list.\n")
	b.WriteString("Rank them 1 to ")
	b.WriteString(strconv.Itoa(cfg.TopNewsCount))
	b.WriteString(" where 1 is the most newsworthy.\n")
	b.WriteString("You must only choose headlines exactly from the provided list.\n")
	b.WriteString("Return JSON only in this shape:\n")
	b.WriteString("{\"ranked\":[{\"rank\":1,\"headline\":\"exact headline from list\",\"reason\":\"short reason\"}]}\n")
	b.WriteString("Headlines:\n")
	for i, headline := range headlines {
		b.WriteString(strconv.Itoa(i + 1))
		b.WriteString(". ")
		b.WriteString(headline)
		b.WriteString("\n")
	}

	text, err := callGeminiText(ctx, client, cfg.GeminiAPIKey, cfg.GeminiTextModel, b.String())
	if err != nil {
		return nil, err
	}

	var parsed struct {
		Ranked []rankedHeadline `json:"ranked"`
	}
	if err := json.Unmarshal([]byte(extractJSON(text)), &parsed); err != nil {
		return nil, fmt.Errorf("parse ranking JSON: %w", err)
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
	b.WriteString("Act as an expert YouTube Thumbnail Designer and AI Prompt Engineer. I am going to give you a video headline. I need you to translate the core concept of this headline into a highly descriptive, visual-only prompt for an AI image generator (like Midjourney or Stable Diffusion).\n")
	b.WriteString("CRITICAL RULES YOU MUST FOLLOW:\n")
	b.WriteString("NO TEXT: Never include the headline, words, or quotes in the final prompt.\n")
	b.WriteString("VISUAL METAPHORS: Translate abstract concepts (like 'quitting,' 'goals,' or 'no time') into physical props (e.g., scissors cutting a tie, a giant glowing mountain, a melting hourglass).\n")
	b.WriteString("EXAGGERATED EXPRESSIONS: Specifically describe the main character's face using anime tropes (e.g., 'sweating profusely,' 'eyes wide in panic,' 'smug Anya face').\n")
	b.WriteString("SAFE ANATOMY: Avoid complex hand interactions. Keep hands resting on desks, holding single large objects, or framing the face.\n")
	b.WriteString("VIBE: Make it look like a high-contrast, chaotic, clickbait anime thumbnail.\n")
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

type referenceImage struct {
	Name     string
	MIMEType string
	Data     []byte
}

func loadReferenceImages(baseDir string, names []string) ([]referenceImage, error) {
	if len(names) == 0 {
		return nil, nil
	}
	var out []referenceImage
	var errs []string
	for _, name := range names {
		slug := strings.ToLower(strings.ReplaceAll(name, " ", "-"))
		path := filepath.Join(baseDir, slug+".png")
		data, err := os.ReadFile(path)
		if err != nil {
			errs = append(errs, fmt.Sprintf("%s (%v)", path, err))
			continue
		}
		out = append(out, referenceImage{
			Name:     name,
			MIMEType: "image/png",
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
		prompt = prompt + "\nUse these attached reference images only for facial identity and hair design consistency for: " + strings.Join(characters, ", ") + "."
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
			"temperature":        0.8,
			"responseModalities": []string{"TEXT", "IMAGE"},
		},
	}

	resp, err := callGemini(ctx, client, cfg.GeminiAPIKey, cfg.GeminiImageModel, payload)
	if err != nil {
		return nil, "", err
	}
	for _, candidate := range resp.Candidates {
		for _, part := range candidate.Content.Parts {
			if part.InlineData == nil || part.InlineData.Data == "" {
				continue
			}
			data, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
			if err != nil {
				return nil, "", err
			}
			return data, part.InlineData.MIMEType, nil
		}
	}
	return nil, "", fmt.Errorf("gemini image response missing inline image data")
}

func uploadThumbnail(ctx context.Context, client *s3.Client, cfg Config, headline string, rank int, data []byte, mimeType string) (string, error) {
	ext := mimeExtension(mimeType)
	key := fmt.Sprintf("%s/%s-rank-%d%s", cfg.ThumbnailS3Prefix, slugify(headline), rank, ext)

	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:      aws.String(cfg.AWSBucket),
		Key:         aws.String(key),
		Body:        bytes.NewReader(data),
		ContentType: aws.String(mimeType),
	})
	if err != nil {
		return "", err
	}
	return key, nil
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

func slugify(s string) string {
	s = strings.ToLower(s)
	var b strings.Builder
	lastDash := false
	for _, r := range s {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		out = strconv.FormatInt(time.Now().UTC().Unix(), 10)
	}
	return out
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
