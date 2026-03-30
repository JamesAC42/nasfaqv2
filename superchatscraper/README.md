## Hololyzer Superchat Scraper (Go)

This service scrapes daily superchat archive data from hololyzer and stores it in Postgres.

### What it stores

- `yt.youtube_superchats`
  - `date`, `video_id`, `superchat_total`
- `yt.youtube_superchat_currency_breakdowns`
  - `video_id`, `currency_name`, `donation_count`, `total_in_currency`, `total_in_yen`

### Behavior

- By default, runs as a long-lived service
- Executes once per day at `8:00 AM` in the configured local timezone
- On scrape day `D`, it fetches hololyzer data for `D - 1`

### Running

```bash
cd superchatscraper
go run ./cmd/superchatscraper
```

### Modes

Run the default daily service:

```bash
go run ./cmd/superchatscraper
```

Run one time now, scraping the previous local day:

```bash
go run ./cmd/superchatscraper --once
```

Run a date range, where each provided day scrapes that day's previous local day:

```bash
go run ./cmd/superchatscraper --range-start 2026-03-20 --range-end 2026-03-25
```

The example above runs scrape dates `2026-03-19` through `2026-03-24`.

### Remediation

If testing leaves the superchat tables in a bad state, clear both tables with:

```bash
go run ./cmd/clear-stream-tables
```

To drop the now-redundant metadata columns from an existing database:

```bash
go run ./cmd/drop-superchat-metadata-columns
```
