package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const defaultListURL = "https://hololive.hololivepro.com/en/talents/"

var ignoredProfileIDs = map[string]struct{}{
	"feed":            {},
	"friend-a":        {},
	"hanazono-sayaka": {},
	"harusaki-nodoka": {},
	"izuki-michiru":   {},
	"kazeshiro-yuki":  {},
}

type profileImage struct {
	ProfileID string
	PageURL   string
	ImageURL  string
}

func main() {
	listURL := flag.String("list-url", defaultListURL, "Talent listing page to scrape")
	outDir := flag.String("out-dir", "reference_images", "Directory to write downloaded images into")
	timeout := flag.Duration("timeout", 20*time.Second, "HTTP timeout per request")
	delay := flag.Duration("delay", 250*time.Millisecond, "Delay between member page requests")
	concurrency := flag.Int("concurrency", 4, "Number of member pages to process concurrently")
	flag.Parse()

	client := newHTTPClient(*timeout)
	ctx := context.Background()

	profileURLs, err := discoverProfileURLs(ctx, client, *listURL)
	if err != nil {
		log.Fatalf("discover profile URLs: %v", err)
	}

	if err := os.MkdirAll(*outDir, 0o755); err != nil {
		log.Fatalf("create output directory: %v", err)
	}

	existingProfileIDs, err := existingProfileIDs(*outDir)
	if err != nil {
		log.Fatalf("read existing reference images: %v", err)
	}

	profileURLs = filterExistingProfiles(profileURLs, existingProfileIDs)
	log.Printf("skipping %d members with existing images", len(existingProfileIDs))
	log.Printf("scraping %d remaining member pages", len(profileURLs))

	images, scrapeErrs := scrapeProfileImages(ctx, client, profileURLs, *delay, *concurrency)
	if len(images) == 0 && len(scrapeErrs) > 0 {
		log.Fatalf("failed to scrape any profile images: %v", errors.Join(scrapeErrs...))
	}

	downloadErrs := downloadImages(ctx, client, *outDir, images)
	errs := append(scrapeErrs, downloadErrs...)

	log.Printf("downloaded %d reference images into %s", len(images)-len(downloadErrs), *outDir)
	if len(errs) > 0 {
		log.Printf("completed with %d errors", len(errs))
		for _, err := range errs {
			log.Printf("error: %v", err)
		}
		os.Exit(1)
	}
}

func newHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &http.Client{Timeout: timeout}
}

func discoverProfileURLs(ctx context.Context, client *http.Client, listURL string) ([]string, error) {
	doc, finalURL, err := fetchDocument(ctx, client, listURL)
	if err != nil {
		return nil, err
	}

	baseURL, err := url.Parse(finalURL)
	if err != nil {
		return nil, fmt.Errorf("parse listing URL: %w", err)
	}

	seen := make(map[string]struct{})
	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok {
			return
		}

		rawURL, err := url.Parse(strings.TrimSpace(href))
		if err != nil {
			return
		}

		resolved := baseURL.ResolveReference(rawURL)
		profileID := profileIDFromURL(resolved)
		if profileID == "" {
			return
		}
		if _, ignored := ignoredProfileIDs[profileID]; ignored {
			return
		}

		resolved.RawQuery = ""
		resolved.Fragment = ""
		resolved.Path = strings.TrimRight(resolved.Path, "/") + "/"
		seen[resolved.String()] = struct{}{}
	})

	if len(seen) == 0 {
		return nil, fmt.Errorf("no profile URLs found on %s", finalURL)
	}

	profileURLs := make([]string, 0, len(seen))
	for profileURL := range seen {
		profileURLs = append(profileURLs, profileURL)
	}
	sort.Strings(profileURLs)
	return profileURLs, nil
}

func profileIDFromURL(u *url.URL) string {
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	switch len(parts) {
	case 2:
		if parts[0] != "talents" || parts[1] == "" {
			return ""
		}
		return parts[1]
	case 3:
		switch parts[0] {
		case "en", "id":
			if parts[1] != "talents" || parts[2] == "" {
				return ""
			}
			return parts[2]
		default:
			return ""
		}
	default:
		return ""
	}
}

func scrapeProfileImages(ctx context.Context, client *http.Client, profileURLs []string, delay time.Duration, concurrency int) ([]profileImage, []error) {
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > len(profileURLs) {
		concurrency = len(profileURLs)
	}
	if concurrency == 0 {
		return nil, nil
	}

	type result struct {
		image profileImage
		err   error
	}

	jobs := make(chan string)
	results := make(chan result, len(profileURLs))

	var wg sync.WaitGroup
	for range concurrency {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for profileURL := range jobs {
				if delay > 0 {
					select {
					case <-ctx.Done():
						results <- result{err: ctx.Err()}
						continue
					case <-time.After(delay):
					}
				}

				image, err := scrapeProfileImage(ctx, client, profileURL)
				results <- result{image: image, err: err}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for _, profileURL := range profileURLs {
			select {
			case <-ctx.Done():
				return
			case jobs <- profileURL:
			}
		}
	}()

	go func() {
		wg.Wait()
		close(results)
	}()

	images := make([]profileImage, 0, len(profileURLs))
	var errs []error
	for result := range results {
		if result.err != nil {
			errs = append(errs, result.err)
			continue
		}
		images = append(images, result.image)
	}

	sort.Slice(images, func(i, j int) bool {
		return images[i].ProfileID < images[j].ProfileID
	})

	return images, errs
}

func scrapeProfileImage(ctx context.Context, client *http.Client, profileURL string) (profileImage, error) {
	doc, finalURL, err := fetchDocument(ctx, client, profileURL)
	if err != nil {
		return profileImage{}, fmt.Errorf("fetch %s: %w", profileURL, err)
	}

	finalParsed, err := url.Parse(finalURL)
	if err != nil {
		return profileImage{}, fmt.Errorf("parse profile URL %s: %w", finalURL, err)
	}

	profileID := profileIDFromURL(finalParsed)
	if profileID == "" {
		return profileImage{}, fmt.Errorf("could not derive profile ID from %s", finalURL)
	}

	imageURL, err := findReferenceImageURL(doc, finalParsed)
	if err != nil {
		return profileImage{}, fmt.Errorf("%s: %w", profileID, err)
	}

	return profileImage{
		ProfileID: profileID,
		PageURL:   finalURL,
		ImageURL:  imageURL,
	}, nil
}

func findReferenceImageURL(doc *goquery.Document, baseURL *url.URL) (string, error) {
	candidates := make([]string, 0, 8)
	doc.Find("img").Each(func(_ int, s *goquery.Selection) {
		imageURL, ok := resolveImageCandidate(s, baseURL)
		if ok {
			candidates = append(candidates, imageURL)
		}
	})

	if len(candidates) == 0 {
		return "", fmt.Errorf("reference image not found")
	}

	for _, candidate := range candidates {
		if isPreferredReferenceImageURL(candidate) {
			return candidate, nil
		}
	}

	return candidates[0], nil
}

func isReferenceImageURL(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	return strings.Contains(value, "pr-img") || strings.Contains(value, "pr-image")
}

func isPreferredReferenceImageURL(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	return strings.Contains(value, "pr-img_01") || strings.Contains(value, "pr-image_01")
}

func resolveImageCandidate(s *goquery.Selection, baseURL *url.URL) (string, bool) {
	alt, _ := s.Attr("alt")
	for _, attr := range []string{"src", "data-src", "data-lazy-src", "data-original"} {
		value, ok := s.Attr(attr)
		if !ok {
			continue
		}
		if !isReferenceImageURL(value) && !strings.Contains(alt, "全身画像") {
			continue
		}

		rawURL, err := url.Parse(strings.TrimSpace(value))
		if err != nil {
			continue
		}
		return baseURL.ResolveReference(rawURL).String(), true
	}
	return "", false
}

func existingProfileIDs(outDir string) (map[string]struct{}, error) {
	entries, err := os.ReadDir(outDir)
	if err != nil {
		return nil, err
	}

	out := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		name := entry.Name()
		ext := filepath.Ext(name)
		profileID := strings.TrimSuffix(name, ext)
		if profileID == "" {
			continue
		}
		out[profileID] = struct{}{}
	}
	return out, nil
}

func filterExistingProfiles(profileURLs []string, existing map[string]struct{}) []string {
	if len(existing) == 0 {
		return profileURLs
	}

	filtered := make([]string, 0, len(profileURLs))
	for _, profileURL := range profileURLs {
		parsed, err := url.Parse(profileURL)
		if err != nil {
			continue
		}
		profileID := profileIDFromURL(parsed)
		if profileID == "" {
			continue
		}
		if _, ok := existing[profileID]; ok {
			continue
		}
		filtered = append(filtered, profileURL)
	}
	return filtered
}

func downloadImages(ctx context.Context, client *http.Client, outDir string, images []profileImage) []error {
	errs := make([]error, 0)
	for _, image := range images {
		if err := downloadImage(ctx, client, outDir, image); err != nil {
			errs = append(errs, err)
		}
	}
	return errs
}

func downloadImage(ctx context.Context, client *http.Client, outDir string, image profileImage) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, image.ImageURL, nil)
	if err != nil {
		return fmt.Errorf("%s: build image request: %w", image.ProfileID, err)
	}
	req.Header.Set("User-Agent", userAgent())

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("%s: download image: %w", image.ProfileID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s: unexpected image status %s", image.ProfileID, resp.Status)
	}

	outPath := filepath.Join(outDir, image.ProfileID+extensionFromURL(image.ImageURL))
	file, err := os.Create(outPath)
	if err != nil {
		return fmt.Errorf("%s: create output file: %w", image.ProfileID, err)
	}
	defer file.Close()

	if _, err := io.Copy(file, resp.Body); err != nil {
		return fmt.Errorf("%s: write image file: %w", image.ProfileID, err)
	}

	return nil
}

func extensionFromURL(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil {
		return ".img"
	}

	ext := strings.ToLower(path.Ext(parsed.Path))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".webp":
		return ext
	default:
		return ".img"
	}
}

func fetchDocument(ctx context.Context, client *http.Client, rawURL string) (*goquery.Document, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", userAgent())

	resp, err := client.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("unexpected status %s", resp.Status)
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, "", fmt.Errorf("parse HTML: %w", err)
	}

	return doc, resp.Request.URL.String(), nil
}

func userAgent() string {
	return "NASFAQV2 Hololive Reference Image Scraper/1.0 (+https://hololive.hololivepro.com/en/talents/)"
}
