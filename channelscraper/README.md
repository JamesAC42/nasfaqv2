# Hololive Channel Scraper

Small Go CLI that scrapes the Hololive talent directory and exports channel metadata to CSV.

Source pages:

- [Hololive talent directory](https://hololive.hololivepro.com/en/talents/)
- Individual profile pages such as [`/en/talents/ouro-kronii/`](https://hololive.hololivepro.com/en/talents/ouro-kronii/)

## What it writes

The CSV headers match the database column names for the fields this scraper can populate:

```text
youtube_channel_id,name_short,name_english,name_japanese,twitter_id,profile_id,birthday,height,unit
```

Notes:

- `name_short` is derived from the last word of `name_english`.
- `profile_id` is the profile slug, such as `ouro-kronii`.
- `birthday` is written as ISO `YYYY-MM-DD`.
- The Hololive site only exposes month/day for birthdays, so this scraper uses a placeholder year.
  The default year is `2000`, and you can change it with `-birthday-year`.
- The scraper has a hard-coded ignore list for these profile IDs:
  `friend-a`, `harusaki-nodoka`, `hanazono-sayaka`, `izuki-michiru`, and `kazeshiro-yuki`.

## Run

From the `channelscraper` directory:

```bash
go mod tidy
go run . -out hololive_channels.csv
```

Useful flags:

- `-out`: output CSV path
- `-birthday-year`: placeholder year for birthdays, default `2000`
- `-timeout`: HTTP timeout per request, default `20s`
- `-delay`: delay between profile page requests, default `250ms`
- `-list-url`: listing page URL, default `https://hololive.hololivepro.com/en/talents/`

Example:

```bash
go run . -out data/hololive_channels.csv -birthday-year 2000
```

## Update Existing DB Rows

There is also a separate updater script that reads the CSV and updates only channels that already
exist in `yt.youtube_channels`, matched by `youtube_channel_id`.

It will not insert new channels.
It also sets `icon` from the last word of `name_english`, normalized to lowercase `a-z` only.
When channels are inserted from the detection flow, `symbol` is derived from the last name using the
first 3 non-vowel letters, or the first 3 letters if there are fewer than 3 non-vowels.

Run it from the `channelscraper` directory:

```bash
go run ./cmd/update-db -csv hololive_channels.csv
```

Database connection:

- Pass `-database-url` explicitly, or
- set `DATABASE_URL`
- a local `.env` file in `channelscraper/` is loaded automatically
- optional: set `ENV_FILE` to point at a different env file

Useful flags:

- `-csv`: input CSV path, default `hololive_channels.csv`
- `-database-url`: Postgres connection string
- `-timeout`: DB connection and transaction timeout, default `30s`
- `-dry-run`: show which existing channels would be updated without writing changes

Example:

```bash
DATABASE_URL="postgres://user:pass@host:5432/dbname?sslmode=disable" go run ./cmd/update-db -csv hololive_channels.csv
```

## Backfill Empty Symbols

To populate missing `symbol` values for channels already in the database:

```bash
go run ./cmd/backfill-symbols
```

Flags:

- `-database-url`: Postgres connection string
- `-timeout`: DB connection and transaction timeout, default `30s`
- `-dry-run`: show what would be updated without writing changes

## Import into Postgres

Because the headers match the table column names, you can import the generated CSV directly into the relevant subset of `yt.youtube_channels`:

```sql
\copy yt.youtube_channels (
  youtube_channel_id,
  name_short,
  name_english,
  name_japanese,
  twitter_id,
  profile_id,
  birthday,
  height,
  unit
) FROM 'hololive_channels.csv' WITH (FORMAT csv, HEADER true);
```

If you want to fill `symbol`, `icon`, or `is_active`, do that separately after import.
