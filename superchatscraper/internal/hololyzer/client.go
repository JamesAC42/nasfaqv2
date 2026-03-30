package hololyzer

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

var (
	youtubeWatchURLPattern = regexp.MustCompile(`^https?://(?:www\.)?youtube\.com/watch\?`)
)

type Client struct {
	BaseURL    string
	HTTPClient *http.Client
}

type DailyArchiveTarget struct {
	ArchiveURL             string
	VideoID                string
	FallbackSuperchatTotal int64
}

type SuperchatCurrencyBreakdown struct {
	CurrencyName    string
	DonationCount   int64
	TotalInCurrency string
	TotalInYen      int64
}

type SuperchatDetail struct {
	VideoID        string
	SuperchatTotal int64
	Breakdowns     []SuperchatCurrencyBreakdown
}

func New(baseURL string) *Client {
	if baseURL == "" {
		baseURL = "https://www.hololyzer.net"
	}
	return &Client{
		BaseURL: strings.TrimRight(baseURL, "/"),
		HTTPClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

func (c *Client) FetchDailyArchiveTargets(ctx context.Context, date string) ([]DailyArchiveTarget, error) {
	dailyURL := fmt.Sprintf("%s/youtube/realtime/list/%s.html", c.BaseURL, date)
	doc, baseURL, err := fetchDocument(ctx, c.HTTPClient, dailyURL)
	if err != nil {
		return nil, err
	}

	seen := make(map[string]struct{})
	targets := make([]DailyArchiveTarget, 0)
	doc.Find(`a[href*="/superchat/"]`).Each(func(_ int, s *goquery.Selection) {
		href, ok := s.Attr("href")
		if !ok || href == "" {
			return
		}
		resolved, err := baseURL.Parse(href)
		if err != nil {
			return
		}
		archiveURL := resolved.String()
		if _, ok := seen[archiveURL]; ok {
			return
		}
		seen[archiveURL] = struct{}{}

		block := s.ParentsFiltered("div.hoge").First()
		videoID := extractDailyArchiveVideoID(block)
		if videoID == "" {
			videoID = extractArchiveVideoID(resolved.Path)
		}

		fallbackTotal, err := parseYenAmountFromAnchorText(s.Text())
		if err != nil {
			return
		}

		targets = append(targets, DailyArchiveTarget{
			ArchiveURL:             archiveURL,
			VideoID:                videoID,
			FallbackSuperchatTotal: fallbackTotal,
		})
	})

	return targets, nil
}

func (c *Client) FetchSuperchatDetail(ctx context.Context, archiveURL string) (SuperchatDetail, error) {
	doc, _, err := fetchDocument(ctx, c.HTTPClient, archiveURL)
	if err != nil {
		return SuperchatDetail{}, err
	}

	_, videoID, err := findVideoAnchor(doc)
	if err != nil {
		return SuperchatDetail{}, fmt.Errorf("parse video link %s: %w", archiveURL, err)
	}

	breakdowns, total, err := parseBreakdowns(doc)
	if err != nil {
		return SuperchatDetail{}, fmt.Errorf("parse superchat table %s: %w", archiveURL, err)
	}

	return SuperchatDetail{
		VideoID:        videoID,
		SuperchatTotal: total,
		Breakdowns:     breakdowns,
	}, nil
}

func fetchDocument(ctx context.Context, client *http.Client, rawURL string) (*goquery.Document, *url.URL, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, nil, fmt.Errorf("build request %s: %w", rawURL, err)
	}
	req.Header.Set("User-Agent", "NASFAQV2-superchatscraper/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("fetch %s: %w", rawURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("fetch %s: unexpected status %d", rawURL, resp.StatusCode)
	}

	doc, err := goquery.NewDocumentFromReader(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("parse html %s: %w", rawURL, err)
	}
	return doc, resp.Request.URL, nil
}

func findVideoAnchor(doc *goquery.Document) (*goquery.Selection, string, error) {
	var match *goquery.Selection
	var videoID string

	doc.Find("a[href]").EachWithBreak(func(_ int, s *goquery.Selection) bool {
		href, ok := s.Attr("href")
		if !ok {
			return true
		}
		if !youtubeWatchURLPattern.MatchString(href) {
			return true
		}
		id := extractVideoID(href)
		if id == "" {
			return true
		}
		match = s
		videoID = id
		return false
	})

	if match == nil || videoID == "" {
		return nil, "", fmt.Errorf("youtube watch link not found")
	}
	return match, videoID, nil
}

func parseBreakdowns(doc *goquery.Document) ([]SuperchatCurrencyBreakdown, int64, error) {
	var breakdowns []SuperchatCurrencyBreakdown
	var total int64
	foundTable := false

	doc.Find("table.supacha_table").First().Find("tr").Each(func(i int, tr *goquery.Selection) {
		if i == 0 {
			foundTable = true
			return
		}

		tds := tr.Find("td.supacha_td")
		if tds.Length() != 5 {
			return
		}

		currencyName := cleanText(tds.Eq(1).Text())
		donationCountText := cleanText(tds.Eq(2).Text())
		totalInCurrencyText := normalizeNumericString(cleanText(tds.Eq(3).Text()))
		totalInYenText := cleanText(tds.Eq(4).Text())

		if currencyName == "----" {
			parsedTotal, err := parseYenAmount(totalInYenText)
			if err == nil {
				total = parsedTotal
			}
			return
		}

		donationCount, err := strconv.ParseInt(donationCountText, 10, 64)
		if err != nil {
			return
		}
		totalInYen, err := parseYenAmount(totalInYenText)
		if err != nil {
			return
		}
		if totalInCurrencyText == "" {
			return
		}

		breakdowns = append(breakdowns, SuperchatCurrencyBreakdown{
			CurrencyName:    currencyName,
			DonationCount:   donationCount,
			TotalInCurrency: totalInCurrencyText,
			TotalInYen:      totalInYen,
		})
	})

	if !foundTable {
		return nil, 0, fmt.Errorf("supacha_table not found")
	}
	if total == 0 {
		lastTD := doc.Find("td.supacha_td").Last()
		if lastTD.Length() == 0 {
			return breakdowns, 0, nil
		}
		parsedTotal, err := parseYenAmount(lastTD.Text())
		if err != nil {
			if len(breakdowns) == 0 {
				return breakdowns, 0, nil
			}
			return nil, 0, err
		}
		total = parsedTotal
	}

	return breakdowns, total, nil
}

func extractDailyArchiveVideoID(block *goquery.Selection) string {
	if block == nil || block.Length() == 0 {
		return ""
	}

	videoAnchor := block.Find(`a[href*="youtube.com/watch?v="]`).First()
	if href, ok := videoAnchor.Attr("href"); ok {
		return extractVideoID(href)
	}
	return ""
}

func extractArchiveVideoID(path string) string {
	trimmed := strings.TrimSuffix(path, ".html")
	parts := strings.Split(strings.Trim(trimmed, "/"), "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

func extractVideoID(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	return parsed.Query().Get("v")
}

func parseYenAmount(value string) (int64, error) {
	cleaned := strings.TrimPrefix(cleanText(value), `\`)
	cleaned = strings.ReplaceAll(cleaned, ",", "")
	if cleaned == "" {
		return 0, fmt.Errorf("empty yen amount")
	}
	return strconv.ParseInt(cleaned, 10, 64)
}

func parseYenAmountFromAnchorText(value string) (int64, error) {
	cleaned := cleanText(value)
	cleaned = strings.TrimPrefix(cleaned, "￥")
	cleaned = strings.TrimPrefix(cleaned, "¥")
	cleaned = strings.ReplaceAll(cleaned, ",", "")
	if cleaned == "" {
		return 0, fmt.Errorf("empty anchor yen amount")
	}
	return strconv.ParseInt(cleaned, 10, 64)
}

func normalizeNumericString(value string) string {
	value = strings.ReplaceAll(cleanText(value), ",", "")
	return value
}

func cleanText(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}
