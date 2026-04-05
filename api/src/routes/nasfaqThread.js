const express = require("express");
const path = require("node:path");
const { HeadObjectCommand, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const router = express.Router();

const FOURCHAN_BOARD = "vt";
const THREAD_CACHE_TTL_SECONDS = 60;
const FOURCHAN_API_BASE = "https://a.4cdn.org";
const FOURCHAN_IMAGE_BASE = "https://i.4cdn.org";
const FOURCHAN_BOARD_URL = "https://boards.4channel.org/vt/";
const THREAD_OPS_PREFIX = "thread-ops";
const THREAD_OPS_CDN_BASE_URL = "https://images.nasfaq.biz/thread-ops";
const MAX_THREAD_OP_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const ALLOWED_IMAGE_CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const THREAD_DEFINITIONS = {
  nasfaq: {
    key: "nasfaq",
    routePath: "/getNasfaqThread",
    cacheKey: "nasfaq_4chan:vt:nasfaq_thread:payload",
    notFoundError: "nasfaq_thread_not_found",
    matcher: (thread) => normalizeSearchableText(thread.sub).includes("nasfaq"),
  },
  hlg: {
    key: "hlg",
    routePath: "/getHlgThread",
    cacheKey: "nasfaq_4chan:vt:hlg_thread:payload",
    notFoundError: "hlg_thread_not_found",
    matcher: (thread) => {
      const subject = normalizeSearchableText(thread.sub);
      const comment = normalizeSearchableText(thread.com);
      return subject.includes("hololive global") || comment.includes("hololive global");
    },
  },
  numbers: {
    key: "numbers",
    routePath: "/getNumbersThread",
    aliasRoutePaths: ["/getPoundThread"],
    cacheKey: "nasfaq_4chan:vt:numbers_thread:payload",
    notFoundError: "numbers_thread_not_found",
    matcher: (thread) => normalizeSearchableText(thread.sub).includes("#"),
  },
  news: {
    key: "news",
    routePath: "/getNewsThread",
    cacheKey: "nasfaq_4chan:vt:news_thread:payload",
    notFoundError: "news_thread_not_found",
    matcher: (thread) => normalizeSearchableText(thread.sub).includes("/news/"),
  },
};

function decodeHtmlEntities(value) {
  if (!value) return "";

  return value
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCodePoint(parsed) : _;
    })
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, "\"")
    .replace(/&apos;/gi, "'")
    .replace(/&#039;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function normalizeSearchableText(value) {
  return decodeHtmlEntities(String(value || "")).trim().toLowerCase();
}

function toPlainText(html) {
  if (!html) return "";

  const withLineBreaks = html
    .replace(/<wbr\s*\/?>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  const decoded = decodeHtmlEntities(withLineBreaks);
  return decoded
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildImageUrls(board, post) {
  if (!post || !post.tim || !post.ext) {
    return { image_url: null, thumbnail_url: null };
  }

  return {
    image_url: `${FOURCHAN_IMAGE_BASE}/${board}/${post.tim}${post.ext}`,
    thumbnail_url: `${FOURCHAN_IMAGE_BASE}/${board}/${post.tim}s.jpg`,
  };
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "NASFAQV2/1.0 (+https://nasfaq.biz)",
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`4chan_http_${response.status}`);
    error.statusCode = response.status;
    error.responseText = body;
    throw error;
  }
  return response.json();
}

async function fetchCatalog(board, signal) {
  return fetchJson(`${FOURCHAN_API_BASE}/${board}/catalog.json`, { signal });
}

async function fetchThread(board, threadId, signal) {
  return fetchJson(`${FOURCHAN_API_BASE}/${board}/thread/${threadId}.json`, { signal });
}

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
}

function normalizeImageExtension(value) {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) return null;
  return trimmed.startsWith(".") ? trimmed.toLowerCase() : `.${trimmed.toLowerCase()}`;
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

function extensionFromContentType(contentType, fallbackExt) {
  const normalized = (contentType || "").toLowerCase().split(";")[0].trim();
  switch (normalized) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return fallbackExt && ALLOWED_IMAGE_EXTENSIONS.has(fallbackExt) ? fallbackExt : null;
  }
}

async function ensureOpImageOnCdn(post) {
  const s3 = getS3Client();
  if (!s3 || !post?.tim || !post?.ext) {
    return null;
  }

  const sourceUrl = `${FOURCHAN_IMAGE_BASE}/${FOURCHAN_BOARD}/${post.tim}${post.ext}`;
  const fallbackExt = normalizeImageExtension(post.ext);
  if (!fallbackExt || !ALLOWED_IMAGE_EXTENSIONS.has(fallbackExt)) {
    return null;
  }

  let objectKey = `${THREAD_OPS_PREFIX}/${post.tim}${fallbackExt}`;
  try {
    await s3.client.send(new HeadObjectCommand({ Bucket: s3.bucket, Key: objectKey }));
    return `${THREAD_OPS_CDN_BASE_URL}/${encodeURIComponent(path.basename(objectKey))}`;
  } catch (error) {
  }

  const response = await fetch(sourceUrl, {
    headers: {
      Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
      Referer: FOURCHAN_BOARD_URL,
      "User-Agent": "NASFAQV2/1.0 (+https://images.nasfaq.biz/thread-ops)",
    },
  });

  if (!response.ok) return null;

  const contentType = (response.headers.get("content-type") || "application/octet-stream").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_IMAGE_CONTENT_TYPES.has(contentType)) {
    return null;
  }

  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_THREAD_OP_IMAGE_BYTES) {
    return null;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_THREAD_OP_IMAGE_BYTES) {
    return null;
  }

  const resolvedExt = extensionFromContentType(contentType, fallbackExt);
  if (!resolvedExt) {
    return null;
  }

  objectKey = `${THREAD_OPS_PREFIX}/${post.tim}${resolvedExt}`;
  try {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: objectKey,
        Body: bytes,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
  } catch (error) {
    return null;
  }

  return `${THREAD_OPS_CDN_BASE_URL}/${encodeURIComponent(path.basename(objectKey))}`;
}

function findThread(catalog, definition) {
  for (const page of Array.isArray(catalog) ? catalog : []) {
    for (const thread of Array.isArray(page?.threads) ? page.threads : []) {
      if (!definition.matcher(thread)) continue;
      return {
        threadId: Number(thread.no) || 0,
        subject: decodeHtmlEntities(String(thread.sub || "")).trim() || null,
      };
    }
  }

  return { threadId: 0, subject: null };
}

async function normalizeThreadPayload(definition, threadId, subject, threadResponse) {
  const posts = Array.isArray(threadResponse?.posts) ? threadResponse.posts : [];
  const opCdnImageUrl = posts[0] ? await ensureOpImageOnCdn(posts[0]) : null;

  return {
    key: definition.key,
    board: FOURCHAN_BOARD,
    thread_id: threadId,
    subject,
    updated_at: new Date().toISOString(),
    posts: posts.map((post, index) => {
      const imageUrls = buildImageUrls(FOURCHAN_BOARD, post);
      return {
        post_id: Number(post?.no) || null,
        timestamp: Number(post?.time) || null,
        author: decodeHtmlEntities(String(post?.name || "")).trim() || "Anonymous",
        text_content: toPlainText(String(post?.com || "")),
        image_url: imageUrls.image_url,
        thumbnail_url: imageUrls.thumbnail_url,
        op_cdn_image_url: index === 0 ? opCdnImageUrl : null,
      };
    }).filter((post) => post.post_id !== null),
  };
}

async function handleThreadRequest(req, res, definition) {
  const redis = req.ctx.redis;
  if (!redis) return res.status(500).json({ error: "redis_not_configured" });

  const cachedPayload = await redis.get(definition.cacheKey);
  if (cachedPayload) {
    res.type("application/json");
    return res.send(cachedPayload);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const catalog = await fetchCatalog(FOURCHAN_BOARD, controller.signal);
    const { threadId, subject } = findThread(catalog, definition);

    if (!threadId) {
      return res.status(404).json({ error: definition.notFoundError });
    }

    const threadResponse = await fetchThread(FOURCHAN_BOARD, threadId, controller.signal);
    const payload = await normalizeThreadPayload(definition, threadId, subject, threadResponse);
    const serialized = JSON.stringify(payload);

    await redis.set(definition.cacheKey, serialized, { EX: THREAD_CACHE_TTL_SECONDS });
    res.type("application/json");
    return res.send(serialized);
  } finally {
    clearTimeout(timeout);
  }
}

for (const definition of Object.values(THREAD_DEFINITIONS)) {
  const routePaths = [definition.routePath, ...(definition.aliasRoutePaths || [])];
  for (const routePath of routePaths) {
    router.get(routePath, async (req, res, next) => {
      try {
        return await handleThreadRequest(req, res, definition);
      } catch (error) {
        if (error?.name === "AbortError") {
          return res.status(504).json({ error: "fourchan_timeout" });
        }
        if (error?.statusCode === 404) {
          return res.status(404).json({ error: definition.notFoundError });
        }
        return next(error);
      }
    });
  }
}

module.exports = router;
