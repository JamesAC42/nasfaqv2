const express = require("express");

const chatDb = require("../chatDb");
const { logAction } = require("../services/moderation");
const notifications = require("../services/notifications");
const { requireAdmin, requireUserId, requireVerifiedUserId } = require("../userContext");

const { rateLimit, byUser } = require("../rateLimit");
const router = express.Router();

const CHAT_EVENTS_REDIS_CHANNEL = "nasfaq_chat:events";

async function publishChatEvent(redis, payload) {
  if (!redis) return;
  try {
    await redis.publish(CHAT_EVENTS_REDIS_CHANNEL, JSON.stringify(payload));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("chat event publish failed:", String(error?.message || error));
  }
}

async function ensureTopology(pool) {
  await chatDb.ensureChatTopologyRecent(pool);
}

async function usernameOf(pool, userId) {
  const { rows } = await pool.query(`SELECT username FROM market.users WHERE id = $1`, [Number(userId) || 0]);
  return rows[0]?.username ?? null;
}

router.get("/channels", async (req, res, next) => {
  try {
    await ensureTopology(req.ctx.pool);
    const channels = await chatDb.listChannels(req.ctx.pool, {
      viewerUserId: req.ctx.user?.id || null,
      scopeType: req.query.scope_type || null,
      includeInactive: Boolean(req.ctx.user?.is_admin) && req.query.include_inactive === "true",
    });
    res.json({ channels });
  } catch (error) {
    next(error);
  }
});

router.get("/channels/:channelKey", async (req, res, next) => {
  try {
    await ensureTopology(req.ctx.pool);
    const channel = await chatDb.getChannelByKey(req.ctx.pool, req.params.channelKey, {
      viewerUserId: req.ctx.user?.id || null,
      includeInactive: Boolean(req.ctx.user?.is_admin),
    });
    if (!channel) {
      return res.status(404).json({ error: "chat_channel_not_found" });
    }
    res.json({ channel });
  } catch (error) {
    next(error);
  }
});

router.get("/channels/:channelKey/messages", async (req, res, next) => {
  try {
    await ensureTopology(req.ctx.pool);
    const channel = await chatDb.getChannelByKey(req.ctx.pool, req.params.channelKey, {
      viewerUserId: req.ctx.user?.id || null,
      includeInactive: Boolean(req.ctx.user?.is_admin),
    });
    if (!channel) {
      return res.status(404).json({ error: "chat_channel_not_found" });
    }

    const messages = await chatDb.listMessages(req.ctx.pool, channel.id, {
      viewerUserId: req.ctx.user?.id || null,
      beforeMessageId: req.query.before || null,
      limit: req.query.limit,
    });

    res.json({
      channel,
      messages: messages.items,
      has_more: messages.has_more,
      next_cursor: messages.next_cursor,
      history_limited: messages.history_limited,
      visible_days: messages.visible_days,
      minimum_messages: messages.minimum_messages,
      oldest_visible_at: messages.oldest_visible_at,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/channels/:channelKey/messages", rateLimit(byUser("chat", 30, 60)), async (req, res, next) => {
  try {
    const viewer = req.ctx.user;
    requireVerifiedUserId(req);
    // One message in flight per person: the 3-second rule below reads the last message and then
    // inserts, so parallel posts could all pass it. This gate makes them take turns.
    if (req.ctx.redis) {
      const gate = await req.ctx.redis.set(`chat:posting:${viewer.id}`, "1", { NX: true, PX: 2500 }).catch(() => "OK");
      if (gate !== "OK") return res.status(429).json({ error: "chat_rate_limited", retry_after: 3 });
    }
    await ensureTopology(req.ctx.pool);

    const channel = await chatDb.getChannelByKey(req.ctx.pool, req.params.channelKey, {
      viewerUserId: viewer.id,
      includeInactive: true,
    });
    if (!channel) {
      return res.status(404).json({ error: "chat_channel_not_found" });
    }

    const created = await chatDb.createMessage(req.ctx.pool, {
      channelId: channel.id,
      viewer,
      body: req.body?.body,
      replyToMessageId: req.body?.reply_to_message_id,
    });

    await publishChatEvent(req.ctx.redis, {
      type: "chat.message.created",
      channel_key: created.channel.channel_key,
      message: created.message,
    });
    // @mentions and replies ring the bell.
    await notifications.notifyChatMessage(req.ctx.pool, { message: created.message, channel: created.channel, author: viewer }).catch(() => null);

    res.status(201).json({
      channel: created.channel,
      message: created.message,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/channels/:channelKey/read", async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await ensureTopology(req.ctx.pool);

    const channel = await chatDb.getChannelByKey(req.ctx.pool, req.params.channelKey, {
      viewerUserId: userId,
      includeInactive: Boolean(req.ctx.user?.is_admin),
    });
    if (!channel) {
      return res.status(404).json({ error: "chat_channel_not_found" });
    }

    const lastReadMessageId = await chatDb.markChannelRead(req.ctx.pool, {
      channelId: channel.id,
      userId,
      lastReadMessageId: req.body?.last_read_message_id,
    });
    // Read state is the reader's own business: nothing is broadcast to the room.

    res.json({
      channel_key: channel.channel_key,
      user_id: userId,
      last_read_message_id: lastReadMessageId,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/messages/:messageId/report", rateLimit(byUser("chat-report", 20, 3600)), async (req, res, next) => {
  try {
    const reporterId = requireUserId(req);
    const report = await chatDb.createMessageReport(req.ctx.pool, {
      messageId: req.params.messageId,
      reporterId,
      reason: req.body?.reason,
      details: req.body?.details,
    });
    res.status(201).json({ report });
  } catch (error) {
    next(error);
  }
});

router.post("/channels/:channelKey/policy", async (req, res, next) => {
  try {
    requireAdmin(req);
    await ensureTopology(req.ctx.pool);
    const channel = await chatDb.getChannelByKey(req.ctx.pool, req.params.channelKey, {
      viewerUserId: req.ctx.user?.id || null,
      includeInactive: true,
    });
    if (!channel) {
      return res.status(404).json({ error: "chat_channel_not_found" });
    }

    const updated = await chatDb.updateChannel(req.ctx.pool, channel.id, {
      postingPolicy: req.body?.posting_policy,
      isActive: req.body?.is_active,
      description: req.body?.description,
    });

    await publishChatEvent(req.ctx.redis, {
      type: "chat.channel.updated",
      channel_key: updated.channel_key,
      channel: updated,
    });
    await logAction(req.ctx.pool, {
      actor: req.ctx.user,
      action: "chat.channel.update",
      targetType: "chat_channel",
      targetId: updated.channel_key,
      targetLabel: updated.display_name,
      details: { posting_policy: updated.posting_policy, is_active: updated.is_active },
    });

    res.json({ channel: updated });
  } catch (error) {
    next(error);
  }
});

router.post("/messages/:messageId/moderate", async (req, res, next) => {
  try {
    const admin = requireAdmin(req);
    const message = await chatDb.moderateMessage(req.ctx.pool, {
      messageId: req.params.messageId,
      moderatorId: admin.id,
      status: req.body?.status,
      reason: req.body?.reason,
    });
    if (!message) {
      return res.status(404).json({ error: "chat_message_not_found" });
    }

    // The room hears that it's gone, not what it said.
    await publishChatEvent(req.ctx.redis, {
      type: "chat.message.updated",
      channel_key: message.channel_key,
      message: { ...message, body: "" },
    });
    // Removing it settles every open report on it.
    const reportsResolved = await chatDb.resolveReportsForMessage(req.ctx.pool, { messageId: message.id, reviewerId: admin.id });
    await logAction(req.ctx.pool, {
      actor: admin,
      action: "chat.message.remove",
      targetType: "chat_message",
      targetId: message.id,
      targetLabel: message.author?.username ?? null,
      reason: req.body?.reason,
      details: { channel_key: message.channel_key, status: message.status, excerpt: String(message.body || "").slice(0, 200), reports_resolved: reportsResolved },
    });

    res.json({ message, reports_resolved: reportsResolved });
  } catch (error) {
    next(error);
  }
});

router.post("/users/:userId/moderation", async (req, res, next) => {
  try {
    const admin = requireAdmin(req);
    await ensureTopology(req.ctx.pool);

    let channelId = null;
    let channelKey = null;
    if (req.body?.channel_key) {
      const channel = await chatDb.getChannelByKey(req.ctx.pool, req.body.channel_key, {
        viewerUserId: admin.id,
        includeInactive: true,
      });
      if (!channel) {
        return res.status(404).json({ error: "chat_channel_not_found" });
      }
      channelId = channel.id;
      channelKey = channel.channel_key;
    }

    const action = await chatDb.createModerationAction(req.ctx.pool, {
      targetUserId: req.params.userId,
      moderatorId: admin.id,
      channelId,
      actionType: req.body?.action_type,
      reason: req.body?.reason,
      durationMinutes: req.body?.duration_minutes,
    });

    await publishChatEvent(req.ctx.redis, {
      type: "chat.user.moderated",
      user_id: Number(req.params.userId),
      channel_key: channelKey,
      action,
    });
    await logAction(req.ctx.pool, {
      actor: admin,
      action: `chat.${action.action_type}`,
      targetType: "user",
      targetId: action.user_id,
      targetLabel: await usernameOf(req.ctx.pool, action.user_id),
      reason: action.reason,
      details: { channel_key: channelKey, expires_at: action.expires_at || null },
    });

    res.status(201).json({ action });
  } catch (error) {
    next(error);
  }
});

router.post("/reports/:reportId/status", async (req, res, next) => {
  try {
    const admin = requireAdmin(req);
    const report = await chatDb.updateReportStatus(req.ctx.pool, {
      reportId: req.params.reportId,
      status: req.body?.status,
      reviewerId: admin.id,
    });
    const { rows } = await req.ctx.pool.query(
      `SELECT r.message_id, u.username AS author_username
       FROM chat.message_reports r JOIN chat.messages m ON m.id = r.message_id JOIN market.users u ON u.id = m.author_id
       WHERE r.id = $1`,
      [report.id]
    );
    await logAction(req.ctx.pool, {
      actor: admin,
      action: report.status === "open" ? "chat.report.reopen" : `chat.report.${report.status === "dismissed" ? "dismiss" : "resolve"}`,
      targetType: "chat_report",
      targetId: report.id,
      targetLabel: rows[0]?.author_username ?? null,
      details: { message_id: rows[0]?.message_id ? Number(rows[0].message_id) : null },
    });
    res.json({ report });
  } catch (error) {
    next(error);
  }
});

// The report queue (/admin/moderation): ?status=open (default), resolved or dismissed.
router.get("/reports", async (req, res, next) => {
  try {
    requireAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json(await chatDb.listReports(req.ctx.pool, { status: req.query.status || "open", limit: req.query.limit }));
  } catch (error) {
    next(error);
  }
});

// Mutes and bans in force, newest first.
router.get("/moderation/active", async (req, res, next) => {
  try {
    requireAdmin(req);
    res.set("Cache-Control", "no-store");
    res.json({ actions: await chatDb.listActiveModerationActions(req.ctx.pool, { limit: req.query.limit }) });
  } catch (error) {
    next(error);
  }
});

// Lift a player's mutes (unmute) or bans (unban): everywhere, or in one room with { channel_key }.
for (const [path, actionType] of [["unmute", "mute"], ["unban", "ban"]]) {
  router.post(`/users/:userId/${path}`, async (req, res, next) => {
    try {
      const admin = requireAdmin(req);
      let channelId = null;
      let channelKey = null;
      if (req.body?.channel_key) {
        await ensureTopology(req.ctx.pool);
        const channel = await chatDb.getChannelByKey(req.ctx.pool, req.body.channel_key, { viewerUserId: admin.id, includeInactive: true });
        if (!channel) {
          return res.status(404).json({ error: "chat_channel_not_found" });
        }
        channelId = channel.id;
        channelKey = channel.channel_key;
      }
      const lifted = await chatDb.revokeModerationActions(req.ctx.pool, { targetUserId: req.params.userId, actionType, channelId });
      if (lifted.length) {
        await publishChatEvent(req.ctx.redis, { type: "chat.user.moderated", user_id: Number(req.params.userId), channel_key: channelKey, action: null });
        await logAction(req.ctx.pool, {
          actor: admin,
          action: `chat.${path}`,
          targetType: "user",
          targetId: Number(req.params.userId),
          targetLabel: await usernameOf(req.ctx.pool, req.params.userId),
          reason: req.body?.reason,
          details: { channel_key: channelKey, lifted: lifted.length },
        });
      }
      res.json({ lifted: lifted.length });
    } catch (error) {
      next(error);
    }
  });
}

router.post("/admin/archive", async (req, res, next) => {
  try {
    requireAdmin(req);
    await ensureTopology(req.ctx.pool);

    let channelId = null;
    if (req.body?.channel_key) {
      const channel = await chatDb.getChannelByKey(req.ctx.pool, req.body.channel_key, {
        viewerUserId: req.ctx.user?.id || null,
        includeInactive: true,
      });
      if (!channel) {
        return res.status(404).json({ error: "chat_channel_not_found" });
      }
      channelId = channel.id;
    }

    const archived_count = await chatDb.archiveMessagesOlderThan(req.ctx.pool, {
      channelId,
      cutoffIso: req.body?.cutoff_at || undefined,
      limit: req.body?.limit,
    });

    res.json({ archived_count });
  } catch (error) {
    next(error);
  }
});

module.exports = {
  CHAT_EVENTS_REDIS_CHANNEL,
  router,
};
