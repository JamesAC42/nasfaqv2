const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const chatDb = require("../src/chatDb");

const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;
test("chat retention against PostgreSQL", { skip: !databaseUrl }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  assert.equal(target.username, "nasfaq_test");
  const pool = new Pool({ connectionString: databaseUrl });
  t.after(() => pool.end());
  await pool.query(`
    CREATE SCHEMA IF NOT EXISTS chat;
    CREATE SCHEMA IF NOT EXISTS market;
    CREATE SCHEMA IF NOT EXISTS yt;
    CREATE TABLE IF NOT EXISTS market.users (
      id bigint PRIMARY KEY, username text, is_admin boolean DEFAULT false,
      profile_color text, oshi_coin_asset_id bigint, profile_picture_id bigint
    );
    CREATE TABLE IF NOT EXISTS market.market_assets (
      id bigint PRIMARY KEY, symbol text, display_name text, youtube_channel_id text
    );
    CREATE TABLE IF NOT EXISTS market.profile_pictures (
      id bigint PRIMARY KEY, is_deleted boolean, filename_small text
    );
    CREATE TABLE IF NOT EXISTS yt.youtube_channels (
      youtube_channel_id text PRIMARY KEY, icon text, color text
    );
    INSERT INTO market.users (id, username, is_admin) VALUES (1, 'reader', false), (2, 'admin', true)
      ON CONFLICT (id) DO NOTHING;
  `);
  // Use the application's actual chat table definitions, including foreign keys.
  const migrations = fs.readFileSync(path.join(__dirname, "../src/migrations.js"), "utf8");
  for (const match of migrations.matchAll(/await pool\.query\(`([\s\S]*?)`\);/g)) {
    if (/CREATE TABLE IF NOT EXISTS chat\./.test(match[1])) await pool.query(match[1]);
  }
  async function reset() {
    await pool.query("TRUNCATE chat.channels CASCADE");
    await pool.query(`INSERT INTO chat.channels
      (id, scope_type, scope_key, display_name, posting_policy)
      VALUES (1, 'market', 'global', 'Market Chat', 'authenticated'),
      (2, 'asset', '2', 'Quiet Chat', 'authenticated')`);
  }
  async function seed(count, { archived = false, start = 1, days = 60, channel = 1, status = "active" } = {}) {
    const table = archived ? "chat.archived_messages" : "chat.messages";
    await pool.query(`INSERT INTO ${table}
      (id, channel_id, author_id, body, status, created_at, updated_at)
      SELECT n, $1, 1, 'fixture-' || n, $2, now() - $3 * interval '1 day', now()
      FROM generate_series($4::int, $5::int) n`, [channel, status, days, start, start + count - 1]);
  }
  const ids = (page) => page.items.map((m) => m.id);
  await t.test("quiet room preserves old messages and preview remains loadable", async () => {
    await reset(); await seed(20);
    const page = await chatDb.listMessages(pool, 1);
    assert.equal(page.items.length, 20);
    assert.equal(page.minimum_messages, 100);
    assert.equal(page.has_more, false);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM chat.archived_messages")).rows[0].n, 0);
    const channel = await chatDb.getChannelByKey(pool, "market:global");
    assert.equal(channel.last_message_id, page.items.at(-1).id);
  });
  await t.test("100 old messages stay; the 101st oldest becomes archived", async () => {
    await reset(); await seed(100);
    assert.equal(await chatDb.archiveMessagesOlderThan(pool, { channelId: 1 }), 0);
    await seed(1, { start: 101 });
    assert.equal(await chatDb.archiveMessagesOlderThan(pool, { channelId: 1 }), 1);
    const page = await chatDb.listMessages(pool, 1, { limit: 100 });
    assert.deepEqual(ids(page), Array.from({ length: 100 }, (_, i) => i + 2));
  });
  await t.test("archive-only history reappears and marking it read respects foreign keys", async () => {
    await reset(); await seed(19, { archived: true });
    const page = await chatDb.listMessages(pool, 1, { viewerUserId: 1 });
    assert.equal(page.items.length, 19);
    assert.equal(await chatDb.markChannelRead(pool, { channelId: 1, userId: 1, lastReadMessageId: 19 }), null);
    await assert.rejects(chatDb.markChannelRead(pool, { channelId: 2, userId: 1, lastReadMessageId: 19 }), /invalid_chat_message/);
  });
  await t.test("pagination keeps a fixed floor across active and archived history", async () => {
    await reset(); await seed(90, { archived: true }); await seed(60, { start: 91 });
    const first = await chatDb.listMessages(pool, 1);
    const second = await chatDb.listMessages(pool, 1, { beforeMessageId: first.next_cursor });
    assert.equal(first.has_more, true); assert.equal(second.has_more, false);
    assert.deepEqual([...ids(second), ...ids(first)], Array.from({ length: 100 }, (_, i) => i + 51));
    assert.deepEqual(ids(await chatDb.listMessages(pool, 1, { beforeMessageId: 51 })), []);
  });
  await t.test("recent messages exceeding the floor are all visible and retained", async () => {
    await reset(); await seed(150, { days: 1 });
    assert.equal(await chatDb.archiveMessagesOlderThan(pool, { channelId: 1 }), 0);
    const first = await chatDb.listMessages(pool, 1, { limit: 100 });
    const second = await chatDb.listMessages(pool, 1, { beforeMessageId: first.next_cursor, limit: 100 });
    assert.equal(first.items.length + second.items.length, 150);
  });
  await t.test("recent archived messages beyond the minimum stay visible", async () => {
    await reset(); await seed(125, { archived: true, days: 2 });
    const first = await chatDb.listMessages(pool, 1, { limit: 100 });
    const second = await chatDb.listMessages(pool, 1, { beforeMessageId: first.next_cursor });
    assert.equal(first.items.length + second.items.length, 125);
  });
  await t.test("read markers advance safely through mixed history without moving backward", async () => {
    await reset(); await seed(1); await seed(1, { archived: true, start: 2 }); await seed(1, { start: 3 });
    assert.equal(await chatDb.markChannelRead(pool, { channelId: 1, userId: 1, lastReadMessageId: 2 }), 1);
    await chatDb.markChannelRead(pool, { channelId: 1, userId: 1, lastReadMessageId: 3 });
    await chatDb.markChannelRead(pool, { channelId: 1, userId: 1, lastReadMessageId: 2 });
    assert.equal(Number((await pool.query("SELECT last_read_message_id FROM chat.user_channel_state WHERE user_id=1 AND channel_id=1")).rows[0].last_read_message_id), 3);
  });
  await t.test("minimum is per room and excludes moderated/deleted messages", async () => {
    await reset(); await seed(120); await seed(3, { start: 121, channel: 2 });
    await seed(110, { start: 200, status: "moderated" });
    await seed(110, { start: 400, status: "deleted", archived: true });
    await chatDb.archiveMessagesOlderThan(pool);
    assert.equal((await chatDb.listMessages(pool, 1, { limit: 100 })).items.length, 100);
    assert.equal((await chatDb.listMessages(pool, 2)).items.length, 3);
  });
  await t.test("admins can read older archived history; regular viewers cannot", async () => {
    await reset(); await seed(150, { archived: true });
    const regular = await chatDb.listMessages(pool, 1, { viewerUserId: 1, beforeMessageId: 51 });
    const admin = await chatDb.listMessages(pool, 1, { viewerUserId: 2, beforeMessageId: 51 });
    assert.equal(regular.items.length, 0); assert.equal(admin.items.length, 50);
    assert.equal(admin.history_limited, false);
  });
});
