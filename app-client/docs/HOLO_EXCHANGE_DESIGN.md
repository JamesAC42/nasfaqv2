# Holo Exchange Design System

> **NASFAQ** is a Hololive market *game* wearing an exchange skin.  
> Think osu! lazer energy for ambition and coherence — not a clone.

---

## Core Philosophy

### 1. One Shell, Many Rooms

Every route shares the same **terminal chrome**:
- Ticker ribbon (scrolling market indexes with sparklines)
- Chicago wordmark header
- Nav rail with room switching
- Status bar (session time, market state, user cash)

The shell never changes. Only the **room content** swaps when navigating. This creates spatial memory — users always know where they are.

### 2. Face is Data

Talent art is **first-class**, not decoration:
- **Instrument badges** — circular avatars from channel icons
- **Selected-row wash** — subtle talent color tint on hover/selection
- **Desk hero** — large talent portrait on the full instrument page
- **Ticker mascots** — Gura in the ribbon divider, Tako in empty states

Use **EXISTING assets** under `public/`:
- `gura-ticker.png` — ribbon loop divider
- `tako.png`, `takostand.png` — mascots
- `suisus.png`, `bijou.png`, `kronie.png` etc. — decorative accents

**Do NOT** invent new Hololive likeness art. Channel avatars come from the API (`asset.icon`).

### 3. Depth Over One Panel

Two levels of instrument detail:

| Surface | Location | Job |
|---------|----------|-----|
| **Peek Rail** | Slides in from board row click | Quick glance: mid/bid/ask, mini chart, BUY/SELL buttons, "Open desk →" link |
| **Full Desk** | `/stocks/[stockName]` | Deep dive: full chart, order book, fundamentals, news, related instruments, full trade ticket |

The peek rail is a **preview**, not a replacement for the desk. It answers "should I trade this?" The desk answers "how do I trade this well?"

### 4. Typography Hierarchy

| Token | Font | Usage |
|-------|------|-------|
| `--font-display` | Chicago | Headers, brand, CTAs, room titles |
| `--font-mono` | Red Hat Mono | Prices, quantities, percentages, timestamps |
| `--font-body` | Rethink Sans / Mukta | Body text, descriptions, labels |

Chicago gives the Hololive voice — playful but authoritative. Red Hat Mono makes numbers scannable. Rethink Sans is neutral and readable.

### 5. What We Reject

- ❌ **Sterile Bloomberg** — mono-only terminals without personality
- ❌ **Generic SaaS cards** — rounded corners and shadows with no soul
- ❌ **Purple AI gradients** — we're not a chatbot
- ❌ **Fake nicknames** — use real talent names and symbols
- ❌ **Magic Patterns one-shots** — this is a coherent system, not throwaway boards

---

## Information Architecture

| Route | Room | Job |
|-------|------|-----|
| `/` | Terminal Home | Movers, watchlist, blotter, news head, session status |
| `/stocks` | Market Board | Dense sortable table of all instruments |
| `/stocks/[name]` | Instrument Desk | Full chart, book, fundamentals, YT stats, news, trade ticket |
| `/market` | Market Report | Daily settlement summary |
| `/finance/activity` | Market Heartbeat | Live trade tape, order queue, session pulse |
| `/indexes` | Index Room | Unit index performance |
| `/news` | News Wire | Latest Hololive news |
| `/articles` | Article Archive | Community articles |
| `/finance` | Portfolio Room | Holdings, cash, ledger |
| `/oshiboard` | Oshiboard | Oshi rankings by asset |
| `/leaderboard` | Leaderboard | Player rankings |
| `/predictions` | Prediction Markets | Community predictions |
| `/games` | Games Hub | Minigames |
| `/chat` | Chat Room | Live chat |
| `/livestreams` | Live Now | Active streams |

All rooms share the terminal shell. Room-specific density varies.

---

## Shell Tokens

### Layout

```scss
--shell-header-height: 3.75rem;
--shell-ribbon-height: 3.5rem;
--shell-status-height: 2.5rem;
--shell-chrome-height: calc(var(--shell-header-height) + var(--shell-ribbon-height));
--shell-content-padding: 1.25rem;
```

### Dark Theme (Primary)

```scss
--terminal-bg: #050a0e;
--terminal-surface: rgba(12, 24, 32, 0.94);
--terminal-surface-raised: rgba(18, 36, 48, 0.92);
--terminal-border: rgba(82, 156, 225, 0.16);
--terminal-border-strong: rgba(95, 222, 236, 0.32);
--terminal-text: #e9f8fb;
--terminal-muted: #6b9eb0;
--terminal-accent: #5fdeec;
--terminal-accent-strong: #c8f8ff;
```

### Trend Colors

```scss
--trend-up: #24e589;
--trend-down: #ff5272;
--trend-neutral: var(--terminal-muted);
```

### Selection & Interaction

```scss
--row-hover: rgba(95, 222, 236, 0.06);
--row-selected: rgba(95, 222, 236, 0.12);
--row-wash-opacity: 0.08; /* talent color wash */
```

---

## Component Checklist

### Shell Components (Shared)

- [x] `SiteShell` — existing, contains header + ribbon + footer
- [ ] `TerminalShell` — new wrapper adding status bar + refined chrome
- [ ] `StatusBar` — session time, market state, user cash/holdings
- [ ] `RoomHeader` — Chicago title + breadcrumb for each room

### Market Board (`/stocks`)

- [x] Dense table with sortable columns
- [ ] Peek rail on row click (slide-in panel)
- [ ] Selected-row wash with talent color
- [x] Quick trade drawer
- [ ] Talent avatar badges in rows

### Instrument Desk (`/stocks/[stockName]`)

- [x] Hero section with price + chart
- [x] Trade ticket
- [x] Adjustment schedule
- [x] News + articles
- [ ] Talent hero portrait (large art)
- [ ] Order book / L2 if present
- [ ] Related instruments section

### Home (`/`)

- [x] Market overview section
- [x] Livestream section
- [x] News section
- [x] Leaderboard preview
- [ ] Watchlist panel
- [ ] Blotter (recent trades)
- [ ] Session card with market status

---

## Don'ts

1. **Don't break API contracts** — restyle, don't rewrite data layer
2. **Don't invent talent art** — use existing public/ assets or API icons
3. **Don't flatten the hierarchy** — peek rail ≠ full desk
4. **Don't over-animate** — subtle transitions only, respect reduced motion
5. **Don't use px for typography** — rem units only (user rule)
6. **Don't abandon dark theme** — it's primary, light is secondary
7. **Don't make it look like Bloomberg** — we're a game, not a terminal

---

## Implementation Notes

### Existing Infrastructure

- **Font wiring**: `app/styles/_fonts.scss` loads Chicago, Mukta, Rethink Sans, Red Hat Mono
- **Theme tokens**: `app/styles/_theme.scss` defines `--font-display`, `--font-body`, `--font-mono`
- **Mixins**: `app/styles/_mixins.scss` has `@mixin panel`, `@mixin section-title`, etc.
- **SiteShell**: Already provides header, ribbon, footer chrome
- **MarketSidebar**: Reusable asset list component

### Data Flow

- `useMarketStore` — assets, indexes, detail bundles, WebSocket
- `useProfileStore` — portfolio, pending orders
- `useChannelStore` — YouTube channel data
- Assets have `icon`, `color`, `symbol`, `display_name` from API

### File Structure

```
app/components/
├── layout/
│   ├── site-shell.tsx          # Existing shell
│   ├── terminal-shell.tsx      # New terminal wrapper
│   └── terminal-shell.module.scss
├── terminal/
│   ├── status-bar.tsx
│   ├── peek-rail.tsx
│   └── room-header.tsx
└── pages/
    ├── stocks-page.tsx         # Restyle with peek rail
    ├── stock-detail-page.tsx   # Restyle as full desk
    └── home-page.tsx           # Restyle with terminal chrome
```

---

## Preview Checklist

Before merging:

- [ ] Chicago headers visible on all rooms
- [ ] Ticker ribbon scrolling with Gura divider
- [ ] Peek rail opens on board row click
- [ ] Full desk shows talent hero + chart + ticket
- [ ] Selected-row wash uses talent color
- [ ] Status bar shows session/cash when logged in
- [ ] Works on mobile (responsive)
- [ ] Respects reduced motion preference
- [ ] Dark theme looks coherent
- [ ] No broken images (use existing public/ assets)

---

*Last updated: 2026-09-21*
