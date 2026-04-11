Leaderboard Design

  I reviewed the current scaffolding in api/src/routes/leaderboard.js, api/src/services/
  netWorth.js, app-client/app/stores/leaderboard-store.ts, and app-client/app/components/
  pages/leaderboard-page.tsx. There is already a usable foundation: current net worth
  calculation, daily net worth history, friendships/rivals, and a dedicated route. The main
  gap is that the leaderboard is still a flat top-N feed with placeholder client types.

  I’d build this as a two-layer leaderboard: a fast current leaderboard for rankings, plus
  richer per-user context and historical deltas for the “fun” parts.

  Core Principle

  Use total_equity = cash_balance + holdings_market_value as the canonical ranking metric. Do
  not recompute the full leaderboard from holdings on every page request once this grows.
  Instead:

  1. Keep market.user_daily_net_worth as the source for historical performance and deltas.
  2. Add a current-state leaderboard table or cache that stores one row per user with
     precomputed rank metrics.
  3. Refresh that current-state table after trading mutations and after settlement, not on
     every read.

  Backend Data Model

  Add a new table, something like market.user_leaderboard_current, with one row per user:

  - user_id
  - username_snapshot
  - profile_picture_url or profile_picture_id
  - profile_color
  - cash_balance
  - holdings_market_value
  - total_equity
  - daily_change_abs
  - daily_change_pct
  - weekly_change_abs
  - weekly_change_pct
  - best_asset_id
  - best_asset_symbol
  - largest_position_asset_id
  - largest_position_symbol
  - updated_at

  Indexes:

  - primary key on user_id
  - btree on (total_equity DESC, user_id ASC) for ranking
  - btree on (daily_change_pct DESC, user_id ASC) if we later add “top movers”
  - btree on (updated_at DESC)

  This avoids repeated joins across all holdings on every leaderboard request.

  How It Gets Updated

  For scale, do not rank by live joins in the request path.

  Use two update paths:

  1. Incremental refresh on trading events
      - After an order fill or settlement for a user, recalculate just that user’s row in
        user_leaderboard_current.
      - This keeps writes localized.
  2. Batch refresh after market-wide repricing
      - When asset prices change globally during settlement or market close, recompute all
        leaderboard rows in one SQL job.
      - Then read-time ranking is cheap.

  That fits the existing services pattern in api/src/services/netWorth.js and market
  scheduler flow.

  Ranking Strategy

  Use two rank concepts:

  - rank_global: rank across all eligible users
  - rank_scope: optional rank within a filtered scope like friends/rivals

  For ties, use:

  1. total_equity DESC
  2. username ASC
  3. user_id ASC

  That gives stable pagination.

  Eligibility Rules

  To keep it fun and avoid junk accounts dominating:

  - Include only users with an account older than X hours or who have made at least one
    trade.
  - Exclude admins if desired.
  - Exclude soft-hidden/test users later if needed.

  I would start with:

  - all registered users visible by default
  - optional future guard: require either non-default cash balance or at least one closed/
    open position

  API Shape

  Replace the current GET /api/leaderboard array response with a richer bundle:

  GET /api/leaderboard?scope=global|friends|rivals&window=1d|7d|
  all&page=1&limit=25&search=jame

  Response shape:

  - scope
  - window
  - pagination
  - entries
  - me
  - stats

  entries[] per user:

  - user_id
  - username
  - profile_picture_url
  - profile_color
  - rank
  - total_equity
  - cash_balance
  - holdings_market_value
  - change_abs
  - change_pct
  - largest_position
  - best_asset
  - badges
  - is_me
  - is_friend
  - is_rival

  me block:

  - rank
  - total_equity
  - change_abs
  - change_pct
  - percentile
  - neighbors
      - one above
      - one below

  stats block:

  - user_count
  - cutoff_equity_top_10
  - cutoff_equity_top_100
  - last_updated_at

  This lets the client render:

  - top podium
  - paginated table
  - sticky “your rank” card
  - rivalry/friends tabs
  - empty states

  Scopes

  Support three scopes from day one:

  - global
  - friends
  - rivals

  You already have friendship/rival data in api/src/profileDb.js, so these are cheap to layer
  in. friends and rivals should require auth; global can stay public.

  Windows

  Support these windows:

  - all: current total equity rank
  - 1d: rank by current total equity, show 1-day delta
  - 7d: rank by current total equity, show 7-day delta

  Important point: I would still rank by current equity, not by daily gain, for the main
  leaderboard. The window affects displayed movement and side badges, not the core rank.
  Later we can add separate views like mode=gainers.

  Fun / Feature-Rich Elements

  These are inexpensive but make it feel alive:

  - Podium for top 3 with profile colors and avatar rings
  - “You moved up 4 spots today” chip
  - Rival markers in the list
  - “Closest rival” card based on nearest equity gap
  - Badges:
      - Whale for top 1%
      - On Fire for positive 3-day streak
      - Diamond Hands for high unrealized gains
      - Cash Gang for high cash ratio
  - Mini sparkline for each row using daily history
  - “Biggest bag” shown from largest position
  - “Best pick” shown from strongest unrealized position

  I would keep badges derived, not stored, unless they become expensive.

  Pagination and Performance

  Use offset pagination only for small lists. For scale, use cursor/keyset pagination on
  (total_equity DESC, user_id ASC).

  Suggested API:

  - page-based initially for simplicity
  - internally design the query so we can move to cursor later without breaking response
    shape

  For now:

  - homepage preview: limit=5
  - leaderboard page: limit=25
  - max limit: 100

  Query Design

  For global:

  - read from user_leaderboard_current
  - compute rank with a window function once in a CTE
  - return requested page plus me

  For friends and rivals:

  - derive the allowed user ids from friendship/rival tables
  - join that smaller set to user_leaderboard_current
  - compute scoped rank only within that set

  For me:

  - fetch exact row and rank separately even if not on current page

  That gives a much better UX than forcing the user to page until they find themselves.

  Client Design

  The current client types in app-client/app/lib/types.ts and normalizer in app-client/app/
  lib/normalizers.ts are too generic. I’d replace the placeholder LeaderboardEntry with a
  dedicated bundle type:

  - LeaderboardResponse
  - LeaderboardEntry
  - LeaderboardUserContext
  - LeaderboardStats

  Store shape in app-client/app/stores/leaderboard-store.ts:

  - active scope
  - active window
  - entries
  - me
  - stats
  - pagination
  - isLoading
  - error
  - fetchLeaderboard(params)

  Page UX

  On app-client/app/components/pages/leaderboard-page.tsx, I’d structure it as:

  1. Hero
      - title
      - last updated timestamp
      - copy focused on portfolio competition
  2. Controls
      - scope tabs: Global / Friends / Rivals
      - window tabs: All Time / 1D / 7D
      - optional search by username
  3. My Rank Card
      - current rank
      - equity
      - delta
      - nearest rival gap
  4. Podium
      - top 3 with stronger visual treatment
  5. Full Table
      - rank
      - user
      - net worth
      - daily or weekly move
      - biggest holding
      - badges
  6. Empty/auth states
      - unauthenticated users can still see global
      - friends/rivals prompt login

  For the homepage preview in app-client/app/components/home/leaderboard-section.tsx, stop
  calling it “Mock Leaderboard” and show a real top-5 slice from the same API.

  Scalability Notes

  This design scales because:

  - reads come from one precomputed table, not live aggregation across all holdings
  - global price updates are handled in batch
  - per-user trading updates are localized
  - friends/rivals scopes are small joins
  - history remains in the existing daily snapshots table for cheap delta computation

  If the leaderboard gets heavy later, we can add:

  - Redis cache for the top page and homepage preview
  - materialized views for percentile buckets
  - websocket invalidation for live leaderboard refresh

  Recommended Implementation Order

  1. Backend response redesign on /api/leaderboard
  2. Add user_leaderboard_current table and refresh helpers
  3. Hook refresh into trading/settlement flows
  4. Add friends/rivals scopes
  5. Update frontend types/store/normalizers
  6. Build leaderboard page UI
  7. Replace homepage mock preview with real data

  If you want, I can move to implementation next and start with the backend schema + API
  contract first.