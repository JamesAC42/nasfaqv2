const VALID_SCOPE_TYPES = new Set(["asset", "unit", "market", "meta"]);
const VALID_POSTING_POLICIES = new Set(["authenticated", "admins_only", "read_only"]);
const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";
const VALID_MESSAGE_STATUSES = new Set(["active", "deleted", "moderated"]);
const VALID_REPORT_STATUSES = new Set(["open", "resolved", "dismissed"]);
const VALID_MODERATION_ACTIONS = new Set(["mute", "ban"]);
const MESSAGE_MIN_LENGTH = 1;
const MESSAGE_MAX_LENGTH = 1000;
const MESSAGE_RATE_LIMIT_MS = 3000;
const CHAT_HISTORY_VISIBLE_DAYS = Math.max(1, Number(process.env.CHAT_HISTORY_VISIBLE_DAYS || 30) || 30);
const CHAT_ARCHIVE_BATCH_SIZE = Math.max(50, Math.min(5000, Number(process.env.CHAT_ARCHIVE_BATCH_SIZE || 1000) || 1000));

function createError(code, extra = {}) {
  const error = new Error(code);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

function optionalTrimmedString(value, { maxLength = null, allowEmpty = false } = {}) {
  if (value === null || value === undefined) return null;
  let trimmed = String(value).trim();
  if (!allowEmpty && !trimmed) return null;
  if (maxLength && trimmed.length > maxLength) {
    trimmed = trimmed.slice(0, maxLength).trim();
    if (!allowEmpty && !trimmed) return null;
  }
  return trimmed;
}

function normalizeScopeType(value) {
  const scopeType = optionalTrimmedString(value, { maxLength: 32 });
  if (!scopeType) return null;
  const normalized = scopeType.toLowerCase();
  return VALID_SCOPE_TYPES.has(normalized) ? normalized : null;
}

function normalizeUnitKey(value) {
  const trimmed = optionalTrimmedString(value, { maxLength: 120 });
  if (!trimmed) return null;
  return trimmed.replace(/\s+/g, " ").toLowerCase();
}

function normalizeScopeKey(scopeType, scopeKey) {
  switch (scopeType) {
    case "asset": {
      const parsed = Number.parseInt(String(scopeKey ?? ""), 10);
      if (!Number.isInteger(parsed) || parsed <= 0) return null;
      return String(parsed);
    }
    case "unit":
      return normalizeUnitKey(scopeKey);
    case "market":
    case "meta":
      return "global";
    default:
      return null;
  }
}

function buildChannelKey(scopeType, scopeKey) {
  return `${scopeType}:${scopeKey}`;
}

function parseChannelKey(value) {
  const raw = optionalTrimmedString(value, { maxLength: 160 });
  if (!raw) return null;
  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) return null;

  const scopeType = normalizeScopeType(raw.slice(0, separatorIndex));
  if (!scopeType) return null;
  const scopeKey = normalizeScopeKey(scopeType, raw.slice(separatorIndex + 1));
  if (!scopeKey) return null;

  return {
    channelKey: buildChannelKey(scopeType, scopeKey),
    scopeType,
    scopeKey,
  };
}

function parseLimit(value, fallback = 50, { min = 1, max = 100 } = {}) {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseMessageId(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw createError("invalid_chat_message");
  }
  return parsed;
}

function normalizeMessageBody(value) {
  const body = optionalTrimmedString(value, { maxLength: MESSAGE_MAX_LENGTH, allowEmpty: false });
  if (!body || body.length < MESSAGE_MIN_LENGTH || body.length > MESSAGE_MAX_LENGTH) {
    throw createError("invalid_chat_message");
  }
  return body;
}

function normalizePostingPolicy(value, { allowNull = false } = {}) {
  if (value === null || value === undefined || value === "") return allowNull ? null : "authenticated";
  const normalized = String(value).trim().toLowerCase();
  if (!VALID_POSTING_POLICIES.has(normalized)) {
    throw createError("invalid_chat_channel");
  }
  return normalized;
}

function normalizeMessageStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!VALID_MESSAGE_STATUSES.has(normalized) || normalized === "active") {
    throw createError("invalid_chat_message");
  }
  return normalized;
}

function normalizeModerationAction(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!VALID_MODERATION_ACTIONS.has(normalized)) {
    throw createError("invalid_chat_moderation");
  }
  return normalized;
}

function normalizeReportStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!VALID_REPORT_STATUSES.has(normalized)) {
    throw createError("invalid_chat_report");
  }
  return normalized;
}

function parseDurationMinutes(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 60 * 24 * 365) {
    throw createError("invalid_chat_moderation");
  }
  return parsed;
}

function buildChannelMetadata(metadata) {
  return metadata && typeof metadata === "object" ? metadata : {};
}

function mapChannelRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    channel_key: buildChannelKey(row.scope_type, row.scope_key),
    scope_type: row.scope_type,
    scope_key: row.scope_key,
    display_name: row.display_name,
    description: row.description,
    is_active: Boolean(row.is_active),
    posting_policy: row.posting_policy,
    metadata: buildChannelMetadata(row.metadata),
    last_message_id: row.last_message_id ? Number(row.last_message_id) : null,
    last_message_at: row.last_message_at || null,
    last_message_preview: row.last_message_preview || null,
    message_count: Number(row.message_count || 0),
    last_read_message_id: row.last_read_message_id ? Number(row.last_read_message_id) : null,
    unread_count: Number(row.unread_count || 0),
    muted_until: row.muted_until || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMessageRow(row, viewerUserId = null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    channel_id: Number(row.channel_id),
    channel_key: buildChannelKey(row.scope_type, row.scope_key),
    body: row.body,
    status: row.status,
    reply_to_message_id: row.reply_to_message_id ? Number(row.reply_to_message_id) : null,
    created_at: row.created_at,
    edited_at: row.edited_at || null,
    moderated_at: row.moderated_at || null,
    author: row.author_id
      ? {
          id: Number(row.author_id),
          username: row.author_username,
          profile_picture_url: row.author_profile_picture_url || null,
          profile_color: row.author_profile_color || null,
          oshi_coin: row.author_oshi_coin_id
            ? {
                id: Number(row.author_oshi_coin_id),
                symbol: row.author_oshi_coin_symbol,
                display_name: row.author_oshi_coin_display_name,
                icon: row.author_oshi_coin_icon || null,
                color: row.author_oshi_coin_color || null,
              }
            : null,
        }
      : null,
    is_mine: viewerUserId ? Number(row.author_id) === Number(viewerUserId) : false,
  };
}

function profilePictureUrlSql(size, alias = "pp") {
  const field = size === "large" ? "filename_large" : "filename_small";
  const folder = size === "large" ? "large" : "small";
  return `CASE WHEN ${alias}.id IS NULL OR ${alias}.is_deleted THEN NULL ELSE '${PROFILE_PICTURE_CDN_BASE_URL}/${folder}/' || ${alias}.${field} END`;
}

function buildVisibleHistoryCutoff() {
  return new Date(Date.now() - CHAT_HISTORY_VISIBLE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

async function archiveMessagesOlderThan(pool, { channelId = null, cutoffIso = buildVisibleHistoryCutoff(), limit = CHAT_ARCHIVE_BATCH_SIZE } = {}) {
  const safeLimit = parseLimit(limit, CHAT_ARCHIVE_BATCH_SIZE, { min: 1, max: 5000 });
  const params = [cutoffIso];
  let channelClause = "";
  if (channelId !== null && channelId !== undefined) {
    params.push(Number(channelId));
    channelClause = ` AND m.channel_id = $${params.length}`;
  }
  params.push(safeLimit);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      WITH candidate_ids AS (
        SELECT m.id
        FROM chat.messages m
        WHERE m.created_at < $1::timestamptz
          ${channelClause}
        ORDER BY m.created_at ASC, m.id ASC
        LIMIT $${params.length}
      ),
      inserted AS (
        INSERT INTO chat.archived_messages (
          id,
          channel_id,
          author_id,
          body,
          status,
          reply_to_message_id,
          edited_at,
          moderated_by,
          moderated_reason,
          moderated_at,
          created_at,
          updated_at,
          archived_at
        )
        SELECT
          m.id,
          m.channel_id,
          m.author_id,
          m.body,
          m.status,
          m.reply_to_message_id,
          m.edited_at,
          m.moderated_by,
          m.moderated_reason,
          m.moderated_at,
          m.created_at,
          m.updated_at,
          now()
        FROM chat.messages m
        JOIN candidate_ids c
          ON c.id = m.id
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      )
      DELETE FROM chat.messages m
      USING inserted i
      WHERE m.id = i.id
      RETURNING m.id
    `,
      params
    );
    await client.query("COMMIT");
    return rows.length;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureCoreChannels(pool) {
  await pool.query(
    `
    INSERT INTO chat.channels (scope_type, scope_key, display_name, description, posting_policy, is_active, metadata, updated_at)
    VALUES
      ('market', 'global', 'Market Chat', 'Global market-wide live discussion.', 'authenticated', true, '{}'::jsonb, now()),
      ('meta', 'global', 'Meta Chat', 'Site-wide discussion about NASFAQ and community topics.', 'authenticated', true, '{}'::jsonb, now())
    ON CONFLICT (scope_type, scope_key)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      updated_at = now()
  `
  );
}

async function syncAssetChannels(pool) {
  await pool.query(
    `
    INSERT INTO chat.channels (scope_type, scope_key, display_name, description, posting_policy, is_active, metadata, updated_at)
    SELECT
      'asset' AS scope_type,
      a.id::text AS scope_key,
      CONCAT(a.symbol, ' Chat') AS display_name,
      CONCAT('Live chat for ', a.display_name, '.'),
      'authenticated' AS posting_policy,
      (a.status <> 'delisted') AS is_active,
      jsonb_build_object(
        'asset_id', a.id,
        'symbol', a.symbol,
        'display_name', a.display_name,
        'asset_status', a.status,
        'youtube_channel_id', a.youtube_channel_id,
        'channel_name', c.name_short,
        'unit', c.unit,
        'icon', c.icon,
        'color', c.color
      ) AS metadata,
      now()
    FROM market.market_assets a
    JOIN yt.youtube_channels c
      ON c.youtube_channel_id = a.youtube_channel_id
    ON CONFLICT (scope_type, scope_key)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      is_active = EXCLUDED.is_active,
      metadata = EXCLUDED.metadata,
      updated_at = now()
  `
  );
}

async function syncUnitChannels(pool) {
  await pool.query(
    `
    WITH units AS (
      SELECT
        lower(regexp_replace(btrim(c.unit), '\s+', ' ', 'g')) AS unit_key,
        min(btrim(c.unit)) AS unit_label,
        COUNT(*)::int AS asset_count
      FROM market.market_assets a
      JOIN yt.youtube_channels c
        ON c.youtube_channel_id = a.youtube_channel_id
      WHERE a.status <> 'delisted'
        AND c.unit IS NOT NULL
        AND btrim(c.unit) <> ''
      GROUP BY lower(regexp_replace(btrim(c.unit), '\s+', ' ', 'g'))
    )
    INSERT INTO chat.channels (scope_type, scope_key, display_name, description, posting_policy, is_active, metadata, updated_at)
    SELECT
      'unit' AS scope_type,
      u.unit_key AS scope_key,
      CONCAT(u.unit_label, ' Unit Chat') AS display_name,
      CONCAT('Live chat for the ', u.unit_label, ' unit.') AS description,
      'authenticated' AS posting_policy,
      true AS is_active,
      jsonb_build_object(
        'unit', u.unit_label,
        'asset_count', u.asset_count
      ) AS metadata,
      now()
    FROM units u
    ON CONFLICT (scope_type, scope_key)
    DO UPDATE SET
      display_name = EXCLUDED.display_name,
      description = EXCLUDED.description,
      is_active = true,
      metadata = EXCLUDED.metadata,
      updated_at = now()
  `
  );

  await pool.query(
    `
    UPDATE chat.channels c
    SET
      is_active = false,
      updated_at = now()
    WHERE c.scope_type = 'unit'
      AND NOT EXISTS (
        SELECT 1
        FROM market.market_assets a
        JOIN yt.youtube_channels yc
          ON yc.youtube_channel_id = a.youtube_channel_id
        WHERE a.status <> 'delisted'
          AND yc.unit IS NOT NULL
          AND btrim(yc.unit) <> ''
          AND lower(regexp_replace(btrim(yc.unit), '\s+', ' ', 'g')) = c.scope_key
      )
  `
  );
}

async function ensureChatTopology(pool) {
  await ensureCoreChannels(pool);
  await syncAssetChannels(pool);
  await syncUnitChannels(pool);
}

function buildChannelSelect(viewerUserId) {
  const viewerSelect = viewerUserId
    ? `
      LEFT JOIN chat.user_channel_state ucs
        ON ucs.channel_id = c.id
       AND ucs.user_id = $1
      LEFT JOIN LATERAL (
        SELECT uma.expires_at AS muted_until
        FROM chat.user_moderation_actions uma
        WHERE uma.user_id = $1
          AND uma.action_type = 'mute'
          AND uma.revoked_at IS NULL
          AND (uma.channel_id IS NULL OR uma.channel_id = c.id)
          AND (uma.expires_at IS NULL OR uma.expires_at > now())
        ORDER BY (uma.channel_id IS NULL) ASC, uma.created_at DESC
        LIMIT 1
      ) active_mute ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS unread_count
        FROM chat.messages unread
        WHERE unread.channel_id = c.id
          AND unread.status = 'active'
          AND (ucs.last_read_message_id IS NULL OR unread.id > ucs.last_read_message_id)
      ) unread_stats ON TRUE
    `
    : `
      LEFT JOIN LATERAL (
        SELECT NULL::bigint AS last_read_message_id
      ) ucs ON TRUE
      LEFT JOIN LATERAL (
        SELECT NULL::timestamptz AS muted_until
      ) active_mute ON TRUE
      LEFT JOIN LATERAL (
        SELECT 0::int AS unread_count
      ) unread_stats ON TRUE
    `;

  return `
    SELECT
      c.id,
      c.scope_type,
      c.scope_key,
      c.display_name,
      c.description,
      c.is_active,
      c.posting_policy,
      c.metadata,
      c.created_at,
      c.updated_at,
      latest_message.id AS last_message_id,
      latest_message.created_at AS last_message_at,
      latest_message.body AS last_message_preview,
      message_stats.message_count,
      ucs.last_read_message_id,
      unread_stats.unread_count,
      active_mute.muted_until
    FROM chat.channels c
    LEFT JOIN LATERAL (
      SELECT
        m.id,
        m.created_at,
        left(m.body, 140) AS body
      FROM (
        SELECT id, created_at, body, status
        FROM chat.messages
        WHERE channel_id = c.id
        UNION ALL
        SELECT id, created_at, body, status
        FROM chat.archived_messages
        WHERE channel_id = c.id
      ) m
      WHERE m.status = 'active'
      ORDER BY m.id DESC
      LIMIT 1
    ) latest_message ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(message_count), 0)::int AS message_count
      FROM (
        SELECT COUNT(*)::int AS message_count
        FROM chat.messages m
        WHERE m.channel_id = c.id
          AND m.status = 'active'
        UNION ALL
        SELECT COUNT(*)::int AS message_count
        FROM chat.archived_messages am
        WHERE am.channel_id = c.id
          AND am.status = 'active'
      ) counts
    ) message_stats ON TRUE
    ${viewerSelect}
  `;
}

async function listChannels(pool, { viewerUserId = null, scopeType = null, includeInactive = false } = {}) {
  const normalizedScopeType = scopeType ? normalizeScopeType(scopeType) : null;
  if (scopeType && !normalizedScopeType) {
    throw createError("invalid_chat_channel");
  }

  const params = [];
  if (viewerUserId) params.push(Number(viewerUserId));
  params.push(Boolean(includeInactive));
  const activeParamIndex = params.length;

  let where = `WHERE ($${activeParamIndex}::boolean IS TRUE OR c.is_active = true)`;
  if (normalizedScopeType) {
    params.push(normalizedScopeType);
    where += ` AND c.scope_type = $${params.length}`;
  }

  const orderBy = `
    ORDER BY
      CASE c.scope_type
        WHEN 'market' THEN 0
        WHEN 'meta' THEN 1
        WHEN 'unit' THEN 2
        WHEN 'asset' THEN 3
        ELSE 4
      END ASC,
      c.display_name ASC,
      c.id ASC
  `;

  const { rows } = await pool.query(
    `
    ${buildChannelSelect(viewerUserId)}
    ${where}
    ${orderBy}
  `,
    params
  );
  return rows.map(mapChannelRow);
}

async function getChannelByKey(pool, channelKey, { viewerUserId = null, includeInactive = false } = {}) {
  const parsed = parseChannelKey(channelKey);
  if (!parsed) {
    throw createError("invalid_chat_channel");
  }

  const params = [];
  if (viewerUserId) params.push(Number(viewerUserId));
  params.push(parsed.scopeType);
  params.push(parsed.scopeKey);
  params.push(Boolean(includeInactive));

  const viewerOffset = viewerUserId ? 1 : 0;
  const scopeTypeParam = viewerOffset + 1;
  const scopeKeyParam = viewerOffset + 2;
  const includeInactiveParam = viewerOffset + 3;

  const { rows } = await pool.query(
    `
    ${buildChannelSelect(viewerUserId)}
    WHERE c.scope_type = $${scopeTypeParam}
      AND c.scope_key = $${scopeKeyParam}
      AND ($${includeInactiveParam}::boolean IS TRUE OR c.is_active = true)
    LIMIT 1
  `,
    params
  );

  return mapChannelRow(rows[0] || null);
}

async function getChannelById(pool, channelId, { viewerUserId = null, includeInactive = false } = {}) {
  const safeChannelId = Number.parseInt(String(channelId), 10);
  if (!Number.isInteger(safeChannelId) || safeChannelId <= 0) {
    throw createError("invalid_chat_channel");
  }

  const params = [];
  if (viewerUserId) params.push(Number(viewerUserId));
  params.push(safeChannelId);
  params.push(Boolean(includeInactive));

  const idParam = (viewerUserId ? 1 : 0) + 1;
  const includeInactiveParam = (viewerUserId ? 1 : 0) + 2;

  const { rows } = await pool.query(
    `
    ${buildChannelSelect(viewerUserId)}
    WHERE c.id = $${idParam}
      AND ($${includeInactiveParam}::boolean IS TRUE OR c.is_active = true)
    LIMIT 1
  `,
    params
  );

  return mapChannelRow(rows[0] || null);
}

async function listMessages(pool, channelId, { viewerUserId = null, beforeMessageId = null, limit = 50 } = {}) {
  const safeChannelId = Number.parseInt(String(channelId), 10);
  if (!Number.isInteger(safeChannelId) || safeChannelId <= 0) {
    throw createError("invalid_chat_channel");
  }

  const isAdminViewer = Boolean(
    viewerUserId
      && (
        await pool.query(
          `
          SELECT is_admin
          FROM market.users
          WHERE id = $1
          LIMIT 1
        `,
          [Number(viewerUserId)]
        )
      ).rows[0]?.is_admin
  );
  const visibleCutoffIso = buildVisibleHistoryCutoff();
  await archiveMessagesOlderThan(pool, {
    channelId: safeChannelId,
    cutoffIso: visibleCutoffIso,
  });

  const safeLimit = parseLimit(limit, 50, { min: 1, max: 100 });
  const beforeId = beforeMessageId ? parseMessageId(beforeMessageId) : null;
  const params = [safeChannelId];
  let beforeClause = "";
  if (beforeId) {
    params.push(beforeId);
    beforeClause = ` AND m.id < $${params.length}`;
  }
  let visibilityClause = "";
  if (!isAdminViewer) {
    params.push(visibleCutoffIso);
    visibilityClause = ` AND m.created_at >= $${params.length}::timestamptz`;
  }
  params.push(safeLimit + 1);

  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.channel_id,
      m.author_id,
      m.body,
      m.status,
      m.reply_to_message_id,
      m.created_at,
      m.edited_at,
      m.moderated_at,
      c.scope_type,
      c.scope_key,
      u.username AS author_username,
      ${profilePictureUrlSql("small")} AS author_profile_picture_url,
      u.profile_color AS author_profile_color,
      ma.id AS author_oshi_coin_id,
      ma.symbol AS author_oshi_coin_symbol,
      ma.display_name AS author_oshi_coin_display_name,
      yc.icon AS author_oshi_coin_icon,
      yc.color AS author_oshi_coin_color
    FROM chat.messages m
    JOIN chat.channels c
      ON c.id = m.channel_id
    JOIN market.users u
      ON u.id = m.author_id
    LEFT JOIN market.market_assets ma
      ON ma.id = u.oshi_coin_asset_id
    LEFT JOIN yt.youtube_channels yc
      ON yc.youtube_channel_id = ma.youtube_channel_id
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE m.channel_id = $1
      AND m.status = 'active'
      ${beforeClause}
      ${visibilityClause}
    ORDER BY m.id DESC
    LIMIT $${params.length}
  `,
    params
  );

  const hasMore = rows.length > safeLimit;
  const slice = hasMore ? rows.slice(0, safeLimit) : rows;
  slice.reverse();

  return {
    items: slice.map((row) => mapMessageRow(row, viewerUserId)),
    has_more: hasMore,
    next_cursor: hasMore && slice.length ? String(slice[0].id) : null,
    history_limited: !isAdminViewer,
    visible_days: !isAdminViewer ? CHAT_HISTORY_VISIBLE_DAYS : null,
    oldest_visible_at: !isAdminViewer ? visibleCutoffIso : null,
  };
}

async function getMessageById(pool, messageId, { viewerUserId = null, includeInactiveChannel = true } = {}) {
  const safeMessageId = parseMessageId(messageId);
  const params = [safeMessageId, Boolean(includeInactiveChannel)];
  const { rows } = await pool.query(
    `
    SELECT
      m.id,
      m.channel_id,
      m.author_id,
      m.body,
      m.status,
      m.reply_to_message_id,
      m.created_at,
      m.edited_at,
      m.moderated_at,
      c.scope_type,
      c.scope_key,
      u.username AS author_username,
      ${profilePictureUrlSql("small")} AS author_profile_picture_url,
      u.profile_color AS author_profile_color,
      ma.id AS author_oshi_coin_id,
      ma.symbol AS author_oshi_coin_symbol,
      ma.display_name AS author_oshi_coin_display_name,
      yc.icon AS author_oshi_coin_icon,
      yc.color AS author_oshi_coin_color
    FROM chat.messages m
    JOIN chat.channels c
      ON c.id = m.channel_id
    JOIN market.users u
      ON u.id = m.author_id
    LEFT JOIN market.market_assets ma
      ON ma.id = u.oshi_coin_asset_id
    LEFT JOIN yt.youtube_channels yc
      ON yc.youtube_channel_id = ma.youtube_channel_id
    LEFT JOIN market.profile_pictures pp
      ON pp.id = u.profile_picture_id
    WHERE m.id = $1
      AND ($2::boolean IS TRUE OR c.is_active = true)
    LIMIT 1
  `,
    params
  );
  return mapMessageRow(rows[0] || null, viewerUserId);
}

async function getActiveModerationAction(pool, { userId, channelId = null }) {
  const params = [Number(userId)];
  let channelClause = "";
  if (channelId) {
    params.push(Number(channelId));
    channelClause = ` AND (uma.channel_id IS NULL OR uma.channel_id = $${params.length})`;
  }

  const { rows } = await pool.query(
    `
    SELECT
      uma.id,
      uma.action_type,
      uma.channel_id,
      uma.reason,
      uma.expires_at
    FROM chat.user_moderation_actions uma
    WHERE uma.user_id = $1
      ${channelClause}
      AND uma.revoked_at IS NULL
      AND (uma.expires_at IS NULL OR uma.expires_at > now())
    ORDER BY (uma.channel_id IS NULL) ASC, uma.created_at DESC
    LIMIT 1
  `,
    params
  );
  return rows[0] || null;
}

async function assertCanPost(pool, { channelId, viewer }) {
  const channel = await getChannelById(pool, channelId, { viewerUserId: viewer?.id || null, includeInactive: true });
  if (!channel || !channel.is_active) {
    throw createError("chat_channel_not_found");
  }
  if (!viewer?.id) {
    throw createError("unauthenticated");
  }
  if (channel.posting_policy === "read_only") {
    throw createError("chat_channel_locked");
  }
  if (channel.posting_policy === "admins_only" && !viewer.is_admin) {
    throw createError("forbidden");
  }

  const moderation = await getActiveModerationAction(pool, {
    userId: viewer.id,
    channelId: channel.id,
  });
  if (moderation) {
    throw createError(
      moderation.action_type === "ban" ? "chat_user_banned" : "chat_user_muted",
      { expires_at: moderation.expires_at || null }
    );
  }

  if (!viewer.is_admin) {
    const { rows } = await pool.query(
      `
      SELECT created_at
      FROM chat.messages
      WHERE author_id = $1
      ORDER BY id DESC
      LIMIT 1
    `,
      [viewer.id]
    );
    const lastCreatedAt = rows[0]?.created_at ? new Date(rows[0].created_at) : null;
    if (lastCreatedAt) {
      const deltaMs = Date.now() - lastCreatedAt.getTime();
      if (deltaMs < MESSAGE_RATE_LIMIT_MS) {
        throw createError("chat_rate_limited", {
          retry_after_ms: Math.max(1, MESSAGE_RATE_LIMIT_MS - deltaMs),
        });
      }
    }
  }

  return channel;
}

async function createMessage(pool, { channelId, viewer, body, replyToMessageId = null }) {
  const channel = await assertCanPost(pool, { channelId, viewer });
  const normalizedBody = normalizeMessageBody(body);
  const safeReplyToMessageId = replyToMessageId ? parseMessageId(replyToMessageId) : null;

  if (safeReplyToMessageId) {
    const { rows } = await pool.query(
      `
      SELECT id
      FROM chat.messages
      WHERE id = $1
        AND channel_id = $2
        AND status = 'active'
      LIMIT 1
    `,
      [safeReplyToMessageId, channel.id]
    );
    if (!rows[0]) {
      throw createError("invalid_chat_message");
    }
  }

  const { rows } = await pool.query(
    `
    INSERT INTO chat.messages (
      channel_id,
      author_id,
      body,
      status,
      reply_to_message_id,
      created_at,
      edited_at
    ) VALUES ($1,$2,$3,'active',$4,now(),NULL)
    RETURNING id
  `,
    [channel.id, viewer.id, normalizedBody, safeReplyToMessageId]
  );

  return {
    channel,
    message: await getMessageById(pool, rows[0].id, {
      viewerUserId: viewer.id,
      includeInactiveChannel: true,
    }),
  };
}

async function markChannelRead(pool, { channelId, userId, lastReadMessageId = null }) {
  const safeChannelId = Number.parseInt(String(channelId), 10);
  if (!Number.isInteger(safeChannelId) || safeChannelId <= 0) {
    throw createError("invalid_chat_channel");
  }

  let targetMessageId = lastReadMessageId ? parseMessageId(lastReadMessageId) : null;
  if (targetMessageId) {
    const { rows } = await pool.query(
      `
      SELECT id
      FROM chat.messages
      WHERE id = $1
        AND channel_id = $2
      LIMIT 1
    `,
      [targetMessageId, safeChannelId]
    );
    if (!rows[0]) {
      throw createError("invalid_chat_message");
    }
  } else {
    const { rows } = await pool.query(
      `
      SELECT id
      FROM chat.messages
      WHERE channel_id = $1
        AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `,
      [safeChannelId]
    );
    targetMessageId = rows[0]?.id ? Number(rows[0].id) : null;
  }

  await pool.query(
    `
    INSERT INTO chat.user_channel_state (user_id, channel_id, last_read_message_id, followed, updated_at)
    VALUES ($1,$2,$3,true,now())
    ON CONFLICT (user_id, channel_id)
    DO UPDATE SET
      last_read_message_id = CASE
        WHEN EXCLUDED.last_read_message_id IS NULL THEN chat.user_channel_state.last_read_message_id
        WHEN chat.user_channel_state.last_read_message_id IS NULL THEN EXCLUDED.last_read_message_id
        ELSE GREATEST(chat.user_channel_state.last_read_message_id, EXCLUDED.last_read_message_id)
      END,
      updated_at = now()
  `,
    [Number(userId), safeChannelId, targetMessageId]
  );

  return targetMessageId;
}

async function createMessageReport(pool, { messageId, reporterId, reason, details = null }) {
  const safeMessageId = parseMessageId(messageId);
  const normalizedReason = optionalTrimmedString(reason, { maxLength: 120, allowEmpty: false });
  const normalizedDetails = optionalTrimmedString(details, { maxLength: 1000, allowEmpty: false });
  if (!normalizedReason) {
    throw createError("invalid_chat_report");
  }

  const existingMessage = await getMessageById(pool, safeMessageId, { includeInactiveChannel: true });
  if (!existingMessage) {
    throw createError("chat_message_not_found");
  }

  const { rows } = await pool.query(
    `
    INSERT INTO chat.message_reports (
      message_id,
      reporter_id,
      reason,
      details,
      status,
      created_at,
      updated_at
    ) VALUES ($1,$2,$3,$4,'open',now(),now())
    ON CONFLICT (message_id, reporter_id)
    DO UPDATE SET
      reason = EXCLUDED.reason,
      details = EXCLUDED.details,
      status = 'open',
      updated_at = now()
    RETURNING id, status, created_at, updated_at
  `,
    [safeMessageId, Number(reporterId), normalizedReason, normalizedDetails]
  );

  return rows[0];
}

async function updateChannel(pool, channelId, { postingPolicy = null, isActive = null, description = null } = {}) {
  const safeChannelId = Number.parseInt(String(channelId), 10);
  if (!Number.isInteger(safeChannelId) || safeChannelId <= 0) {
    throw createError("invalid_chat_channel");
  }

  const updates = [];
  const params = [];
  if (postingPolicy !== null && postingPolicy !== undefined) {
    params.push(normalizePostingPolicy(postingPolicy));
    updates.push(`posting_policy = $${params.length}`);
  }
  if (isActive !== null && isActive !== undefined) {
    params.push(Boolean(isActive));
    updates.push(`is_active = $${params.length}`);
  }
  if (description !== null && description !== undefined) {
    params.push(optionalTrimmedString(description, { maxLength: 500, allowEmpty: true }));
    updates.push(`description = $${params.length}`);
  }
  if (!updates.length) {
    throw createError("invalid_chat_channel");
  }

  params.push(safeChannelId);
  const { rows } = await pool.query(
    `
    UPDATE chat.channels
    SET
      ${updates.join(", ")},
      updated_at = now()
    WHERE id = $${params.length}
    RETURNING id
  `,
    params
  );
  if (!rows[0]) {
    throw createError("chat_channel_not_found");
  }
  return getChannelById(pool, rows[0].id, { includeInactive: true });
}

async function moderateMessage(pool, { messageId, moderatorId, status, reason = null } = {}) {
  const safeMessageId = parseMessageId(messageId);
  const nextStatus = normalizeMessageStatus(status);
  const normalizedReason = optionalTrimmedString(reason, { maxLength: 500, allowEmpty: false });

  const { rows } = await pool.query(
    `
    UPDATE chat.messages
    SET
      status = $2,
      moderated_by = $3,
      moderated_reason = $4,
      moderated_at = now(),
      updated_at = now()
    WHERE id = $1
    RETURNING id
  `,
    [safeMessageId, nextStatus, Number(moderatorId), normalizedReason]
  );
  if (!rows[0]) {
    throw createError("chat_message_not_found");
  }
  return getMessageById(pool, rows[0].id, { includeInactiveChannel: true });
}

async function createModerationAction(
  pool,
  { targetUserId, moderatorId, channelId = null, actionType, reason = null, durationMinutes = null } = {}
) {
  const safeTargetUserId = Number.parseInt(String(targetUserId), 10);
  if (!Number.isInteger(safeTargetUserId) || safeTargetUserId <= 0) {
    throw createError("invalid_chat_moderation");
  }
  const safeChannelId =
    channelId === null || channelId === undefined || channelId === ""
      ? null
      : Number.parseInt(String(channelId), 10);
  if (safeChannelId !== null && (!Number.isInteger(safeChannelId) || safeChannelId <= 0)) {
    throw createError("invalid_chat_moderation");
  }

  const normalizedActionType = normalizeModerationAction(actionType);
  const normalizedReason = optionalTrimmedString(reason, { maxLength: 500, allowEmpty: false });
  const safeDurationMinutes = parseDurationMinutes(durationMinutes);
  const expiresAt =
    safeDurationMinutes === null ? null : new Date(Date.now() + safeDurationMinutes * 60 * 1000).toISOString();

  const targetUserResult = await pool.query(
    `
    SELECT id
    FROM market.users
    WHERE id = $1
    LIMIT 1
  `,
    [safeTargetUserId]
  );
  if (!targetUserResult.rows[0]) {
    throw createError("invalid_chat_moderation");
  }

  const { rows } = await pool.query(
    `
    INSERT INTO chat.user_moderation_actions (
      user_id,
      channel_id,
      action_type,
      reason,
      created_by,
      expires_at,
      created_at
    ) VALUES ($1,$2,$3,$4,$5,$6,now())
    RETURNING id, user_id, channel_id, action_type, reason, expires_at, created_at
  `,
    [safeTargetUserId, safeChannelId, normalizedActionType, normalizedReason, Number(moderatorId), expiresAt]
  );

  return rows[0];
}

async function updateReportStatus(pool, { reportId, status, reviewerId } = {}) {
  const safeReportId = Number.parseInt(String(reportId), 10);
  if (!Number.isInteger(safeReportId) || safeReportId <= 0) {
    throw createError("invalid_chat_report");
  }
  const normalizedStatus = normalizeReportStatus(status);
  const { rows } = await pool.query(
    `
    UPDATE chat.message_reports
    SET
      status = $2,
      reviewed_by = $3,
      reviewed_at = now(),
      updated_at = now()
    WHERE id = $1
    RETURNING id, status, reviewed_by, reviewed_at, updated_at
  `,
    [safeReportId, normalizedStatus, Number(reviewerId)]
  );
  if (!rows[0]) {
    throw createError("chat_report_not_found");
  }
  return rows[0];
}

module.exports = {
  archiveMessagesOlderThan,
  buildChannelKey,
  createMessage,
  createMessageReport,
  createModerationAction,
  ensureChatTopology,
  getChannelById,
  getChannelByKey,
  getMessageById,
  listChannels,
  listMessages,
  markChannelRead,
  moderateMessage,
  parseChannelKey,
  updateChannel,
  updateReportStatus,
};
