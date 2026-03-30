package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/joho/godotenv"

	"github.com/JamesAC42/nasfaqv2/brokerbot/superchatscraper/internal/db"
)

func main() {
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

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatalf("missing DATABASE_URL")
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	pool, err := db.NewPool(ctx, databaseURL)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer pool.Close()

	if err := db.ApplySchema(ctx, pool); err != nil {
		log.Fatalf("schema: %v", err)
	}

	if err := db.ClearYouTubeSuperchatTables(ctx, pool); err != nil {
		log.Fatalf("clear: %v", err)
	}

	log.Printf("clear: truncated yt.youtube_superchat_currency_breakdowns and yt.youtube_superchats")
}
