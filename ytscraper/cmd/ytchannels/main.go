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

	"github.com/joho/godotenv"

	"nasfaqv2/brokerbot/ytscraper/internal/db"
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
	fmt.Println("Enter 'q' at any prompt to quit.\n")

	for {
		id, ok := prompt(in, "youtube_channel_id")
		if !ok {
			return
		}
		if id == "" {
			fmt.Println("youtube_channel_id is required.\n")
			continue
		}

		name, ok := prompt(in, "name")
		if !ok {
			return
		}
		if name == "" {
			fmt.Println("name is required.\n")
			continue
		}

		symbolStr, ok := prompt(in, "symbol (optional)")
		if !ok {
			return
		}
		iconStr, ok := prompt(in, "icon url/path (optional)")
		if !ok {
			return
		}

		var symbol *string
		if symbolStr != "" {
			s := symbolStr
			symbol = &s
		}
		var icon *string
		if iconStr != "" {
			s := iconStr
			icon = &s
		}

		ch := db.Channel{
			YouTubeChannelID: id,
			Name:             name,
			Symbol:           symbol,
			Icon:             icon,
		}

		if err := db.UpsertChannel(ctx, pool, ch); err != nil {
			fmt.Printf("ERROR: %v\n\n", err)
			continue
		}

		fmt.Printf("OK: upserted channel %s (%s)\n\n", id, name)
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
