// Who a piece of text is about: hololive talents by name, nickname and Japanese name.
//
// Used by the /vt/ chatter index and article auto-tagging to find *candidates*; Jev (when set up)
// then judges whether each candidate is really what the text is about. Without Jev the matcher is
// the whole answer, so it leans conservative: short or everyday nicknames ("Ao", "Ame", "Mori")
// are "weak" and only match capitalised, exactly as written.

/**
 * symbol → aliases. Strong aliases match case-insensitively on word boundaries; `weak` ones match
 * case-sensitively. Japanese aliases match as substrings (Japanese has no spaces between words), so
 * only distinctive ones are listed.
 */
const ALIASES = {
  // Gen 0
  SRA: { strong: ["Tokino Sora", "Sora-chan", "Sorachan", "ときのそら"], weak: ["Sora"] },
  RBC: { strong: ["Roboco", "Robocosan", "Roboco-san", "ロボ子"] },
  MIK: { strong: ["Sakura Miko", "Miko", "Mikochi", "Mikko", "さくらみこ", "みこち"] },
  SUI: { strong: ["Hoshimachi Suisei", "Suisei", "Suichan", "Sui-chan", "Suityan", "星街すいせい", "すいせい"] },
  AZK: { strong: ["AZKi", "Azki"] },
  // Gen 1
  FBK: { strong: ["Shirakami Fubuki", "Fubuki", "Fubuchan", "Fubu-chan", "FBK", "白上フブキ", "フブキ"] },
  MTS: { strong: ["Natsuiro Matsuri", "Matsuri", "Maturi", "夏色まつり"] },
  HAT: { strong: ["Akai Haato", "Haato", "Haachama", "Haachamachama", "赤井はあと", "はあちゃま"], weak: ["Chama"] },
  AKI: { strong: ["Aki Rosenthal", "Akirose", "Aki Rose", "アキロゼ", "アキ・ローゼンタール"], weak: ["Aki"] },
  // Gen 2
  AQU: { strong: ["Minato Aqua", "Aqua", "Akukin", "湊あくあ", "あくあ"] },
  SHI: { strong: ["Murasaki Shion", "Shion", "紫咲シオン", "シオン"] },
  AYA: { strong: ["Nakiri Ayame", "Ayame", "百鬼あやめ"], weak: ["Ojou"] },
  CHC: { strong: ["Yuzuki Choco", "Choco-sen", "Chocosen", "癒月ちょこ"], weak: ["Choco"] },
  SBR: { strong: ["Oozora Subaru", "Subaru", "Shuba", "大空スバル", "スバル"] },
  // GAMERS
  MIO: { strong: ["Ookami Mio", "Mio-sha", "Miosha", "大神ミオ"], weak: ["Mio"] },
  OKY: { strong: ["Nekomata Okayu", "Okayu", "猫又おかゆ", "おかゆ"] },
  KRE: { strong: ["Inugami Korone", "Korone", "Koro-san", "戌神ころね", "ころね"], weak: ["Doog"] },
  // Gen 3
  PEK: { strong: ["Usada Pekora", "Pekora", "Peko", "Pekor", "Pekochan", "兎田ぺこら", "ぺこら"] },
  FLR: { strong: ["Shiranui Flare", "Flare", "Fuutan", "不知火フレア", "フレア"] },
  NOE: { strong: ["Shirogane Noel", "Danchou", "Dancho", "白銀ノエル", "ノエル"], weak: ["Noel"] },
  MAR: { strong: ["Houshou Marine", "Senchou", "Sencho", "Houshou", "宝鐘マリン", "マリン"], weak: ["Marine"] },
  // Gen 4
  KAN: { strong: ["Amane Kanata", "Kanata", "Kanatan", "天音かなた"] },
  COC: { strong: ["Kiryu Coco", "Kiryuu Coco", "Kaichou", "桐生ココ"], weak: ["Coco"] },
  WAT: { strong: ["Tsunomaki Watame", "Watame", "Wamy", "角巻わため", "わため"] },
  TOW: { strong: ["Tokoyami Towa", "Towa", "Towasama", "Towa-sama", "常闇トワ"] },
  LUN: { strong: ["Himemori Luna", "Lunatan", "姫森ルーナ", "ルーナ"], weak: ["Luna"] },
  // Gen 5
  LAM: { strong: ["Yukihana Lamy", "Lamy", "雪花ラミィ", "ラミィ"] },
  NEN: { strong: ["Momosuzu Nene", "Nenechi", "Super Nenechi", "桃鈴ねね"], weak: ["Nene"] },
  BOT: { strong: ["Shishiro Botan", "Botan", "Shishiron", "獅白ぼたん", "ぼたん"] },
  PLK: { strong: ["Omaru Polka", "Polka", "尾丸ポルカ", "ポルカ"] },
  // holoX
  DRK: { strong: ["La+ Darknesss", "Laplus", "La+", "Lap-chan", "ラプラス"], weak: ["Lap"] },
  LUI: { strong: ["Takane Lui", "Luisama", "Lui-sama", "鷹嶺ルイ"], weak: ["Lui"] },
  KYR: { strong: ["Hakui Koyori", "Koyori", "Koyo", "博衣こより", "こより"] },
  CHL: { strong: ["Sakamata Chloe", "Chloe", "Sakamata", "沙花叉クロヱ", "クロヱ"] },
  IRO: { strong: ["Kazama Iroha", "Iroha", "Gozaru", "風真いろは", "いろは"] },
  // ReGLOSS
  HIO: { strong: ["Hiodoshi Ao", "Ao-kun", "Aokun", "Hiodoshi", "火威青"], weak: ["Ao"] },
  KND: { strong: ["Otonose Kanade", "Kanade", "音乃瀬奏"] },
  RRK: { strong: ["Ichijou Ririka", "Ririka", "一条莉々華"] },
  RDN: { strong: ["Juufuutei Raden", "Raden", "儒烏風亭らでん", "らでん"] },
  HJM: { strong: ["Todoroki Hajime", "Hajime", "Banchou", "Bancho", "轟はじめ"] },
  // FLOW GLOW
  RIO: { strong: ["Isaki Riona", "Riona", "響咲リオナ"] },
  NIK: { strong: ["Koganei Niko", "Koganei", "虎金妃笑虎"], weak: ["Niko"] },
  MIZ: { strong: ["Mizumiya Su", "Mizumiya", "水宮枢"] },
  CHH: { strong: ["Rindo Chihaya", "Chihaya", "輪堂千速"] },
  VIV: { strong: ["Kikirara Vivi", "Kikirara", "綺々羅々ヴィヴィ"], weak: ["Vivi"] },
  // Myth
  CLI: { strong: ["Mori Calliope", "Calliope", "Calli", "Moririn"], weak: ["Mori"] },
  KRA: { strong: ["Takanashi Kiara", "Kiara", "Tenchou", "Tencho"] },
  INA: { strong: ["Ninomae Ina'nis", "Ninomae Ina’nis", "Ina'nis", "Ninomae", "Inanis"], weak: ["Ina"] },
  GUR: { strong: ["Gawr Gura", "Gura", "Goob", "Same-chan"] },
  AME: { strong: ["Watson Amelia", "Amelia", "Ame-chan", "Amechan"], weak: ["Ame", "Watson"] },
  // Council / Promise
  RYS: { strong: ["IRyS", "Irys"] },
  SAN: { strong: ["Tsukumo Sana", "Sana-chan", "Tsukumo"], weak: ["Sana"] },
  FAU: { strong: ["Ceres Fauna", "Fauna"] },
  KRN: { strong: ["Ouro Kronii", "Kronii", "Kroni"] },
  MUM: { strong: ["Nanashi Mumei", "Mumei", "Moom"] },
  BLZ: { strong: ["Hakos Baelz", "Baelz", "Hakos"], weak: ["Bae"] },
  // Advent
  NVL: { strong: ["Shiori Novella", "Shiori", "Novella"] },
  BIJ: { strong: ["Koseki Bijou", "Bijou", "Biboo"] },
  RVN: { strong: ["Nerissa Ravencroft", "Nerissa", "Ravencroft"] },
  BYS: { strong: ["FuwaMoco", "Fuwamoco", "FWMC", "Fuwawa", "Mococo", "Abyssgard"] },
  // Justice
  BLD: { strong: ["Elizabeth Rose Bloodflame", "Bloodflame", "Elizabeth Rose"], weak: ["Liz", "ERB"] },
  MRN: { strong: ["Gigi Murin", "Gigi", "Murin"] },
  MMR: { strong: ["Cecilia Immergreen", "Cecilia", "Immergreen", "Ceci"] },
  PNT: { strong: ["Raora Panthera", "Raora", "Panthera"] },
  // Indonesia
  RIS: { strong: ["Ayunda Risu", "Risu"] },
  HSH: { strong: ["Moona Hoshinova", "Moona", "Hoshinova"] },
  FFT: { strong: ["Airani Iofifteen", "Iofifteen", "Iofi"] },
  OLL: { strong: ["Kureiji Ollie", "Ollie", "Kureiji"] },
  MLF: { strong: ["Anya Melfissa", "Melfissa"], weak: ["Anya"] },
  REI: { strong: ["Pavolia Reine", "Reine", "Pavolia"] },
  ZET: { strong: ["Vestia Zeta", "Vestia"], weak: ["Zeta"] },
  KVL: { strong: ["Kaela Kovalskia", "Kaela", "Kovalskia"] },
  KNR: { strong: ["Kobo Kanaeru", "Kanaeru"], weak: ["Kobo"] },
};

const CJK = /[぀-ヿ㐀-鿿]/;

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[’`]/g, "'");
}

function aliasPattern(alias, { caseSensitive }) {
  const clean = normalize(alias);
  const body = escapeRegex(clean).replace(/\\?\s+/g, "[\\s_-]*");
  if (CJK.test(clean)) return new RegExp(body, "gu");
  // Letters/digits must not continue the word on either side ("Pekora" not "Pekoraaa" is fine to miss).
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, caseSensitive ? "gu" : "giu");
}

/** Aliases for one talent, from the table or derived from their English name. */
function aliasesFor(symbol, name) {
  const entry = ALIASES[symbol];
  if (entry) return { strong: entry.strong ?? [], weak: entry.weak ?? [] };
  const full = String(name ?? "").trim();
  if (!full) return { strong: [], weak: [] };
  const parts = full.split(/\s+/).filter((part) => part.length >= 4);
  return { strong: [full, ...parts.slice(-1)], weak: [] };
}

/**
 * Build a matcher over the listed talents: `[{ symbol, name }]`.
 * `match(text)` → Map(symbol → { count, strong, aliases: string[] }).
 */
function createMatcher(talents) {
  const rules = [];
  const names = new Map();
  for (const talent of talents) {
    const symbol = String(talent.symbol || "").toUpperCase();
    if (!symbol) continue;
    names.set(symbol, talent.name || symbol);
    const { strong, weak } = aliasesFor(symbol, talent.name);
    for (const alias of strong) rules.push({ symbol, alias, strong: true, pattern: aliasPattern(alias, { caseSensitive: false }) });
    for (const alias of weak) rules.push({ symbol, alias, strong: false, pattern: aliasPattern(alias, { caseSensitive: true }) });
  }
  // Longest first, and each character of the text can only count once ("Usada Pekora" is one
  // mention, not "Usada Pekora" + "Pekora").
  rules.sort((a, b) => b.alias.length - a.alias.length);

  function match(text) {
    let source = normalize(text);
    const found = new Map();
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      source = source.replace(rule.pattern, (value) => {
        const entry = found.get(rule.symbol) ?? { count: 0, strong: false, aliases: [] };
        entry.count += 1;
        entry.strong = entry.strong || rule.strong;
        if (!entry.aliases.includes(rule.alias)) entry.aliases.push(rule.alias);
        found.set(rule.symbol, entry);
        return " ".repeat(value.length);
      });
    }
    return found;
  }

  return { match, names, size: names.size };
}

/** The talents a thread is dedicated to, from "/slug/" tokens in its subject ("/pekora/ general"). */
function threadSlugs(subject) {
  return [...normalize(subject).matchAll(/\/([^/\s]{2,24})\//g)].map((m) => m[1]);
}

/** Loads the listed talents' names for a matcher. */
async function loadTalents(pool) {
  const { rows } = await pool.query(`
    SELECT a.symbol, COALESCE(c.name_english, c.name_short, a.display_name) AS name, a.youtube_channel_id
    FROM market.market_assets a
    LEFT JOIN yt.youtube_channels c ON c.youtube_channel_id = a.youtube_channel_id
    WHERE a.status = 'active'
  `);
  return rows.map((row) => ({ symbol: String(row.symbol).toUpperCase(), name: row.name, youtube_channel_id: row.youtube_channel_id }));
}

module.exports = { ALIASES, aliasesFor, createMatcher, loadTalents, normalize, threadSlugs };
