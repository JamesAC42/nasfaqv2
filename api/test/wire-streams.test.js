const test = require("node:test");
const assert = require("node:assert/strict");

const streams = require("../src/services/wire/streams");
const { milestoneStep } = require("../src/services/wire");

test("keyword rules catch the common JP and EN event titles", () => {
  assert.equal(streams.keywordEvent("【3D LIVE】ぺこらの3Dライブ！"), "three_d");
  assert.equal(streams.keywordEvent("【新衣装お披露目】New outfit!!"), "new_outfit");
  assert.equal(streams.keywordEvent("【誕生日ライブ】Happy birthday to me"), "birthday");
  assert.equal(streams.keywordEvent("【歌枠】Karaoke night"), "karaoke");
  assert.equal(streams.keywordEvent("【メン限】雑談"), "members_only");
  assert.equal(streams.keywordEvent("【Minecraft】chill mining"), "other");
});

function withJev(answer, fn) {
  return async () => {
    const saved = { fetch: global.fetch, key: process.env.JEV_API_KEY };
    process.env.JEV_API_KEY = "test";
    global.fetch = async () => ({ status: 200, ok: true, json: async () => ({ answers: { event: answer }, usage: { input_tokens: 40 } }) });
    try {
      await fn();
    } finally {
      global.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.JEV_API_KEY;
      else process.env.JEV_API_KEY = saved.key;
    }
  };
}

test(
  "a confident Jev answer wins over the keywords",
  withJev({ type: "choice", choice: "original_song", confidence: 0.82, probabilities: { original_song: 0.9, other: 0.1 } }, async () => {
    const verdict = await streams.judgeTitle("【初披露】Brand new song premiere", "Pekora");
    assert.equal(verdict.event, "original_song");
    assert.equal(verdict.classifier, "jev");
  })
);

test(
  "an unsure Jev answer falls back to the keyword only if Jev ranked it top two",
  withJev({ type: "choice", choice: "karaoke", confidence: 0.3, probabilities: { karaoke: 0.4, birthday: 0.35, other: 0.25 } }, async () => {
    assert.equal((await streams.judgeTitle("【誕生日】birthday karaoke", "Marine")).event, "birthday");
  })
);

test(
  "announcements need the title to say so",
  withJev({ type: "choice", choice: "announcement", confidence: 0.9, probabilities: { announcement: 0.9 } }, async () => {
    assert.equal((await streams.judgeTitle("【雑談】talking about stuff", "Suisei")).event, "other");
  })
);

test(
  "a Jev failure keeps the keyword answer (not checked)",
  async () => {
    const saved = { fetch: global.fetch, key: process.env.JEV_API_KEY };
    process.env.JEV_API_KEY = "test";
    global.fetch = async () => ({ status: 401, ok: false, json: async () => ({ error: "bad key" }) });
    try {
      const verdict = await streams.judgeTitle("【3D LIVE】concert", "Aqua");
      assert.deepEqual([verdict.event, verdict.classifier], ["three_d", "keywords"]);
    } finally {
      global.fetch = saved.fetch;
      if (saved.key === undefined) delete process.env.JEV_API_KEY;
      else process.env.JEV_API_KEY = saved.key;
    }
  }
);

test("milestones step 100K under 1M, then 250K, then 500K", () => {
  assert.equal(milestoneStep(950_000), 100_000);
  assert.equal(milestoneStep(1_600_000), 250_000);
  assert.equal(milestoneStep(3_200_000), 500_000);
});
