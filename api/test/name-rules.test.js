const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nameRules = require("../src/services/nameRules");
const emailRules = require("../src/services/emailRules");
const ipHash = require("../src/services/ipHash");
const { accountStatus } = require("../src/services/games/accountRules");

// The variants a term is tried in. Built from the lists, so every term in them is covered.
const LEET = { a: "4", e: "3", i: "1", o: "0", s: "5", t: "7" };
const leet = (term) => [...term].map((ch) => LEET[ch] ?? ch).join("");
const spaced = (term) => [...term].join("_");
const shout = (term) => term.toUpperCase();
const stretched = (term) => term.replace(/([aeiou])/, "$1$1$1");

test("usernames: every slur and hate term is refused, however it's dressed up", () => {
  for (const [term] of [...nameRules.SLURS, ...nameRules.HATE_TERMS]) {
    for (const name of [term, shout(term), leet(term), spaced(term), stretched(term), `xx_${term}_xx`, `${term}s`, `${term}123`]) {
      assert.equal(nameRules.usernameProblem(name), "username_not_allowed", name);
    }
  }
  for (const name of ["x1488x", "14_88", "1_4_8_8"]) assert.equal(nameRules.usernameProblem(name), "username_not_allowed", name);
  // ANYWHERE terms hide inside a longer name too.
  for (const [term, mode] of nameRules.SLURS) if (mode === "anywhere") assert.equal(nameRules.usernameProblem(`the${term}king`), "username_not_allowed", term);
});

test("usernames: staff words are reserved, as words and at the edges", () => {
  for (const [word] of nameRules.RESERVED_WORDS) {
    for (const name of [word, shout(word), leet(word), spaced(word), `${word}1`, `${word}s`, `Bob_${word}`, `${word} Bob`, `Bob${word[0].toUpperCase()}${word.slice(1)}`]) {
      assert.equal(nameRules.usernameProblem(name), "username_reserved", name);
    }
  }
  for (const name of ["adminbob", "bobadmin", "Sysadmin", "nasfaqfan", "TheModeratorGuy", "4dm1n", "a d m i n", "NASFAQ_Official"]) {
    assert.equal(nameRules.usernameProblem(name), "username_reserved", name);
  }
});

test("usernames: ordinary names that contain a listed word get through", () => {
  for (const name of [
    "badminton",
    "Modern_Man",
    "Supporter",
    "staffordshire",
    "Systematic",
    "Raccoon",
    "Tycoon",
    "Cocoon",
    "Spicy_Boi",
    "Montenegro",
    "Pakistan_Fan",
    "Scunthorpe",
    "Nazir",
    "Sniggers",
    "Grape_Juice",
    "PekoraFan",
    "Peko Fan",
    "player_12",
    "rrat",
    "Fourteen 88",
  ]) {
    assert.equal(nameRules.usernameProblem(name), null, name);
  }
});

test("usernames: a talent's ticker or name, whole, is reserved for her", () => {
  const talentNames = new Set([
    ...nameRules.talentKeys({ symbol: "PEK", names: ["Usada Pekora", "Pekora Ch."] }),
    ...nameRules.talentKeys({ symbol: "INA", names: ["Ninomae Ina’nis"] }),
  ]);
  for (const name of ["PEK", "pek", "Pekora", "PEKORA", "Pek0ra", "pekora_2", "Usada_Pekora", "Usada Pekora", "Pekora_Usada", "INA", "Inanis", "Ninomae"]) {
    assert.equal(nameRules.usernameProblem(name, { talentNames }), "username_talent", name);
  }
  for (const name of ["PekoraFan", "Peko Fan", "Usada_Pekora_Simp", "Inafan"]) assert.equal(nameRules.usernameProblem(name, { talentNames }), null, name);
  // Parts shorter than four letters aren't reserved on their own ("Ina" here), only the ticker is.
  assert.deepEqual([...nameRules.talentKeys({ symbol: "HIO", names: ["Hiodoshi Ao"] })].sort(), ["aohiodoshi", "hio", "hiodoshi", "hiodoshiao"]);
});

test("assertUsernameAllowed reads talent names from the database, cached", async () => {
  nameRules.clearTalentNameCache();
  let queries = 0;
  const db = {
    async query() {
      queries += 1;
      return { rows: [{ symbol: "GUR", names: ["Gawr Gura", "Gura Ch.", null] }] };
    },
  };
  await assert.rejects(nameRules.assertUsernameAllowed(db, "Gura"), { code: "username_talent" });
  await assert.rejects(nameRules.assertUsernameAllowed(db, "admin"), { code: "username_reserved" });
  assert.equal(await nameRules.assertUsernameAllowed(db, "GuraFan"), "GuraFan");
  assert.equal(queries, 1);
  nameRules.clearTalentNameCache();
});

test("what people write: slurs and hate phrases as words, leetspeak undone", () => {
  for (const [term] of nameRules.SLURS) {
    for (const text of [`you ${term}`, `${shout(term)}!`, `lol ${leet(term)} lol`, `${term}s everywhere`, `@${term} hi`, `"${stretched(term)}"`]) {
      assert.equal(nameRules.findBlockedWord(text), term, text);
    }
  }
  for (const phrase of nameRules.HATE_PHRASES) {
    assert.equal(nameRules.findBlockedWord(`${shout(phrase)}!!`), phrase, phrase);
    assert.equal(nameRules.findBlockedWord(leet(phrase).replace(/ /g, "   ")), phrase, phrase);
  }
  assert.throws(() => nameRules.assertCleanText(`a ${leet(nameRules.SLURS[0][0])}`, "bio"), { code: "blocked_words", field: "bio" });
  assert.equal(nameRules.assertCleanText("PEKO to the moon", "bio"), "PEKO to the moon");
});

test("what people write: the lighter check leaves ordinary words, swearing and prices alone", () => {
  for (const text of [
    "what a raccoon",
    "spicy ramen tonight",
    "Montenegro is lovely",
    "he sniggered at the chart",
    "Pakistan stream when",
    "a cocoon of bagholders",
    "Scunthorpe United",
    "I sold 1488 shares at $14.88",
    "kkkk lol",
    "this fucking stock, holy shit",
    "the moderator and the admin",
    "mod pls",
    "Ahoy! Pekora!!",
    "",
    "   ",
    "ぺこら",
  ]) {
    assert.equal(nameRules.findBlockedWord(text), null, text);
  }
});

test("canonicalEmail: one inbox, one address", () => {
  const same = ["peko@gmail.com", "Pe.Ko@gmail.com", "p.e.k.o+alt@gmail.com", "PEKO+x+y@GMAIL.COM", "peko@googlemail.com", "pe.ko+1@googlemail.com"];
  for (const email of same) assert.equal(emailRules.canonicalEmail(email), "peko@gmail.com", email);
  // Elsewhere dots matter, +tags don't.
  assert.equal(emailRules.canonicalEmail("Pe.Ko+alt@Example.com"), "pe.ko@example.com");
  assert.notEqual(emailRules.canonicalEmail("pe.ko@example.com"), emailRules.canonicalEmail("peko@example.com"));
  // A leading "+" is the whole name, not a tag.
  assert.equal(emailRules.canonicalEmail("+peko@example.com"), "+peko@example.com");
  for (const bad of ["", "peko", "@gmail.com", "peko@"]) assert.equal(emailRules.canonicalEmail(bad), null, bad);
});

test("throwaway email domains: the bundled list, subdomains, and real providers left alone", () => {
  for (const email of ["x@mailinator.com", "X@YOPMAIL.COM", "x@guerrillamail.com", "x@sub.mailinator.com", "x@10minutemail.com"]) {
    assert.equal(emailRules.isDisposableEmail(email), true, email);
  }
  for (const email of ["x@gmail.com", "x@outlook.com", "x@proton.me", "x@mailinator.com.example.org", "x@notmailinator.org"]) {
    assert.equal(emailRules.isDisposableEmail(email), false, email);
  }
  const file = path.join(__dirname, "..", "src", "data", "disposable-email-domains.txt");
  const text = fs.readFileSync(file, "utf8");
  assert.match(text, /^# .*\n(?:#.*\n)*/, "starts with a comment saying where the list came from");
  assert.match(text, /github\.com\/disposable-email-domains\/disposable-email-domains/);
  const domains = text.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  assert.ok(domains.length >= 100);
  assert.equal(new Set(domains).size, domains.length, "no duplicates");
  for (const domain of domains) assert.match(domain, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, domain);
  for (const real of ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "proton.me", "protonmail.com", "mail.ru", "gmx.de", "qq.com", "naver.com"]) {
    assert.equal(domains.includes(real), false, real);
  }
});

test("IP hashes: salted, never the address, IPv6 by its /64", () => {
  const salt = "test-salt";
  const v4 = ipHash.hashIp("203.0.113.7", salt);
  assert.match(v4, /^[0-9a-f]{32}$/);
  assert.equal(ipHash.hashIp("::ffff:203.0.113.7", salt), v4);
  assert.equal(ipHash.hashIp(" 203.0.113.7:5000 ", salt), v4);
  assert.notEqual(ipHash.hashIp("203.0.113.8", salt), v4);
  assert.notEqual(ipHash.hashIp("203.0.113.7", "another-salt"), v4, "the salt matters");
  assert.equal(ipHash.hashIp("203.0.113.7", ""), null, "no salt, nothing stored");
  assert.equal(ipHash.hashIp("unknown", salt), null);

  assert.equal(ipHash.ipKey("2001:db8:85a3:0042:1000:8a2e:370:7334"), "2001:db8:85a3:42::/64");
  assert.equal(ipHash.ipKey("[2001:DB8:85A3:42::1]:443"), "2001:db8:85a3:42::/64");
  assert.equal(ipHash.hashIp("2001:db8:85a3:42::1", salt), ipHash.hashIp("2001:db8:85a3:42:ffff:1:2:3", salt));
  assert.notEqual(ipHash.hashIp("2001:db8:85a3:42::1", salt), ipHash.hashIp("2001:db8:85a3:43::1", salt));

  const saved = process.env.IP_HASH_SALT;
  try {
    process.env.IP_HASH_SALT = salt;
    assert.equal(ipHash.ipHashingEnabled(), true);
    const req = { headers: { "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }, socket: {} };
    assert.equal(ipHash.requestIpHash(req), v4, "Cloudflare's header first, like the rate limits");
    delete process.env.IP_HASH_SALT;
    assert.equal(ipHash.ipHashingEnabled(), false);
    assert.equal(ipHash.requestIpHash(req), null);
  } finally {
    if (saved === undefined) delete process.env.IP_HASH_SALT;
    else process.env.IP_HASH_SALT = saved;
  }
});

test("Cash-moving account rules: verified email, then account age", () => {
  const now = Date.parse("2026-10-29T12:00:00Z");
  const rules = { tooNew: "pvp_account_too_new", now, minAgeHours: 168 };
  assert.deepEqual(accountStatus(null, rules), { eligible: false, reason: "unauthenticated", available_at: null });
  assert.deepEqual(accountStatus({ created_at: "2026-01-01T00:00:00Z", email_verified: false }, rules), {
    eligible: false,
    reason: "email_verification_required",
    available_at: null,
  });
  assert.deepEqual(accountStatus({ created_at: "2026-10-27T12:00:00Z", email_verified: true }, rules), {
    eligible: false,
    reason: "pvp_account_too_new",
    available_at: "2026-11-03T12:00:00.000Z",
  });
  assert.deepEqual(accountStatus({ created_at: "2026-10-22T12:00:00Z", email_verified: true }, rules), { eligible: true, reason: null, available_at: null });
});
