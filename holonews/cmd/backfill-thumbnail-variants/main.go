package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/JamesAC42/nasfaqv2/holonews/internal/thumbs"
	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/joho/godotenv"
)

type Config struct {
	AWSAccessKeyID      string
	AWSSecretAccessKey  string
	AWSRegion           string
	AWSBucket           string
	ThumbnailS3Prefix   string
	ThumbnailCDNBaseURL string
	RequestTimeout      time.Duration
}

func main() {
	loadEnv()
	cfg := mustLoadConfig()

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	client, err := newS3Client(ctx, cfg)
	if err != nil {
		log.Fatalf("s3: %v", err)
	}
	httpClient := &http.Client{Timeout: cfg.RequestTimeout}

	originalKeys, existingKeys, err := listThumbnailObjects(ctx, client, cfg)
	if err != nil {
		log.Fatalf("list objects: %v", err)
	}

	log.Printf("backfill: found %d original objects and %d total objects under %s/", len(originalKeys), len(existingKeys), cfg.ThumbnailS3Prefix)

	created := 0
	skipped := 0
	for _, key := range originalKeys {
		variantKey := thumbs.VariantKey(key)
		if _, exists := existingKeys[variantKey]; exists {
			log.Printf("backfill: skip existing variant source=%s variant=%s", key, variantKey)
			skipped++
			continue
		}

		data, err := downloadObject(ctx, httpClient, cfg, key)
		if err != nil {
			log.Printf("backfill: download failed key=%s err=%v", key, err)
			continue
		}

		thumbnailData, thumbnailMIMEType, err := thumbs.SquareJPEG(data, thumbs.DefaultSize)
		if err != nil {
			log.Printf("backfill: resize failed key=%s err=%v", key, err)
			continue
		}

		thumbnailMetadata := map[string]string{
			"source-key": key,
			"variant":    "thumbnail",
		}
		if err := putImageObject(ctx, client, cfg.AWSBucket, variantKey, thumbnailData, thumbnailMIMEType, thumbnailMetadata); err != nil {
			log.Printf("backfill: upload failed key=%s variant=%s err=%v", key, variantKey, err)
			continue
		}

		log.Printf("backfill: uploaded variant source=%s variant=%s", key, variantKey)
		created++
	}

	log.Printf("backfill: complete created=%d skipped=%d", created, skipped)
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
		AWSAccessKeyID:      getEnv("AWS_ACCESS_KEY_ID", ""),
		AWSSecretAccessKey:  getEnv("AWS_SECRET_ACCESS_KEY", ""),
		AWSRegion:           getEnv("AWS_REGION", ""),
		AWSBucket:           getEnv("AWS_SW_BUCKET", ""),
		ThumbnailS3Prefix:   strings.Trim(getEnv("THUMBNAIL_S3_PREFIX", "thumbnails"), "/"),
		ThumbnailCDNBaseURL: strings.TrimRight(getEnv("THUMBNAIL_CDN_BASE_URL", "https://images.nasfaq.biz"), "/"),
		RequestTimeout:      time.Duration(parseEnvInt("REQUEST_TIMEOUT_SECONDS", 20)) * time.Second,
	}

	var missing []string
	for key, value := range map[string]string{
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
		log.Fatalf("missing required env vars: %s", strings.Join(missing, ", "))
	}

	return cfg
}

func parseEnvInt(key string, fallback int) int {
	v := strings.TrimSpace(os.Getenv(key))
	if v == "" {
		return fallback
	}
	var out int
	for _, ch := range v {
		if ch < '0' || ch > '9' {
			return fallback
		}
		out = out*10 + int(ch-'0')
	}
	return out
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

func listThumbnailObjects(ctx context.Context, client *s3.Client, cfg Config) ([]string, map[string]struct{}, error) {
	prefix := cfg.ThumbnailS3Prefix + "/"
	paginator := s3.NewListObjectsV2Paginator(client, &s3.ListObjectsV2Input{
		Bucket: aws.String(cfg.AWSBucket),
		Prefix: aws.String(prefix),
	})

	existingKeys := make(map[string]struct{})
	originalKeys := make([]string, 0)
	for paginator.HasMorePages() {
		page, err := paginator.NextPage(ctx)
		if err != nil {
			return nil, nil, err
		}
		for _, object := range page.Contents {
			if object.Key == nil {
				continue
			}
			key := strings.TrimSpace(*object.Key)
			if key == "" || strings.HasSuffix(key, "/") {
				continue
			}
			existingKeys[key] = struct{}{}
			if thumbs.IsVariantKey(key) {
				continue
			}
			originalKeys = append(originalKeys, key)
		}
	}
	return originalKeys, existingKeys, nil
}

func downloadObject(ctx context.Context, client *http.Client, cfg Config, key string) ([]byte, error) {
	segments := strings.Split(strings.TrimSpace(key), "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	imageURL := cfg.ThumbnailCDNBaseURL + "/" + strings.Join(segments, "/")

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, imageURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("cdn status %d for %s", resp.StatusCode, imageURL)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return data, nil
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
