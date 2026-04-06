const articleDb = require("./articleDb");
const netWorth = require("./services/netWorth");
const trading = require("./services/trading");

function toInt(value, fallback, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function paginationShape({ total, page, limit }) {
  const pageCount = total > 0 ? Math.ceil(total / limit) : 1;
  return {
    total,
    page,
    limit,
    page_count: pageCount,
    has_previous_page: page > 1,
    has_next_page: page < pageCount,
  };
}

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

async function getUserByUsername(pool, username) {
  const safeUsername = normalizeUsername(username);
  if (!safeUsername) return null;
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.created_at,
      u.bio,
      u.profile_picture_url,
      u.profile_color,
      u.oshi_coin_asset_id,
      CASE
        WHEN ma.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', ma.id,
          'symbol', ma.symbol,
          'display_name', ma.display_name,
          'icon', yc.icon,
          'color', yc.color
        )
      END AS oshi_coin
    FROM market.users u
    LEFT JOIN market.market_assets ma
      ON ma.id = u.oshi_coin_asset_id
    LEFT JOIN yt.youtube_channels yc
      ON yc.youtube_channel_id = ma.youtube_channel_id
    WHERE u.username_normalized = $1
    LIMIT 1
  `,
    [safeUsername]
  );
  return rows[0] || null;
}

async function getUserById(pool, userId) {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) return null;
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.created_at,
      u.bio,
      u.profile_picture_url,
      u.profile_color,
      u.oshi_coin_asset_id,
      CASE
        WHEN ma.id IS NULL THEN NULL
        ELSE jsonb_build_object(
          'id', ma.id,
          'symbol', ma.symbol,
          'display_name', ma.display_name,
          'icon', yc.icon,
          'color', yc.color
        )
      END AS oshi_coin
    FROM market.users u
    LEFT JOIN market.market_assets ma
      ON ma.id = u.oshi_coin_asset_id
    LEFT JOIN yt.youtube_channels yc
      ON yc.youtube_channel_id = ma.youtube_channel_id
    WHERE u.id = $1
    LIMIT 1
  `,
    [safeUserId]
  );
  return rows[0] || null;
}

async function getPublicPortfolioSummary(pool, userId) {
  const currentNetWorth = await netWorth.getCurrentNetWorth(pool, userId);

  return {
    cash_balance: currentNetWorth.cash_balance,
    total_market_value: currentNetWorth.total_market_value,
    total_unrealized_pnl: currentNetWorth.total_unrealized_pnl,
    total_equity: currentNetWorth.total_equity,
    holdings: [],
  };
}

async function listAcceptedFriends(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      friend.id,
      friend.username,
      friend.profile_picture_url,
      friend.profile_color
    FROM market.user_friendships f
    JOIN market.users friend
      ON friend.id = CASE
        WHEN f.requester_id = $1 THEN f.addressee_id
        ELSE f.requester_id
      END
    WHERE f.status = 'accepted'
      AND ($1 IN (f.requester_id, f.addressee_id))
    ORDER BY COALESCE(f.accepted_at, f.created_at) DESC, friend.username ASC
  `,
    [userId]
  );
  return rows;
}

async function listRivals(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.profile_picture_url,
      u.profile_color
    FROM market.user_rivals r
    JOIN market.users u
      ON u.id = r.rival_user_id
    WHERE r.user_id = $1
    ORDER BY r.created_at DESC, u.username ASC
  `,
    [userId]
  );
  return rows;
}

async function listPendingFriendRequests(pool, userId, direction) {
  const isIncoming = direction === "incoming";
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.profile_picture_url,
      u.profile_color,
      f.created_at
    FROM market.user_friendships f
    JOIN market.users u
      ON u.id = ${isIncoming ? "f.requester_id" : "f.addressee_id"}
    WHERE f.status = 'pending'
      AND ${isIncoming ? "f.addressee_id" : "f.requester_id"} = $1
    ORDER BY f.created_at DESC, u.username ASC
  `,
    [userId]
  );
  return rows;
}

async function getViewerContext(pool, profileUserId, viewerUserId) {
  if (!viewerUserId) {
    return {
      is_authenticated: false,
      is_self: false,
      friendship_status: "none",
      can_send_friend_request: false,
      is_rival: false,
      is_rivaled_by_profile: false,
    };
  }

  if (Number(viewerUserId) === Number(profileUserId)) {
    return {
      is_authenticated: true,
      is_self: true,
      friendship_status: "self",
      can_send_friend_request: false,
      is_rival: false,
      is_rivaled_by_profile: false,
    };
  }

  const [friendshipResult, rivalResult, reverseRivalResult] = await Promise.all([
    pool.query(
      `
      SELECT requester_id, addressee_id, status
      FROM market.user_friendships
      WHERE LEAST(requester_id, addressee_id) = LEAST($1, $2)
        AND GREATEST(requester_id, addressee_id) = GREATEST($1, $2)
      LIMIT 1
    `,
      [viewerUserId, profileUserId]
    ),
    pool.query(
      `
      SELECT 1
      FROM market.user_rivals
      WHERE user_id = $1
        AND rival_user_id = $2
      LIMIT 1
    `,
      [viewerUserId, profileUserId]
    ),
    pool.query(
      `
      SELECT 1
      FROM market.user_rivals
      WHERE user_id = $1
        AND rival_user_id = $2
      LIMIT 1
    `,
      [profileUserId, viewerUserId]
    ),
  ]);

  const friendship = friendshipResult.rows[0] || null;
  let friendshipStatus = "none";
  if (friendship?.status === "accepted") {
    friendshipStatus = "accepted";
  } else if (friendship?.status === "pending") {
    friendshipStatus = Number(friendship.requester_id) === Number(viewerUserId) ? "pending_outgoing" : "pending_incoming";
  }

  return {
    is_authenticated: true,
    is_self: false,
    friendship_status: friendshipStatus,
    can_send_friend_request: friendshipStatus === "none",
    is_rival: Boolean(rivalResult.rows[0]),
    is_rivaled_by_profile: Boolean(reverseRivalResult.rows[0]),
  };
}

async function getProfileStats(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM content.articles a WHERE a.author_id = $1 AND a.status = 'published') AS article_count,
      (SELECT COUNT(*)::int FROM market.trade_fills tf WHERE tf.user_id = $1) AS trade_count,
      (
        SELECT COUNT(*)::int
        FROM market.user_friendships f
        WHERE f.status = 'accepted'
          AND $1 IN (f.requester_id, f.addressee_id)
      ) AS friend_count,
      (SELECT COUNT(*)::int FROM market.user_rivals r WHERE r.user_id = $1) AS rival_count
  `,
    [userId]
  );
  return rows[0] || { article_count: 0, trade_count: 0, friend_count: 0, rival_count: 0 };
}

async function getNetworthHistory(pool, userId, { limit = 60 } = {}) {
  return netWorth.listDailyNetWorthHistory(pool, userId, { limit });
}

async function listProfileTrades(pool, userId, { page = 1, limit = 10 } = {}) {
  const safePage = toInt(page, 1, { min: 1, max: 1000 });
  const safeLimit = toInt(limit, 10, { min: 1, max: 50 });
  const offset = (safePage - 1) * safeLimit;

  const [countResult, itemsResult] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int AS total FROM market.trade_fills WHERE user_id = $1`, [userId]),
    pool.query(
      `
      SELECT
        tf.id,
        tf.ts,
        tf.side,
        tf.price,
        tf.quantity,
        tf.gross_cash,
        tf.fee_cash,
        tf.net_cash,
        ma.symbol,
        ma.display_name
      FROM market.trade_fills tf
      JOIN market.market_assets ma
        ON ma.id = tf.asset_id
      WHERE tf.user_id = $1
      ORDER BY tf.ts DESC, tf.id DESC
      LIMIT $2
      OFFSET $3
    `,
      [userId, safeLimit, offset]
    ),
  ]);

  return {
    items: itemsResult.rows,
    pagination: paginationShape({
      total: Number(countResult.rows[0]?.total || 0),
      page: safePage,
      limit: safeLimit,
    }),
  };
}

async function listProfileArticles(pool, userId, { page = 1, limit = 6, viewerUserId = null } = {}) {
  const result = await articleDb.listArticles(pool, {
    page,
    limit,
    authorId: userId,
    viewerUserId,
    includeDrafts: false,
  });

  return {
    items: result.items,
    pagination: paginationShape(result),
  };
}

async function resolveProfileUser(pool, { username = null, viewerUserId = null, selfOnly = false } = {}) {
  const profileUser = selfOnly ? await getUserById(pool, viewerUserId) : await getUserByUsername(pool, username);
  if (!profileUser) {
    const error = new Error("profile_not_found");
    error.code = "profile_not_found";
    throw error;
  }
  return profileUser;
}

async function getProfileBundle(pool, {
  username = null,
  viewerUserId = null,
  articlesPage = 1,
  articlesLimit = 6,
  tradesPage = 1,
  tradesLimit = 10,
  historyLimit = 60,
  selfOnly = false,
} = {}) {
  const profileUser = await resolveProfileUser(pool, { username, viewerUserId, selfOnly });

  const isSelf = Boolean(viewerUserId) && Number(profileUser.id) === Number(viewerUserId);
  const [viewerContext, stats, friends, rivals, networth, articleResult, tradeResult, portfolio] = await Promise.all([
    getViewerContext(pool, profileUser.id, viewerUserId),
    getProfileStats(pool, profileUser.id),
    listAcceptedFriends(pool, profileUser.id),
    listRivals(pool, profileUser.id),
    getNetworthHistory(pool, profileUser.id, { limit: historyLimit }),
    listProfileArticles(pool, profileUser.id, { page: articlesPage, limit: articlesLimit, viewerUserId }),
    listProfileTrades(pool, profileUser.id, { page: tradesPage, limit: tradesLimit }),
    isSelf ? trading.getPortfolioSummary(pool, profileUser.id) : getPublicPortfolioSummary(pool, profileUser.id),
  ]);

  const pending = isSelf
    ? {
        incoming: await listPendingFriendRequests(pool, profileUser.id, "incoming"),
        outgoing: await listPendingFriendRequests(pool, profileUser.id, "outgoing"),
      }
    : null;

  return {
    profile: {
      id: profileUser.id,
      username: profileUser.username,
      created_at: profileUser.created_at,
      bio: profileUser.bio,
      profile_picture_url: profileUser.profile_picture_url,
      profile_color: profileUser.profile_color,
      oshi_coin: profileUser.oshi_coin,
      stats: {
        cash_balance: portfolio.cash_balance,
        total_market_value: portfolio.total_market_value,
        total_unrealized_pnl: portfolio.total_unrealized_pnl,
        total_equity: portfolio.total_equity,
        article_count: Number(stats.article_count || 0),
        trade_count: Number(stats.trade_count || 0),
        friend_count: Number(stats.friend_count || 0),
        rival_count: Number(stats.rival_count || 0),
      },
      networth_history: networth,
      friends,
      rivals,
      pending_friend_requests: pending,
      holdings: isSelf ? portfolio.holdings : [],
    },
    viewer_context: viewerContext,
    articles: {
      items: articleResult.items,
      pagination: articleResult.pagination,
    },
    trades: tradeResult,
  };
}

async function resolveTargetUser(pool, username, viewerUserId) {
  const target = await getUserByUsername(pool, username);
  if (!target) {
    const error = new Error("profile_not_found");
    error.code = "profile_not_found";
    throw error;
  }
  if (Number(target.id) === Number(viewerUserId)) {
    const error = new Error("invalid_profile_target");
    error.code = "invalid_profile_target";
    throw error;
  }
  return target;
}

async function sendFriendRequest(pool, viewerUserId, username) {
  const target = await resolveTargetUser(pool, username, viewerUserId);
  const pairResult = await pool.query(
    `
    SELECT id, requester_id, addressee_id, status
    FROM market.user_friendships
    WHERE LEAST(requester_id, addressee_id) = LEAST($1, $2)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1, $2)
    LIMIT 1
  `,
    [viewerUserId, target.id]
  );
  const existing = pairResult.rows[0] || null;

  if (existing?.status === "accepted") {
    const error = new Error("already_friends");
    error.code = "already_friends";
    throw error;
  }
  if (existing?.status === "pending") {
    const error = new Error(Number(existing.requester_id) === Number(viewerUserId) ? "friend_request_pending" : "friend_request_needs_response");
    error.code = error.message;
    throw error;
  }
  if (existing) {
    await pool.query(`DELETE FROM market.user_friendships WHERE id = $1`, [existing.id]);
  }

  await pool.query(
    `
    INSERT INTO market.user_friendships (
      requester_id,
      addressee_id,
      status,
      created_at,
      updated_at
    ) VALUES ($1, $2, 'pending', now(), now())
  `,
    [viewerUserId, target.id]
  );
}

async function acceptFriendRequest(pool, viewerUserId, username) {
  const target = await resolveTargetUser(pool, username, viewerUserId);
  const result = await pool.query(
    `
    UPDATE market.user_friendships
    SET
      status = 'accepted',
      accepted_at = now(),
      updated_at = now()
    WHERE requester_id = $1
      AND addressee_id = $2
      AND status = 'pending'
    RETURNING id
  `,
    [target.id, viewerUserId]
  );
  if (!result.rows[0]) {
    const error = new Error("friend_request_not_found");
    error.code = "friend_request_not_found";
    throw error;
  }
}

async function removeFriendship(pool, viewerUserId, username) {
  const target = await resolveTargetUser(pool, username, viewerUserId);
  await pool.query(
    `
    DELETE FROM market.user_friendships
    WHERE LEAST(requester_id, addressee_id) = LEAST($1, $2)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1, $2)
  `,
    [viewerUserId, target.id]
  );
}

async function setRival(pool, viewerUserId, username, active) {
  const target = await resolveTargetUser(pool, username, viewerUserId);
  if (active) {
    await pool.query(
      `
      INSERT INTO market.user_rivals (user_id, rival_user_id, created_at)
      VALUES ($1, $2, now())
      ON CONFLICT (user_id, rival_user_id) DO NOTHING
    `,
      [viewerUserId, target.id]
    );
    return;
  }

  await pool.query(
    `
    DELETE FROM market.user_rivals
    WHERE user_id = $1
      AND rival_user_id = $2
  `,
    [viewerUserId, target.id]
  );
}

module.exports = {
  acceptFriendRequest,
  getProfileBundle,
  listProfileArticles,
  listProfileTrades,
  removeFriendship,
  resolveProfileUser,
  sendFriendRequest,
  setRival,
};
