// Email rules for sign-up: one inbox, one account, and no throwaway inboxes.
//
// canonicalEmail() is the address as the mailbox sees it, stored in market.users.email_normalized
// (unique). Gmail ignores dots and anything after a "+", and googlemail.com is the same inbox, so
// Pe.Ko+alt@googlemail.com is peko@gmail.com. Elsewhere only the "+tag" is dropped (most providers
// deliver a+anything to a). The address itself is kept as typed.
//
// Throwaway domains come from data/disposable-email-domains.txt (where they came from is noted
// at its top); a subdomain of one counts too.

const fs = require("node:fs");
const path = require("node:path");

const GMAIL_DOMAINS = new Set(["gmail.com", "googlemail.com"]);

/** The address as its inbox sees it (lower case; Gmail dots and every +tag dropped), or null. */
function canonicalEmail(email) {
  const value = String(email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  let local = value.slice(0, at);
  let domain = value.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL_DOMAINS.has(domain)) {
    local = local.replace(/\./g, "") || local;
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

function loadDisposableDomains(file = path.join(__dirname, "..", "data", "disposable-email-domains.txt")) {
  return new Set(
    fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter((line) => line && !line.startsWith("#"))
  );
}

const DISPOSABLE_DOMAINS = loadDisposableDomains();

/** Whether the address is at a throwaway domain (or a subdomain of one). */
function isDisposableEmail(email, domains = DISPOSABLE_DOMAINS) {
  const value = String(email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 0) return false;
  const labels = value.slice(at + 1).split(".");
  for (let index = 0; index < labels.length - 1; index += 1) {
    if (domains.has(labels.slice(index).join("."))) return true;
  }
  return false;
}

/**
 * Fills market.users.email_normalized where it's empty (a migration; the unique index goes on after
 * it). Accounts made before the rule can share an inbox: the oldest keeps the address, and the rest
 * are left empty, reported in the log by id and username (not address), and otherwise untouched.
 * Returns those as [{ id, username, inbox_holder: { id, username } }].
 */
async function backfillEmailNormalized(pool, { log = console.warn } = {}) {
  const { rows } = await pool.query(
    `SELECT id, username, email, email_normalized FROM market.users WHERE email IS NOT NULL ORDER BY created_at, id`
  );
  const holders = new Map(rows.filter((row) => row.email_normalized).map((row) => [row.email_normalized, row]));
  const collisions = [];
  for (const row of rows) {
    if (row.email_normalized) continue;
    const canonical = canonicalEmail(row.email);
    if (!canonical) continue;
    let holder = holders.get(canonical);
    if (!holder) {
      try {
        await pool.query(`UPDATE market.users SET email_normalized = $2 WHERE id = $1 AND email_normalized IS NULL`, [row.id, canonical]);
        holders.set(canonical, row);
        continue;
      } catch (error) {
        if (error?.code !== "23505") throw error;
        // Someone signed up with it while this ran.
        const { rows: taken } = await pool.query(`SELECT id, username FROM market.users WHERE email_normalized = $1`, [canonical]);
        holder = taken[0] || { id: null, username: null };
      }
    }
    collisions.push({ id: Number(row.id), username: row.username, inbox_holder: { id: holder.id === null ? null : Number(holder.id), username: holder.username } });
  }
  if (collisions.length) {
    log(
      `[migrations] ${collisions.length} account(s) share an inbox with an older account, so email_normalized is left empty for them: ` +
        collisions.map((entry) => `#${entry.id} ${entry.username} (same inbox as #${entry.inbox_holder.id} ${entry.inbox_holder.username})`).join("; ") +
        ". Look at them on /admin/people."
    );
  }
  return collisions;
}

module.exports = { DISPOSABLE_DOMAINS, backfillEmailNormalized, canonicalEmail, isDisposableEmail, loadDisposableDomains };
