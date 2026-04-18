package scraper

import (
	"context"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const DefaultListURL = "https://hololive.hololivepro.com/en/talents/"

var youtubeChannelIDPatterns = []*regexp.Regexp{
	regexp.MustCompile(`"externalId":"(UC[a-zA-Z0-9_-]+)"`),
	regexp.MustCompile(`"channelId":"(UC[a-zA-Z0-9_-]+)"`),
	regexp.MustCompile(`https://www\.youtube\.com/channel/(UC[a-zA-Z0-9_-]+)`),
}

var leadingNameLabelPattern = regexp.MustCompile(`^\[[^\]]+\]\s*`)

var defaultIgnoredProfileIDs = map[string]struct{}{
	"friend-a":         {},
	"hanazono-sayaka":  {},
	"harusaki-nodoka":  {},
	"izuki-michiru":    {},
	"kazeshiro-yuki":   {},
}

type Channel struct {
	YouTubeChannelID string `json:"youtube_channel_id"`
	NameShort        string `json:"name_short"`
	NameEnglish      string `json:"name_english"`
	NameJapanese     string `json:"name_japanese"`
	TwitterID        string `json:"twitter_id"`
	ProfileID        string `json:"profile_id"`
	Birthday         string `json:"birthday"`
	Height           string `json:"height"`
	Unit             string `json:"unit"`
	Icon             string `json:"icon"`
	ReferenceImageURL string `json:"reference_image_url"`
}

type Options struct {
	ListURL        string
	BirthdayYear   int
	Delay          time.Duration
	Concurrency    int
	SkipProfileIDs []string
	ContinueOnProfileError bool
}

func NewHTTPClient(timeout time.Duration) *http.Client {
	if timeout <= 0 {
		timeout = 20 * time.Second
	}
	return &http.Client{Timeout: timeout}
}

func Scrape(ctx context.Context, client *http.Client, opts Options) ([]Channel, error) {
	if client == nil {
		return nil, fmt.Errorf("nil http client")
	}
	if opts.BirthdayYear < 1 {
		return nil, fmt.Errorf("birthday year must be at least 1")
	}
	if opts.ListURL == "" {
		opts.ListURL = DefaultListURL
	}
	if opts.Concurrency < 1 {
		opts.Concurrency = 1
	}

	skipProfileIDs := make(map[string]struct{}, len(defaultIgnoredProfileIDs)+len(opts.SkipProfileIDs))
	for profileID := range defaultIgnoredProfileIDs {
		skipProfileIDs[profileID] = struct{}{}
	}
	for _, profileID := range opts.SkipProfileIDs {
		profileID = strings.TrimSpace(strings.ToLower(profileID))
		if profileID != "" {
			skipProfileIDs[profileID] = struct{}{}
		}
	}

	listDoc, _, err := fetchDocument(ctx, client, opts.ListURL)
	if err != nil {
		return nil, fmt.Errorf("fetch listing page: %w", err)
	}

	profileURLs, err := discoverTalentLinks(listDoc, opts.ListURL, skipProfileIDs)
	if err != nil {
		return nil, fmt.Errorf("discover talent links: %w", err)
	}

	rows, err := scrapeProfileURLs(ctx, client, profileURLs, opts)
	if err != nil {
		return nil, err
	}

	sort.Slice(rows, func(i, j int) bool {
		return rows[i].ProfileID < rows[j].ProfileID
	})

	return rows, nil
}

func scrapeProfileURLs(ctx context.Context, client *http.Client, profileURLs []string, opts Options) ([]Channel, error) {
	if opts.Concurrency <= 1 || len(profileURLs) <= 1 {
		rows := make([]Channel, 0, len(profileURLs))
		for i, profileURL := range profileURLs {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if i > 0 && opts.Delay > 0 {
				select {
				case <-ctx.Done():
					return nil, ctx.Err()
				case <-time.After(opts.Delay):
				}
			}

			row, err := scrapeTalentPage(ctx, client, profileURL, opts.BirthdayYear)
			if err != nil {
				if opts.ContinueOnProfileError {
					log.Printf("warn: skipping profile %s: %v", profileURL, err)
					continue
				}
				return nil, fmt.Errorf("scrape %s: %w", profileURL, err)
			}
			rows = append(rows, row)
		}
		return rows, nil
	}

	type job struct {
		index int
		url   string
	}
	type result struct {
		index int
		row   Channel
		err   error
	}

	workerCount := opts.Concurrency
	if workerCount > len(profileURLs) {
		workerCount = len(profileURLs)
	}

	jobs := make(chan job)
	results := make(chan result, len(profileURLs))

	for range workerCount {
		go func() {
			for job := range jobs {
				if opts.Delay > 0 {
					select {
					case <-ctx.Done():
						results <- result{index: job.index, err: ctx.Err()}
						continue
					case <-time.After(opts.Delay):
					}
				}

				row, err := scrapeTalentPage(ctx, client, job.url, opts.BirthdayYear)
				if err != nil {
					results <- result{index: job.index, err: fmt.Errorf("scrape %s: %w", job.url, err)}
					continue
				}
				results <- result{index: job.index, row: row}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for i, profileURL := range profileURLs {
			select {
			case <-ctx.Done():
				return
			case jobs <- job{index: i, url: profileURL}:
			}
		}
	}()

	rows := make([]Channel, len(profileURLs))
	for range profileURLs {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case result := <-results:
			if result.err != nil {
				if opts.ContinueOnProfileError {
					log.Printf("warn: %v", result.err)
					continue
				}
				return nil, result.err
			}
			rows[result.index] = result.row
		}
	}

	if opts.ContinueOnProfileError {
		filtered := make([]Channel, 0, len(rows))
		for _, row := range rows {
			if row.YouTubeChannelID == "" || row.NameShort == "" {
				continue
			}
			filtered = append(filtered, row)
		}
		return filtered, nil
	}

	return rows, nil
}

func DefaultIcon(nameEnglish, nameShort string) string {
	source := strings.TrimSpace(nameShort)
	if trimmedEnglish := strings.TrimSpace(nameEnglish); trimmedEnglish != "" {
		fields := strings.Fields(trimmedEnglish)
		if len(fields) > 0 {
			source = fields[len(fields)-1]
		}
	}

	var b strings.Builder
	for _, r := range strings.ToLower(source) {
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r)
		}
	}

	return b.String()
}

func fetchDocument(ctx context.Context, client *http.Client, rawURL string) (*goquery.Document, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, "", fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("User-Agent", "NASFAQV2 Channels Scraper/1.0 (+https://hololive.hololivepro.com/en/talents/)")

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
		return nil, "", fmt.Errorf("parse html: %w", err)
	}

	return doc, resp.Request.URL.String(), nil
}

func discoverTalentLinks(doc *goquery.Document, listURL string, skipProfileIDs map[string]struct{}) ([]string, error) {
	baseURL, err := url.Parse(listURL)
	if err != nil {
		return nil, fmt.Errorf("parse list url: %w", err)
	}

	seen := make(map[string]struct{})
	for _, raw := range collectHrefs(doc) {
		u, err := url.Parse(raw)
		if err != nil {
			continue
		}

		resolved := baseURL.ResolveReference(u)
		profileID := profileIDFromURL(resolved)
		if profileID == "" {
			continue
		}
		if _, ignored := skipProfileIDs[profileID]; ignored {
			continue
		}

		resolved.RawQuery = ""
		resolved.Fragment = ""
		resolved.Path = strings.TrimRight(resolved.Path, "/") + "/"
		seen[resolved.String()] = struct{}{}
	}

	if len(seen) == 0 {
		return nil, fmt.Errorf("no talent profile links found")
	}

	out := make([]string, 0, len(seen))
	for profileURL := range seen {
		out = append(out, profileURL)
	}
	sort.Strings(out)
	return out, nil
}

func collectHrefs(doc *goquery.Document) []string {
	out := make([]string, 0, 128)
	doc.Find("a[href]").Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if ok {
			out = append(out, href)
		}
	})
	return out
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
		if parts[0] != "en" || parts[1] != "talents" || parts[2] == "" {
			return ""
		}
		return parts[2]
	default:
		return ""
	}
}

func scrapeTalentPage(ctx context.Context, client *http.Client, profileURL string, birthdayYear int) (Channel, error) {
	doc, finalURL, err := fetchDocument(ctx, client, profileURL)
	if err != nil {
		return Channel{}, err
	}

	finalParsed, err := url.Parse(finalURL)
	if err != nil {
		return Channel{}, fmt.Errorf("parse final url: %w", err)
	}

	row := Channel{
		ProfileID: profileIDFromURL(finalParsed),
	}
	if row.ProfileID == "" {
		return Channel{}, fmt.Errorf("could not derive profile_id from %s", finalURL)
	}

	h1 := doc.Find("div.right_box div.bg_box h1").First()
	if h1.Length() == 0 {
		h1 = doc.Find("h1").First()
	}
	if h1.Length() == 0 {
		return Channel{}, fmt.Errorf("missing h1")
	}

	row.NameEnglish = normalizeEnglishName(cleanWhitespace(ownText(h1)))
	row.NameShort = shortName(row.NameEnglish)
	row.NameJapanese = normalizeJapaneseName(cleanWhitespace(h1.Find("span").First().Text()))
	row.Icon = DefaultIcon(row.NameEnglish, row.NameShort)
	row.ReferenceImageURL = extractReferenceImageURL(doc, finalParsed)

	if row.NameEnglish == "" {
		return Channel{}, fmt.Errorf("missing name_english")
	}
	if row.NameShort == "" {
		return Channel{}, fmt.Errorf("missing name_short")
	}

	socials, err := extractSocialLinks(ctx, client, doc)
	if err != nil {
		return Channel{}, err
	}
	row.YouTubeChannelID = socials.YouTubeChannelID
	row.TwitterID = socials.TwitterID

	if row.YouTubeChannelID == "" {
		return Channel{}, fmt.Errorf("missing youtube_channel_id")
	}

	dataFields := extractDataFields(doc)

	birthday, err := normalizeBirthday(dataFields["birthday"], birthdayYear)
	if err != nil {
		return Channel{}, err
	}
	row.Birthday = birthday
	row.Height = cleanWhitespace(dataFields["height"])
	row.Unit = cleanWhitespace(dataFields["unit"])

	return row, nil
}

func extractReferenceImageURL(doc *goquery.Document, baseURL *url.URL) string {
	candidates := make([]string, 0, 8)
	doc.Find("img").Each(func(_ int, s *goquery.Selection) {
		imageURL, ok := resolveReferenceImageCandidate(s, baseURL)
		if ok {
			candidates = append(candidates, imageURL)
		}
	})

	for _, candidate := range candidates {
		if isPreferredReferenceImageURL(candidate) {
			return candidate
		}
	}
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

func resolveReferenceImageCandidate(s *goquery.Selection, baseURL *url.URL) (string, bool) {
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

func isReferenceImageURL(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	return strings.Contains(value, "pr-img") || strings.Contains(value, "pr-image")
}

func isPreferredReferenceImageURL(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	return strings.Contains(value, "pr-img_01") || strings.Contains(value, "pr-image_01")
}

func ownText(s *goquery.Selection) string {
	clone := s.Clone()
	clone.Find("span").Remove()
	return clone.Text()
}

func shortName(name string) string {
	fields := strings.Fields(name)
	if len(fields) == 0 {
		return ""
	}
	return strings.Trim(fields[len(fields)-1], "()[]")
}

func normalizeEnglishName(name string) string {
	return cleanWhitespace(leadingNameLabelPattern.ReplaceAllString(name, ""))
}

func normalizeJapaneseName(name string) string {
	replacer := strings.NewReplacer("・", " ", "･", " ", "·", " ")
	return cleanWhitespace(replacer.Replace(name))
}

type socialLinks struct {
	YouTubeChannelID string
	TwitterID        string
}

func extractSocialLinks(ctx context.Context, client *http.Client, doc *goquery.Document) (socialLinks, error) {
	var out socialLinks
	var youtubeURL string

	doc.Find("ul.t_sns a[href]").Each(func(_ int, s *goquery.Selection) {
		rawHref, ok := s.Attr("href")
		if !ok {
			return
		}

		href, err := url.Parse(rawHref)
		if err != nil {
			return
		}

		host := strings.ToLower(strings.TrimPrefix(href.Hostname(), "www."))
		switch host {
		case "youtube.com":
			if strings.HasPrefix(href.Path, "/channel/") && out.YouTubeChannelID == "" {
				out.YouTubeChannelID = strings.TrimPrefix(href.Path, "/channel/")
			} else if youtubeURL == "" {
				youtubeURL = href.String()
			}
		case "twitter.com", "x.com":
			if out.TwitterID == "" {
				out.TwitterID = firstPathSegment(href.Path)
			}
		}
	})

	if out.YouTubeChannelID == "" && youtubeURL != "" {
		channelID, err := resolveYouTubeChannelID(ctx, client, youtubeURL)
		if err != nil {
			return socialLinks{}, err
		}
		out.YouTubeChannelID = channelID
	}

	return out, nil
}

func firstPathSegment(pathValue string) string {
	trimmed := strings.Trim(pathValue, "/")
	if trimmed == "" {
		return ""
	}
	return strings.Split(trimmed, "/")[0]
}

func extractDataFields(doc *goquery.Document) map[string]string {
	fields := make(map[string]string)
	doc.Find("div.talent_data dl").Each(func(_ int, dl *goquery.Selection) {
		key := normalizeFieldKey(dl.Find("dt").First().Text())
		value := cleanWhitespace(dl.Find("dd").First().Text())
		if key != "" {
			fields[key] = value
		}
	})
	return fields
}

func normalizeFieldKey(value string) string {
	return strings.ToLower(cleanWhitespace(value))
}

func normalizeBirthday(raw string, year int) (string, error) {
	raw = cleanWhitespace(raw)
	if raw == "" {
		return "", nil
	}

	parsed, err := time.Parse("January 2", raw)
	if err != nil {
		return "", fmt.Errorf("parse birthday %q: %w", raw, err)
	}

	date := time.Date(year, parsed.Month(), parsed.Day(), 0, 0, 0, 0, time.UTC)
	return date.Format("2006-01-02"), nil
}

func resolveYouTubeChannelID(ctx context.Context, client *http.Client, rawURL string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return "", fmt.Errorf("build youtube request: %w", err)
	}
	req.Header.Set("User-Agent", "NASFAQV2 Channels Scraper/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("fetch youtube page: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("youtube lookup returned %s", resp.Status)
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if err != nil {
		return "", fmt.Errorf("read youtube page: %w", err)
	}

	html := string(body)
	for _, pattern := range youtubeChannelIDPatterns {
		matches := pattern.FindStringSubmatch(html)
		if len(matches) == 2 {
			return matches[1], nil
		}
	}

	return "", fmt.Errorf("could not resolve youtube channel id from %s", rawURL)
}

func cleanWhitespace(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}
