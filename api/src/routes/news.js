const express = require("express");
const db = require("../db");
const { sendCachedJson } = require("../responseCache");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    // Browsing (no search) is the same for everyone: cached for 30s per page/sort/unit/limit.
    // Searches go straight to the database.
    const searching = Boolean(req.query.q || req.query.channel || req.query.stock);
    if (!searching) {
      const key = ["news", String(req.query.unit || "").slice(0, 40), String(req.query.sort || "").slice(0, 20), Number.parseInt(req.query.page, 10) || 1, Number.parseInt(req.query.limit, 10) || 0].join(":");
      await sendCachedJson(req, res, key, { ttlSeconds: 30, memoMs: 5000, load: () => loadNews(req) });
      return;
    }
    res.json(await loadNews(req));
  } catch (e) {
    next(e);
  }
});

async function loadNews(req) {
  const result = await db.listNewsFeed(req.ctx.pool, {
    headlineQuery: req.query.q,
    channelQuery: req.query.channel,
    stockQuery: req.query.stock,
    unit: req.query.unit,
    sort: req.query.sort,
    page: req.query.page,
    limit: req.query.limit,
  });

  const items = result.items.map((item) => {
    return {
      ...item,
      article_id: item.article_id ?? null,
      article_slug: item.article_slug ?? `news-${item.id}`,
      is_news: true,
      view_count: item.view_count ?? 0,
      like_count: item.like_count ?? 0,
      save_count: item.save_count ?? 0,
      comment_count: item.comment_count ?? 0,
    };
  });

  const pageCount = result.total > 0 ? Math.ceil(result.total / result.limit) : 1;

  return {
    items,
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
      page_count: pageCount,
      has_previous_page: result.page > 1,
      has_next_page: result.page < pageCount,
    },
    filters: {
      q: req.query.q ? String(req.query.q) : "",
      channel: req.query.channel ? String(req.query.channel) : "",
      stock: req.query.stock ? String(req.query.stock) : "",
      unit: req.query.unit ? String(req.query.unit) : "",
      sort: result.sort,
    },
  };
}

module.exports = router;
