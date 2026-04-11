function slugify(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "article";
}

const MAX_SLUG_LENGTH = 80;
const ARTICLE_COMMENT_MOODS = new Set([
  "Bullish",
  "Bearish",
  "Neutral",
  "Hodling",
  "Dump Eet",
  "He Bought?",
  "He Sold?",
  "Diamond Hands",
  "Watching",
  "Accumulating",
]);

function buildNewsSlugBase(headline) {
  return slugify(headline || "news").slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "") || "news";
}

function normalizeString(value, { maxLength = null, allowEmpty = false } = {}) {
  const trimmed = String(value || "").trim();
  const limited = maxLength ? trimmed.slice(0, maxLength) : trimmed;
  if (!allowEmpty && !limited) return null;
  return limited;
}

function normalizeNullableString(value, { maxLength = null } = {}) {
  const normalized = normalizeString(value, { maxLength, allowEmpty: false });
  return normalized || null;
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const tags = [];
  for (const item of value) {
    const normalized = normalizeString(item, { maxLength: 40, allowEmpty: false });
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(normalized);
    if (tags.length >= 12) break;
  }
  return tags;
}

function normalizeAssetIds(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const ids = [];
  for (const item of value) {
    const nextId = Number(item);
    if (!Number.isInteger(nextId) || nextId <= 0 || seen.has(nextId)) continue;
    seen.add(nextId);
    ids.push(nextId);
    if (ids.length >= 16) break;
  }
  return ids;
}

function normalizeStatus(value) {
  return String(value || "").toLowerCase() === "draft" ? "draft" : "published";
}

function normalizeCommentMood(value) {
  const normalized = normalizeNullableString(value, { maxLength: 40 });
  if (!normalized) return null;
  return ARTICLE_COMMENT_MOODS.has(normalized) ? normalized : null;
}

function getPreview(content, subtitle) {
  if (subtitle) return subtitle;
  const normalized = String(content || "").replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, 240);
}

async function generateUniqueSlug(client, title, articleId = null) {
  const rawBase = slugify(title);
  const base = rawBase.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, "") || "article";
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
    const allowedBaseLength = Math.max(1, MAX_SLUG_LENGTH - suffix.length);
    const candidateBase = base.slice(0, allowedBaseLength).replace(/-+$/g, "") || "article";
    const candidate = `${candidateBase}${suffix}`;
    const { rows } = await client.query(
      `
      SELECT id
      FROM content.articles
      WHERE slug = $1
        AND ($2::bigint IS NULL OR id <> $2)
      LIMIT 1
    `,
      [candidate, articleId]
    );
    if (!rows[0]) return candidate;
  }
  return `${base}-${Date.now()}`;
}

async function ensureNewsArticle(client, newsId) {
  const safeNewsId = Number(newsId);
  if (!Number.isInteger(safeNewsId) || safeNewsId <= 0) {
    const error = new Error("invalid_news_id");
    error.code = "invalid_news_id";
    throw error;
  }

  const newsResult = await client.query(
    `
    SELECT id, headline, thumbnail_url, date::text AS published_at
    FROM info.member_news
    WHERE id = $1
    LIMIT 1
  `,
    [safeNewsId]
  );
  const newsItem = newsResult.rows[0] || null;
  if (!newsItem) {
    const error = new Error("article_not_found");
    error.code = "article_not_found";
    throw error;
  }

  const existingResult = await client.query(
    `
    SELECT id, slug
    FROM content.articles
    WHERE news_id = $1
    LIMIT 1
  `,
    [safeNewsId]
  );
  const existing = existingResult.rows[0] || null;
  const slug = await generateUniqueSlug(client, newsItem.headline, existing?.id || null);

  let articleId = null;
  if (existing) {
    const updateResult = await client.query(
      `
      UPDATE content.articles
      SET
        slug = $2,
        title = $3,
        thumbnail_url = $4,
        is_news = TRUE,
        status = 'published',
        published_at = ($5::date::timestamp AT TIME ZONE 'UTC'),
        updated_at = now()
      WHERE id = $1
      RETURNING id
    `,
      [existing.id, slug, newsItem.headline, newsItem.thumbnail_url, newsItem.published_at]
    );
    articleId = updateResult.rows[0]?.id || null;
  } else {
    const insertResult = await client.query(
      `
      INSERT INTO content.articles (
        slug,
        news_id,
        title,
        thumbnail_url,
        content,
        author_id,
        is_news,
        status,
        published_at,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,'',NULL,TRUE,'published',($5::date::timestamp AT TIME ZONE 'UTC'),now(),now())
      RETURNING id
    `,
      [slug, safeNewsId, newsItem.headline, newsItem.thumbnail_url, newsItem.published_at]
    );
    articleId = insertResult.rows[0]?.id || null;
  }

  if (!articleId) {
    const error = new Error("article_not_found");
    error.code = "article_not_found";
    throw error;
  }

  await client.query(`DELETE FROM content.article_assets WHERE article_id = $1`, [articleId]);
  await client.query(
    `
    INSERT INTO content.article_assets (article_id, asset_id)
    SELECT DISTINCT $1::bigint, ma.id
    FROM info.member_news_channels mnc
    JOIN market.market_assets ma
      ON ma.youtube_channel_id = mnc.youtube_channel_id
    WHERE mnc.news_id = $2::bigint
    ON CONFLICT DO NOTHING
  `,
    [articleId, safeNewsId]
  );

  return {
    id: articleId,
    slug,
  };
}

async function ensureNewsArticles(pool, newsIds) {
  const uniqueIds = Array.from(new Set((Array.isArray(newsIds) ? newsIds : []).map((item) => Number(item)).filter((item) => Number.isInteger(item) && item > 0)));
  const out = new Map();
  if (!uniqueIds.length) return out;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const newsId of uniqueIds) {
      const article = await ensureNewsArticle(client, newsId);
      out.set(newsId, article);
    }
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureNewsArticlesByHeadlines(pool, headlines) {
  const normalizedHeadlines = Array.from(
    new Set(
      (Array.isArray(headlines) ? headlines : [])
        .map((item) => normalizeString(item, { maxLength: 500, allowEmpty: false }))
        .filter(Boolean)
    )
  );
  const out = new Map();
  if (!normalizedHeadlines.length) return out;

  const newsResult = await pool.query(
    `
    SELECT DISTINCT ON (mn.headline)
      mn.id,
      mn.headline
    FROM info.member_news mn
    WHERE mn.headline = ANY($1::text[])
    ORDER BY mn.headline ASC, mn.date DESC, mn.id DESC
  `,
    [normalizedHeadlines]
  );

  const ensured = await ensureNewsArticles(
    pool,
    newsResult.rows.map((row) => row.id)
  );

  for (const row of newsResult.rows) {
    const article = ensured.get(Number(row.id)) || null;
    if (article) {
      out.set(String(row.headline), article);
    }
  }

  return out;
}

async function backfillAllNewsArticles(pool, { batchSize = 500 } = {}) {
  const safeBatchSize = Math.max(1, Math.min(5000, Number(batchSize) || 500));
  const idsResult = await pool.query(
    `
    SELECT id
    FROM info.member_news
    ORDER BY id ASC
  `
  );
  const ids = idsResult.rows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
  for (let index = 0; index < ids.length; index += safeBatchSize) {
    await ensureNewsArticles(pool, ids.slice(index, index + safeBatchSize));
  }
  return ids.length;
}

async function findNewsIdBySlugCandidate(client, slug) {
  const safeSlug = normalizeString(slug, { maxLength: 220, allowEmpty: false });
  if (!safeSlug) return null;
  const { rows } = await client.query(
    `
    SELECT id
    FROM info.member_news
    WHERE regexp_replace(
      regexp_replace(lower(headline), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    ) = $1
    ORDER BY date DESC, id DESC
    LIMIT 1
  `,
    [safeSlug]
  );
  return rows[0]?.id ?? null;
}

async function getArticleRowBySlug(client, slug, { includeDrafts = false } = {}) {
  const safeSlug = normalizeString(slug, { maxLength: 220, allowEmpty: false });
  if (!safeSlug) return null;

  const { rows } = await client.query(
    `
    SELECT
      a.id,
      a.slug,
      a.news_id,
      a.title,
      a.subtitle,
      a.tags,
      a.thumbnail_url,
      a.content,
      a.author_id,
      a.likes,
      a.saves,
      a.views,
      a.is_news,
      a.status,
      a.published_at,
      a.created_at,
      a.updated_at,
      n.headline AS news_headline,
      n.date::text AS news_date,
      u.username AS author_username,
      COALESCE(comment_counts.comment_count, 0)::int AS comment_count,
      COALESCE(asset_rel.assets, '[]'::json) AS related_assets
    FROM content.articles a
    LEFT JOIN info.member_news n
      ON n.id = a.news_id
    LEFT JOIN market.users u
      ON u.id = a.author_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS comment_count
      FROM content.article_comments ac
      WHERE ac.article_id = a.id
    ) comment_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(
        jsonb_build_object(
          'id', ma.id,
          'symbol', ma.symbol,
          'display_name', ma.display_name,
          'icon', yc.icon,
          'color', yc.color
        )
        ORDER BY ma.symbol ASC
      ) AS assets
      FROM content.article_assets aa
      JOIN market.market_assets ma
        ON ma.id = aa.asset_id
      LEFT JOIN yt.youtube_channels yc
        ON yc.youtube_channel_id = ma.youtube_channel_id
      WHERE aa.article_id = a.id
    ) asset_rel ON TRUE
    WHERE a.slug = $1
      AND ($2::boolean IS TRUE OR a.status = 'published')
    LIMIT 1
  `,
    [safeSlug, includeDrafts]
  );

  return rows[0] || null;
}

async function hydrateArticleDetail(client, articleRow, viewerUserId = null) {
  if (!articleRow) return null;

  const [commentsResult, proposalsResult, viewerStateResult] = await Promise.all([
    client.query(
      `
      SELECT
        c.id,
        c.body,
        c.mood,
        c.created_at,
        c.updated_at,
        jsonb_build_object(
          'id', u.id,
          'username', u.username
        ) AS author
      FROM content.article_comments c
      JOIN market.users u
        ON u.id = c.author_id
      WHERE c.article_id = $1
      ORDER BY c.created_at ASC, c.id ASC
    `,
      [articleRow.id]
    ),
    client.query(
      `
      SELECT
        p.id,
        p.title,
        p.subtitle,
        p.tags,
        p.thumbnail_url,
        p.content,
        p.status,
        p.created_at,
        p.updated_at,
        p.reviewed_at,
        jsonb_build_object(
          'id', author_user.id,
          'username', author_user.username
        ) AS author,
        CASE
          WHEN reviewer.id IS NULL THEN NULL
          ELSE jsonb_build_object(
            'id', reviewer.id,
            'username', reviewer.username
          )
        END AS reviewer,
        COALESCE(vote_counts.upvotes, 0)::int AS upvotes,
        COALESCE(vote_counts.downvotes, 0)::int AS downvotes,
        COALESCE(viewer_vote.value, 0)::int AS viewer_vote
      FROM content.news_article_proposals p
      JOIN market.users author_user
        ON author_user.id = p.author_id
      LEFT JOIN market.users reviewer
        ON reviewer.id = p.reviewed_by
      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE value = 1)::int AS upvotes,
          COUNT(*) FILTER (WHERE value = -1)::int AS downvotes
        FROM content.news_article_proposal_votes pv
        WHERE pv.proposal_id = p.id
      ) vote_counts ON TRUE
      LEFT JOIN LATERAL (
        SELECT pv.value
        FROM content.news_article_proposal_votes pv
        WHERE pv.proposal_id = p.id
          AND pv.user_id = $2
        LIMIT 1
      ) viewer_vote ON TRUE
      WHERE p.article_id = $1
      ORDER BY
        CASE p.status WHEN 'approved' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
        COALESCE(vote_counts.upvotes, 0) DESC,
        COALESCE(vote_counts.downvotes, 0) ASC,
        p.created_at DESC,
        p.id DESC
    `,
      [articleRow.id, viewerUserId]
    ),
    viewerUserId
      ? client.query(
        `
        SELECT
          EXISTS (
            SELECT 1
            FROM content.article_likes
            WHERE article_id = $1
              AND user_id = $2
          ) AS has_liked,
          EXISTS (
            SELECT 1
            FROM content.article_saves
            WHERE article_id = $1
              AND user_id = $2
          ) AS has_saved
      `,
        [articleRow.id, viewerUserId]
      )
      : Promise.resolve({ rows: [{ has_liked: false, has_saved: false }] }),
  ]);

  return {
    id: articleRow.id,
    slug: articleRow.slug,
    title: articleRow.title,
    subtitle: articleRow.subtitle,
    tags: Array.isArray(articleRow.tags) ? articleRow.tags : [],
    thumbnail_url: articleRow.thumbnail_url,
    content: articleRow.content,
    preview: getPreview(articleRow.content, articleRow.subtitle),
    author: articleRow.author_id
      ? {
          id: articleRow.author_id,
          username: articleRow.author_username,
        }
      : null,
    likes: Number(articleRow.likes || 0),
    saves: Number(articleRow.saves || 0),
    views: Number(articleRow.views || 0),
    is_news: Boolean(articleRow.is_news),
    status: articleRow.status,
    published_at: articleRow.published_at,
    created_at: articleRow.created_at,
    updated_at: articleRow.updated_at,
    comment_count: Number(articleRow.comment_count || 0),
    related_assets: Array.isArray(articleRow.related_assets) ? articleRow.related_assets : [],
    news_item: articleRow.news_id
      ? {
          id: articleRow.news_id,
          headline: articleRow.news_headline || articleRow.title,
          published_at: articleRow.news_date || null,
        }
      : null,
    viewer_has_liked: Boolean(viewerStateResult.rows[0]?.has_liked),
    viewer_has_saved: Boolean(viewerStateResult.rows[0]?.has_saved),
    comments: commentsResult.rows,
    proposals: proposalsResult.rows,
  };
}

async function listArticles(pool, {
  page = 1,
  limit = 12,
  assetSymbol = null,
  isNews = null,
  query = null,
  authorId = null,
  viewerUserId = null,
  includeDrafts = false,
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(48, Math.max(1, Number(limit) || 12));
  const offset = (safePage - 1) * safeLimit;
  const params = [
    normalizeNullableString(assetSymbol, { maxLength: 24 }),
    typeof isNews === "boolean" ? isNews : null,
    normalizeNullableString(query, { maxLength: 120 }),
    includeDrafts,
    Number.isInteger(Number(authorId)) && Number(authorId) > 0 ? Number(authorId) : null,
  ];

  const whereClause = `
    WHERE ($1::text IS NULL OR EXISTS (
      SELECT 1
      FROM content.article_assets aa
      JOIN market.market_assets ma
        ON ma.id = aa.asset_id
      WHERE aa.article_id = a.id
        AND lower(ma.symbol) = lower($1)
    ))
      AND ($2::boolean IS NULL OR a.is_news = $2)
      AND (
        $3::text IS NULL
        OR a.title ILIKE '%' || $3 || '%'
        OR COALESCE(a.subtitle, '') ILIKE '%' || $3 || '%'
        OR EXISTS (
          SELECT 1
          FROM unnest(a.tags) AS tag
          WHERE tag ILIKE '%' || $3 || '%'
        )
      )
      AND ($4::boolean IS TRUE OR a.status = 'published')
      AND ($5::bigint IS NULL OR a.author_id = $5)
  `;

  const countResult = await pool.query(
    `
    SELECT COUNT(*)::int AS total
    FROM content.articles a
    ${whereClause}
  `,
    params
  );

  const itemsResult = await pool.query(
    `
    SELECT
      a.id,
      a.slug,
      a.news_id,
      a.title,
      a.subtitle,
      a.tags,
      a.thumbnail_url,
      a.content,
      a.likes,
      a.saves,
      a.views,
      a.is_news,
      a.status,
      a.published_at,
      a.created_at,
      a.updated_at,
      a.author_id,
      n.headline AS news_headline,
      n.date::text AS news_date,
      u.username AS author_username,
      COALESCE(comment_counts.comment_count, 0)::int AS comment_count,
      COALESCE(asset_rel.assets, '[]'::json) AS related_assets
    FROM content.articles a
    LEFT JOIN info.member_news n
      ON n.id = a.news_id
    LEFT JOIN market.users u
      ON u.id = a.author_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS comment_count
      FROM content.article_comments ac
      WHERE ac.article_id = a.id
    ) comment_counts ON TRUE
    LEFT JOIN LATERAL (
      SELECT json_agg(
        jsonb_build_object(
          'id', ma.id,
          'symbol', ma.symbol,
          'display_name', ma.display_name,
          'icon', yc.icon,
          'color', yc.color
        )
        ORDER BY ma.symbol ASC
      ) AS assets
      FROM content.article_assets aa
      JOIN market.market_assets ma
        ON ma.id = aa.asset_id
      LEFT JOIN yt.youtube_channels yc
        ON yc.youtube_channel_id = ma.youtube_channel_id
      WHERE aa.article_id = a.id
    ) asset_rel ON TRUE
    ${whereClause}
    ORDER BY a.published_at DESC, a.id DESC
    LIMIT $6
    OFFSET $7
  `,
    [...params, safeLimit, offset]
  );

  const viewerIds = viewerUserId
    ? itemsResult.rows.map((row) => row.id)
    : [];
  let likedSet = new Set();
  let savedSet = new Set();
  if (viewerIds.length) {
    const [likedResult, savedResult] = await Promise.all([
      pool.query(
        `
        SELECT article_id
        FROM content.article_likes
        WHERE user_id = $1
          AND article_id = ANY($2::bigint[])
      `,
        [viewerUserId, viewerIds]
      ),
      pool.query(
        `
        SELECT article_id
        FROM content.article_saves
        WHERE user_id = $1
          AND article_id = ANY($2::bigint[])
      `,
        [viewerUserId, viewerIds]
      ),
    ]);
    likedSet = new Set(likedResult.rows.map((row) => Number(row.article_id)));
    savedSet = new Set(savedResult.rows.map((row) => Number(row.article_id)));
  }

  const items = itemsResult.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    tags: Array.isArray(row.tags) ? row.tags : [],
    thumbnail_url: row.thumbnail_url,
    preview: getPreview(row.content, row.subtitle),
    author: row.author_id ? { id: row.author_id, username: row.author_username } : null,
    likes: Number(row.likes || 0),
    saves: Number(row.saves || 0),
    views: Number(row.views || 0),
    is_news: Boolean(row.is_news),
    status: row.status,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    comment_count: Number(row.comment_count || 0),
    related_assets: Array.isArray(row.related_assets) ? row.related_assets : [],
    viewer_has_liked: likedSet.has(Number(row.id)),
    viewer_has_saved: savedSet.has(Number(row.id)),
    news_item: row.news_id
      ? {
          id: row.news_id,
          headline: row.news_headline || row.title,
          published_at: row.news_date || null,
        }
      : null,
  }));

  return {
    items,
    total: countResult.rows[0]?.total ?? 0,
    page: safePage,
    limit: safeLimit,
  };
}

async function incrementArticleViews(client, articleId) {
  const { rows } = await client.query(
    `
    UPDATE content.articles
    SET views = views + 1
    WHERE id = $1
    RETURNING views
  `,
    [articleId]
  );
  return rows[0]?.views ?? null;
}

async function getArticleBySlug(pool, slug, viewerUserId = null, includeDrafts = false, incrementViews = false) {
  const safeSlug = normalizeString(slug, { maxLength: 220, allowEmpty: false });
  if (!safeSlug) return null;

  const client = await pool.connect();
  try {
    let articleRow = await getArticleRowBySlug(client, safeSlug, { includeDrafts });
    if (!articleRow && /^news-\d+$/.test(safeSlug)) {
      const newsId = Number(safeSlug.slice(5));
      const article = await ensureNewsArticle(client, newsId);
      articleRow = await getArticleRowBySlug(client, article.slug, { includeDrafts: true });
    } else if (!articleRow) {
      const newsId = await findNewsIdBySlugCandidate(client, safeSlug);
      if (newsId) {
        const article = await ensureNewsArticle(client, newsId);
        articleRow = await getArticleRowBySlug(client, article.slug, { includeDrafts: true });
      }
    }
    if (!articleRow) return null;
    if (!includeDrafts && articleRow.status !== "published") return null;
    if (incrementViews) {
      const nextViews = await incrementArticleViews(client, articleRow.id);
      articleRow = {
        ...articleRow,
        views: nextViews ?? articleRow.views,
      };
    }
    return await hydrateArticleDetail(client, articleRow, viewerUserId);
  } finally {
    client.release();
  }
}

async function createArticle(pool, {
  title,
  subtitle,
  tags,
  thumbnailUrl,
  content,
  authorId,
  assetIds,
  status,
}) {
  const safeTitle = normalizeString(title, { maxLength: 180, allowEmpty: false });
  const safeContent = normalizeString(content, { maxLength: 50000, allowEmpty: false });
  if (!safeTitle || !safeContent) {
    const error = new Error("invalid_article");
    error.code = "invalid_article";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const slug = await generateUniqueSlug(client, safeTitle);
    const safeTags = normalizeTags(tags);
    const safeAssetIds = normalizeAssetIds(assetIds);
    const articleStatus = normalizeStatus(status);
    const { rows } = await client.query(
      `
      INSERT INTO content.articles (
        slug,
        title,
        subtitle,
        tags,
        thumbnail_url,
        content,
        author_id,
        is_news,
        status,
        published_at,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4::text[],$5,$6,$7,FALSE,$8,now(),now(),now())
      RETURNING id, slug
    `,
      [slug, safeTitle, normalizeNullableString(subtitle, { maxLength: 220 }), safeTags, normalizeNullableString(thumbnailUrl, { maxLength: 500 }), safeContent, authorId, articleStatus]
    );
    const articleId = rows[0].id;

    if (safeAssetIds.length) {
      await client.query(
        `
        INSERT INTO content.article_assets (article_id, asset_id)
        SELECT $1, ma.id
        FROM market.market_assets ma
        WHERE ma.id = ANY($2::bigint[])
        ON CONFLICT DO NOTHING
      `,
        [articleId, safeAssetIds]
      );
    }

    await client.query("COMMIT");
    return rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getArticleOwnership(pool, slug) {
  const { rows } = await pool.query(
    `
    SELECT id, slug, title, author_id, is_news, status
    FROM content.articles
    WHERE slug = $1
    LIMIT 1
  `,
    [slug]
  );
  return rows[0] || null;
}

async function updateArticle(pool, slug, {
  title,
  subtitle,
  tags,
  thumbnailUrl,
  content,
  assetIds,
  status,
}) {
  const safeTitle = normalizeString(title, { maxLength: 180, allowEmpty: false });
  const safeContent = normalizeString(content, { maxLength: 50000, allowEmpty: false });
  if (!safeTitle || !safeContent) {
    const error = new Error("invalid_article");
    error.code = "invalid_article";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await getArticleOwnership(client, slug);
    if (!existing) {
      const error = new Error("article_not_found");
      error.code = "article_not_found";
      throw error;
    }
    if (existing.is_news) {
      const error = new Error("cannot_edit_news_article");
      error.code = "cannot_edit_news_article";
      throw error;
    }

    const nextSlug = safeTitle === existing.title ? existing.slug : await generateUniqueSlug(client, safeTitle, existing.id);
    await client.query(
      `
      UPDATE content.articles
      SET
        slug = $2,
        title = $3,
        subtitle = $4,
        tags = $5::text[],
        thumbnail_url = $6,
        content = $7,
        status = $8,
        updated_at = now(),
        published_at = CASE
          WHEN $8 = 'published' THEN now()
          ELSE published_at
        END
      WHERE id = $1
    `,
      [
        existing.id,
        nextSlug,
        safeTitle,
        normalizeNullableString(subtitle, { maxLength: 220 }),
        normalizeTags(tags),
        normalizeNullableString(thumbnailUrl, { maxLength: 500 }),
        safeContent,
        normalizeStatus(status),
      ]
    );

    await client.query(`DELETE FROM content.article_assets WHERE article_id = $1`, [existing.id]);
    const safeAssetIds = normalizeAssetIds(assetIds);
    if (safeAssetIds.length) {
      await client.query(
        `
        INSERT INTO content.article_assets (article_id, asset_id)
        SELECT $1, ma.id
        FROM market.market_assets ma
        WHERE ma.id = ANY($2::bigint[])
        ON CONFLICT DO NOTHING
      `,
        [existing.id, safeAssetIds]
      );
    }

    await client.query("COMMIT");
    return nextSlug;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createComment(pool, slug, authorId, body, mood) {
  const safeBody = normalizeString(body, { maxLength: 4000, allowEmpty: false });
  const safeMood = normalizeCommentMood(mood);
  if (!safeBody || (mood != null && !safeMood)) {
    const error = new Error("invalid_comment");
    error.code = "invalid_comment";
    throw error;
  }
  const article = await getArticleOwnership(pool, slug);
  if (!article || article.status !== "published") {
    const error = new Error("article_not_found");
    error.code = "article_not_found";
    throw error;
  }
  await pool.query(
    `
    INSERT INTO content.article_comments (article_id, author_id, body, mood, created_at, updated_at)
    VALUES ($1,$2,$3,$4,now(),now())
  `,
    [article.id, authorId, safeBody, safeMood]
  );
}

async function toggleArticlePreference(pool, slug, userId, kind) {
  const article = await getArticleOwnership(pool, slug);
  if (!article || article.status !== "published") {
    const error = new Error("article_not_found");
    error.code = "article_not_found";
    throw error;
  }

  const tableName = kind === "save" ? "content.article_saves" : "content.article_likes";
  const counterColumn = kind === "save" ? "saves" : "likes";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existingResult = await client.query(
      `SELECT 1 AS exists FROM ${tableName} WHERE article_id = $1 AND user_id = $2 LIMIT 1`,
      [article.id, userId]
    );
    const exists = Boolean(existingResult.rows[0]);
    if (exists) {
      await client.query(
        `DELETE FROM ${tableName} WHERE article_id = $1 AND user_id = $2`,
        [article.id, userId]
      );
      await client.query(
        `UPDATE content.articles SET ${counterColumn} = GREATEST(${counterColumn} - 1, 0), updated_at = now() WHERE id = $1`,
        [article.id]
      );
    } else {
      await client.query(
        `INSERT INTO ${tableName} (article_id, user_id, created_at) VALUES ($1,$2,now()) ON CONFLICT DO NOTHING`,
        [article.id, userId]
      );
      await client.query(
        `UPDATE content.articles SET ${counterColumn} = ${counterColumn} + 1, updated_at = now() WHERE id = $1`,
        [article.id]
      );
    }
    await client.query("COMMIT");
    return !exists;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function createProposal(pool, slug, authorId, {
  title,
  subtitle,
  tags,
  thumbnailUrl,
  content,
}) {
  const safeContent = normalizeString(content, { maxLength: 20000, allowEmpty: false });
  if (!safeContent) {
    const error = new Error("invalid_proposal");
    error.code = "invalid_proposal";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const article = await getArticleOwnership(client, slug);
    if (!article) {
      const error = new Error("article_not_found");
      error.code = "article_not_found";
      throw error;
    }
    if (!article.is_news) {
      const error = new Error("proposal_not_allowed");
      error.code = "proposal_not_allowed";
      throw error;
    }

    await client.query(
      `
      INSERT INTO content.news_article_proposals (
        article_id,
        author_id,
        title,
        subtitle,
        tags,
        thumbnail_url,
        content,
        status,
        created_at,
        updated_at
      ) VALUES ($1,$2,$3,$4,$5::text[],$6,$7,'pending',now(),now())
    `,
      [
        article.id,
        authorId,
        normalizeNullableString(title, { maxLength: 180 }),
        normalizeNullableString(subtitle, { maxLength: 220 }),
        normalizeTags(tags),
        normalizeNullableString(thumbnailUrl, { maxLength: 500 }),
        safeContent,
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function approveProposal(pool, slug, proposalId, reviewerId) {
  const safeProposalId = Number(proposalId);
  if (!Number.isInteger(safeProposalId) || safeProposalId <= 0) {
    const error = new Error("invalid_proposal");
    error.code = "invalid_proposal";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const article = await getArticleOwnership(client, slug);
    if (!article) {
      const error = new Error("article_not_found");
      error.code = "article_not_found";
      throw error;
    }
    if (!article.is_news) {
      const error = new Error("proposal_not_allowed");
      error.code = "proposal_not_allowed";
      throw error;
    }

    const proposalResult = await client.query(
      `
      SELECT id, article_id, title, subtitle, tags, thumbnail_url, content
      FROM content.news_article_proposals
      WHERE id = $1
        AND article_id = $2
      LIMIT 1
    `,
      [safeProposalId, article.id]
    );
    const proposal = proposalResult.rows[0];
    if (!proposal) {
      const error = new Error("proposal_not_found");
      error.code = "proposal_not_found";
      throw error;
    }

    await client.query(
      `
      UPDATE content.news_article_proposals
      SET
        status = CASE WHEN id = $2 THEN 'approved' ELSE status END,
        reviewed_by = CASE WHEN id = $2 THEN $3 ELSE reviewed_by END,
        reviewed_at = CASE WHEN id = $2 THEN now() ELSE reviewed_at END,
        updated_at = now()
      WHERE article_id = $1
        AND status = 'approved'
    `,
      [article.id, safeProposalId, reviewerId]
    );

    await client.query(
      `
      UPDATE content.news_article_proposals
      SET
        status = 'approved',
        reviewed_by = $3,
        reviewed_at = now(),
        updated_at = now()
      WHERE article_id = $1
        AND id = $2
    `,
      [article.id, safeProposalId, reviewerId]
    );

    await client.query(
      `
      UPDATE content.articles
      SET
        title = COALESCE($2, title),
        subtitle = $3,
        tags = $4::text[],
        thumbnail_url = COALESCE($5, thumbnail_url),
        content = $6,
        updated_at = now()
      WHERE id = $1
    `,
      [article.id, proposal.title, proposal.subtitle, Array.isArray(proposal.tags) ? proposal.tags : [], proposal.thumbnail_url, proposal.content]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function setProposalVote(pool, slug, proposalId, userId, value) {
  const safeProposalId = Number(proposalId);
  const safeValue = Number(value);
  if (!Number.isInteger(safeProposalId) || safeProposalId <= 0) {
    const error = new Error("invalid_proposal");
    error.code = "invalid_proposal";
    throw error;
  }
  if (![1, 0, -1].includes(safeValue)) {
    const error = new Error("invalid_vote");
    error.code = "invalid_vote";
    throw error;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const article = await getArticleOwnership(client, slug);
    if (!article) {
      const error = new Error("article_not_found");
      error.code = "article_not_found";
      throw error;
    }
    if (!article.is_news) {
      const error = new Error("proposal_not_allowed");
      error.code = "proposal_not_allowed";
      throw error;
    }

    const proposalResult = await client.query(
      `
      SELECT id
      FROM content.news_article_proposals
      WHERE id = $1
        AND article_id = $2
      LIMIT 1
    `,
      [safeProposalId, article.id]
    );
    if (!proposalResult.rows[0]) {
      const error = new Error("proposal_not_found");
      error.code = "proposal_not_found";
      throw error;
    }

    if (safeValue === 0) {
      await client.query(
        `
        DELETE FROM content.news_article_proposal_votes
        WHERE proposal_id = $1
          AND user_id = $2
      `,
        [safeProposalId, userId]
      );
    } else {
      await client.query(
        `
        INSERT INTO content.news_article_proposal_votes (
          proposal_id,
          user_id,
          value,
          created_at,
          updated_at
        ) VALUES ($1,$2,$3,now(),now())
        ON CONFLICT (proposal_id, user_id) DO UPDATE
        SET
          value = EXCLUDED.value,
          updated_at = now()
      `,
        [safeProposalId, userId, safeValue]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  slugify,
  buildNewsSlugBase,
  ensureNewsArticle,
  ensureNewsArticles,
  ensureNewsArticlesByHeadlines,
  backfillAllNewsArticles,
  listArticles,
  getArticleBySlug,
  createArticle,
  updateArticle,
  getArticleOwnership,
  createComment,
  toggleArticlePreference,
  createProposal,
  approveProposal,
  setProposalVote,
};
