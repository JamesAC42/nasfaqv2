# Holo Exchange — Visual Design System

**Locked 2026-09-21** — This is the source of truth for the nasfaq visual redesign.

## Design Read

**Reading this as:** Hololive virtual stock-market *game* wearing an exchange skin — one continuous dark stage, loud character art, expressive motion (osu! lazer energy). Not Bloomberg cosplay, not pastel brochure, not SaaS card grids.

## Locked Dials

| Dial | Pick | Meaning |
|------|------|---------|
| 1 Accent | **B Hololive-warm** | Warm coral / gold accents on near-black navy; cool aqua only for live/data edges |
| 2 Structure | **A Kill most cards** | Hairline panels + dense tables; continuous surface; no floating blue card stacks |
| 3 Character art | **C Loud** | Art-backed rows / blades; character faces as data from existing public assets (NEVER AI-generated talent faces). Initials + talent color until art exists |
| 4 Motion | **C Expressive** | Selection washes, row transitions, ticker pulse — purposeful, not confetti |

**Taste Dials:** VARIANCE 7 · MOTION 8 · DENSITY 8

---

## Color Tokens

### Stage (Backgrounds)

```scss
// Near-black navy continuous stage
--stage-deep: #050810;           // Deepest background
--stage-base: #070c14;           // Primary background
--stage-raised: #0a1018;         // Raised surfaces
--stage-elevated: #0e151f;       // Elevated panels
--stage-glow: rgba(10, 16, 24, 0.96);  // Panels with glow context
```

### Accent — Hololive-warm

```scss
// Primary warm accents (coral / gold)
--accent-coral: #ff6b54;         // Primary accent
--accent-coral-soft: rgba(255, 107, 84, 0.18);
--accent-coral-glow: rgba(255, 107, 84, 0.12);
--accent-gold: #f5a623;          // Secondary warm accent
--accent-gold-soft: rgba(245, 166, 35, 0.16);

// Live/data edge aqua (used sparingly)
--accent-aqua: #5fdeec;          // Live data, active states
--accent-aqua-soft: rgba(95, 222, 236, 0.12);
```

### Borders

```scss
--border-hairline: rgba(255, 255, 255, 0.06);   // Subtle dividers
--border-soft: rgba(255, 255, 255, 0.10);       // Panel borders
--border-warm: rgba(255, 107, 84, 0.22);        // Warm accent borders
--border-glow: rgba(245, 166, 35, 0.18);        // Gold glow borders
```

### Text

```scss
--text-primary: #f0f4f8;         // Primary text
--text-secondary: #8b9eb0;       // Secondary / muted
--text-tertiary: #5a6d7f;        // Tertiary / disabled
--text-warm: #ffb89a;            // Warm accent text
```

### Trend Colors

```scss
--trend-up: #22d47e;             // Positive / gains
--trend-up-soft: rgba(34, 212, 126, 0.14);
--trend-down: #ff5272;           // Negative / losses
--trend-down-soft: rgba(255, 82, 114, 0.12);
```

---

## Typography

### Font Stack

```scss
--font-display: "Chicago", "Iowan Old Style", "Palatino Linotype", serif;
--font-body: "Rethink Sans", "Mukta", system-ui, sans-serif;
--font-mono: "Red Hat Mono", "JetBrains Mono", monospace;
```

### Type Roles

| Role | Font | Weight | Use |
|------|------|--------|-----|
| **Brand headers** | Chicago | 700 | Page titles, section headers, wordmark, primary CTAs |
| **Body** | Rethink Sans | 400-700 | Running copy, labels, navigation |
| **Money** | Red Hat Mono | 400-700 | Prices, %, P&L, quantities — always `font-variant-numeric: tabular-nums` |

### Type Scale

```scss
--text-xs: 0.6875rem;    // 11px — badges, fine print
--text-sm: 0.8125rem;    // 13px — table cells, secondary labels
--text-base: 0.9375rem;  // 15px — body text
--text-lg: 1.125rem;     // 18px — section labels
--text-xl: 1.5rem;       // 24px — section titles
--text-2xl: 2rem;        // 32px — page titles
--text-3xl: 2.75rem;     // 44px — hero headlines
```

---

## Spacing

Base unit: **4px**

```scss
--space-1: 0.25rem;   // 4px
--space-2: 0.5rem;    // 8px
--space-3: 0.75rem;   // 12px
--space-4: 1rem;      // 16px
--space-5: 1.25rem;   // 20px
--space-6: 1.5rem;    // 24px
--space-8: 2rem;      // 32px
--space-10: 2.5rem;   // 40px
--space-12: 3rem;     // 48px
```

---

## Radius Scale

Shape lock: one radius scale, stated rules.

```scss
--radius-none: 0;
--radius-sm: 0.1875rem;  // 3px — inputs, small elements
--radius-md: 0.375rem;   // 6px — buttons, cards
--radius-lg: 0.5rem;     // 8px — panels, modals
--radius-pill: 9999px;   // Pills, badges
```

**Rules:**
- Dense data rows: `--radius-none` or `--radius-sm`
- Buttons: `--radius-md`
- Panels: `--radius-lg`
- Badges/pills: `--radius-pill`

---

## Component Grammar

### Shell

The **terminal shell** wraps every page:
- Sticky header with blur backdrop
- Warm-lit ribbon ticker (coral/gold glow)
- Chicago wordmark + nav rail
- Hairline bottom border, no heavy shadows

```scss
.shell {
  background: var(--stage-base);
  min-height: 100dvh;
}

.header {
  background: color-mix(in srgb, var(--stage-base) 88%, transparent);
  backdrop-filter: blur(20px) saturate(1.2);
  border-bottom: 1px solid var(--border-hairline);
}
```

### Ticker Ribbon

Marquee of market indexes with warm glow edge:

```scss
.ribbon {
  background: var(--stage-deep);
  border-top: 1px solid var(--border-hairline);
  border-bottom: 1px solid var(--border-hairline);
  box-shadow: 
    inset 0 1px 0 var(--accent-coral-glow),
    inset 0 -1px 0 var(--accent-gold-soft);
}
```

### Dense Table (Board Rows)

Kill cards → hairline rows with hover wash:

```scss
.boardRow {
  display: grid;
  grid-template-columns: /* defined per table */;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border-hairline);
  transition: background-color 140ms ease-out;
  
  &:hover {
    background: var(--accent-coral-glow);
  }
  
  &.selected {
    background: rgba(255, 107, 84, 0.08);
    box-shadow: inset 2px 0 0 var(--accent-coral);
  }
}
```

### Art Blade

When character art exists, it becomes data — a warm-lit panel edge:

```scss
.artBlade {
  position: relative;
  padding-left: 4.5rem;
  
  &::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 4rem;
    background: 
      linear-gradient(90deg, transparent, var(--stage-raised)),
      var(--asset-art-url) center/cover;
    border-right: 1px solid var(--border-warm);
  }
}
```

When no art exists, show initials in talent color:

```scss
.initialsToken {
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-md);
  background: var(--talent-color, var(--accent-coral));
  color: var(--stage-deep);
  font-family: var(--font-display);
  font-size: var(--text-sm);
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

### Panel (Hairline)

Replace floating cards with continuous hairline panels:

```scss
.panel {
  background: var(--stage-elevated);
  border: 1px solid var(--border-soft);
  border-radius: var(--radius-lg);
}

.panelHeader {
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border-hairline);
  
  h2, h3 {
    font-family: var(--font-display);
    color: var(--text-warm);
    font-size: var(--text-lg);
    text-transform: lowercase;
  }
}
```

### Button

```scss
.btnPrimary {
  background: var(--accent-coral);
  color: var(--stage-deep);
  font-family: var(--font-display);
  font-weight: 700;
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  border: 1px solid rgba(255, 255, 255, 0.1);
  transition: 
    transform 140ms ease,
    background-color 140ms ease;
  
  &:hover {
    background: color-mix(in srgb, var(--accent-coral) 85%, white);
    transform: translateY(-1px);
  }
  
  &:active {
    transform: translateY(1px);
  }
}

.btnSecondary {
  background: var(--accent-coral-soft);
  color: var(--text-warm);
  // ... same pattern
}
```

---

## Motion Tokens

**Frequency gate:** High-frequency actions (tab switch, scroll, back) get platform defaults. Medium-frequency (press, row select) get quick, under 150ms. Low-frequency (sheets, modals, toasts) get standard motion.

### Timing

```scss
--duration-instant: 0ms;
--duration-fast: 100ms;
--duration-normal: 180ms;
--duration-slow: 280ms;
--duration-slower: 400ms;
```

### Easing

```scss
--ease-out: cubic-bezier(0.23, 1, 0.32, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
--ease-settle: cubic-bezier(0.25, 0.1, 0.25, 1);
```

### Named Animations

**Selection wash** — row/card select feedback:
```scss
@keyframes selectionWash {
  from {
    background-color: var(--accent-coral-soft);
    box-shadow: inset 0 0 0 1px var(--accent-coral);
  }
  to {
    background-color: rgba(255, 107, 84, 0.06);
    box-shadow: inset 2px 0 0 var(--accent-coral);
  }
}
```

**Ticker pulse** — live data highlight:
```scss
@keyframes tickerPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.tickerLive {
  animation: tickerPulse 2s ease-in-out infinite;
}
```

**Row enter** — staggered fade-up for lists:
```scss
@keyframes rowEnter {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.boardRow {
  animation: rowEnter var(--duration-normal) var(--ease-out) both;
  animation-delay: calc(var(--row-index, 0) * 20ms);
}
```

---

## Hard Bans

1. **NO AI talent faces** — Use real public assets or initials + talent color
2. **NO new peek-rail / quick-trade flyout** — Existing trade UI only, restyled
3. **NO fake Hololive nicknames** — Real `display_name` from codebase only
4. **NO floating card grids** — Hairline panels + dense tables
5. **NO scope creep** — This is site visual language, not micro-UX invention

---

## Page Checklist

- [ ] **Home** — Hero with warm art backdrop, dense news/market panels, no card stacks
- [ ] **Market/Stocks** — Dense board rows with art blades, hairline dividers
- [ ] **Stock Detail** — Terminal panel layout, loud art when present, existing trade ticket restyled
- [ ] **Portfolio** — Holdings table with warm accents, P&L with trend colors
- [ ] **News** — Dense headline list, warm timestamp badges

---

## Acceptance Criteria

A reviewer opening **home → market → one stock** feels one coherent game-exchange:
- Chicago headers on every page
- Hololive-warm accents (coral/gold, not cyan everywhere)
- Hairline dense boards, not floating card grids
- Loud art when assets exist
- Expressive selection/motion
- Existing trade UI still works, just restyled
