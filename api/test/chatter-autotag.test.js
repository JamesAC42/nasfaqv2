const test = require("node:test");
const assert = require("node:assert/strict");

const talents = require("../src/services/talents");
const chatter = require("../src/services/chatter");
const autotag = require("../src/services/autotag");
const { postText } = require("../src/services/chatter/fourchan");

const matcher = talents.createMatcher(Object.keys(talents.ALIASES).map((symbol) => ({ symbol, name: symbol })));
const symbolsOf = (found) => [...found.keys()].sort();

test("names, nicknames and Japanese names all find the talent, once per mention", () => {
  assert.deepEqual(symbolsOf(matcher.match("Usada Pekora and Miko collab")), ["MIK", "PEK"]);
  assert.equal(matcher.match("Usada Pekora").get("PEK").count, 1);
  assert.deepEqual(symbolsOf(matcher.match("ぺこらとみこちのコラボ")), ["MIK", "PEK"]);
  assert.deepEqual(symbolsOf(matcher.match("FuwaMoco 3D when")), ["BYS"]);
});

test("everyday words only count when written as a name", () => {
  assert.deepEqual(symbolsOf(matcher.match("the marine corps, a mori, ao means blue")), []);
  assert.deepEqual(symbolsOf(matcher.match("Marine and Ao streamed")), ["HIO", "MAR"]);
  assert.equal(matcher.match("Ao").get("HIO").strong, false);
});

test("threads: hololive generals and talent threads count, other agencies don't", () => {
  const thread = (sub, com = "") => chatter.classifyThread({ sub, com }, matcher);
  assert.deepEqual(thread("/hlgg/ Hololive Global"), { holo: true, symbol: null, subject: "/hlgg/ Hololive Global" });
  assert.equal(thread("/pekora/ general #12").symbol, "PEK");
  assert.equal(thread("/nijisanji/ EN").holo, false);
  assert.equal(thread("", "Which holo would win").holo, true);
});

test("a post's mentions: named talents, the thread's talent, and no roll calls", () => {
  assert.deepEqual(chatter.mentionsForPost("Suisei's new song", matcher, null).map((m) => m.symbol), ["SUI"]);
  assert.deepEqual(chatter.mentionsForPost("that stream was funny", matcher, "PEK"), [{ symbol: "PEK", via: "thread", strong: true }]);
  assert.deepEqual(chatter.mentionsForPost("Ina Ame Gura Kiara Calli Kronii", matcher, null), []);
});

test("4chan comments become plain text without quote links", () => {
  assert.equal(postText('<a href="#p1" class="quotelink">&gt;&gt;1</a><br>Miko &amp; Suisei<br><span class="quote">&gt;tfw</span>'), "Miko & Suisei\n>tfw");
});

test("heat compares the last 6 hours with the talent's own usual pace", () => {
  const now = Date.parse("2026-09-27T12:00:00Z");
  const at = (hoursAgo) => new Date(now - hoursAgo * 3600_000).toISOString();
  const rows = [];
  // PEK: 1 post an hour for a week, then 30 in the last 6 hours.
  for (let h = 7; h < 168; h += 1) rows.push({ symbol: "PEK", posted_at: at(h), topic: "stream" });
  for (let i = 0; i < 30; i += 1) rows.push({ symbol: "PEK", posted_at: at(i * 0.19), topic: "music" });
  // SUI: steady 2 an hour.
  for (let h = 0; h < 168; h += 0.5) rows.push({ symbol: "SUI", posted_at: at(h), topic: null });
  const out = chatter.summarize(rows, { now, coveredHours: 168 });
  const pek = out.talents.find((entry) => entry.symbol === "PEK");
  const sui = out.talents.find((entry) => entry.symbol === "SUI");
  assert.equal(out.ready, true);
  assert.equal(pek.posts_recent, 30);
  assert.ok(pek.heat > 3, `PEK heat ${pek.heat}`);
  assert.ok(Math.abs(sui.heat - 1) < 0.15, `SUI heat ${sui.heat}`);
  assert.deepEqual(out.hot, ["PEK"]);
  assert.equal(out.busiest[0], "PEK");
  assert.equal(pek.topic, "music");
  assert.equal(pek.hourly.length, 24);
});

test("before a day of history there's no heat, just volume", () => {
  const now = Date.now();
  const out = chatter.summarize([{ symbol: "PEK", posted_at: new Date(now).toISOString(), topic: null }], { now, coveredHours: 2 });
  assert.equal(out.ready, false);
  assert.equal(out.talents[0].heat, null);
  assert.deepEqual(out.hot, []);
});

test("article candidates: named in the title, or strongly twice in the body", () => {
  const found = autotag.candidatesFor({ title: "Pekora's 3D live recap", body: "Pekora sang with Miko. Suisei watched. Suisei cried." }, matcher);
  const bySymbol = Object.fromEntries(found.map((candidate) => [candidate.symbol, candidate.keyword]));
  assert.deepEqual(bySymbol, { PEK: true, MIK: false, SUI: true });
});

function withJev(answers, fn) {
  return async () => {
    const saved = { fetch: global.fetch, key: process.env.JEV_API_KEY };
    process.env.JEV_API_KEY = "test";
    global.fetch = async () => ({ status: 200, ok: true, json: async () => ({ answers, usage: { input_tokens: 90 } }) });
    try {
      await fn();
    } finally {
      global.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.JEV_API_KEY;
      else process.env.JEV_API_KEY = saved.key;
    }
  };
}

test("without Jev, only the keyword candidates are tagged", async () => {
  const saved = process.env.JEV_API_KEY;
  delete process.env.JEV_API_KEY;
  try {
    const candidates = [
      { symbol: "PEK", count: 4, keyword: true },
      { symbol: "MIK", count: 1, keyword: false },
    ];
    assert.deepEqual(await autotag.judge({ title: "t", body: "b", kind: "article" }, candidates, new Map()), { symbols: ["PEK"], classifier: "keywords" });
  } finally {
    if (saved !== undefined) process.env.JEV_API_KEY = saved;
  }
});

test(
  "Jev keeps real subjects, drops passing mentions, and defers to keywords when unsure",
  withJev(
    {
      PEK: { choice: "main", confidence: 0.9 },
      MIK: { choice: "involved", confidence: 0.7 },
      SUI: { choice: "passing", confidence: 0.8 },
      AQU: { choice: "main", confidence: 0.3 },
    },
    async () => {
      const candidates = [
        { symbol: "PEK", count: 4, keyword: true },
        { symbol: "MIK", count: 1, keyword: false },
        { symbol: "SUI", count: 2, keyword: true },
        { symbol: "AQU", count: 1, keyword: false },
      ];
      const out = await autotag.judge({ title: "t", body: "b", kind: "article" }, candidates, new Map());
      assert.deepEqual(out, { symbols: ["PEK", "MIK"], classifier: "jev" });
    }
  )
);
