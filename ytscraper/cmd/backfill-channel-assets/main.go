package main

import (
	"bytes"
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"strings"
	"syscall"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
)

const (
	defaultAssetPrefix   = "channel-assets"
	defaultCDNBaseURL    = "https://images.nasfaq.biz"
	maxDownloadBytes     = 20 * 1024 * 1024
	defaultHTTPTimeout   = 45 * time.Second
	defaultRequestDelay  = 200 * time.Millisecond
	immutableCacheHeader = "public, max-age=31536000, immutable"
)

type Config struct {
	DatabaseURL                string
	AWSAccessKeyID             string
	AWSSecretAccessKey         string
	AWSRegion                  string
	AWSBucket                  string
	ChannelAssetsS3Prefix      string
	ChannelAssetsPublicBaseURL string
}

type assetKind struct {
	Name      string
	Suffix    string
	SourceURL *string
	StoredURL *string
}

type downloadedAsset struct {
	Bytes       []byte
	ContentType string
	Extension   string
}

func main() {
	var dryRun bool
	var force bool
	flag.BoolVar(&dryRun, "dry-run", false, "download and inspect assets without uploading or updating the database")
	flag.BoolVar(&force, "force", false, "re-upload assets even if channel asset URLs are already stored")
	flag.Parse()

	loadEnv()

	cfg := Config{
		DatabaseURL:                strings.TrimSpace(os.Getenv("DATABASE_URL")),
		AWSAccessKeyID:             strings.TrimSpace(os.Getenv("AWS_ACCESS_KEY_ID")),
		AWSSecretAccessKey:         strings.TrimSpace(os.Getenv("AWS_SECRET_ACCESS_KEY")),
		AWSRegion:                  strings.TrimSpace(os.Getenv("AWS_REGION")),
		AWSBucket:                  strings.TrimSpace(os.Getenv("AWS_SW_BUCKET")),
		ChannelAssetsS3Prefix:      normalizePrefix(os.Getenv("CHANNEL_ASSETS_S3_PREFIX"), defaultAssetPrefix),
		ChannelAssetsPublicBaseURL: normalizePublicBaseURL(os.Getenv("CHANNEL_ASSETS_PUBLIC_BASE_URL")),
	}
	mustValidateConfig(cfg)

	ctx, stop := signalContext()
	defer stop()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	channels, err := db.ListChannelsForAssetBackfill(ctx, pool)
	if err != nil {
		log.Fatalf("list channels: %v", err)
	}
	if len(channels) == 0 {
		log.Printf("no channels found in yt.youtube_channels")
		return
	}

	s3Client, err := newS3Client(ctx, cfg)
	if err != nil {
		log.Fatalf("s3: %v", err)
	}

	httpClient := &http.Client{
		Timeout: defaultHTTPTimeout,
	}

	var uploadedCount int
	var updatedChannels int
	var skippedCount int

	for _, ch := range channels {
		select {
		case <-ctx.Done():
			log.Fatalf("stopped: %v", ctx.Err())
		default:
		}

		assets := []assetKind{
			{
				Name:      "profile",
				Suffix:    "profile",
				SourceURL: ch.YouTubeIconURL,
				StoredURL: ch.ChannelAssetIconURL,
			},
			{
				Name:      "banner",
				Suffix:    "banner",
				SourceURL: ch.YouTubeBannerURL,
				StoredURL: ch.ChannelAssetBannerURL,
			},
		}

		var nextIconURL *string
		var nextBannerURL *string
		var channelChanged bool

		for _, asset := range assets {
			if strings.TrimSpace(stringValue(asset.SourceURL)) == "" {
				log.Printf("skip channel=%s name=%q asset=%s: source url missing", ch.YouTubeChannelID, ch.NameShort, asset.Name)
				skippedCount++
				continue
			}
			if !force && strings.TrimSpace(stringValue(asset.StoredURL)) != "" {
				log.Printf("skip channel=%s name=%q asset=%s: asset url already present", ch.YouTubeChannelID, ch.NameShort, asset.Name)
				skippedCount++
				continue
			}

			downloaded, err := downloadAsset(ctx, httpClient, stringValue(asset.SourceURL))
			if err != nil {
				log.Printf("skip channel=%s name=%q asset=%s: download failed: %v", ch.YouTubeChannelID, ch.NameShort, asset.Name, err)
				skippedCount++
				continue
			}

			key := fmt.Sprintf("%s/%s-%s%s", cfg.ChannelAssetsS3Prefix, ch.YouTubeChannelID, asset.Suffix, downloaded.Extension)
			publicURL := publicAssetURL(cfg, key)

			if dryRun {
				log.Printf(
					"dry-run channel=%s name=%q asset=%s key=%q public_url=%q bytes=%d content_type=%q",
					ch.YouTubeChannelID,
					ch.NameShort,
					asset.Name,
					key,
					publicURL,
					len(downloaded.Bytes),
					downloaded.ContentType,
				)
			} else {
				if err := uploadAsset(ctx, s3Client, cfg, key, downloaded); err != nil {
					log.Printf("skip channel=%s name=%q asset=%s: upload failed: %v", ch.YouTubeChannelID, ch.NameShort, asset.Name, err)
					skippedCount++
					continue
				}
				log.Printf("uploaded channel=%s name=%q asset=%s key=%q", ch.YouTubeChannelID, ch.NameShort, asset.Name, key)
			}

			uploadedCount++
			channelChanged = true

			switch asset.Name {
			case "profile":
				nextIconURL = aws.String(publicURL)
			case "banner":
				nextBannerURL = aws.String(publicURL)
			}

			time.Sleep(defaultRequestDelay)
		}

		if !channelChanged || dryRun {
			continue
		}
		if err := db.UpdateChannelAssetURLs(ctx, pool, ch.YouTubeChannelID, nextIconURL, nextBannerURL); err != nil {
			log.Fatalf("update channel asset urls channel=%s: %v", ch.YouTubeChannelID, err)
		}
		updatedChannels++
	}

	if dryRun {
		log.Printf("dry run complete: prepared %d upload(s), skipped %d asset(s)", uploadedCount, skippedCount)
		return
	}
	log.Printf("backfill complete: uploaded %d asset(s), updated %d channel(s), skipped %d asset(s)", uploadedCount, updatedChannels, skippedCount)
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

func signalContext() (context.Context, context.CancelFunc) {
	return signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
}

func mustValidateConfig(cfg Config) {
	required := map[string]string{
		"DATABASE_URL":          cfg.DatabaseURL,
		"AWS_ACCESS_KEY_ID":     cfg.AWSAccessKeyID,
		"AWS_SECRET_ACCESS_KEY": cfg.AWSSecretAccessKey,
		"AWS_REGION":            cfg.AWSRegion,
		"AWS_SW_BUCKET":         cfg.AWSBucket,
	}
	for name, value := range required {
		if value == "" {
			log.Fatalf("missing %s", name)
		}
	}
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

func downloadAsset(ctx context.Context, client *http.Client, rawURL string) (*downloadedAsset, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "nasfaq-ytscraper-channel-assets/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("unexpected status %d", resp.StatusCode)
	}

	reader := io.LimitReader(resp.Body, maxDownloadBytes+1)
	body, err := io.ReadAll(reader)
	if err != nil {
		return nil, err
	}
	if len(body) == 0 {
		return nil, errors.New("empty response body")
	}
	if len(body) > maxDownloadBytes {
		return nil, fmt.Errorf("image exceeds %d bytes", maxDownloadBytes)
	}

	contentType := normalizeContentType(resp.Header.Get("Content-Type"), body)
	if !strings.HasPrefix(contentType, "image/") {
		return nil, fmt.Errorf("unsupported content type %q", contentType)
	}

	ext := extensionForAsset(contentType, rawURL)
	if ext == "" {
		return nil, fmt.Errorf("unsupported image type %q", contentType)
	}

	return &downloadedAsset{
		Bytes:       body,
		ContentType: contentType,
		Extension:   ext,
	}, nil
}

func uploadAsset(ctx context.Context, client *s3.Client, cfg Config, key string, asset *downloadedAsset) error {
	_, err := client.PutObject(ctx, &s3.PutObjectInput{
		Bucket:       aws.String(cfg.AWSBucket),
		Key:          aws.String(key),
		Body:         bytes.NewReader(asset.Bytes),
		ContentType:  aws.String(asset.ContentType),
		CacheControl: aws.String(immutableCacheHeader),
	})
	return err
}

func normalizePrefix(raw string, fallback string) string {
	trimmed := strings.Trim(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func normalizePublicBaseURL(raw string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(raw), "/")
	if trimmed == "" {
		return defaultCDNBaseURL
	}
	return trimmed
}

func normalizeContentType(headerValue string, body []byte) string {
	if mediaType, _, err := mime.ParseMediaType(headerValue); err == nil {
		mediaType = strings.ToLower(strings.TrimSpace(mediaType))
		if mediaType != "" {
			return mediaType
		}
	}
	return strings.ToLower(http.DetectContentType(body))
}

func extensionForAsset(contentType string, rawURL string) string {
	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/avif":
		return ".avif"
	case "image/svg+xml":
		return ".svg"
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	ext := strings.ToLower(path.Ext(parsed.Path))
	switch ext {
	case ".jpeg":
		return ".jpg"
	case ".jpg", ".png", ".webp", ".gif", ".avif", ".svg":
		return ext
	default:
		return ""
	}
}

func publicAssetURL(cfg Config, key string) string {
	escapedKey := escapeS3Key(key)
	if cfg.ChannelAssetsPublicBaseURL != "" {
		return cfg.ChannelAssetsPublicBaseURL + "/" + escapedKey
	}
	return fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", cfg.AWSBucket, cfg.AWSRegion, escapedKey)
}

func escapeS3Key(key string) string {
	parts := strings.Split(strings.TrimSpace(key), "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func stringValue(v *string) string {
	if v == nil {
		return ""
	}
	return strings.TrimSpace(*v)
}
