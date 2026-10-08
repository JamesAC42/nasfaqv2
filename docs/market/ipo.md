# Listing new talents: the IPO

How a newly debuted talent becomes a stock. Written for the ASOBI★MAWARI-TAI! debut (four hololive
JP members, debuted 24–25 September 2026), but meant for every future debut. Sits alongside
`core-market.md` (pricing, shares, the weekly evaluation) and `credit.md` (Cash and Credit).

**Status: first pass built** (see [How it's built](#how-its-built)). Items marked **[BBB]** are
economy calls for BBB. Each one uses the recommendation below as its default so the whole flow can be
tried now; the percentages are per-IPO settings on `/admin/ipo`, and the debut pricing is in
`fundamentals.js`.

## Why not just activate the channel

Before the IPO, the pieces existed with nothing between them:

- `channelscraper` detected new talents on hololive's official site, and `POST /api/channels/detect`
  plus `/detect/add-all` saved them as **inactive** channels with a reference picture. (The detect
  route needed Go, so it only ran on a dev machine; its UI was the old, undeployed admin app.)
- Setting a channel **active** was the whole listing. The scraper starts collecting its daily stats,
  and the next 09:00 run's `bootstrapAssets` (`api/src/services/marketAdmin.js`) creates the stock as
  `active` and tradable straight away: 10,000 max shares, all with the broker, no announcement.

Doing only that would have gone badly:

1. **A young channel is priced about 3× too low, then jumps.** The fair value's size term uses 30-day
   views, which don't exist before day 30, so the factor is 1 instead of ~3–3.4. Meanwhile the view
   and sub growth signals saturate at their caps because the 35-day baseline is missing. Around day 30
   the value jumps ~3× and climbs at the +25%/day smoothing cap for about five days. Whoever buys on
   day 1 gets a near-guaranteed tripling.
2. **One missing stats row stalls the whole market.** A date settles only when every active channel
   has a stats row for it. Activating a channel after that night's 00:05 ET scrape, or one with
   hidden subscribers, blocks settlement for everyone until fixed.
3. **A stock with no fair value trades at $0.000001.** Trading floors the price at
   `max(fair value, 0.000001)`. That happens if the stock is created before its first stats exist.
4. **The first Saturday can freeze it.** The weekly evaluation sets max shares from a z-score of
   ln(subscribers) across all listed stocks. A ~300k channel lands near 6,000–7,000, and if day-one
   buying pushed holdings past that, it goes straight into a buyback.
5. **Dividends and fees read the debut spike.** The weekly shift compares this week's value with last
   week's, which for a debut is either missing (rate 0) or a launch-week spike.
6. **Small things:** adding talents reshuffles the card gacha's weekly featured talent mid-week
   (rotation is `% talents.length`); the unit needs a label, sort order and headline keywords; /vt/
   chatter and news tagging need aliases; the oshimark icon must be uploaded or the coin shows a
   broken image.

## The lifecycle

Use the `status` values the schema already allows (`prelaunch`, `active`, `halted`, `delisted`).
`prelaunch` already behaves almost right: visible, not tradable, and left out of settlement, ticks,
indexes and the weekly evaluation.

1. **Tracked (prelaunch).** The channel is active, so we collect its stats from day one. The stock
   exists with status `prelaunch`: its page says "Coming to market", shows the channel numbers and
   the IPO date, and has no price. A missing stats row for a prelaunch talent never blocks settlement.
   Fair value is computed daily but stays hidden.
2. **IPO window (still prelaunch).** For a set window before listing, players subscribe for shares at
   the IPO price. Subscriptions hold cash, the same way queued buys do.
3. **Listing day.** At the 09:00 ET settlement, subscriptions are allocated and filled at the IPO
   price. The stock becomes `active`, the day opens at the IPO price, and the four ticks pull it
   toward fair value like any other stock. Normal trading starts with the first batch.

## Pricing a young talent

The fair value needs a **debut mode** until the channel has 35 days of our own stats. The point is to
avoid the day-1 underpricing and the day-30 jump, so that the IPO price means something.
Recommendation:

- **Size term:** replace the missing 30-day views with the trailing 7-day views × 30/7. Leave out
  the first 7 days after debut so the launch spike doesn't count.
- **Growth signals:** sub and view momentum and stagnation are 0 in debut mode (they compare against
  history that doesn't exist yet). Uploads and big-stream events still count.
- **Hand-over:** from day 35, blend linearly into the normal formula over ten days.

**[BBB]** Is that the right shape, or should a debut be anchored to peers (for example the median
price of the last generation at the same age), or simply priced from subscribers alone until day 35?

For scale, with today's formula settled: ~280k subscribers and ~5M monthly views comes to about
**$6–7**, against a market median of ~$12.30 (range $4.88–22.64). The new members would start among
the cheaper stocks and grow with their channels.

## The IPO itself

| | Recommendation | Why |
|---|---|---|
| **IPO price** | Debut-mode fair value on the morning the window opens, to the cent. **[BBB]** a discount (say 10%)? | A discount makes the IPO an event worth joining; with no discount there's little reason to subscribe rather than buy on day one. |
| **Shares offered** | 40% of her starting max shares. **[BBB]** | Leaves the rest with the broker for normal buying after listing. |
| **Starting max shares** | From the weekly bell curve at listing, not the flat 10,000. | Otherwise the first Saturday resizes her. |
| **Window** | 48 hours, ending at the listing day's 09:00 settlement. | Two windows' worth of time zones; no first-come rush. |
| **Per-player cap** | 10% of the offering per talent. **[BBB]** | Stops one player taking the whole float. |
| **Allocation** | Pro rata if oversubscribed (with a floor of 1 share for everyone who subscribed); everyone filled if not. | Fair across time zones, unlike first come, first served. |
| **Payment** | Cash only, held at subscribe time and released if not allocated. | BBB's rule: buying shares is Liquid only. Reuses the order-hold machinery. |
| **Share limit** | IPO allocations don't count toward the 180-shares-per-tick-window limit. | They aren't tick trading. |
| **Order book** | Subscriptions are visible as a total ("2,140 of 2,600 shares subscribed"), not by player. | The demand is half the fun. |

**[BBB]** Alternative: a **Dutch auction** (players bid price and quantity; the clearing price is the
IPO price, and everyone pays it). It's more of a market, but harder to explain. The fixed price above
is the recommendation for the first IPO.

## Around the listing

- **Weekly evaluation.** A stock's first four Saturdays can't cut max shares below what players hold
  (the "no shrink below held" guard today only covers the very first evaluation ever). Separately,
  every new talent shifts everyone else's z-score a little; expected and fine.
- **Dividends and fees.** A **rookie period**: no dividend or fee for her first four weekly
  evaluations, because the week-over-week shift reads the launch spike. **[BBB]** four weeks?
- **Indexes.** A stock joins its unit and the all-talent index on listing day at 100. Because the
  index averages each stock against its own first day, adding one moves the equal-weight index by
  about a tenth of a point. The new unit gets its own index from listing day.
- **Cards and gacha.** Her five cards join the pool on listing day, not before (the art usually
  isn't ready earlier). Add a **debut banner** (a `games.card_banners` row with
  `featured_asset_id`), and fix the weekly featured rotation so adding talents doesn't reshuffle it.
- **Chat.** Her room and the unit's room appear automatically (the 5-minute resync).
- **News and the Wire.** An "IPO window opens" and an "IPO day" Wire item; notifications to everyone
  who follows the unit or subscribed.
- **Aliases.** Nicknames and JP names in `api/src/services/talents.js` for /vt/ chatter, article
  tagging and news moods.
- **Units.** Add the unit to `UNIT_ORDER` and the headline keywords. Unit strings come from the
  official site inconsistently, so normalize them when the channel is saved.

## Onboarding ASOBI★MAWARI-TAI!

From the detector (run 5 October against hololive.hololivepro.com/en/talents):

| | Proposed ticker | YouTube channel | Profile slug | Birthday | X |
|---|---|---|---|---|---|
| Achichi Mela 熱千めら | MEL | `UC8eitCE9Z6EwUCs-VUi1blg` | achichi-mela | 16 Apr | @achichi_mela |
| Sorashina Sopia 宙科そぴあ | SOP | `UCROQtXcp2loQEmvpe5rhJzQ` | sorashina-sopia | 13 Jun | @sorashina_sopia |
| Suzuna Tsuzuri 鈴鳴つづり | TSU | `UCy9mgxB8pn2C4aNK_MPthDQ` | suzuna-tsuzuri | 28 Jun | @suzuna_tsuzuri |
| Hyakuto Kyoko 百灯キョーコ | KYO | `UCSjQDxud2HkAO2DVD3lwxmw` | hyakuto-kyoko | 8 May | @hyakuto_kyoko |

Unit label: **ASOBI★MAWARI-TAI!** (no "hololive" prefix, like FLOW GLOW and ReGLOSS). All four
tickers are free today.

Still needed per member: a theme **colour** (the detector doesn't return one), an **oshimark SVG**
(uploaded to `icons/`), **aliases**, and the **art** below.

**Timing.** History only starts when we start scraping; YouTube's API returns today's totals, not
the past. So the sooner they're tracked (as `prelaunch`), the sooner debut mode has a trailing week
to work with. Suggested: tracked as soon as the prelaunch changes ship, IPO window opening about two
weeks later, and listing on a weekday (not Saturday, the evaluation day).

## Art

`art-pipeline` (local only) makes all 13 images per talent with Anima Turbo, which is text-only. It
worked for the existing 73 because Anima knows them by name. It doesn't know the new members, so:

1. **Start with tags.** Write `identity_tags` and `outfit_desc` for each member from the reference
   pictures, then run `generate.py try SYM keyart --seeds 4` to see how well Anima holds the design.
   This takes minutes per member, and for simple designs it may be enough.
2. **If identity drifts, a character LoRA per member.** The Anima graph already loads LoRAs; what's
   missing is the training, done outside the repo, from the official art (debut key visuals, PV
   frames, reference sheets).
3. **Reference images through FLUX Klein.** This mode exists but is broken (`generate.py`
   `build_prompts` uses variables only defined in the Anima builder). It only covers key art and
   reactions, and it won't match the house style. Last resort.

Until art lands, the site shows each member's colour and oshimark, so the art isn't a blocker for
the IPO itself.

## Build order

1. **Prelaunch, safely (no economy decisions needed).**
   - Bootstrap creates new stocks as `prelaunch`.
   - A prelaunch stock's missing stats never block settlement.
   - Trading refuses a stock with no fair value.
   - The asset API and stock page show prelaunch stocks as "Coming to market".
   - A small admin route to set a listing date.
   - Then add the four channels.
2. **Debut-mode fair value** once **[BBB]** confirms the shape.
3. **IPO window and listing:**
   - subscriptions with cash holds;
   - allocation at the listing settlement;
   - the stock page's IPO panel;
   - Wire items and notifications;
   - the rookie period;
   - the max-shares guard.
4. **Cards and the debut banner**, when the art is ready.

## How it's built

**Admin, `/admin/ipo`:**

1. **Detect.** "Check hololive's site" runs the detector (`api/src/services/talentDetect.js`, a Node
   port of the Go scraper, so it runs in the API). It lists talents with no channel here: names,
   birthday, X, YouTube, reference picture, YouTube avatar, a suggested ticker (first three letters of
   her name) and her **oshimark**: the emoji in her X display name, read through the public fxtwitter
   API because X needs a login (`TALENT_X_PROFILE_API` to point elsewhere, `off` to skip). Set each
   one's ticker, colour, unit and oshimark.
2. **Create the IPO.** Title, listing date, window length and the three percentages. This saves the
   channels as active (the scraper picks them up from the next 00:05 ET run), uploads the reference
   pictures to `reference-images/` and the oshimark's Twemoji SVG to `icons/<icon>.svg` (when S3 is
   configured), and creates the stocks as `prelaunch`. "↻ Avatar & oshimark" on a talent re-reads
   them and lets you pick another emoji.
3. **Watch the funnel.** Each talent's days tracked, subscribers, views, trends and (admin only) her
   debut-mode fair value, refreshed every 30 seconds.
4. **Window.** Opens by itself at the set time (`startIpoScheduler`, every minute), fixing each IPO
   price, starting max shares and offering. If a talent has no fair value yet it waits and says why.
   "Open window now" forces it.
5. **Listing.** The 09:00 cycle lists open IPOs whose listing day is the first day being settled,
   before settlement (`listDueEvents` in `marketScheduler.js`). "List now" forces it. "Call off"
   refunds everyone; the talents stay tracked and can join another IPO.

**Players:** the Market › IPO tab (`/market/ipo`), a banner on the other market tabs, a note on the
stock page of a ticker that isn't listed yet, Wire items (announced, window open, listed) and a
notification with each player's allocation.

**Market changes:**

- `bootstrapAssets` creates new stocks as `prelaunch` (a full rebuild still creates them `active`).
- Readiness counts only channels whose stock is active or halted, so a prelaunch talent's missing
  day never holds up settlement.
- The asset list and the board leave prelaunch stocks out; the card pool only has listed talents.
- Trading refuses a stock with no fair value.
- Settlement opens a listed IPO stock's first day at its IPO price.
- Debut mode: `computeDerivedSnapshot` takes the talent's first tracked day for IPO talents.
- Weekly evaluation: rookies (listed in the last 28 days) get no dividend or fee, are left out of the
  ranking, and their max shares never drop below what's held.

**Tables:** `market.ipo_events`, `market.ipo_listings`, `market.ipo_subscriptions`
(`services/ipo.js` holds the schema). Subscription cash moves through `held_cash` like queued buys,
with `ipo_cash_hold`, `ipo_cash_release` and `ipo_allocation` ledger entries.

**Locally:** there's no scraper, so `node scripts/seed-dev.js ipo-stats [days]` writes made-up daily
stats for the talents in an announced or open IPO and prices them.

**Not built yet:** the debut card banner and the featured-rotation fix (with the art), aliases, the
unit's headline keywords.

## Questions for BBB

1. Debut-mode pricing: extrapolated views with growth signals off (recommended), peer-anchored, or
   subscribers only?
2. IPO price: debut fair value as is, or with a discount (how much)?
3. Fixed-price subscription (recommended) or a Dutch auction?
4. Offering size (40% of max shares?) and the per-player cap (10% of the offering?).
5. Rookie period for dividends and fees: four weekly evaluations?
6. Should IPO allocations earn a little Credit or carry a holding badge, as a reason to join rather
   than wait for day one?
