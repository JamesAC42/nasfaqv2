// Chat popups: which rooms a player hears about, and which players they've muted. Delivery itself
// is the browser's job: it subscribes to these rooms on the chat socket and bunches what comes in
// (app-client/app/stores/chat-notify-store.ts). Nothing here writes to the bell's inbox, which a busy
// room would flush in a day.
//
// A player hears about a room they chose, or one they've posted in lately, unless they turned that
// room off. Turning a room off sticks: posting there again doesn't turn it back on.

// A room you posted in stays on your list this long after your last message there.
const POSTED_WINDOW_DAYS = 30;
// Unread counts stop here. The badge says 99+ anyway, and counting a whole room is wasted work.
const UNREAD_CAP = 100;

function createError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function mapRoom(row) {
  return {
    channel_key: `${row.scope_type}:${row.scope_key}`,
    scope_type: row.scope_type,
    display_name: row.display_name,
    metadata: row.metadata && typeof row.metadata === "object" ? row.metadata : {},
    notify: row.notify,
    posted: Boolean(row.posted),
    unread: Number(row.unread || 0),
  };
}

/**
 * Everything the browser needs: the overall switch, the rooms the player has a say on, and who
 * they've muted. A room is on when `notify` is true, or `notify` is null and they've posted there.
 * Cheap enough to load with every signed-in page: it reads this player's rows only.
 */
async function getSettings(pool, userId) {
  const safeUserId = Number(userId);
  const [settings, rooms, muted] = await Promise.all([
    pool.query(`SELECT enabled FROM chat.user_notify_settings WHERE user_id = $1`, [safeUserId]),
    pool.query(
      `
      WITH posted AS (
        SELECT DISTINCT channel_id
        FROM chat.messages
        WHERE author_id = $1 AND created_at > now() - make_interval(days => $2)
      ),
      rooms AS (
        SELECT COALESCE(chosen.channel_id, posted.channel_id) AS channel_id, chosen.notify, chosen.since_message_id, posted.channel_id IS NOT NULL AS posted
        FROM (SELECT channel_id, notify, since_message_id FROM chat.user_notify_rooms WHERE user_id = $1) chosen
        FULL JOIN posted ON posted.channel_id = chosen.channel_id
      )
      SELECT c.scope_type, c.scope_key, c.display_name, c.metadata, r.notify, r.posted,
        CASE WHEN COALESCE(r.notify, r.posted) THEN (
          SELECT count(*)::int
          FROM (
            SELECT 1
            FROM chat.messages m
            WHERE m.channel_id = c.id
              AND m.status = 'active'
              AND m.author_id <> $1
              AND m.id > GREATEST(COALESCE(ucs.last_read_message_id, 0), COALESCE(r.since_message_id, 0))
              AND NOT EXISTS (SELECT 1 FROM chat.user_mutes um WHERE um.user_id = $1 AND um.muted_user_id = m.author_id)
            ORDER BY m.id DESC
            LIMIT $3
          ) capped
        ) ELSE 0 END AS unread
      FROM rooms r
      -- Only rooms the chat page and the floating window can open. Not the meta room, and not a game
      -- table's room, whose talk is for whoever is sitting there.
      JOIN chat.channels c ON c.id = r.channel_id AND c.is_active = true AND c.scope_type IN ('market', 'unit', 'asset')
      LEFT JOIN chat.user_channel_state ucs ON ucs.user_id = $1 AND ucs.channel_id = c.id
      ORDER BY c.scope_type, c.display_name
    `,
      [safeUserId, POSTED_WINDOW_DAYS, UNREAD_CAP]
    ),
    pool.query(
      `
      SELECT u.id, u.username
      FROM chat.user_mutes um
      JOIN market.users u ON u.id = um.muted_user_id
      WHERE um.user_id = $1
      ORDER BY u.username_normalized
    `,
      [safeUserId]
    ),
  ]);
  return {
    enabled: settings.rows[0]?.enabled ?? true,
    rooms: rooms.rows.map(mapRoom),
    muted_players: muted.rows.map((row) => ({ id: Number(row.id), username: row.username })),
  };
}

async function setEnabled(pool, userId, enabled) {
  if (typeof enabled !== "boolean") throw createError("invalid_chat_notify");
  await pool.query(
    `
    INSERT INTO chat.user_notify_settings (user_id, enabled)
    VALUES ($1, $2)
    ON CONFLICT (user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()
  `,
    [Number(userId), enabled]
  );
}

/** One room: true (hear about it), false (don't, even if you post there), null (back to the default). */
async function setRoom(pool, userId, channelId, notify) {
  if (notify !== true && notify !== false && notify !== null) throw createError("invalid_chat_notify");
  if (notify === null) {
    await pool.query(`DELETE FROM chat.user_notify_rooms WHERE user_id = $1 AND channel_id = $2`, [Number(userId), Number(channelId)]);
    return;
  }
  await pool.query(
    `
    INSERT INTO chat.user_notify_rooms (user_id, channel_id, notify, since_message_id)
    VALUES ($1, $2, $3, (SELECT max(id) FROM chat.messages WHERE channel_id = $2))
    ON CONFLICT (user_id, channel_id) DO UPDATE
    SET notify = EXCLUDED.notify,
        -- Unread starts over only when a room goes from off to on.
        since_message_id = CASE WHEN EXCLUDED.notify AND NOT chat.user_notify_rooms.notify THEN EXCLUDED.since_message_id ELSE chat.user_notify_rooms.since_message_id END,
        updated_at = now()
  `,
    [Number(userId), Number(channelId), notify]
  );
}

async function mutePlayer(pool, userId, mutedUserId) {
  const target = Number.parseInt(String(mutedUserId), 10);
  if (!Number.isInteger(target) || target <= 0 || target === Number(userId)) throw createError("invalid_chat_notify");
  const { rows } = await pool.query(`SELECT 1 FROM market.users WHERE id = $1`, [target]);
  if (!rows[0]) throw createError("chat_player_not_found");
  await pool.query(`INSERT INTO chat.user_mutes (user_id, muted_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [Number(userId), target]);
}

async function unmutePlayer(pool, userId, mutedUserId) {
  const target = Number.parseInt(String(mutedUserId), 10);
  if (!Number.isInteger(target) || target <= 0) throw createError("invalid_chat_notify");
  await pool.query(`DELETE FROM chat.user_mutes WHERE user_id = $1 AND muted_user_id = $2`, [Number(userId), target]);
}

/** Which of these players have muted the author, so their @mentions and replies don't ring the bell. */
async function playersWhoMuted(pool, authorId, userIds) {
  const ids = [...new Set((userIds || []).map(Number))].filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return new Set();
  const { rows } = await pool.query(`SELECT user_id FROM chat.user_mutes WHERE muted_user_id = $1 AND user_id = ANY($2::bigint[])`, [Number(authorId), ids]);
  return new Set(rows.map((row) => Number(row.user_id)));
}

module.exports = { POSTED_WINDOW_DAYS, UNREAD_CAP, getSettings, mutePlayer, playersWhoMuted, setEnabled, setRoom, unmutePlayer };
