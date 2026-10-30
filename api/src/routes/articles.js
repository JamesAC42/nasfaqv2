const express = require("express");
const articleDb = require("../articleDb");
const { requireAdmin, requireUserId, requireVerifiedUserId } = require("../userContext");

const { rateLimit, byUser, clientIp, hit, voteLimit } = require("../rateLimit");
const router = express.Router();

// A view counts once per reader per article an hour, and at most 20 a minute per reader (the
// account, or the address when signed out). Past either, the article still loads; the count
// just doesn't move.
async function countsAsView(req, slug) {
  const reader = req.ctx.user ? `u${req.ctx.user.id}` : `ip${clientIp(req)}`;
  const redis = req.ctx.redis;
  if (!(await hit(redis, "article-view:reader", reader, { limit: 20, windowSeconds: 60 })).ok) return false;
  return (await hit(redis, "article-view:once", `${reader}:${slug}`, { limit: 1, windowSeconds: 3600 })).ok;
}

function paginationShape(result) {
  const pageCount = result.total > 0 ? Math.ceil(result.total / result.limit) : 1;
  return {
    total: result.total,
    page: result.page,
    limit: result.limit,
    page_count: pageCount,
    has_previous_page: result.page > 1,
    has_next_page: result.page < pageCount,
  };
}

router.get("/", async (req, res, next) => {
  try {
    const result = await articleDb.listArticles(req.ctx.pool, {
      page: req.query.page,
      limit: req.query.limit,
      assetSymbol: req.query.asset,
      isNews: req.query.type === "news" ? true : req.query.type === "community" ? false : null,
      query: req.query.q,
      viewerUserId: req.ctx.user?.id || null,
      includeDrafts: Boolean(req.ctx.user?.is_admin),
    });

    // Listed articles already exist: news articles are made when the headline arrives (the
    // HoloNews pipeline) and by the migration backfill. Re-syncing each one here made every page
    // view a write transaction (~6 statements per headline).
    res.json({
      items: result.items,
      pagination: paginationShape(result),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/", rateLimit(byUser("article", 5, 3600)), async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const created = await articleDb.createArticle(req.ctx.pool, {
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      tags: req.body?.tags,
      thumbnailUrl: req.body?.thumbnail_url,
      content: req.body?.content,
      authorId: userId,
      assetIds: req.body?.asset_ids,
      status: req.body?.status,
    });
    const article = await articleDb.getArticleBySlug(req.ctx.pool, created.slug, userId, true);
    res.status(201).json({ article });
  } catch (error) {
    next(error);
  }
});

router.get("/:slug", async (req, res, next) => {
  try {
    const article = await articleDb.getArticleBySlug(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user?.id || null,
      Boolean(req.ctx.user)
    );
    if (!article) {
      return res.status(404).json({ error: "article_not_found" });
    }
    if (article.status !== "published" && (!req.ctx.user || (!req.ctx.user.is_admin && req.ctx.user.id !== article.author?.id))) {
      return res.status(404).json({ error: "article_not_found" });
    }
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/view", async (req, res, next) => {
  try {
    const article = await articleDb.getArticleBySlug(
      req.ctx.pool,
      req.params.slug,
      req.ctx.user?.id || null,
      Boolean(req.ctx.user),
      await countsAsView(req, String(req.params.slug || ""))
    );
    if (!article) {
      return res.status(404).json({ error: "article_not_found" });
    }
    if (article.status !== "published" && (!req.ctx.user || (!req.ctx.user.is_admin && req.ctx.user.id !== article.author?.id))) {
      return res.status(404).json({ error: "article_not_found" });
    }
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.put("/:slug", async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const ownership = await articleDb.getArticleOwnership(req.ctx.pool, req.params.slug);
    if (!ownership) return res.status(404).json({ error: "article_not_found" });
    if (!req.ctx.user?.is_admin && ownership.author_id !== userId) {
      return res.status(403).json({ error: "forbidden" });
    }
    const nextSlug = await articleDb.updateArticle(req.ctx.pool, req.params.slug, {
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      tags: req.body?.tags,
      thumbnailUrl: req.body?.thumbnail_url,
      content: req.body?.content,
      assetIds: req.body?.asset_ids,
      status: req.body?.status,
    });
    const article = await articleDb.getArticleBySlug(req.ctx.pool, nextSlug, userId, true);
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.delete("/:slug", async (req, res, next) => {
  try {
    requireAdmin(req);
    await articleDb.deleteArticle(req.ctx.pool, req.params.slug);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete("/:slug/body", async (req, res, next) => {
  try {
    requireAdmin(req);
    await articleDb.deleteNewsArticleBody(req.ctx.pool, req.params.slug);
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, req.ctx.user?.id || null, true);
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/comments", rateLimit(byUser("article-comment", 10, 60)), async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    await articleDb.createComment(req.ctx.pool, req.params.slug, userId, req.body?.body, req.body?.mood);
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, userId, true);
    res.status(201).json({ article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/like", voteLimit, async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const active = await articleDb.toggleArticlePreference(req.ctx.pool, req.params.slug, userId, "like");
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, userId, true);
    res.json({ active, article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/save", voteLimit, async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    const active = await articleDb.toggleArticlePreference(req.ctx.pool, req.params.slug, userId, "save");
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, userId, true);
    res.json({ active, article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/comments/:commentId/vote", voteLimit, async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    await articleDb.setArticleCommentVote(req.ctx.pool, req.params.slug, req.params.commentId, userId, req.body?.value);
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, userId, true);
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/proposals", rateLimit(byUser("article-proposal", 20, 3600)), async (req, res, next) => {
  try {
    const userId = requireVerifiedUserId(req);
    await articleDb.createProposal(req.ctx.pool, req.params.slug, userId, {
      title: req.body?.title,
      subtitle: req.body?.subtitle,
      tags: req.body?.tags,
      thumbnailUrl: req.body?.thumbnail_url,
      content: req.body?.content,
    });
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, userId, true);
    res.status(201).json({ article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/proposals/:proposalId/approve", async (req, res, next) => {
  try {
    const admin = requireAdmin(req);
    await articleDb.approveProposal(req.ctx.pool, req.params.slug, req.params.proposalId, admin.id);
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, req.ctx.user?.id || null, true);
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

router.post("/:slug/proposals/:proposalId/vote", voteLimit, async (req, res, next) => {
  try {
    const userId = requireUserId(req);
    await articleDb.setProposalVote(req.ctx.pool, req.params.slug, req.params.proposalId, userId, req.body?.value);
    const article = await articleDb.getArticleBySlug(req.ctx.pool, req.params.slug, userId, true);
    res.json({ article });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
