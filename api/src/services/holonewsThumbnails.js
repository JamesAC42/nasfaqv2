const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const articleDb = require("../articleDb");
const talents = require("./talents");

const DEFAULT_THUMBNAIL_CDN_BASE_URL = "https://images.nasfaq.biz";
const DEFAULT_REFERENCE_IMAGES_BASE_URL = "https://images.nasfaq.biz/reference-images";
const DEFAULT_TEXT_MODEL = "gemini-3-flash-preview";
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const REDIS_ITEMS_KEY = "nasfaq_holonews:items";
const REDIS_META_KEY = "nasfaq_holonews:meta";

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
}

function makeError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getS3Client() {
  const accessKeyId = optionalTrimmedString(process.env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = optionalTrimmedString(process.env.AWS_SECRET_ACCESS_KEY);
  const region = optionalTrimmedString(process.env.AWS_REGION);
  const bucket = optionalTrimmedString(process.env.AWS_SW_BUCKET);

  if (!accessKeyId || !secretAccessKey || !region || !bucket) {
    return null;
  }

  return {
    bucket,
    client: new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
      followRegionRedirects: true,
    }),
  };
}

function getConfig() {
  const timeoutSeconds = Number(process.env.GEMINI_TIMEOUT_SECONDS || 90);
  return {
    geminiApiKey: optionalTrimmedString(process.env.GEMINI_API_KEY),
    geminiTextModel: optionalTrimmedString(process.env.GEMINI_TEXT_MODEL) || DEFAULT_TEXT_MODEL,
    geminiImageModel: optionalTrimmedString(process.env.GEMINI_IMAGE_MODEL) || DEFAULT_IMAGE_MODEL,
    geminiTimeoutMs: Math.max(5_000, (Number.isFinite(timeoutSeconds) ? timeoutSeconds : 90) * 1000),
    thumbnailS3Prefix: (optionalTrimmedString(process.env.THUMBNAIL_S3_PREFIX) || "thumbnails").replace(/^\/+|\/+$/g, ""),
    thumbnailCDNBaseURL: (optionalTrimmedString(process.env.THUMBNAIL_CDN_BASE_URL) || DEFAULT_THUMBNAIL_CDN_BASE_URL).replace(/\/+$/g, ""),
    referenceImagesBaseURL: (optionalTrimmedString(process.env.REFERENCE_IMAGES_BASE_URL) || DEFAULT_REFERENCE_IMAGES_BASE_URL).replace(/\/+$/g, ""),
  };
}

function normalizeString(value, maxLength = 500) {
  const trimmed = optionalTrimmedString(value);
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function normalizeList(value, maxItems = 16) {
  const source = Array.isArray(value) ? value : value ? [value] : [];
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const normalized = normalizeString(item, 120);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Reference images are named by the hololive site's talent slugs (holonews/reference_image_scraper),
// which drop punctuation (La+ → la-darknesss, Ina’nis → ninomae-inanis) and don't always match our
// channel names. A duo channel gets one image per member. Keep in step with holonews/cmd/holonews.
const REFERENCE_IMAGE_OVERRIDES = {
  "fuwamoco-abyssgard": { slugs: ["fuwawa-abyssgard", "mococo-abyssgard"], note: "the twins Fuwawa and Mococo Abyssgard, one image each" },
  robocosan: { slugs: ["roboco-san"] },
};

function memberSlug(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** The reference image slugs for a member name, and a note for the image prompt when it needs one. */
function referenceImagesFor(name) {
  const slug = memberSlug(name);
  return REFERENCE_IMAGE_OVERRIDES[slug] || { slugs: [slug] };
}

function dedupeStrings(values) {
  const seen = new Set();
  const out = [];
  for (const value of values || []) {
    const normalized = normalizeString(value, 120);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function extractJSON(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return trimmed;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function encodeS3URL(baseURL, key) {
  const encoded = String(key || "")
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${baseURL}/${encoded}`;
}

async function callGemini(config, model, payload) {
  if (!config.geminiApiKey) throw makeError("gemini_not_configured");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.geminiTimeoutMs);
  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": config.geminiApiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.text();
    if (!response.ok) {
      throw makeError("gemini_request_failed", `gemini http ${response.status}: ${body.trim()}`);
    }
    let parsed = null;
    try {
      parsed = JSON.parse(body);
    } catch (error) {
      throw makeError("gemini_request_failed", `gemini returned invalid JSON: ${error?.message || error}`);
    }
    if (!Array.isArray(parsed.candidates) || !parsed.candidates.length) {
      throw makeError("gemini_request_failed", "gemini response missing candidates");
    }
    return parsed;
  } catch (error) {
    if (error?.name === "AbortError") throw makeError("gemini_request_failed", "gemini request timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiText(config, prompt) {
  const response = await callGemini(config, config.geminiTextModel, {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 4096,
      responseMimeType: "application/json",
    },
  });

  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (optionalTrimmedString(part.text)) return part.text.trim();
    }
  }
  throw makeError("gemini_request_failed", "gemini text response missing content");
}

async function resolveNewsTarget(pool, { newsId, articleSlug, headline }) {
  const normalizedHeadline = normalizeString(headline, 500);
  const safeNewsId = Number(newsId);
  const slug = normalizeString(articleSlug, 220);

  const params = [];
  let where = "";
  if (Number.isInteger(safeNewsId) && safeNewsId > 0) {
    params.push(safeNewsId);
    where = "mn.id = $1";
  } else if (slug) {
    params.push(slug);
    where = "a.slug = $1";
  } else if (normalizedHeadline) {
    params.push(normalizedHeadline);
    where = "mn.headline = $1";
  } else {
    throw makeError("invalid_holonews_thumbnail_request");
  }

  const { rows } = await pool.query(
    `
    SELECT
      mn.id,
      mn.headline,
      mn.thumbnail_url,
      mn.date::text AS published_at,
      a.id AS article_id,
      a.slug AS article_slug
    FROM info.member_news mn
    LEFT JOIN content.articles a
      ON a.news_id = mn.id
    WHERE ${where}
    ORDER BY mn.date DESC, mn.id DESC
    LIMIT 1
  `,
    params
  );

  const item = rows[0] || null;
  if (!item) throw makeError("holonews_item_not_found");
  return {
    ...item,
    original_headline: item.headline,
    headline: normalizedHeadline || item.headline,
  };
}

// Who a thumbnail may show: the talents the headline names (full name, first name or a known
// nickname, from services/talents.js) and nobody else, however many talents it says took part.
// Mirrors holonews/cmd/holonews (identifyHeadlineTalents, planThumbnail); keep the two in step.

/** The talents a headline names, in the order it names them: `[{ symbol, name, youtube_channel_id }]`. */
function namedTalents(headline, roster) {
  const bySymbol = new Map(roster.map((talent) => [talent.symbol, talent]));
  const text = talents.normalize(headline).toLowerCase();
  const found = [];
  for (const [symbol, match] of talents.createMatcher(roster).match(headline)) {
    const talent = bySymbol.get(symbol);
    if (!talent?.name) continue;
    const at = Math.min(...match.aliases.map((alias) => text.indexOf(talents.normalize(alias).toLowerCase())).filter((index) => index >= 0), Number.MAX_SAFE_INTEGER);
    found.push({ talent, at });
  }
  return found.sort((a, b) => a.at - b.at || a.talent.name.localeCompare(b.talent.name)).map((entry) => entry.talent);
}

/**
 * The candidates someone vouched for (the model, or the admin's tags on the article), in the
 * headline's order. A name that isn't a candidate is dropped: nobody the headline doesn't name.
 */
function selectTalents(candidates, confirmed) {
  const keep = new Set();
  for (const value of confirmed || []) {
    const key = String(value ?? "").trim().replace(/^[#$]+/, "").toLowerCase();
    if (key) keep.add(key);
  }
  return candidates.filter((talent) => keep.has(String(talent.name).toLowerCase()) || keep.has(String(talent.symbol).toLowerCase()));
}

async function confirmHeadlineTalents(config, headline, candidates) {
  let prompt = "Return JSON only in this shape: {\"characters\":[\"Exact Name\"]}\n";
  prompt += "A hololive news headline contains these talents' names or nicknames:\n";
  for (const talent of candidates) prompt += `- ${talent.name}\n`;
  prompt += "Rules:\n";
  prompt += "- Keep a name only if the headline is about that talent or the talent takes part in what it describes.\n";
  prompt += "- Drop it if the word means something else there (an everyday word, another person, a game or a brand).\n";
  prompt += "- Use only exact names from the list above. Never add anyone else.\n";
  prompt += "- Output JSON only, no markdown or commentary.\n";
  prompt += `Headline: ${headline}\n`;

  const text = await callGeminiText(config, prompt);
  let parsed = null;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch (error) {
    throw makeError("gemini_request_failed", `parse character JSON: ${error?.message || error}`);
  }
  return Array.isArray(parsed?.characters) ? parsed.characters : [];
}

/**
 * Who the thumbnail shows: the named talents the model agrees the headline is about, plus any the
 * article is already tagged with. When the model can't be asked, every named talent stands.
 */
async function identifyTalents(config, headline, roster, tagged = []) {
  const candidates = namedTalents(headline, roster);
  if (!candidates.length) return [];
  let confirmed;
  try {
    confirmed = await confirmHeadlineTalents(config, headline, candidates);
  } catch (error) {
    if (error?.code === "gemini_not_configured") throw error;
    return candidates;
  }
  return selectTalents(candidates, [...confirmed, ...tagged]);
}

// The illustrator brief every thumbnail prompt starts from. Keep in step with holonews/cmd/holonews.
const THUMBNAIL_STYLE_RULES = [
  "Act as an expert VTuber Thumbnail Illustrator. I will give you a video headline. You must translate the core concept into a fun, visually clear prompt for an image generator.",
  "DEFAULT TONE: cute, playful, lively, charming, humorous, and expressive. The image should usually feel fun or endearing, not threatening, sinister, manic, or evil.",
  "Only use extreme chaos, panic, or manic comedy when the headline clearly calls for it and it would be funny.",
  "CRITICAL RULES YOU MUST FOLLOW:",
  "1. NO TEXT OR LABELS: You are strictly forbidden from asking for words, letters, logos, or signs. Represent concepts with physical props only.",
  "2. STRICT ART STYLE FORMULA: Your 'image_prompt' MUST ALWAYS begin with this exact phrase: '2D flat anime illustration, cel-shaded, official studio key visual, clean crisp lineart, vibrant colors, aesthetic anime screencap, '",
  "3. BANNED WORDS: Never use the words: 3D, realistic, hyper-detailed, cinematic, text, negative space, empty space. We are NOT adding text to these images.",
  "4. CAMERA & POSING: Prefer lively, appealing compositions such as close-up, medium close-up, slight Dutch angle, energetic pose, cheerful lean toward camera, or playful foreshortening. Avoid describing the character as aggressive, menacing, threatening, or attacking unless the headline specifically implies that tone.",
  "5. EXPRESSIONS: Favor bright, cute, funny, confident, surprised, determined, embarrassed, pouty, excited, or mischievous expressions. Use extreme or deranged expressions only if the joke or headline clearly supports it.",
  "6. ACTION WITH PROPS: Don't just place props in the background. Make the characters actively interact with them in a playful or visually clear way, such as hugging, presenting, pointing at, reacting to, or struggling comedically with the object.",
  "7. SAFE ANATOMY ANCHORING: To prevent AI anatomy errors, strictly favor 'upper body shot' or 'cowboy shot' (hips up) to avoid rendering complex leg poses. When interacting with props, prefer phrases like 'holding [prop] with both hands' or 'one hand on [prop], one hand pointing' to anchor the limbs and prevent extra arms.",
].join("\n") + "\n";

/** Who may appear: exactly the talents the headline names, or nobody. */
function thumbnailCastRules(characters) {
  if (!characters.length) {
    return "CAST: The headline names no hololive talent, so draw NO people and NO characters at all: no faces, figures, silhouettes, mascots or crowds, and never guess who it might be about, even when it says how many talents are involved. "
      + "If the story has a clear subject you can show with objects or a place (a stage, a game board with dice, a trophy, a calendar, a concert hall), describe that scene with nobody in it. "
      + "If it has nothing clear to picture, return {\"image_prompt\":\"\",\"skip\":true}.\n";
  }
  return `CAST: Draw exactly these hololive talents and nobody else: ${characters.join(", ")}. `
    + "Even if the headline mentions more people or a number of talents, add no other characters, background people or crowds.\n";
}

async function generateThumbnailPrompt(config, headline, characters) {
  let prompt = "Return JSON only in this shape: {\"image_prompt\":\"...\",\"skip\":false}\n\n";
  prompt += THUMBNAIL_STYLE_RULES;
  prompt += thumbnailCastRules(characters);
  prompt += `Here is the headline: ${headline}\n`;

  const text = await callGeminiText(config, prompt);
  let parsed = null;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch (error) {
    throw makeError("gemini_request_failed", `parse prompt JSON: ${error?.message || error}`);
  }
  return { image_prompt: normalizeString(parsed?.image_prompt, 4000) || "", skip: parsed?.skip === true };
}

/** The illustrator's prompt plus who the image model may draw: exactly the named talents, or nobody. */
function thumbnailImagePrompt(imagePrompt, characters) {
  const prompt = String(imagePrompt || "").trim();
  if (!characters.length) {
    return `${prompt}\nDraw no people and no characters: no faces, figures, silhouettes, mascots or crowds. Show only objects and places.`;
  }
  const subjects = characters.map((name) => {
    const { note } = referenceImagesFor(name);
    return note ? `${name} (${note})` : name;
  });
  const count = characters.length === 1 ? "1 character" : `${characters.length} characters`;
  return `${prompt}\nDraw exactly ${count}: ${subjects.join(", ")}. Use the attached reference images only for their character designs. Add no other characters, background people or crowds.`;
}

/**
 * Whether a headline gets a thumbnail: one that names no talent and has nothing clear to picture
 * gets none, and the site shows its usual picture for a story without one.
 * → { draw, prompt } or { draw: false, reason }.
 */
function planThumbnail(characters, prompt) {
  if (!characters.length && prompt?.skip) {
    return { draw: false, reason: "This headline names no talent and has nothing clear to picture, so no thumbnail was made." };
  }
  if (!String(prompt?.image_prompt || "").trim()) return { draw: false, reason: "The image prompt came back empty, so no thumbnail was made." };
  return { draw: true, prompt: thumbnailImagePrompt(prompt.image_prompt, characters) };
}

async function loadReferenceImages(config, names) {
  const out = [];
  const missing = [];
  for (const name of names) {
    for (const slug of referenceImagesFor(name).slugs) {
      const imageURL = `${config.referenceImagesBaseURL}/${encodeURIComponent(slug)}.jpg`;
      try {
        const response = await fetch(imageURL);
        if (!response.ok) {
          missing.push(`${imageURL} (http ${response.status})`);
          continue;
        }
        const bytes = Buffer.from(await response.arrayBuffer());
        if (!bytes.length) {
          missing.push(`${imageURL} (empty)`);
          continue;
        }
        out.push({ name, mimeType: "image/jpeg", bytes, url: imageURL });
      } catch (error) {
        missing.push(`${imageURL} (${error?.message || error})`);
      }
    }
  }
  if (missing.length) {
    const error = makeError("reference_images_missing", `missing reference images: ${missing.join("; ")}`);
    error.reference_image_errors = missing;
    error.loaded_reference_images = out.map((item) => ({ name: item.name, url: item.url }));
    throw error;
  }
  return out;
}

/** One image from a prompt built by planThumbnail and the talents' reference images. */
async function generateImage(config, prompt, referenceImages) {
  const parts = [{ text: prompt }];
  for (const ref of referenceImages) {
    parts.push({
      inline_data: {
        mime_type: ref.mimeType,
        data: ref.bytes.toString("base64"),
      },
    });
  }

  const response = await callGemini(config, config.geminiImageModel, {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature: 0.9,
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio: "16:9",
        imageSize: "2K",
      },
    },
  });

  const textParts = [];
  for (const candidate of response.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      const inline = part.inlineData || part.inline_data;
      if (inline?.data) {
        return {
          bytes: Buffer.from(inline.data, "base64"),
          mimeType: inline.mimeType || inline.mime_type || "image/png",
        };
      }
      if (optionalTrimmedString(part.text)) textParts.push(part.text.trim());
    }
  }
  throw makeError("gemini_request_failed", `gemini image response missing inline image data${textParts.length ? `: ${textParts.join(" | ")}` : ""}`);
}

function mimeExtension(mimeType) {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized === "image/jpeg") return ".jpg";
  if (normalized === "image/png") return ".png";
  if (normalized === "image/webp") return ".webp";
  return ".bin";
}

function variantKey(key) {
  const dir = path.posix.dirname(key);
  const file = path.posix.basename(key);
  if (!dir || dir === ".") return `thumbnail-${file}`;
  return `${dir}/thumbnail-${file}`;
}

function s3TimestampKey(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-") + `-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

async function uploadThumbnail(config, headline, image) {
  const s3 = getS3Client();
  if (!s3) throw makeError("s3_not_configured");

  const hash = crypto.createHash("sha256").update(image.bytes).digest("hex").slice(0, 12);
  const timestamp = s3TimestampKey();
  const key = `${config.thumbnailS3Prefix}/${timestamp}-admin-${hash}${mimeExtension(image.mimeType)}`;
  const metadata = { headline };

  await s3.client.send(new PutObjectCommand({
    Bucket: s3.bucket,
    Key: key,
    Body: image.bytes,
    ContentType: image.mimeType,
    Metadata: metadata,
    CacheControl: "public, max-age=31536000, immutable",
  }));

  const square = await sharp(image.bytes, { failOn: "none" })
    .rotate()
    .resize(480, 480, { fit: "cover", position: "center" })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();
  const squareKey = variantKey(key);
  await s3.client.send(new PutObjectCommand({
    Bucket: s3.bucket,
    Key: squareKey,
    Body: square,
    ContentType: "image/jpeg",
    Metadata: { ...metadata, "source-key": key, variant: "thumbnail" },
    CacheControl: "public, max-age=31536000, immutable",
  }));

  return {
    s3_key: key,
    thumbnail_s3_key: squareKey,
    url: encodeS3URL(config.thumbnailCDNBaseURL, key),
    thumbnail_url: encodeS3URL(config.thumbnailCDNBaseURL, squareKey),
  };
}

async function persistThumbnail(pool, target, upload, members) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // A new thumbnail from an admin also lifts an earlier "remove thumbnail".
    await client.query(
      `
      UPDATE info.member_news
      SET headline = $2,
          thumbnail_url = $3,
          thumbnail_removed_at = NULL
      WHERE id = $1
    `,
      [target.id, target.headline, upload.url]
    );

    const channelIds = dedupeStrings(members.map((member) => member.youtube_channel_id).filter(Boolean));
    if (channelIds.length) {
      await client.query(`DELETE FROM info.member_news_channels WHERE news_id = $1`, [target.id]);
      await client.query(
        `
        INSERT INTO info.member_news_channels (news_id, youtube_channel_id)
        SELECT $1::bigint, unnest($2::text[])
        ON CONFLICT DO NOTHING
      `,
        [target.id, channelIds]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const ensured = await articleDb.ensureNewsArticles(pool, [Number(target.id)]);
  const ensuredArticle = ensured.get(Number(target.id)) || null;

  return {
    article_id: ensuredArticle?.id || target.article_id || null,
    article_slug: ensuredArticle?.slug || target.article_slug || null,
  };
}

/**
 * Rewrites the holonews scraper's Redis copy of one headline (the front page's lead stories read
 * it): `patch(item)` gives the new item. Returns whether anything changed.
 */
async function patchRedisItem(redis, target, patch) {
  if (!redis) return false;
  const rawItems = await redis.lRange(REDIS_ITEMS_KEY, 0, -1);
  if (!Array.isArray(rawItems) || !rawItems.length) return false;

  const matches = (item) => item?.headline === target.headline || item?.headline === target.original_headline;
  let changed = false;
  const nextItems = rawItems.map((raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (!matches(parsed)) return raw;
      changed = true;
      return JSON.stringify(patch(parsed));
    } catch {
      return raw;
    }
  });

  if (!changed) return false;
  const multi = redis.multi();
  multi.del(REDIS_ITEMS_KEY);
  for (const item of nextItems) multi.rPush(REDIS_ITEMS_KEY, item);
  const rawMeta = await redis.get(REDIS_META_KEY);
  if (rawMeta) {
    try {
      const meta = JSON.parse(rawMeta);
      if (Array.isArray(meta.items)) {
        meta.items = meta.items.map((item) => (matches(item) ? patch(item) : item));
        meta.updated_at = new Date().toISOString();
        multi.set(REDIS_META_KEY, JSON.stringify(meta));
      }
    } catch {
      // Ignore malformed legacy Redis metadata; the DB is the source of truth here.
    }
  }
  await multi.exec();
  return true;
}

async function regenerateThumbnail(pool, redis, input = {}) {
  const config = getConfig();
  const target = await resolveNewsTarget(pool, {
    newsId: input.news_id ?? input.newsId,
    articleSlug: input.article_slug ?? input.articleSlug ?? input.slug,
    headline: input.headline,
  });
  // The article's tags (sent by the admin tools) vouch for a talent the headline names, but can't
  // add one it doesn't.
  const tagged = [
    ...normalizeList(input.impacted_coins ?? input.impactedCoins ?? input.coins ?? input.symbols),
    ...normalizeList(input.reference_images ?? input.referenceImages ?? input.characters),
  ];
  const roster = await talents.loadTalents(pool);
  const members = await identifyTalents(config, target.headline, roster, tagged);
  const characterNames = members.map((member) => member.name);

  const prompt = await generateThumbnailPrompt(config, target.headline, characterNames);
  const plan = planThumbnail(characterNames, prompt);
  if (!plan.draw) throw makeError("thumbnail_not_drawn", plan.reason);

  const referenceImages = await loadReferenceImages(config, characterNames);
  const image = await generateImage(config, plan.prompt, referenceImages);
  const upload = await uploadThumbnail(config, target.headline, image);

  const association = await persistThumbnail(pool, target, upload, members);
  const redis_updated = await patchRedisItem(redis, target, (item) => ({
    ...item,
    headline: target.headline,
    characters: characterNames,
    thumbnail_s3_key: upload.s3_key,
  }));

  return {
    news_item: {
      id: Number(target.id),
      headline: target.headline,
      article_id: association.article_id,
      article_slug: association.article_slug,
      thumbnail_url: upload.url,
    },
    prompt,
    impacted_members: members,
    reference_images: referenceImages.map((item) => ({ name: item.name, url: item.url })),
    upload,
    redis_updated,
  };
}

/**
 * Takes a news story's thumbnail off: the article shows the site's usual picture for a story without
 * one, and holonews doesn't draw a new one on its own (thumbnail_removed_at). "New thumbnail" puts
 * one back. The image stays in S3; the admin log keeps its address.
 */
async function removeThumbnail(pool, redis, input = {}) {
  const target = await resolveNewsTarget(pool, {
    newsId: input.news_id ?? input.newsId,
    articleSlug: input.article_slug ?? input.articleSlug ?? input.slug,
  });
  const client = await pool.connect();
  let previous = null;
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      `
      SELECT mn.thumbnail_url AS news_thumbnail_url, a.thumbnail_url AS article_thumbnail_url
      FROM info.member_news mn
      LEFT JOIN content.articles a ON a.news_id = mn.id
      WHERE mn.id = $1
      FOR UPDATE OF mn
    `,
      [target.id]
    );
    previous = rows[0]?.news_thumbnail_url || rows[0]?.article_thumbnail_url || null;
    await client.query(`UPDATE info.member_news SET thumbnail_url = NULL, thumbnail_removed_at = now() WHERE id = $1`, [target.id]);
    await client.query(`UPDATE content.articles SET thumbnail_url = NULL, updated_at = now() WHERE news_id = $1`, [target.id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const redis_updated = await patchRedisItem(redis, target, (item) => ({ ...item, thumbnail_s3_key: null }));
  return {
    news_item: {
      id: Number(target.id),
      headline: target.headline,
      article_id: target.article_id ? Number(target.article_id) : null,
      article_slug: target.article_slug || null,
      thumbnail_url: null,
    },
    previous_thumbnail_url: previous,
    redis_updated,
  };
}

module.exports = {
  _test: { referenceImagesFor, namedTalents, selectTalents, identifyTalents, thumbnailCastRules, thumbnailImagePrompt, planThumbnail },
  regenerateThumbnail,
  removeThumbnail,
};
