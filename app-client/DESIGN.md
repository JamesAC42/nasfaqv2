# NASFAQ design system

The direction is **"trading terminal + game moments"**: a dense, fast, numbers-first trading floor as the frame, with personality delivered through scheduled events (ticks, fills, headlines) and character art that breaks the grid.

Tokens live in `app/styles/_theme.scss`, mixins in `app/styles/_mixins.scss`, fonts in `app/fonts.ts`.

## Rules

1. **Hairlines, not cards.** Sections are separated by 1px `--rule` lines. Borders, fills and shadows each say "separate object", so spend them by role. Only things that float above the page (peeks, menus, moments) get `--shadow-pop`.
2. **Every number is mono.** `@include num` (Martian Mono, condensed). Hero prices use `@include num(wide)`. Always `tabular-nums`.
3. **Chicago is for voice, not UI.** `@include display` for page titles, talent names, and moments (TICK, FILLED, MOONING). Never for body copy, labels or numbers. It has one weight; never bold it.
4. **Labels are small uppercase mono.** `@include label` / `@include section-heading`.
5. **Blue is the chassis.** `--blue` means live, next, focus and links. **Green/red only ever mean up/down** (`--up`/`--down`), never decoration.
6. **Talents own their pages.** Talent colors come from the API. Always pass them through `talentAccent()` (lib/talent-color.ts) before use, and expose them as `--tal` on the subtree.
7. **Oshimarks represent stocks.** Wherever a ticker appears, put its oshimark next to it (`<Oshimark icon={asset.icon} />`). `AssetCoin` renders the bare oshimark too.
8. **Art comes from the manifest.** Use `<ArtSlot kind="keyart" | "chibi" />`. It reads the art pipeline's `manifest.json` (`NEXT_PUBLIC_ART_MANIFEST_URL`, default `/art/manifest.json`) and falls back to a talent-colored placeholder, so pages look finished before art exists.
9. **Motion is earned and optional.** Price flashes, the tape marquee, tick and fill moments. Everything must still work in calm mode (`html[data-calm="true"]`, `useMotion()`, `isCalm()`), which is on by default under `prefers-reduced-motion`.
10. **Copy has a voice.** Talk like the thread, not like a SaaS dashboard. Don't explain the UI in subtitles ("Market Search: search by symbol..."); name things by what players call them (bags, the bell, bagholders).

## Market rhythm (drives countdowns)

`lib/market-clock.ts` mirrors the API: four adjustment ticks a day (Open 09:00, Lunch 15:00, Late 21:00, Overnight 03:00 ET), settlement at 09:00 ET, and 10-minute live-order batches. Use `useNow()` (one shared 1s ticker) for countdowns.

## Migration

Old token names (`--surface-card`, `--accent`, `--muted`, ...) are aliased to the new palette at the bottom of `_theme.scss`, so existing pages already use the new colors. When you rebuild a page, switch it to the new names (`--ink-*`, `--rule`, `--text/--mid/--dim`, `--blue`, `--up/--down`) and drop any aliases that are no longer referenced.
