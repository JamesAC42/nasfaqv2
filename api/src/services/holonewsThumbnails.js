const crypto = require("node:crypto");
const path = require("node:path");
const sharp = require("sharp");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");
const articleDb = require("../articleDb");

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

function memberSlug(name) {
  return String(name || "").trim().toLowerCase().replaceAll(" ", "-");
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

async function loadValidMemberNames(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT btrim(name_english) AS name
    FROM yt.youtube_channels
    WHERE is_active = true
      AND name_english IS NOT NULL
      AND btrim(name_english) <> ''
    ORDER BY btrim(name_english) ASC
  `);
  return rows.map((row) => row.name).filter(Boolean);
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

async function resolveImpactedMembers(pool, impactedCoins, referenceImages) {
  const tokens = dedupeStrings([...normalizeList(impactedCoins), ...normalizeList(referenceImages)]);
  if (!tokens.length) return [];
  const lookupTokens = dedupeStrings(tokens.flatMap((item) => [
    item,
    item.replace(/^[#$]+/, ""),
  ])).map((item) => item.toLowerCase());

  const { rows } = await pool.query(
    `
    SELECT DISTINCT
      yc.youtube_channel_id,
      btrim(yc.name_english) AS name_english,
      yc.name_short,
      ma.id AS asset_id,
      ma.symbol
    FROM yt.youtube_channels yc
    LEFT JOIN market.market_assets ma
      ON ma.youtube_channel_id = yc.youtube_channel_id
    WHERE yc.is_active = true
      AND (
        lower(yc.youtube_channel_id) = ANY($1::text[])
        OR lower(yc.name_short) = ANY($1::text[])
        OR lower(btrim(COALESCE(yc.name_english, ''))) = ANY($1::text[])
        OR lower(COALESCE(yc.symbol, '')) = ANY($1::text[])
        OR lower(COALESCE(ma.symbol, '')) = ANY($1::text[])
      )
    ORDER BY btrim(yc.name_english) ASC
  `,
    [lookupTokens]
  );

  return rows
    .filter((row) => row.name_english)
    .map((row) => ({
      youtube_channel_id: row.youtube_channel_id,
      name: row.name_english,
      asset_id: row.asset_id ? Number(row.asset_id) : null,
      symbol: row.symbol || null,
    }));
}

async function generateThumbnailPrompt(config, headline, validMembers) {
  let prompt = "Return JSON only in this shape: {\"image_prompt\":\"...\",\"characters\":[\"Exact Member Name\"]}\n";
  prompt += "The character names array must contain only exact values from the valid member list below.\n";
  prompt += "Use an empty array if the headline does not clearly refer to a member.\n\n";
  prompt += "Act as an expert VTuber Thumbnail Illustrator. I will give you a video headline. You must translate the core concept into a fun, visually clear prompt for an image generator.\n";
  prompt += "DEFAULT TONE: cute, playful, lively, charming, humorous, and expressive. The image should usually feel fun or endearing, not threatening, sinister, manic, or evil.\n";
  prompt += "Only use extreme chaos, panic, or manic comedy when the headline clearly calls for it and it would be funny.\n";
  prompt += "CRITICAL RULES YOU MUST FOLLOW:\n";
  prompt += "1. NO TEXT OR LABELS: You are strictly forbidden from asking for words, letters, logos, or signs. Represent concepts with physical props only.\n";
  prompt += "2. STRICT ART STYLE FORMULA: Your 'image_prompt' MUST ALWAYS begin with this exact phrase: '2D flat anime illustration, cel-shaded, official studio key visual, clean crisp lineart, vibrant colors, aesthetic anime screencap, '\n";
  prompt += "3. BANNED WORDS: Never use the words: 3D, realistic, hyper-detailed, cinematic, text, negative space, empty space. We are NOT adding text to these images.\n";
  prompt += "4. CAMERA & POSING: Prefer lively, appealing compositions such as close-up, medium close-up, slight Dutch angle, energetic pose, cheerful lean toward camera, or playful foreshortening. Avoid describing the character as aggressive, menacing, threatening, or attacking unless the headline specifically implies that tone.\n";
  prompt += "5. EXPRESSIONS: Favor bright, cute, funny, confident, surprised, determined, embarrassed, pouty, excited, or mischievous expressions. Use extreme or deranged expressions only if the joke or headline clearly supports it.\n";
  prompt += "6. ACTION WITH PROPS: Don't just place props in the background. Make the characters actively interact with them in a playful or visually clear way, such as hugging, presenting, pointing at, reacting to, or struggling comedically with the object.\n\n";
  prompt += "7. SAFE ANATOMY ANCHORING: To prevent AI anatomy errors, strictly favor 'upper body shot' or 'cowboy shot' (hips up) to avoid rendering complex leg poses. When interacting with props, prefer phrases like 'holding [prop] with both hands' or 'one hand on [prop], one hand pointing' to anchor the limbs and prevent extra arms.\n";
  prompt += `Here is the headline: ${headline}\n\nValid members:\n`;
  for (const name of validMembers) prompt += `- ${name}\n`;

  const text = await callGeminiText(config, prompt);
  let parsed = null;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch (error) {
    throw makeError("gemini_request_failed", `parse prompt JSON: ${error?.message || error}`);
  }
  const imagePrompt = normalizeString(parsed.image_prompt, 4000);
  if (!imagePrompt) throw makeError("gemini_request_failed", "empty image prompt");

  const validSet = new Set(validMembers);
  const characters = dedupeStrings(Array.isArray(parsed.characters) ? parsed.characters : []).filter((name) => validSet.has(name));
  return { image_prompt: imagePrompt, characters };
}

async function loadReferenceImages(config, names) {
  const out = [];
  const missing = [];
  for (const name of names) {
    const imageURL = `${config.referenceImagesBaseURL}/${encodeURIComponent(memberSlug(name))}.jpg`;
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
  if (missing.length) {
    const error = makeError("reference_images_missing", `missing reference images: ${missing.join("; ")}`);
    error.reference_image_errors = missing;
    error.loaded_reference_images = out.map((item) => ({ name: item.name, url: item.url }));
    throw error;
  }
  return out;
}

async function generateImage(config, imagePrompt, characters, referenceImages) {
  let prompt = imagePrompt;
  if (characters.length) {
    prompt += `\nUse these attached reference images only for character design consistency for: ${characters.join(", ")}.`;
  }

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
    await client.query(
      `
      UPDATE info.member_news
      SET headline = $2,
          thumbnail_url = $3
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

async function updateRedisState(redis, target, upload, characterNames) {
  if (!redis) return false;
  const rawItems = await redis.lRange(REDIS_ITEMS_KEY, 0, -1);
  if (!Array.isArray(rawItems) || !rawItems.length) return false;

  let changed = false;
  const nextItems = rawItems.map((raw) => {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.headline !== target.headline && parsed?.headline !== target.original_headline) return raw;
      changed = true;
      return JSON.stringify({
        ...parsed,
        headline: target.headline,
        characters: characterNames,
        thumbnail_s3_key: upload.s3_key,
      });
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
        meta.items = meta.items.map((item) => (
          item?.headline === target.headline || item?.headline === target.original_headline
            ? { ...item, headline: target.headline, characters: characterNames, thumbnail_s3_key: upload.s3_key }
            : item
        ));
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
  const validMembers = await loadValidMemberNames(pool);
  const impactedMembers = await resolveImpactedMembers(
    pool,
    input.impacted_coins ?? input.impactedCoins ?? input.coins ?? input.symbols,
    input.reference_images ?? input.referenceImages ?? input.characters
  );

  const prompt = await generateThumbnailPrompt(config, target.headline, validMembers);
  const characterNames = dedupeStrings([
    ...impactedMembers.map((member) => member.name),
    ...prompt.characters,
  ]).filter((name) => validMembers.includes(name));

  const referenceImages = await loadReferenceImages(config, characterNames);
  const image = await generateImage(config, prompt.image_prompt, characterNames, referenceImages);
  const upload = await uploadThumbnail(config, target.headline, image);

  const membersByName = new Map(impactedMembers.map((member) => [member.name, member]));
  if (characterNames.some((name) => !membersByName.has(name))) {
    const resolvedPromptMembers = await resolveImpactedMembers(pool, [], characterNames);
    for (const member of resolvedPromptMembers) membersByName.set(member.name, member);
  }
  const members = characterNames.map((name) => membersByName.get(name)).filter(Boolean);
  const association = await persistThumbnail(pool, target, upload, members);
  const redis_updated = await updateRedisState(redis, target, upload, characterNames);

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

module.exports = {
  regenerateThumbnail,
};
