const express = require("express");

const chatDb = require("../chatDb");
const { requireAdmin, requireUserId, requireVerifiedUserId } = require("../userContext");

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
  await chatDb.ensureChatTopology(pool);
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
      oldest_visible_at: messages.oldest_visible_at,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/channels/:channelKey/messages", async (req, res, next) => {
  try {
    const viewer = req.ctx.user;
    requireVerifiedUserId(req);
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

    await publishChatEvent(req.ctx.redis, {
      type: "chat.read_state.updated",
      channel_key: channel.channel_key,
      user_id: userId,
      last_read_message_id: lastReadMessageId,
    });

    res.json({
      channel_key: channel.channel_key,
      user_id: userId,
      last_read_message_id: lastReadMessageId,
    });
  } catch (error) {
    next(error);
  }
});

router.post("/messages/:messageId/report", async (req, res, next) => {
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

    await publishChatEvent(req.ctx.redis, {
      type: "chat.message.updated",
      channel_key: message.channel_key,
      message,
    });

    res.json({ message });
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
    res.json({ report });
  } catch (error) {
    next(error);
  }
});

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
