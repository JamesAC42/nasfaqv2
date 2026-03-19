# Hololive Reference Image Scraper

Small Go CLI that downloads each Hololive member's first PR image into `reference_images/`.

It scrapes the current Hololive talent directory, visits each member page, prefers the first PR image ending in `_01`, and falls back to the next PR image in that full-body image section if `_01` is missing. It saves each file locally as `<member-slug>.<ext>`.

If a member already has any file in `reference_images/` matching their slug, that member is skipped on reruns.

## Layout

- `main.go`: scraper entry point
- `reference_images/`: downloaded PR images

## Run

From `/mnt/d/Documents/Github/NASFAQV2/holonews/reference_image_scraper`:

```bash
go mod tidy
go run .
```

Useful flags:

- `-list-url`: talent listing page to scrape
- `-out-dir`: image output directory, default `reference_images`
- `-timeout`: HTTP timeout per request, default `20s`
- `-delay`: delay between member page requests, default `250ms`
- `-concurrency`: number of member pages to process concurrently, default `4`

Example:

```bash
go run . -out-dir reference_images -concurrency 6
```

The scraper exits with a non-zero status if any member page or image download fails, and logs each failed slug so reruns are easy.
