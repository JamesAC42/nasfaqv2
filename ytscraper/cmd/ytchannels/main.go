package main

import (
	"bufio"
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/ytscraper/internal/db"
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

	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.NewPool(ctx, dbURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	in := bufio.NewReader(os.Stdin)

	fmt.Println("Add YouTube channels to yt.youtube_channels.")
	fmt.Println("Enter 'q' at any prompt to quit.")
	fmt.Println()

	for {
		id, ok := prompt(in, "youtube_channel_id")
		if !ok {
			return
		}
		if id == "" {
			fmt.Println("youtube_channel_id is required.")
			fmt.Println()
			continue
		}

		nameShort, ok := prompt(in, "name_short")
		if !ok {
			return
		}
		if nameShort == "" {
			fmt.Println("name_short is required.")
			fmt.Println()
			continue
		}

		nameEnglishStr, ok := prompt(in, "name_english (optional)")
		if !ok {
			return
		}
		nameJapaneseStr, ok := prompt(in, "name_japanese (optional)")
		if !ok {
			return
		}
		symbolStr, ok := prompt(in, "symbol (optional)")
		if !ok {
			return
		}
		iconStr, ok := prompt(in, "icon url/path (optional)")
		if !ok {
			return
		}
		twitterIDStr, ok := prompt(in, "twitter_id (optional)")
		if !ok {
			return
		}
		profileIDStr, ok := prompt(in, "profile_id (optional)")
		if !ok {
			return
		}
		birthdayStr, ok := prompt(in, "birthday (optional, YYYY-MM-DD)")
		if !ok {
			return
		}
		heightStr, ok := prompt(in, "height (optional)")
		if !ok {
			return
		}
		unitStr, ok := prompt(in, "unit (optional)")
		if !ok {
			return
		}

		birthday, err := optionalDatePtr(birthdayStr)
		if err != nil {
			fmt.Printf("birthday must be YYYY-MM-DD: %v\n\n", err)
			continue
		}

		ch := db.Channel{
			YouTubeChannelID: id,
			NameShort:        nameShort,
			NameEnglish:      optionalStringPtr(nameEnglishStr),
			NameJapanese:     optionalStringPtr(nameJapaneseStr),
			Symbol:           optionalStringPtr(symbolStr),
			Icon:             optionalStringPtr(iconStr),
			TwitterID:        optionalStringPtr(twitterIDStr),
			ProfileID:        optionalStringPtr(profileIDStr),
			Birthday:         birthday,
			Height:           optionalStringPtr(heightStr),
			Unit:             optionalStringPtr(unitStr),
		}

		if err := db.UpsertChannel(ctx, pool, ch); err != nil {
			fmt.Printf("ERROR: %v\n\n", err)
			continue
		}

		fmt.Printf("OK: upserted channel %s (%s)\n\n", id, nameShort)
	}
}

func prompt(in *bufio.Reader, label string) (string, bool) {
	fmt.Printf("%s: ", label)
	raw, err := in.ReadString('\n')
	if err != nil {
		return "", false
	}
	s := strings.TrimSpace(raw)
	if strings.EqualFold(s, "q") {
		return "", false
	}
	return s, true
}

func optionalStringPtr(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}

func optionalDatePtr(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}

	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return nil, err
	}
	utc := time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 0, 0, 0, 0, time.UTC)
	return &utc, nil
}
