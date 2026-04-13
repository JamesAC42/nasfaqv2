const DEFAULT_STARTER_CASH = 10000;
const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";

function getStarterCash() {
  const parsed = Number(process.env.MARKET_STARTER_CASH || DEFAULT_STARTER_CASH);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_STARTER_CASH;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value, fallback = 0) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toRatio(numerator, denominator) {
  if (!(denominator > 0)) return null;
  return numerator / denominator;
}

function profilePictureUrlSql(size, alias = "pp") {
  const field = size === "large" ? "filename_large" : "filename_small";
  const folder = size === "large" ? "large" : "small";
  return `CASE WHEN ${alias}.id IS NULL OR ${alias}.is_deleted THEN NULL ELSE '${PROFILE_PICTURE_CDN_BASE_URL}/${folder}/' || ${alias}.${field} END`;
}

function getScopedRelationshipQuery(scope) {
  if (scope === "friends") {
    return `
      SELECT DISTINCT CASE
        WHEN f.requester_id = $1 THEN f.addressee_id
        ELSE f.requester_id
      END AS user_id
      FROM market.user_friendships f
      WHERE f.status = 'accepted'
        AND $1 IN (f.requester_id, f.addressee_id)
    `;
  }

  if (scope === "rivals") {
    return `
      SELECT r.rival_user_id AS user_id
      FROM market.user_rivals r
      WHERE r.user_id = $1
    `;
  }

  return null;
}

function normalizeWindow(window) {
  return window === "7d" ? "7d" : window === "all" ? "all" : "1d";
}

function buildBadges(entry, userCount, decoration = null) {
  const badges = [];
  const achievementBadges = Array.isArray(decoration?.achievements)
    ? decoration.achievements.map((achievement) => achievement.name).filter(Boolean)
    : [];
  for (const badge of achievementBadges) {
    if (!badges.includes(badge)) badges.push(badge);
  }

  const currentStreakDays = toInt(decoration?.streaks?.current_streak_days, 0);
  if (currentStreakDays >= 3) {
    badges.push(`${currentStreakDays}d Streak`);
  }

  const cashRatio = toRatio(entry.cash_balance, entry.total_equity);
  if (entry.rank <= Math.max(1, Math.ceil(userCount * 0.01))) badges.push("Whale");
  if ((entry.daily_change_pct ?? 0) >= 0.05) badges.push("On Fire");
  if ((entry.total_unrealized_pnl ?? 0) > 0 && (entry.holdings_market_value ?? 0) > 0) badges.push("Diamond Hands");
  if ((cashRatio ?? 0) >= 0.6) badges.push("Cash Gang");
  return Array.from(new Set(badges)).slice(0, 4);
}

function selectWindowChange(row, window) {
  if (window === "7d") {
    return {
      change_abs: toNumber(row.weekly_change_abs, 0),
      change_pct: row.weekly_change_pct === null || row.weekly_change_pct === undefined ? null : toNumber(row.weekly_change_pct, 0),
    };
  }

  if (window === "all") {
    const starterCash = getStarterCash();
    const totalEquity = toNumber(row.total_equity, starterCash);
    const changeAbs = totalEquity - starterCash;
    return {
      change_abs: changeAbs,
      change_pct: starterCash > 0 ? changeAbs / starterCash : null,
    };
  }

  return {
    change_abs: toNumber(row.daily_change_abs, 0),
    change_pct: row.daily_change_pct === null || row.daily_change_pct === undefined ? null : toNumber(row.daily_change_pct, 0),
  };
}

function mapLeaderboardEntry(row, {
  window,
  userCount,
  viewerId = null,
  friendIds = new Set(),
  rivalIds = new Set(),
  decorationByUserId = new Map(),
}) {
  const selectedChange = selectWindowChange(row, window);
  const totalEquity = toNumber(row.total_equity, 0);
  const cashBalance = toNumber(row.cash_balance, 0);
  const holdingsMarketValue = toNumber(row.holdings_market_value, 0);
  const totalUnrealizedPnl = toNumber(row.total_unrealized_pnl, 0);
  const userId = toInt(row.user_id);
  const decoration = decorationByUserId.get(userId) || null;

  const entry = {
    user_id: userId,
    username: String(row.username_snapshot || ""),
    profile_picture_url: row.profile_picture_url ? String(row.profile_picture_url) : null,
    profile_color: row.profile_color ? String(row.profile_color) : null,
    rank: toInt(row.rank, 0),
    total_equity: totalEquity,
    cash_balance: cashBalance,
    holdings_market_value: holdingsMarketValue,
    total_unrealized_pnl: totalUnrealizedPnl,
    change_abs: selectedChange.change_abs,
    change_pct: selectedChange.change_pct,
    daily_change_abs: toNumber(row.daily_change_abs, 0),
    daily_change_pct: row.daily_change_pct === null || row.daily_change_pct === undefined ? null : toNumber(row.daily_change_pct, 0),
    weekly_change_abs: toNumber(row.weekly_change_abs, 0),
    weekly_change_pct: row.weekly_change_pct === null || row.weekly_change_pct === undefined ? null : toNumber(row.weekly_change_pct, 0),
    largest_position: row.largest_position_symbol
      ? {
          asset_id: row.largest_position_asset_id === null || row.largest_position_asset_id === undefined ? null : toInt(row.largest_position_asset_id),
          symbol: String(row.largest_position_symbol),
          value: toNumber(row.largest_position_value, 0),
        }
      : null,
    best_asset: row.best_asset_symbol
      ? {
          asset_id: row.best_asset_id === null || row.best_asset_id === undefined ? null : toInt(row.best_asset_id),
          symbol: String(row.best_asset_symbol),
          unrealized_pnl: toNumber(row.best_asset_unrealized_pnl, 0),
        }
      : null,
    achievements: decoration?.achievements || [],
    streaks: decoration?.streaks || {
      current_streak_days: 0,
      longest_streak_days: 0,
      last_trade_day: null,
    },
    is_me: viewerId ? toInt(row.user_id) === toInt(viewerId) : false,
    is_friend: friendIds.has(userId),
    is_rival: rivalIds.has(userId),
    badges: [],
  };

  entry.badges = buildBadges(entry, userCount, decoration);
  return entry;
}

async function loadLeaderboardDecorations(pool, userIds) {
  const safeUserIds = Array.isArray(userIds)
    ? Array.from(new Set(userIds.map((value) => toInt(value, 0)).filter((value) => value > 0)))
    : [];
  const decorationByUserId = new Map();
  if (!safeUserIds.length) return decorationByUserId;

  const [achievementResult, streakResult] = await Promise.all([
    pool.query(
      `
      SELECT
        ua.user_id,
        ua.achievement_key AS key,
        ua.earned_at,
        ua.reward_cash,
        ad.name,
        ad.description,
        ad.badge_icon,
        ad.badge_color
      FROM market.user_achievements ua
      JOIN market.achievement_definitions ad
        ON ad.id = ua.achievement_definition_id
      WHERE ua.user_id = ANY($1::bigint[])
      ORDER BY ua.user_id ASC, ua.earned_at DESC, ua.id DESC
    `,
      [safeUserIds]
    ),
    pool.query(
      `
      SELECT
        user_id,
        current_streak_days,
        longest_streak_days,
        last_trade_day
      FROM market.user_trade_streaks
      WHERE user_id = ANY($1::bigint[])
    `,
      [safeUserIds]
    ),
  ]);

  for (const userId of safeUserIds) {
    decorationByUserId.set(userId, {
      achievements: [],
      streaks: {
        current_streak_days: 0,
        longest_streak_days: 0,
        last_trade_day: null,
      },
    });
  }

  for (const row of achievementResult.rows) {
    const userId = toInt(row.user_id, 0);
    if (!decorationByUserId.has(userId)) continue;
    const decoration = decorationByUserId.get(userId);
    if (decoration.achievements.length >= 4) continue;
    decoration.achievements.push({
      key: String(row.key || ""),
      name: String(row.name || row.key || ""),
      description: row.description ? String(row.description) : null,
      badge_icon: row.badge_icon ? String(row.badge_icon) : null,
      badge_color: row.badge_color ? String(row.badge_color) : null,
      earned_at: row.earned_at ? new Date(row.earned_at).toISOString() : null,
      reward_cash: toNumber(row.reward_cash, 0),
    });
  }

  for (const row of streakResult.rows) {
    const userId = toInt(row.user_id, 0);
    if (!decorationByUserId.has(userId)) continue;
    decorationByUserId.get(userId).streaks = {
      current_streak_days: toInt(row.current_streak_days, 0),
      longest_streak_days: toInt(row.longest_streak_days, 0),
      last_trade_day: row.last_trade_day ? String(row.last_trade_day) : null,
    };
  }

  return decorationByUserId;
}

async function getCurrentNetWorth(pool, userId) {
  const starterCash = getStarterCash();
  const { rows } = await pool.query(
    `
    SELECT
      COALESCE(pcb.cash_balance, $2) AS cash_balance,
      COALESCE(SUM(h.quantity * COALESCE(a.current_mid_price, 0)), 0) AS total_market_value,
      COALESCE(SUM(h.quantity * (COALESCE(a.current_mid_price, 0) - h.avg_cost_basis)), 0) AS total_unrealized_pnl
    FROM market.users u
    LEFT JOIN market.portfolio_cash_balances pcb
      ON pcb.user_id = u.id
    LEFT JOIN market.portfolio_holdings h
      ON h.user_id = u.id
     AND h.quantity > 0
    LEFT JOIN market.market_assets a
      ON a.id = h.asset_id
    WHERE u.id = $1
    GROUP BY u.id, pcb.cash_balance
  `,
    [userId, starterCash]
  );

  const row = rows[0] || {
    cash_balance: starterCash,
    total_market_value: 0,
    total_unrealized_pnl: 0,
  };
  const cashBalance = toNumber(row.cash_balance, starterCash);
  const totalMarketValue = toNumber(row.total_market_value, 0);
  const totalUnrealizedPnl = toNumber(row.total_unrealized_pnl, 0);

  return {
    cash_balance: cashBalance,
    total_market_value: totalMarketValue,
    total_unrealized_pnl: totalUnrealizedPnl,
    total_equity: cashBalance + totalMarketValue,
  };
}

async function refreshCurrentLeaderboardWithClient(client, { userIds = null } = {}) {
  const starterCash = getStarterCash();
  const safeUserIds = Array.isArray(userIds) && userIds.length
    ? Array.from(new Set(userIds.map((value) => toInt(value, 0)).filter((value) => value > 0)))
    : null;

  await client.query(
    `
    WITH target_users AS (
      SELECT u.id
      FROM market.users u
      WHERE $1::bigint[] IS NULL OR u.id = ANY($1::bigint[])
    ),
    latest_market_date AS (
      SELECT MAX(market_date) AS market_date
      FROM market.user_daily_net_worth
    ),
    user_totals AS (
      SELECT
        u.id AS user_id,
        u.username AS username_snapshot,
        ${profilePictureUrlSql("small")} AS profile_picture_url,
        u.profile_color,
        COALESCE(pcb.cash_balance, $2) AS cash_balance,
        COALESCE(SUM(h.quantity * COALESCE(a.current_mid_price, 0)), 0) AS holdings_market_value,
        COALESCE(SUM(h.quantity * (COALESCE(a.current_mid_price, 0) - h.avg_cost_basis)), 0) AS total_unrealized_pnl
      FROM target_users tu
      JOIN market.users u
        ON u.id = tu.id
      LEFT JOIN market.profile_pictures pp
        ON pp.id = u.profile_picture_id
      LEFT JOIN market.portfolio_cash_balances pcb
        ON pcb.user_id = u.id
      LEFT JOIN market.portfolio_holdings h
        ON h.user_id = u.id
       AND h.quantity > 0
      LEFT JOIN market.market_assets a
        ON a.id = h.asset_id
      GROUP BY u.id, u.username, pp.id, pp.is_deleted, pp.filename_small, u.profile_color, pcb.cash_balance
    ),
    latest_daily AS (
      SELECT DISTINCT ON (d.user_id)
        d.user_id,
        d.total_equity
      FROM market.user_daily_net_worth d
      JOIN target_users tu
        ON tu.id = d.user_id
      ORDER BY d.user_id ASC, d.market_date DESC
    ),
    latest_weekly AS (
      SELECT DISTINCT ON (d.user_id)
        d.user_id,
        d.total_equity
      FROM market.user_daily_net_worth d
      JOIN target_users tu
        ON tu.id = d.user_id
      CROSS JOIN latest_market_date lmd
      WHERE lmd.market_date IS NOT NULL
        AND d.market_date <= (lmd.market_date - INTERVAL '7 days')
      ORDER BY d.user_id ASC, d.market_date DESC
    ),
    largest_position AS (
      SELECT
        ranked.user_id,
        ranked.asset_id,
        ranked.symbol,
        ranked.market_value
      FROM (
        SELECT
          h.user_id,
          a.id AS asset_id,
          a.symbol,
          h.quantity * COALESCE(a.current_mid_price, 0) AS market_value,
          ROW_NUMBER() OVER (
            PARTITION BY h.user_id
            ORDER BY h.quantity * COALESCE(a.current_mid_price, 0) DESC, a.symbol ASC, a.id ASC
          ) AS row_num
        FROM market.portfolio_holdings h
        JOIN target_users tu
          ON tu.id = h.user_id
        JOIN market.market_assets a
          ON a.id = h.asset_id
        WHERE h.quantity > 0
      ) ranked
      WHERE ranked.row_num = 1
    ),
    best_asset AS (
      SELECT
        ranked.user_id,
        ranked.asset_id,
        ranked.symbol,
        ranked.unrealized_pnl
      FROM (
        SELECT
          h.user_id,
          a.id AS asset_id,
          a.symbol,
          h.quantity * (COALESCE(a.current_mid_price, 0) - h.avg_cost_basis) AS unrealized_pnl,
          ROW_NUMBER() OVER (
            PARTITION BY h.user_id
            ORDER BY h.quantity * (COALESCE(a.current_mid_price, 0) - h.avg_cost_basis) DESC, a.symbol ASC, a.id ASC
          ) AS row_num
        FROM market.portfolio_holdings h
        JOIN target_users tu
          ON tu.id = h.user_id
        JOIN market.market_assets a
          ON a.id = h.asset_id
        WHERE h.quantity > 0
      ) ranked
      WHERE ranked.row_num = 1
    )
    INSERT INTO market.user_leaderboard_current (
      user_id,
      username_snapshot,
      profile_picture_url,
      profile_color,
      cash_balance,
      holdings_market_value,
      total_unrealized_pnl,
      total_equity,
      daily_change_abs,
      daily_change_pct,
      weekly_change_abs,
      weekly_change_pct,
      largest_position_asset_id,
      largest_position_symbol,
      largest_position_value,
      best_asset_id,
      best_asset_symbol,
      best_asset_unrealized_pnl,
      updated_at
    )
    SELECT
      totals.user_id,
      totals.username_snapshot,
      totals.profile_picture_url,
      totals.profile_color,
      totals.cash_balance,
      totals.holdings_market_value,
      totals.total_unrealized_pnl,
      totals.cash_balance + totals.holdings_market_value AS total_equity,
      (totals.cash_balance + totals.holdings_market_value) - COALESCE(ld.total_equity, $2) AS daily_change_abs,
      CASE
        WHEN COALESCE(ld.total_equity, $2) > 0
          THEN ((totals.cash_balance + totals.holdings_market_value) - COALESCE(ld.total_equity, $2)) / COALESCE(ld.total_equity, $2)
        ELSE NULL
      END AS daily_change_pct,
      (totals.cash_balance + totals.holdings_market_value) - COALESCE(lw.total_equity, $2) AS weekly_change_abs,
      CASE
        WHEN COALESCE(lw.total_equity, $2) > 0
          THEN ((totals.cash_balance + totals.holdings_market_value) - COALESCE(lw.total_equity, $2)) / COALESCE(lw.total_equity, $2)
        ELSE NULL
      END AS weekly_change_pct,
      lp.asset_id,
      lp.symbol,
      lp.market_value,
      ba.asset_id,
      ba.symbol,
      ba.unrealized_pnl,
      now()
    FROM user_totals totals
    LEFT JOIN latest_daily ld
      ON ld.user_id = totals.user_id
    LEFT JOIN latest_weekly lw
      ON lw.user_id = totals.user_id
    LEFT JOIN largest_position lp
      ON lp.user_id = totals.user_id
    LEFT JOIN best_asset ba
      ON ba.user_id = totals.user_id
    ON CONFLICT (user_id)
    DO UPDATE SET
      username_snapshot = EXCLUDED.username_snapshot,
      profile_picture_url = EXCLUDED.profile_picture_url,
      profile_color = EXCLUDED.profile_color,
      cash_balance = EXCLUDED.cash_balance,
      holdings_market_value = EXCLUDED.holdings_market_value,
      total_unrealized_pnl = EXCLUDED.total_unrealized_pnl,
      total_equity = EXCLUDED.total_equity,
      daily_change_abs = EXCLUDED.daily_change_abs,
      daily_change_pct = EXCLUDED.daily_change_pct,
      weekly_change_abs = EXCLUDED.weekly_change_abs,
      weekly_change_pct = EXCLUDED.weekly_change_pct,
      largest_position_asset_id = EXCLUDED.largest_position_asset_id,
      largest_position_symbol = EXCLUDED.largest_position_symbol,
      largest_position_value = EXCLUDED.largest_position_value,
      best_asset_id = EXCLUDED.best_asset_id,
      best_asset_symbol = EXCLUDED.best_asset_symbol,
      best_asset_unrealized_pnl = EXCLUDED.best_asset_unrealized_pnl,
      updated_at = now()
  `,
    [safeUserIds, starterCash]
  );
}

async function refreshCurrentLeaderboard(pool, options = {}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await refreshCurrentLeaderboardWithClient(client, options);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function refreshCurrentLeaderboardForAssetWithClient(client, assetId, { extraUserIds = [] } = {}) {
  const { rows } = await client.query(
    `
    SELECT DISTINCT user_id
    FROM market.portfolio_holdings
    WHERE asset_id = $1
      AND quantity > 0
  `,
    [assetId]
  );

  const userIds = [
    ...rows.map((row) => toInt(row.user_id, 0)),
    ...extraUserIds.map((value) => toInt(value, 0)),
  ].filter((value) => value > 0);

  if (!userIds.length) return;
  await refreshCurrentLeaderboardWithClient(client, { userIds });
}

async function ensureCurrentLeaderboardReady(pool) {
  const { rows } = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::INTEGER FROM market.users) AS user_count,
      (SELECT COUNT(*)::INTEGER FROM market.user_leaderboard_current) AS leaderboard_count
  `
  );

  const userCount = toInt(rows[0]?.user_count, 0);
  const leaderboardCount = toInt(rows[0]?.leaderboard_count, 0);
  if (userCount > 0 && leaderboardCount < userCount) {
    await refreshCurrentLeaderboard(pool);
  }
}

async function listScopedUserIds(pool, viewerUserId, scope) {
  const query = getScopedRelationshipQuery(scope);
  if (!query) return null;

  const { rows } = await pool.query(query, [viewerUserId]);
  const ids = Array.from(new Set(
    [toInt(viewerUserId, 0), ...rows.map((row) => toInt(row.user_id, 0))].filter((value) => value > 0)
  ));
  return ids;
}

async function listRelationshipIds(pool, viewerUserId, scope) {
  if (!viewerUserId) {
    return {
      friendIds: new Set(),
      rivalIds: new Set(),
    };
  }

  const [friendRows, rivalRows] = await Promise.all([
    pool.query(getScopedRelationshipQuery("friends"), [viewerUserId]),
    pool.query(getScopedRelationshipQuery("rivals"), [viewerUserId]),
  ]);

  return {
    friendIds: new Set(friendRows.rows.map((row) => toInt(row.user_id, 0)).filter((value) => value > 0)),
    rivalIds: new Set(rivalRows.rows.map((row) => toInt(row.user_id, 0)).filter((value) => value > 0)),
    scopeIds: scope === "friends" || scope === "rivals"
      ? new Set((scope === "friends" ? friendRows.rows : rivalRows.rows).map((row) => toInt(row.user_id, 0)).filter((value) => value > 0))
      : null,
  };
}

async function listLeaderboardBundle(pool, { viewerUserId = null, scope = "global", window = "1d", page = 1, limit = 25 } = {}) {
  await ensureCurrentLeaderboardReady(pool);

  const safeWindow = normalizeWindow(window);
  const safeLimit = Math.max(1, Math.min(100, toInt(limit, 25)));
  const safePage = Math.max(1, toInt(page, 1));
  const offset = (safePage - 1) * safeLimit;

  let scopedUserIds = null;
  if (scope === "friends" || scope === "rivals") {
    if (!viewerUserId) {
      const error = new Error("unauthenticated");
      error.code = "unauthenticated";
      throw error;
    }
    scopedUserIds = await listScopedUserIds(pool, viewerUserId, scope);
  }

  const { friendIds, rivalIds } = await listRelationshipIds(pool, viewerUserId, scope);

  const rankedSql = `
    WITH ranked AS (
      SELECT
        l.*,
        ROW_NUMBER() OVER (
          ORDER BY l.total_equity DESC, l.username_snapshot ASC, l.user_id ASC
        )::INTEGER AS rank
      FROM market.user_leaderboard_current l
      WHERE $1::bigint[] IS NULL OR l.user_id = ANY($1::bigint[])
    )
  `;

  const [entriesResult, statsResult, meResult] = await Promise.all([
    pool.query(
      `
      ${rankedSql}
      SELECT *
      FROM ranked
      ORDER BY rank ASC
      OFFSET $2
      LIMIT $3
    `,
      [scopedUserIds, offset, safeLimit]
    ),
    pool.query(
      `
      ${rankedSql}
      SELECT
        COUNT(*)::INTEGER AS user_count,
        MAX(updated_at) AS last_updated_at,
        MAX(CASE WHEN rank = 10 THEN total_equity END) AS cutoff_equity_top_10,
        MAX(CASE WHEN rank = 100 THEN total_equity END) AS cutoff_equity_top_100
      FROM ranked
    `,
      [scopedUserIds]
    ),
    viewerUserId
      ? pool.query(
        `
        ${rankedSql}
        SELECT *
        FROM ranked
        WHERE user_id = $2
        LIMIT 1
      `,
        [scopedUserIds, viewerUserId]
      )
      : Promise.resolve({ rows: [] }),
  ]);

  const statsRow = statsResult.rows[0] || {};
  const userCount = toInt(statsRow.user_count, 0);

  const meRow = meResult.rows[0] || null;

  const neighborsResult = meRow
    ? await pool.query(
      `
      ${rankedSql}
      SELECT *
      FROM ranked
      WHERE rank BETWEEN $2 AND $3
      ORDER BY rank ASC
    `,
      [scopedUserIds, Math.max(1, toInt(meRow.rank, 0) - 1), toInt(meRow.rank, 0) + 1]
    )
    : { rows: [] };

  const decorationByUserId = await loadLeaderboardDecorations(
    pool,
    [
      ...entriesResult.rows.map((row) => toInt(row.user_id, 0)),
      ...neighborsResult.rows.map((row) => toInt(row.user_id, 0)),
      meRow ? toInt(meRow.user_id, 0) : 0,
    ]
  );

  const entries = entriesResult.rows.map((row) =>
    mapLeaderboardEntry(row, {
      window: safeWindow,
      userCount,
      viewerId: viewerUserId,
      friendIds,
      rivalIds,
      decorationByUserId,
    })
  );

  const mappedMeEntry = meRow
    ? mapLeaderboardEntry(meRow, {
      window: safeWindow,
      userCount,
      viewerId: viewerUserId,
      friendIds,
      rivalIds,
      decorationByUserId,
    })
    : null;

  const neighbors = neighborsResult.rows
    .filter((row) => toInt(row.user_id, 0) !== toInt(viewerUserId, 0))
    .map((row) => {
      const entry = mapLeaderboardEntry(row, {
        window: safeWindow,
        userCount,
        viewerId: viewerUserId,
        friendIds,
        rivalIds,
        decorationByUserId,
      });
      return {
        user_id: entry.user_id,
        username: entry.username,
        rank: entry.rank,
        total_equity: entry.total_equity,
        gap_abs: mappedMeEntry ? entry.total_equity - mappedMeEntry.total_equity : null,
        profile_picture_url: entry.profile_picture_url,
        profile_color: entry.profile_color,
      };
    });

  const pageCount = userCount > 0 ? Math.ceil(userCount / safeLimit) : 1;

  return {
    scope,
    window: safeWindow,
    pagination: {
      total: userCount,
      page: safePage,
      limit: safeLimit,
      page_count: pageCount,
      has_previous_page: safePage > 1,
      has_next_page: safePage < pageCount,
    },
    stats: {
      user_count: userCount,
      cutoff_equity_top_10: statsRow.cutoff_equity_top_10 === null || statsRow.cutoff_equity_top_10 === undefined
        ? null
        : toNumber(statsRow.cutoff_equity_top_10, 0),
      cutoff_equity_top_100: statsRow.cutoff_equity_top_100 === null || statsRow.cutoff_equity_top_100 === undefined
        ? null
        : toNumber(statsRow.cutoff_equity_top_100, 0),
      last_updated_at: statsRow.last_updated_at ? new Date(statsRow.last_updated_at).toISOString() : null,
    },
    entries,
    me: mappedMeEntry
      ? {
          ...mappedMeEntry,
          percentile: userCount > 1 ? (userCount - mappedMeEntry.rank) / (userCount - 1) : 1,
          neighbors,
        }
      : null,
  };
}

async function listCurrentNetWorthByUserIds(pool, userIds) {
  await ensureCurrentLeaderboardReady(pool);
  const safeUserIds = Array.isArray(userIds)
    ? Array.from(new Set(userIds.map((value) => toInt(value, 0)).filter((value) => value > 0)))
    : [];
  if (!safeUserIds.length) return [];

  const { rows } = await pool.query(
    `
    WITH ranked AS (
      SELECT
        l.user_id,
        l.username_snapshot,
        l.total_equity,
        l.updated_at,
        ROW_NUMBER() OVER (
          ORDER BY l.total_equity DESC, l.username_snapshot ASC, l.user_id ASC
        )::INTEGER AS rank
      FROM market.user_leaderboard_current l
    )
    SELECT
      user_id,
      username_snapshot,
      total_equity,
      updated_at,
      rank
    FROM ranked
    WHERE user_id = ANY($1::bigint[])
    ORDER BY rank ASC
  `,
    [safeUserIds]
  );

  return rows.map((row) => ({
    user_id: toInt(row.user_id, 0),
    username: String(row.username_snapshot || ""),
    total_equity: toNumber(row.total_equity, 0),
    rank: toInt(row.rank, 0),
    updated_at: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));
}

async function listCurrentNetWorthLeaderboard(pool, { limit = 100 } = {}) {
  const bundle = await listLeaderboardBundle(pool, { limit, page: 1, scope: "global", window: "1d" });
  return bundle.entries;
}

async function listDailyNetWorthHistory(pool, userId, { limit = 60 } = {}) {
  const safeLimit = Math.max(1, Math.min(365, Number(limit) || 60));
  const { rows } = await pool.query(
    `
    SELECT
      market_date::text AS recorded_at,
      cash_balance,
      holdings_market_value AS total_market_value,
      total_equity
    FROM market.user_daily_net_worth
    WHERE user_id = $1
    ORDER BY market_date DESC
    LIMIT $2
  `,
    [userId, safeLimit]
  );
  return rows.reverse();
}

async function recordDailyNetWorthSnapshot(client, marketDate) {
  if (!marketDate) return { market_date: null, user_count: 0 };

  const starterCash = getStarterCash();
  const { rowCount } = await client.query(
    `
    INSERT INTO market.user_daily_net_worth (
      user_id,
      market_date,
      cash_balance,
      holdings_market_value,
      total_equity,
      priced_position_count,
      unpriced_position_count,
      created_at,
      updated_at
    )
    SELECT
      u.id,
      $1::date,
      COALESCE(pcb.cash_balance, $2) AS cash_balance,
      COALESCE(SUM(
        CASE
          WHEN d.asset_id IS NULL THEN 0
          ELSE h.quantity * COALESCE(d.mid_close, d.mid_open, 0)
        END
      ), 0) AS holdings_market_value,
      COALESCE(pcb.cash_balance, $2) + COALESCE(SUM(
        CASE
          WHEN d.asset_id IS NULL THEN 0
          ELSE h.quantity * COALESCE(d.mid_close, d.mid_open, 0)
        END
      ), 0) AS total_equity,
      COUNT(*) FILTER (WHERE h.asset_id IS NOT NULL AND d.asset_id IS NOT NULL)::INTEGER AS priced_position_count,
      COUNT(*) FILTER (WHERE h.asset_id IS NOT NULL AND d.asset_id IS NULL)::INTEGER AS unpriced_position_count,
      now(),
      now()
    FROM market.users u
    LEFT JOIN market.portfolio_cash_balances pcb
      ON pcb.user_id = u.id
    LEFT JOIN market.portfolio_holdings h
      ON h.user_id = u.id
     AND h.quantity > 0
    LEFT JOIN market.asset_daily_market_state d
      ON d.asset_id = h.asset_id
     AND d.market_date = $1::date
    GROUP BY u.id, pcb.cash_balance
    ON CONFLICT (user_id, market_date)
    DO UPDATE SET
      cash_balance = EXCLUDED.cash_balance,
      holdings_market_value = EXCLUDED.holdings_market_value,
      total_equity = EXCLUDED.total_equity,
      priced_position_count = EXCLUDED.priced_position_count,
      unpriced_position_count = EXCLUDED.unpriced_position_count,
      updated_at = now()
  `,
    [marketDate, starterCash]
  );

  return {
    market_date: marketDate,
    user_count: rowCount,
  };
}

module.exports = {
  ensureCurrentLeaderboardReady,
  getCurrentNetWorth,
  getStarterCash,
  listCurrentNetWorthLeaderboard,
  listCurrentNetWorthByUserIds,
  listDailyNetWorthHistory,
  listLeaderboardBundle,
  recordDailyNetWorthSnapshot,
  refreshCurrentLeaderboard,
  refreshCurrentLeaderboardForAssetWithClient,
  refreshCurrentLeaderboardWithClient,
};
