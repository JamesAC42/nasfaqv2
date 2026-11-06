const test = require("node:test");
const assert = require("node:assert/strict");
const { Pool } = require("pg");
const blackjack = require("../src/services/games/tables/blackjack");
const { PROFILE_PICTURE_CDN_BASE_URL } = require("../src/profilePictures");

// A seat carries the player's picture, read the way the top bar reads it. On a freshly migrated
// database of its own, from the local or CI test server.
const databaseUrl = process.env.CHAT_TEST_DATABASE_URL;

test("a blackjack seat shows the player's picture", { skip: !databaseUrl, timeout: 180_000 }, async (t) => {
  const target = new URL(databaseUrl);
  assert.ok(["127.0.0.1", "localhost"].includes(target.hostname));
  assert.equal(target.pathname, "/nasfaq_chat_test");
  const admin = new Pool({ connectionString: databaseUrl });
  try {
    await admin.query("DROP DATABASE IF EXISTS nasfaq_blackjack_seats_test WITH (FORCE)");
    await admin.query("CREATE DATABASE nasfaq_blackjack_seats_test");
  } finally {
    await admin.end();
  }
  target.pathname = "/nasfaq_blackjack_seats_test";
  const pool = new Pool({ connectionString: target.href });
  t.after(() => pool.end());
  const saved = [console.warn, console.log, console.info];
  console.warn = console.log = console.info = () => {};
  try {
    await require("../src/migrations").applySchema(pool);
  } finally {
    [console.warn, console.log, console.info] = saved;
  }

  const user = async (name) => {
    const { rows } = await pool.query(
      `INSERT INTO market.users (username, username_normalized, email, email_verified, password_hash, password_salt, password_params_json, profile_color)
       VALUES ($1, $1, $1 || '@example.test', true, 'x', 'x', '{}', '#3fb8f5') RETURNING id`,
      [name]
    );
    return Number(rows[0].id);
  };
  const uploaded = await user("uploaded");
  const reaction = await user("reaction");
  const plain = await user("plain");
  const removed = await user("removed");
  const { rows: pictures } = await pool.query(
    `INSERT INTO market.profile_pictures (name, filename_large, filename_small, is_deleted)
     VALUES ('Test', 'test-large.webp', 'test-small.webp', false), ('Gone', 'gone-large.webp', 'gone-small.webp', true) RETURNING id`
  );
  await pool.query(`UPDATE market.users SET profile_picture_id = $2 WHERE id = $1`, [uploaded, pictures[0].id]);
  await pool.query(`UPDATE market.users SET profile_picture_id = $2 WHERE id = $1`, [removed, pictures[1].id]);
  await pool.query(`UPDATE market.users SET profile_reaction = 'PEK/hype' WHERE id = $1`, [reaction]);

  await blackjack.init(pool);
  for (const [seat, userId] of [uploaded, reaction, plain, removed].entries()) await blackjack.sit({ userId, tableKey: "low", seat });

  const seats = blackjack.getTable("low").seats;
  assert.equal(seats[0].profile_picture_url, `${PROFILE_PICTURE_CDN_BASE_URL}/small/test-small.webp`, "an uploaded picture, small size");
  assert.equal(seats[1].profile_picture_url, "reaction:PEK/hype", "a card reaction picked as the picture");
  assert.equal(seats[2].profile_picture_url, null, "no picture: the client draws initials");
  assert.equal(seats[3].profile_picture_url, null, "a picture taken out of the catalog doesn't show");
  assert.equal(seats[0].profile_color, "#3fb8f5");
  assert.equal(seats[0].username, "uploaded");
});
