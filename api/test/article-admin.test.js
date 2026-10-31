const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Pool } = require("pg");

// The article tools an admin has on HoloNews stories: take a thumbnail off, and pin stories to the
// top of the home page. End to end on a freshly migrated database of its own, from the local or CI
// test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

const ERROR_STATUS = {
  unauthenticated: 401,
  forbidden: 403,
  article_not_found: 404,
  holonews_item_not_found: 404,
  invalid_front_page_pins: 400,
};

/** Enough Redis for the holonews items, the response cache and the admin log: an in-memory stand-in. */
function memoryRedis() {
  const strings = new Map();
  const lists = new Map();
  const redis = {
    strings,
    lists,
    async get(key) {
      return strings.has(key) ? strings.get(key) : null;
    },
    async set(key, value) {
      strings.set(key, String(value));
      return "OK";
    },
    async del(keys) {
      for (const key of [].concat(keys)) {
        strings.delete(key);
        lists.delete(key);
      }
    },
    async lRange(key) {
      return [...(lists.get(key) ?? [])];
    },
    multi() {
      const ops = [];
      const chain = {
        del: (key) => (ops.push(() => redis.del(key)), chain),
        rPush: (key, value) => (ops.push(() => lists.set(key, [...(lists.get(key) ?? []), value])), chain),
        set: (key, value) => (ops.push(() => strings.set(key, value)), chain),
        exec: async () => {
          for (const op of ops) await op();
        },
      };
      return chain;
    },
  };
  return redis;
}

test("article admin tools end to end", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_article_admin_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_article_admin_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_article_admin_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await pool.end();
  });
  const { applySchema } = require("../src/migrations");
  const auth = require("../src/services/auth");
  const articleDb = require("../src/articleDb");
  const adminHolonewsRoutes = require("../src/routes/adminHolonews");
  const newsRoutes = require("../src/routes/news");
  const quiet = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = quiet;
  }

  const addUser = async (username, { isAdmin = false } = {}) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, is_admin)
       VALUES ($1, lower($1), $1 || '@example.test', true, 'x', 'x', '{}', $2) RETURNING id`,
      [username, isAdmin]
    );
    return Number(rows[0].id);
  };
  const cookieFor = async (userId) => `nasfaq_session=${(await auth.createSession(pool, userId)).token}`;
  const boss = await cookieFor(await addUser("boss", { isAdmin: true }));
  const player = await cookieFor(await addUser("player"));

  // Three news stories (two with thumbnails) and a player article.
  const addNews = async (headline, thumbnailUrl) => {
    const { rows } = await pool.query(`INSERT INTO info.member_news (headline, thumbnail_url, date) VALUES ($1, $2, CURRENT_DATE) RETURNING id`, [headline, thumbnailUrl]);
    return Number(rows[0].id);
  };
  const tabletopId = await addNews("Shattered Legends is confirmed as a Tabletop RPG project", "https://images.nasfaq.biz/thumbnails/2026-10-31-090000-1-abc.png");
  const concertId = await addNews("Pekora announces a 3D concert", "https://images.nasfaq.biz/thumbnails/2026-10-31-090000-2-def.png");
  const quietId = await addNews("A quiet day on the wire", null);
  const ensured = await articleDb.ensureNewsArticles(pool, [tabletopId, concertId, quietId]);
  const slugOf = (newsId) => ensured.get(newsId).slug;
  await pool.query(
    `INSERT INTO content.articles (slug, title, subtitle, content, is_news, status, published_at) VALUES
       ('my-guide', 'My guide to trading', 'Buy low', 'Body', false, 'published', now() - interval '1 day'),
       ('my-draft', 'Not ready yet', NULL, '', false, 'draft', now())`
  );

  // The holonews scraper's Redis copy of today's stories, which the home page's lead stories come from.
  const redis = memoryRedis();
  redis.lists.set("nasfaq_holonews:items", [
    JSON.stringify({ headline: "Shattered Legends is confirmed as a Tabletop RPG project", rank: 1, thumbnail_s3_key: "thumbnails/2026-10-31-090000-1-abc.png" }),
    JSON.stringify({ headline: "Pekora announces a 3D concert", rank: 2, thumbnail_s3_key: "thumbnails/2026-10-31-090000-2-def.png" }),
  ]);
  redis.strings.set("nasfaq_holonews:meta", JSON.stringify({ thread_id: 1, source_post: 2, items: redis.lists.get("nasfaq_holonews:items").map((raw) => JSON.parse(raw)) }));

  const app = express();
  app.use(async (req, _res, next) => {
    try {
      req.ctx = { pool, redis, user: await auth.getAuthenticatedUser(pool, req) };
      next();
    } catch (error) {
      next(error);
    }
  });
  app.use(express.json());
  app.use("/api/admin/holonews", adminHolonewsRoutes);
  app.use("/api/news", newsRoutes);
  app.use((error, _req, res, _next) => {
    const status = ERROR_STATUS[error?.code];
    if (status) return res.status(status).json({ error: error.code });
    res.status(500).json({ error: String(error?.message || error) });
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    server.closeAllConnections();
    return new Promise((resolve) => server.close(resolve));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, cookie } = {}) => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const logged = async (action) => (await pool.query(`SELECT * FROM market.admin_actions WHERE action = $1 ORDER BY id`, [action])).rows;

  await t.test("remove thumbnail: admins only", async () => {
    assert.equal((await call("POST", "/api/admin/holonews/thumbnails/remove", { body: { article_slug: slugOf(tabletopId) } })).status, 403);
    assert.equal((await call("POST", "/api/admin/holonews/thumbnails/remove", { body: { article_slug: slugOf(tabletopId) }, cookie: player })).status, 403);
    assert.equal((await call("POST", "/api/admin/holonews/thumbnails/remove", { body: { article_slug: "no-such-story" }, cookie: boss })).status, 404);
  });

  await t.test("remove thumbnail: gone everywhere the site reads it, marked, and logged", async () => {
    const res = await call("POST", "/api/admin/holonews/thumbnails/remove", { body: { news_id: tabletopId, article_slug: slugOf(tabletopId) }, cookie: boss });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.news_item.thumbnail_url, null);
    assert.equal(res.body.previous_thumbnail_url, "https://images.nasfaq.biz/thumbnails/2026-10-31-090000-1-abc.png");
    assert.equal(res.body.redis_updated, true);

    const { rows } = await pool.query(
      `SELECT mn.thumbnail_url, mn.thumbnail_removed_at, a.thumbnail_url AS article_thumbnail_url
       FROM info.member_news mn JOIN content.articles a ON a.news_id = mn.id WHERE mn.id = $1`,
      [tabletopId]
    );
    assert.equal(rows[0].thumbnail_url, null);
    assert.equal(rows[0].article_thumbnail_url, null);
    assert.ok(rows[0].thumbnail_removed_at, "marked so holonews doesn't draw a new one");

    // The scraper's copy: this story's key is cleared, the other story's is untouched.
    const items = (await redis.lRange("nasfaq_holonews:items")).map((raw) => JSON.parse(raw));
    assert.equal(items[0].thumbnail_s3_key, null);
    assert.equal(items[1].thumbnail_s3_key, "thumbnails/2026-10-31-090000-2-def.png");
    const meta = JSON.parse(await redis.get("nasfaq_holonews:meta"));
    assert.equal(meta.items[0].thumbnail_s3_key, null);

    // An article lookup (which re-syncs the article from the story) doesn't bring it back.
    await articleDb.ensureNewsArticles(pool, [tabletopId]);
    const article = await articleDb.getArticleBySlug(pool, slugOf(tabletopId));
    assert.equal(article.thumbnail_url, null);

    const [entry] = await logged("news.thumbnail.remove");
    assert.equal(entry.target_type, "news_article");
    assert.equal(entry.target_label, "Shattered Legends is confirmed as a Tabletop RPG project");
    assert.equal(entry.details.thumbnail_url, "https://images.nasfaq.biz/thumbnails/2026-10-31-090000-1-abc.png");
  });

  await t.test("pins: admins only, at most six, real articles", async () => {
    assert.equal((await call("GET", "/api/admin/holonews/front-page", { cookie: player })).status, 403);
    assert.equal((await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: ["my-guide"] }, cookie: player })).status, 403);
    assert.equal((await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: "my-guide" }, cookie: boss })).status, 400);
    assert.equal((await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: ["a", "b", "c", "d", "e", "f", "g"] }, cookie: boss })).status, 400);
    assert.equal((await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: ["my-guide", "no-such-article"] }, cookie: boss })).status, 404);
    assert.deepEqual((await call("GET", "/api/admin/holonews/front-page", { cookie: boss })).body.pins, [], "a failed save pins nothing");
    assert.deepEqual((await call("GET", "/api/news/front-page")).body.items, []);
  });

  await t.test("pins lead in the admin's order, and the home page feed shows published ones", async () => {
    // A news story by its fallback slug (news-<id>), a player article, and a draft.
    const res = await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: [`news-${quietId}`, "my-guide", "my-draft"] }, cookie: boss });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.limit, 6);
    assert.deepEqual(res.body.pins.map((pin) => [pin.article_slug, pin.position, pin.status, pin.pinned_by]), [
      [slugOf(quietId), 1, "published", "boss"],
      ["my-guide", 2, "published", "boss"],
      ["my-draft", 3, "draft", "boss"],
    ]);

    const feed = await call("GET", "/api/news/front-page");
    assert.equal(feed.status, 200);
    assert.deepEqual(
      feed.body.items.map((item) => [item.headline, item.article_slug, item.source, item.summary]),
      [
        ["A quiet day on the wire", slugOf(quietId), "HoloNews", null],
        ["My guide to trading", "my-guide", "Player article", "Buy low"],
      ]
    );
    // Nothing about who pinned what reaches players.
    assert.equal(feed.body.items[0].pinned_by, undefined);
    assert.equal(feed.body.items[0].status, undefined);

    const [entry] = await logged("news.front_page.pins");
    assert.deepEqual(entry.details.after, [slugOf(quietId), "my-guide", "my-draft"]);
  });

  await t.test("reorder and unpin; the feed updates straight away", async () => {
    const pinnedAt = (await articleDb.listFrontPagePins(pool)).find((pin) => pin.article_slug === "my-guide").pinned_at;
    let res = await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: ["my-guide", slugOf(concertId)] }, cookie: boss });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.pins.map((pin) => pin.article_slug), ["my-guide", slugOf(concertId)]);
    assert.equal(res.body.pins[0].pinned_at.toString(), pinnedAt.toISOString(), "still pinned since the first time");
    assert.deepEqual((await call("GET", "/api/news/front-page")).body.items.map((item) => item.article_slug), ["my-guide", slugOf(concertId)]);

    // Saving the same order again logs nothing new.
    await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: ["my-guide", slugOf(concertId)] }, cookie: boss });
    assert.equal((await logged("news.front_page.pins")).length, 2);

    res = await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: [] }, cookie: boss });
    assert.deepEqual(res.body.pins, []);
    assert.deepEqual((await call("GET", "/api/news/front-page")).body.items, []);
  });

  await t.test("a deleted story drops out of the pins", async () => {
    await call("PUT", "/api/admin/holonews/front-page", { body: { slugs: [slugOf(concertId), "my-guide"] }, cookie: boss });
    await articleDb.deleteNewsArticle(pool, slugOf(concertId));
    assert.deepEqual((await articleDb.listFrontPagePins(pool)).map((pin) => [pin.article_slug, pin.position]), [["my-guide", 2]]);
  });
});
