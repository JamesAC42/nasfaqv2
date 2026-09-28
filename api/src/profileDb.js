const { loadEquipped } = require("./services/games/equipped");
const articleDb = require("./articleDb");
const netWorth = require("./services/netWorth");
const achievements = require("./services/achievements");
const trading = require("./services/trading");
const gamesInventory = require("./services/games/inventory");
const { profilePictureUrlSql } = require("./profilePictures");
const reactions = require("./services/games/reactions");

// Banner art counts only while the player still owns one of her SSR/UR cards (cards can be sold).
const BANNER_RARITIES_SQL = "('SSR', 'UR')";
const PROFILE_BANNER_JOIN = `
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('id', ba.id, 'symbol', ba.symbol, 'display_name', ba.display_name, 'icon', bc.icon, 'color', bc.color) AS banner
      FROM market.market_assets ba
      LEFT JOIN yt.youtube_channels bc ON bc.youtube_channel_id = ba.youtube_channel_id
      WHERE ba.id = u.profile_banner_asset_id
        AND EXISTS (
          SELECT 1 FROM games.user_cards uc
          WHERE uc.user_id = u.id AND uc.asset_id = ba.id AND uc.rarity IN ${BANNER_RARITIES_SQL}
        )
    ) pb ON true`;

function profileError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

/** Talents whose banner the user has unlocked (owns her SSR or UR), for the profile banner picker. */
async function listBannerOptions(pool, userId) {
  const { rows } = await pool.query(
    `
    SELECT DISTINCT a.id, a.symbol, a.display_name, c.icon, c.color
    FROM games.user_cards uc
    JOIN market.market_assets a ON a.id = uc.asset_id
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE uc.user_id = $1 AND uc.rarity IN ${BANNER_RARITIES_SQL}
    ORDER BY a.symbol
  `,
    [userId]
  );
  return rows.map((row) => ({ id: Number(row.id), symbol: row.symbol, display_name: row.display_name, icon: row.icon || null, color: row.color || null }));
}

/** The asset behind `symbol` whose SSR/UR card the user owns, or null. */
async function bannerAssetForSymbol(pool, userId, symbol) {
  const { rows } = await pool.query(
    `
    SELECT uc.asset_id
    FROM games.user_cards uc
    JOIN market.market_assets a ON a.id = uc.asset_id
    WHERE uc.user_id = $1 AND upper(a.symbol) = upper($2) AND uc.rarity IN ${BANNER_RARITIES_SQL}
    LIMIT 1
  `,
    [userId, String(symbol || "")]
  );
  return rows[0] ? Number(rows[0].asset_id) : null;
}

/** Sets (or with null, clears) the profile banner. Throws banner_locked unless she's unlocked. */
async function setProfileBanner(pool, userId, assetId) {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) throw profileError("invalid_profile_update");
  let safeAssetId = null;
  if (assetId !== null && assetId !== undefined && assetId !== "") {
    safeAssetId = Number(assetId);
    if (!Number.isInteger(safeAssetId) || safeAssetId <= 0) throw profileError("invalid_profile_update");
    const { rows } = await pool.query(
      `SELECT 1 FROM games.user_cards WHERE user_id = $1 AND asset_id = $2 AND rarity IN ${BANNER_RARITIES_SQL} LIMIT 1`,
      [safeUserId, safeAssetId]
    );
    if (!rows[0]) throw profileError("banner_locked");
  }
  await pool.query(`UPDATE market.users SET profile_banner_asset_id = $2, updated_at = now() WHERE id = $1`, [safeUserId, safeAssetId]);
}

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

function validateUsername(value) {
  const trimmed = String(value || "").trim();
  if (trimmed.length < 3 || trimmed.length > 32 || !/^[A-Za-z0-9_]+(?: [A-Za-z0-9_]+)*$/.test(trimmed)) {
    const error = new Error("invalid_profile_update");
    error.code = "invalid_profile_update";
    throw error;
  }
  return trimmed;
}

function normalizeUserId(value) {
  const parsed = Number.parseInt(String(value || "").trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
}

function optionalHexColor(value) {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) return null;
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}


async function getUserByUsername(pool, username) {
  const safeUsername = normalizeUsername(username);
  if (!safeUsername) return null;
  const { rows } = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.email_verified,
      u.created_at,
      u.bio,
      ${profilePictureUrlSql("large")} AS profile_picture_url,
      u.profile_color,
      u.is_admin,
      u.can_manage_assets,
      u.can_create_prediction_markets,
      u.can_approve_prediction_markets,
      u.can_resolve_prediction_markets,
      u.can_void_prediction_markets,
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
      END AS oshi_coin,
      pb.banner AS profile_banner
    FROM market.users u
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    LEFT JOIN market.market_assets ma
      ON ma.id = u.oshi_coin_asset_id
    LEFT JOIN yt.youtube_channels yc
      ON yc.youtube_channel_id = ma.youtube_channel_id
    ${PROFILE_BANNER_JOIN}
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
      u.email_verified,
      u.created_at,
      u.bio,
      ${profilePictureUrlSql("large")} AS profile_picture_url,
      u.profile_color,
      u.is_admin,
      u.can_manage_assets,
      u.can_create_prediction_markets,
      u.can_approve_prediction_markets,
      u.can_resolve_prediction_markets,
      u.can_void_prediction_markets,
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
      END AS oshi_coin,
      pb.banner AS profile_banner
    FROM market.users u
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    LEFT JOIN market.market_assets ma
      ON ma.id = u.oshi_coin_asset_id
    LEFT JOIN yt.youtube_channels yc
      ON yc.youtube_channel_id = ma.youtube_channel_id
    ${PROFILE_BANNER_JOIN}
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
      ${profilePictureUrlSql("small", "pp", "friend")} AS profile_picture_url,
      friend.profile_color
    FROM market.user_friendships f
    JOIN market.users friend
      ON friend.id = CASE
        WHEN f.requester_id = $1 THEN f.addressee_id
        ELSE f.requester_id
      END
    LEFT JOIN market.profile_pictures pp
      ON pp.id = friend.profile_picture_id
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
      ${profilePictureUrlSql("small", "pp")} AS profile_picture_url,
      u.profile_color
    FROM market.user_rivals r
    JOIN market.users u
      ON u.id = r.rival_user_id
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
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
      ${profilePictureUrlSql("small", "pp")} AS profile_picture_url,
      u.profile_color,
      f.created_at
    FROM market.user_friendships f
    JOIN market.users u
      ON u.id = ${isIncoming ? "f.requester_id" : "f.addressee_id"}
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE f.status = 'pending'
      AND ${isIncoming ? "f.addressee_id" : "f.requester_id"} = $1
    ORDER BY f.created_at DESC, u.username ASC
  `,
    [userId]
  );
  return rows;
}

async function getViewerContext(pool, profileUserId, viewerUserId) {
  const safeProfileUserId = normalizeUserId(profileUserId);
  const safeViewerUserId = normalizeUserId(viewerUserId);

  if (!safeProfileUserId || !safeViewerUserId) {
    return {
      is_authenticated: false,
      is_self: false,
      friendship_status: "none",
      can_send_friend_request: false,
      is_rival: false,
      is_rivaled_by_profile: false,
    };
  }

  if (safeViewerUserId === safeProfileUserId) {
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
      WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
        AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)
      LIMIT 1
    `,
      [safeViewerUserId, safeProfileUserId]
    ),
    pool.query(
      `
      SELECT 1
      FROM market.user_rivals
      WHERE user_id = $1::bigint
        AND rival_user_id = $2::bigint
      LIMIT 1
    `,
      [safeViewerUserId, safeProfileUserId]
    ),
    pool.query(
      `
      SELECT 1
      FROM market.user_rivals
      WHERE user_id = $1::bigint
        AND rival_user_id = $2::bigint
      LIMIT 1
    `,
      [safeProfileUserId, safeViewerUserId]
    ),
  ]);

  const friendship = friendshipResult.rows[0] || null;
  let friendshipStatus = "none";
  if (friendship?.status === "accepted") {
    friendshipStatus = "accepted";
  } else if (friendship?.status === "pending") {
    friendshipStatus = Number(friendship.requester_id) === safeViewerUserId ? "pending_outgoing" : "pending_incoming";
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

async function listSavedArticles(pool, userId, { page = 1, limit = 6 } = {}) {
  const result = await articleDb.listArticles(pool, {
    page,
    limit,
    savedByUserId: userId,
    viewerUserId: userId,
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
  savedArticlesPage = 1,
  savedArticlesLimit = 6,
  tradesPage = 1,
  tradesLimit = 10,
  historyLimit = 60,
  selfOnly = false,
} = {}) {
  const profileUser = await resolveProfileUser(pool, { username, viewerUserId, selfOnly });

  const isSelf = Boolean(viewerUserId) && Number(profileUser.id) === Number(viewerUserId);
  const [viewerContext, stats, friends, rivals, networth, articleResult, savedArticleResult, tradeResult, portfolio, userAchievements, streaks, leaderboardEntries, oshiboards, gachaBadges, gachaTotalSpent] = await Promise.all([
    getViewerContext(pool, profileUser.id, viewerUserId),
    getProfileStats(pool, profileUser.id),
    listAcceptedFriends(pool, profileUser.id),
    listRivals(pool, profileUser.id),
    getNetworthHistory(pool, profileUser.id, { limit: historyLimit }),
    listProfileArticles(pool, profileUser.id, { page: articlesPage, limit: articlesLimit, viewerUserId }),
    isSelf ? listSavedArticles(pool, profileUser.id, { page: savedArticlesPage, limit: savedArticlesLimit }) : Promise.resolve(null),
    listProfileTrades(pool, profileUser.id, { page: tradesPage, limit: tradesLimit }),
    isSelf ? trading.getPortfolioSummary(pool, profileUser.id) : getPublicPortfolioSummary(pool, profileUser.id),
    achievements.listUserAchievements(pool, profileUser.id, { limit: 100 }),
    achievements.getUserTradeStreak(pool, profileUser.id),
    netWorth.listCurrentNetWorthByUserIds(pool, [profileUser.id]),
    netWorth.listUserOshiboardMemberships(pool, profileUser.id),
    gamesInventory.listUserGachaBadges(pool, profileUser.id),
    gamesInventory.getTotalGachaSpentCash(pool, profileUser.id),
  ]);
  const equipped = (await loadEquipped(pool, [profileUser.id])).get(Number(profileUser.id)) ?? {};
  const bannerOptions = isSelf ? await listBannerOptions(pool, profileUser.id) : [];
  const leaderboardEntry = leaderboardEntries[0] || null;

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
      email_verified: Boolean(profileUser.email_verified),
      created_at: profileUser.created_at,
      bio: profileUser.bio,
      profile_picture_url: profileUser.profile_picture_url,
      profile_color: profileUser.profile_color,
      equipped,
      is_admin: Boolean(profileUser.is_admin),
      permissions: {
        can_manage_assets: Boolean(profileUser.can_manage_assets),
        can_create_prediction_markets: Boolean(profileUser.can_create_prediction_markets),
        can_approve_prediction_markets: Boolean(profileUser.can_approve_prediction_markets),
        can_resolve_prediction_markets: Boolean(profileUser.can_resolve_prediction_markets),
        can_void_prediction_markets: Boolean(profileUser.can_void_prediction_markets),
      },
      rank: Number(leaderboardEntry?.rank || 0),
      oshiboards,
      oshi_coin: profileUser.oshi_coin,
      profile_banner: profileUser.profile_banner || null,
      banner_options: bannerOptions,
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
      achievements: userAchievements,
      streaks: {
        current_streak_days: Number(streaks.current_streak_days || 0),
        longest_streak_days: Number(streaks.longest_streak_days || 0),
        last_trade_day: streaks.last_trade_day || null,
        streak_started_day: streaks.streak_started_day || null,
        longest_streak_started_day: streaks.longest_streak_started_day || null,
        longest_streak_ended_day: streaks.longest_streak_ended_day || null,
      },
      friends,
      rivals,
      pending_friend_requests: pending,
      holdings: isSelf ? portfolio.holdings : [],
      gacha_badges: gachaBadges,
      gacha_total_spent_cash: gachaTotalSpent,
    },
    viewer_context: viewerContext,
    articles: {
      items: articleResult.items,
      pagination: articleResult.pagination,
    },
    saved_articles: savedArticleResult,
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

async function setProfilePicture(pool, userId, profilePictureId, { reaction = null } = {}) {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) {
    const error = new Error("invalid_profile_picture");
    error.code = "invalid_profile_picture";
    throw error;
  }

  // A card reaction as the avatar ("PEK/hype"): needs a card of that talent. It takes precedence
  // over the catalog picture, which is kept for when the reaction is cleared.
  if (reaction) {
    const { symbol, pose } = reactions.parseReactionId(reaction);
    await reactions.assertOwnsReaction(pool, safeUserId, symbol);
    await pool.query(`UPDATE market.users SET profile_reaction = $2 WHERE id = $1`, [safeUserId, `${symbol}/${pose}`]);
    await refreshAvatarCopies(pool, safeUserId);
    return;
  }

  if (profilePictureId === null || profilePictureId === undefined) {
    await pool.query(
      `
      UPDATE market.users
      SET profile_picture_id = NULL, profile_reaction = NULL
      WHERE id = $1
    `,
      [safeUserId]
    );
    await refreshAvatarCopies(pool, safeUserId);
    return;
  }

  const safeProfilePictureId = Number(profilePictureId);
  if (!Number.isInteger(safeProfilePictureId) || safeProfilePictureId <= 0) {
    const error = new Error("invalid_profile_picture");
    error.code = "invalid_profile_picture";
    throw error;
  }

  const exists = await pool.query(
    `
    SELECT id
    FROM market.profile_pictures
    WHERE id = $1
      AND is_deleted = false
    LIMIT 1
  `,
    [safeProfilePictureId]
  );

  if (!exists.rows[0]) {
    const error = new Error("profile_picture_not_found");
    error.code = "profile_picture_not_found";
    throw error;
  }

  await pool.query(
    `
    UPDATE market.users
    SET profile_picture_id = $2, profile_reaction = NULL
    WHERE id = $1
  `,
    [safeUserId, safeProfilePictureId]
  );
  await refreshAvatarCopies(pool, safeUserId);
}

// The leaderboard and oshiboards keep a copy of each player's avatar URL.
async function refreshAvatarCopies(pool, userId) {
  await netWorth.refreshCurrentLeaderboard(pool, { userIds: [userId] });
  await netWorth.refreshCurrentOshiboards(pool, { userIds: [userId] });
}

async function updateProfileSettings(pool, userId, { username, bio, profileColor, oshiCoinAssetId, profileBannerAssetId }) {
  const safeUserId = Number(userId);
  if (!Number.isInteger(safeUserId) || safeUserId <= 0) {
    const error = new Error("invalid_profile_update");
    error.code = "invalid_profile_update";
    throw error;
  }

  const safeBio = optionalTrimmedString(bio);
  if (safeBio && safeBio.length > 250) {
    const error = new Error("invalid_profile_update");
    error.code = "invalid_profile_update";
    throw error;
  }
  const safeUsername = validateUsername(username);
  const safeUsernameNormalized = normalizeUsername(safeUsername);

  const safeProfileColor = profileColor === null || profileColor === undefined || profileColor === ""
    ? null
    : optionalHexColor(profileColor);
  if (profileColor !== null && profileColor !== undefined && profileColor !== "" && !safeProfileColor) {
    const error = new Error("invalid_profile_update");
    error.code = "invalid_profile_update";
    throw error;
  }

  let safeOshiCoinAssetId = null;
  if (oshiCoinAssetId !== null && oshiCoinAssetId !== undefined && oshiCoinAssetId !== "") {
    safeOshiCoinAssetId = Number(oshiCoinAssetId);
    if (!Number.isInteger(safeOshiCoinAssetId) || safeOshiCoinAssetId <= 0) {
      const error = new Error("invalid_profile_update");
      error.code = "invalid_profile_update";
      throw error;
    }

    const assetResult = await pool.query(
      `
      SELECT id
      FROM market.market_assets
      WHERE id = $1
      LIMIT 1
    `,
      [safeOshiCoinAssetId]
    );
    if (!assetResult.rows[0]) {
      const error = new Error("invalid_profile_update");
      error.code = "invalid_profile_update";
      throw error;
    }
  }

  // Left out of the request = unchanged. Checked first, so a locked banner saves nothing.
  if (profileBannerAssetId !== undefined) await setProfileBanner(pool, safeUserId, profileBannerAssetId);

  try {
    await pool.query(
      `
      UPDATE market.users
      SET username = $2,
          username_normalized = $3,
          bio = $4,
          profile_color = $5,
          oshi_coin_asset_id = $6,
          updated_at = now()
      WHERE id = $1
    `,
      [safeUserId, safeUsername, safeUsernameNormalized, safeBio, safeProfileColor, safeOshiCoinAssetId]
    );
  } catch (error) {
    if (error?.code === "23505") {
      const e = new Error("username_taken");
      e.code = "username_taken";
      throw e;
    }
    throw error;
  }

  await netWorth.refreshCurrentOshiboards(pool, { userIds: [safeUserId] });
}

async function sendFriendRequest(pool, viewerUserId, username) {
  const safeViewerUserId = normalizeUserId(viewerUserId);
  if (!safeViewerUserId) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }

  const target = await resolveTargetUser(pool, username, safeViewerUserId);
  const pairResult = await pool.query(
    `
    SELECT id, requester_id, addressee_id, status
    FROM market.user_friendships
    WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)
    LIMIT 1
  `,
    [safeViewerUserId, target.id]
  );
  const existing = pairResult.rows[0] || null;

  if (existing?.status === "accepted") {
    const error = new Error("already_friends");
    error.code = "already_friends";
    throw error;
  }
  if (existing?.status === "pending") {
    const error = new Error(Number(existing.requester_id) === safeViewerUserId ? "friend_request_pending" : "friend_request_needs_response");
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
    [safeViewerUserId, target.id]
  );
}

async function acceptFriendRequest(pool, viewerUserId, username) {
  const safeViewerUserId = normalizeUserId(viewerUserId);
  if (!safeViewerUserId) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }

  const target = await resolveTargetUser(pool, username, safeViewerUserId);
  const result = await pool.query(
    `
    UPDATE market.user_friendships
    SET
      status = 'accepted',
      accepted_at = now(),
      updated_at = now()
    WHERE requester_id = $1::bigint
      AND addressee_id = $2::bigint
      AND status = 'pending'
    RETURNING id
  `,
    [target.id, safeViewerUserId]
  );
  if (!result.rows[0]) {
    const error = new Error("friend_request_not_found");
    error.code = "friend_request_not_found";
    throw error;
  }
}

async function removeFriendship(pool, viewerUserId, username) {
  const safeViewerUserId = normalizeUserId(viewerUserId);
  if (!safeViewerUserId) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }

  const target = await resolveTargetUser(pool, username, safeViewerUserId);
  await pool.query(
    `
    DELETE FROM market.user_friendships
    WHERE LEAST(requester_id, addressee_id) = LEAST($1::bigint, $2::bigint)
      AND GREATEST(requester_id, addressee_id) = GREATEST($1::bigint, $2::bigint)
  `,
    [safeViewerUserId, target.id]
  );
}

async function setRival(pool, viewerUserId, username, active) {
  const safeViewerUserId = normalizeUserId(viewerUserId);
  if (!safeViewerUserId) {
    const error = new Error("unauthenticated");
    error.code = "unauthenticated";
    throw error;
  }

  const target = await resolveTargetUser(pool, username, safeViewerUserId);
  if (active) {
    await pool.query(
      `
      INSERT INTO market.user_rivals (user_id, rival_user_id, created_at)
      VALUES ($1, $2, now())
      ON CONFLICT (user_id, rival_user_id) DO NOTHING
    `,
      [safeViewerUserId, target.id]
    );
    return;
  }

  await pool.query(
    `
    DELETE FROM market.user_rivals
    WHERE user_id = $1::bigint
      AND rival_user_id = $2::bigint
  `,
    [safeViewerUserId, target.id]
  );
}

module.exports = {
  acceptFriendRequest,
  getProfileBundle,
  listSavedArticles,
  listProfileArticles,
  listProfileTrades,
  removeFriendship,
  resolveProfileUser,
  bannerAssetForSymbol,
  setProfileBanner,
  setProfilePicture,
  updateProfileSettings,
  sendFriendRequest,
  setRival,
};
