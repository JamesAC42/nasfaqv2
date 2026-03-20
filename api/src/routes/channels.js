const express = require("express");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const db = require("../db");

const router = express.Router();
const execFileAsync = promisify(execFile);
const CHANNELSCRAPER_DIR = path.resolve(__dirname, "..", "..", "..", "channelscraper");
const DETECT_TIMEOUT_MS = 300000;
const ICON_CDN_BASE_URL = "https://images.nasfaq.biz/icons";
const REFERENCE_IMAGE_CDN_BASE_URL = "https://images.nasfaq.biz/reference-images";
const MAX_ICON_UPLOAD_BYTES = 1024 * 1024;
const MAX_REFERENCE_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const REFERENCE_IMAGE_SCALE = 0.6;
const REFERENCE_IMAGE_JPEG_QUALITY = 76;

function toVideoLink(videoId) {
  return videoId ? `https://www.youtube.com/watch?v=${videoId}` : null;
}
function toChannelLink(channelId) {
  return channelId ? `https://www.youtube.com/channel/${channelId}` : null;
}

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
}

function optionalHexColor(value) {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) return null;
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : INVALID_COLOR;
}

function getIconUrl(iconName) {
  if (!iconName) return null;
  return `${ICON_CDN_BASE_URL}/${encodeURIComponent(iconName)}.svg`;
}

function getReferenceImageUrl(filename) {
  if (!filename) return null;
  return `${REFERENCE_IMAGE_CDN_BASE_URL}/${encodeURIComponent(filename)}`;
}

const INVALID_DATE = Symbol("invalid_date");
const INVALID_COLOR = Symbol("invalid_color");

function optionalIsoDate(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return INVALID_DATE;

  const parsed = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return INVALID_DATE;
  return trimmed;
}

function normalizeChannelKey(value) {
  return (value || "").toString().trim().toLowerCase();
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
      followRegionRedirects: true
    })
  };
}

function parseUploadedIconName(filename) {
  const baseName = path.parse(path.basename((filename || "").toString())).name.trim();
  return baseName || null;
}

function decodeSvgUpload(data) {
  const trimmed = optionalTrimmedString(data);
  if (!trimmed) return null;

  const buffer = Buffer.from(trimmed, "base64");
  if (!buffer.length || buffer.length > MAX_ICON_UPLOAD_BYTES) {
    return null;
  }

  const text = buffer.toString("utf8").trim();
  if (!text || !/<svg[\s>]/i.test(text)) {
    return null;
  }

  return Buffer.from(text, "utf8");
}

function defaultIconValue(nameEnglish, nameShort) {
  let source = (nameShort || "").toString().trim();
  if (nameEnglish) {
    const fields = nameEnglish
      .toString()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (fields.length > 0) {
      source = fields[fields.length - 1];
    }
  }

  const icon = source.toLowerCase().replace(/[^a-z]/g, "");
  return icon || null;
}

function defaultSymbolValue(nameEnglish, nameShort) {
  let source = (nameShort || "").toString().trim();
  if (nameEnglish) {
    const fields = nameEnglish
      .toString()
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (fields.length > 0) {
      source = fields[fields.length - 1];
    }
  }

  const letters = source.toLowerCase().replace(/[^a-z]/g, "");
  if (!letters) return null;

  const nonVowels = letters.replace(/[aeiou]/g, "");
  const symbol = nonVowels.length >= 3 ? nonVowels.slice(0, 3) : letters.slice(0, 3);
  return symbol ? symbol.toUpperCase() : null;
}

function normalizeChannelInput(body, { currentIsActive = true, useDefaultIcon = false, useDefaultSymbol = false } = {}) {
  const name_short = (body?.name_short ?? body?.name ?? "").toString().trim();
  const name_english = optionalTrimmedString(body?.name_english);
  const icon = optionalTrimmedString(body?.icon) ?? (useDefaultIcon ? defaultIconValue(name_english, name_short) : null);
  const symbol = optionalTrimmedString(body?.symbol) ?? (useDefaultSymbol ? defaultSymbolValue(name_english, name_short) : null);

  return {
    youtube_channel_id: (body?.youtube_channel_id || "").toString().trim(),
    name_short,
    name_english,
    name_japanese: optionalTrimmedString(body?.name_japanese),
    symbol,
    icon,
    color: optionalHexColor(body?.color),
    twitter_id: optionalTrimmedString(body?.twitter_id),
    profile_id: optionalTrimmedString(body?.profile_id),
    birthday: optionalIsoDate(body?.birthday),
    height: optionalTrimmedString(body?.height),
    unit: optionalTrimmedString(body?.unit),
    is_active: body?.is_active === undefined ? currentIsActive : Boolean(body?.is_active)
  };
}

function normalizeReferenceImageUrl(value) {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function toChannelResponse(channel) {
  return {
    ...channel,
    youtube_channel_url: toChannelLink(channel.youtube_channel_id)
  };
}

function toDetectedChannelResponse(channel) {
  const icon = optionalTrimmedString(channel.icon) ?? defaultIconValue(channel.name_english, channel.name_short);
  const symbol = optionalTrimmedString(channel.symbol) ?? defaultSymbolValue(channel.name_english, channel.name_short);
  return {
    youtube_channel_id: channel.youtube_channel_id,
    name_short: channel.name_short,
    name: channel.name_short,
    name_english: channel.name_english || null,
    name_japanese: channel.name_japanese || null,
    symbol,
    icon,
    twitter_id: channel.twitter_id || null,
    profile_id: channel.profile_id || null,
    birthday: channel.birthday || null,
    height: channel.height || null,
    unit: channel.unit || null,
    reference_image_url: normalizeReferenceImageUrl(channel.reference_image_url),
    is_active: false,
    youtube_channel_url: toChannelLink(channel.youtube_channel_id)
  };
}

function referenceImageBaseName(channel) {
  const source = optionalTrimmedString(channel?.profile_id) || optionalTrimmedString(channel?.youtube_channel_id);
  if (!source) return null;
  const normalized = source.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || null;
}

function extensionFromContentType(contentType) {
  switch ((contentType || "").toLowerCase().split(";")[0].trim()) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    default:
      return null;
  }
}

function getSharp() {
  try {
    // Loaded lazily so the API can still boot far enough to give a clear error if deps are missing.
    return require("sharp");
  } catch {
    return null;
  }
}

async function optimizeReferenceImage(bytes) {
  const sharp = getSharp();
  if (!sharp) {
    const error = new Error("reference_image_processing_not_configured");
    error.code = "reference_image_processing_not_configured";
    throw error;
  }

  let image = sharp(bytes, { failOn: "none" }).rotate();
  let metadata;
  try {
    metadata = await image.metadata();
  } catch (cause) {
    const error = new Error(`reference image metadata failed: ${optionalTrimmedString(cause?.message) || "decode error"}`);
    error.code = "reference_image_processing_failed";
    throw error;
  }

  const nextWidth = metadata?.width ? Math.max(1, Math.round(metadata.width * REFERENCE_IMAGE_SCALE)) : null;
  if (nextWidth) {
    image = image.resize({ width: nextWidth, withoutEnlargement: true });
  }

  try {
    return await image
      .flatten({ background: "#ffffff" })
      .jpeg({
        quality: REFERENCE_IMAGE_JPEG_QUALITY,
        mozjpeg: true,
        progressive: true,
        chromaSubsampling: "4:2:0"
      })
      .toBuffer();
  } catch (cause) {
    const error = new Error(`reference image processing failed: ${optionalTrimmedString(cause?.message) || "encode error"}`);
    error.code = "reference_image_processing_failed";
    throw error;
  }
}

async function uploadReferenceImageFromUrl(channel, rawUrl) {
  const s3 = getS3Client();
  if (!s3) {
    const error = new Error("reference_image_upload_not_configured");
    error.code = "reference_image_upload_not_configured";
    throw error;
  }

  const objectBaseName = referenceImageBaseName(channel);
  if (!objectBaseName) {
    return null;
  }

  let response;
  try {
    response = await fetch(rawUrl, {
      headers: {
        "User-Agent": "NASFAQV2 API/1.0 (+https://images.nasfaq.biz/reference-images)"
      }
    });
  } catch (cause) {
    const error = new Error(`reference image download failed: ${optionalTrimmedString(cause?.message) || "network error"}`);
    error.code = "reference_image_download_failed";
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`reference image download failed with ${response.status}`);
    error.code = "reference_image_download_failed";
    throw error;
  }

  const contentType = optionalTrimmedString(response.headers.get("content-type")) || "application/octet-stream";
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_REFERENCE_IMAGE_UPLOAD_BYTES) {
    const error = new Error("reference image exceeds size limit");
    error.code = "reference_image_download_failed";
    throw error;
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_REFERENCE_IMAGE_UPLOAD_BYTES) {
    const error = new Error("reference image exceeds size limit");
    error.code = "reference_image_download_failed";
    throw error;
  }

  const optimizedBytes = await optimizeReferenceImage(bytes);
  if (!optimizedBytes.length || optimizedBytes.length > MAX_REFERENCE_IMAGE_UPLOAD_BYTES) {
    const error = new Error("optimized reference image exceeds size limit");
    error.code = "reference_image_processing_failed";
    throw error;
  }

  const filename = `${objectBaseName}.jpg`;
  const key = `reference-images/${filename}`;

  try {
    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: key,
        Body: optimizedBytes,
        ContentType: "image/jpeg",
        CacheControl: "public, max-age=31536000, immutable"
      })
    );
  } catch (cause) {
    const error = new Error(`reference image upload failed: ${optionalTrimmedString(cause?.message) || optionalTrimmedString(cause?.name) || "s3 error"}`);
    error.code = "reference_image_upload_failed";
    throw error;
  }

  return {
    key,
    url: getReferenceImageUrl(filename)
  };
}

async function maybeUploadReferenceImage(channel, rawUrl) {
  const normalizedUrl = normalizeReferenceImageUrl(rawUrl);
  if (!normalizedUrl) {
    return null;
  }
  return uploadReferenceImageFromUrl(channel, normalizedUrl);
}

async function findChannelConflict(pool, { youtube_channel_id = null, name_short, excludeChannelId = null }) {
  if (youtube_channel_id) {
    const existingById = await db.getChannel(pool, youtube_channel_id);
    if (existingById && existingById.youtube_channel_id !== excludeChannelId) {
      return {
        error: "duplicate_youtube_channel_id",
        field: "youtube_channel_id",
        channel_id: existingById.youtube_channel_id
      };
    }
  }

  const existingByName = await db.findChannelByName(pool, name_short, { excludeChannelId });
  if (existingByName) {
    return {
      error: "duplicate_name",
      field: "name_short",
      channel_id: existingByName.youtube_channel_id
    };
  }

  return null;
}

async function rejectConflicts(res, pool, args) {
  const conflict = await findChannelConflict(pool, args);
  if (!conflict) return false;
  res.status(409).json(conflict);
  return true;
}

async function detectNewChannels(pool) {
  const identifiers = await db.listChannelIdentifiers(pool);
  const existingYouTubeIds = new Set(identifiers.map((row) => row.youtube_channel_id).filter(Boolean));
  const existingNames = new Set(identifiers.map((row) => normalizeChannelKey(row.name_short)).filter(Boolean));
  const existingProfileIds = new Set(identifiers.map((row) => normalizeChannelKey(row.profile_id)).filter(Boolean));

  const args = ["run", "./cmd/detect", "-birthday-year", "2000", "-concurrency", "8"];
  for (const profileId of Array.from(existingProfileIds).sort()) {
    args.push("-skip-profile-id", profileId);
  }

  let stdout;
  try {
    ({ stdout } = await execFileAsync("go", args, {
      cwd: CHANNELSCRAPER_DIR,
      timeout: DETECT_TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true
    }));
  } catch (error) {
    const detail = [error?.stderr, error?.stdout, error?.message].filter(Boolean).join("\n");
    const wrapped = new Error(`detect_command_failed: ${detail}`);
    wrapped.code = "detect_command_failed";
    throw wrapped;
  }

  const detected = JSON.parse(stdout || "[]");
  return detected
    .filter((channel) => {
      if (!channel || !channel.youtube_channel_id || !channel.name_short) return false;
      if (existingYouTubeIds.has(channel.youtube_channel_id)) return false;
      if (existingNames.has(normalizeChannelKey(channel.name_short))) return false;
      if (normalizeChannelKey(channel.profile_id) && existingProfileIds.has(normalizeChannelKey(channel.profile_id))) return false;
      return true;
    })
    .map(toDetectedChannelResponse);
}

async function insertDetectedChannels(pool, rawChannels) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const identifiers = await db.listChannelIdentifiers(client);
    const existingYouTubeIds = new Set(identifiers.map((row) => row.youtube_channel_id).filter(Boolean));
    const existingNames = new Set(identifiers.map((row) => normalizeChannelKey(row.name_short)).filter(Boolean));
    const existingProfileIds = new Set(identifiers.map((row) => normalizeChannelKey(row.profile_id)).filter(Boolean));

    const inserted = [];
    const skipped = [];

    for (const rawChannel of rawChannels) {
      const input = normalizeChannelInput(rawChannel, { useDefaultIcon: true, useDefaultSymbol: true, currentIsActive: false });

      if (!input.youtube_channel_id || !input.name_short) {
        skipped.push({
          youtube_channel_id: input.youtube_channel_id || null,
          name_short: input.name_short || null,
          reason: "missing_required_fields"
        });
        continue;
      }
      if (input.birthday === INVALID_DATE) {
        skipped.push({
          youtube_channel_id: input.youtube_channel_id,
          name_short: input.name_short,
          reason: "birthday_invalid"
        });
        continue;
      }
      if (input.color === INVALID_COLOR) {
        skipped.push({
          youtube_channel_id: input.youtube_channel_id,
          name_short: input.name_short,
          reason: "color_invalid"
        });
        continue;
      }
      if (existingYouTubeIds.has(input.youtube_channel_id)) {
        skipped.push({
          youtube_channel_id: input.youtube_channel_id,
          name_short: input.name_short,
          reason: "duplicate_youtube_channel_id"
        });
        continue;
      }
      if (existingNames.has(normalizeChannelKey(input.name_short))) {
        skipped.push({
          youtube_channel_id: input.youtube_channel_id,
          name_short: input.name_short,
          reason: "duplicate_name"
        });
        continue;
      }
      if (normalizeChannelKey(input.profile_id) && existingProfileIds.has(normalizeChannelKey(input.profile_id))) {
        skipped.push({
          youtube_channel_id: input.youtube_channel_id,
          name_short: input.name_short,
          reason: "duplicate_profile_id"
        });
        continue;
      }

      const saved = await db.insertChannel(client, input);
      await maybeUploadReferenceImage(saved, rawChannel?.reference_image_url);
      inserted.push(toChannelResponse(saved));
      existingYouTubeIds.add(input.youtube_channel_id);
      existingNames.add(normalizeChannelKey(input.name_short));
      if (normalizeChannelKey(input.profile_id)) {
        existingProfileIds.add(normalizeChannelKey(input.profile_id));
      }
    }

    await client.query("COMMIT");
    return { inserted, skipped };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

router.get("/", async (req, res, next) => {
  try {
    const activeOnly = (req.query.active ?? "true").toString().toLowerCase() !== "false";
    const rows = await db.listChannels(req.ctx.pool, { activeOnly });
    res.json(
      rows.map((c) => ({
        ...c,
        youtube_channel_url: toChannelLink(c.youtube_channel_id)
      }))
    );
  } catch (e) {
    next(e);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const input = normalizeChannelInput(req.body, { currentIsActive: false, useDefaultSymbol: true });
    const { youtube_channel_id, name_short, birthday, color } = input;
    const referenceImageUrl = normalizeReferenceImageUrl(req.body?.reference_image_url);

    if (!youtube_channel_id) return res.status(400).json({ error: "youtube_channel_id_required" });
    if (!name_short) return res.status(400).json({ error: "name_required" });
    if (birthday === INVALID_DATE) return res.status(400).json({ error: "birthday_invalid" });
    if (color === INVALID_COLOR) return res.status(400).json({ error: "color_invalid" });

    const hasConflict = await rejectConflicts(res, req.ctx.pool, { youtube_channel_id, name_short });
    if (hasConflict) return;

    const client = await req.ctx.pool.connect();
    let saved;
    try {
      await client.query("BEGIN");
      saved = await db.insertChannel(client, input);
      await maybeUploadReferenceImage(saved, referenceImageUrl);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json(toChannelResponse(saved));
  } catch (e) {
    if (e?.code === "reference_image_upload_not_configured") {
      return res.status(500).json({ error: "reference_image_upload_not_configured" });
    }
    if (e?.code === "reference_image_download_failed") {
      return res.status(502).json({ error: "reference_image_download_failed", detail: optionalTrimmedString(e?.message) });
    }
    if (e?.code === "reference_image_processing_not_configured") {
      return res.status(500).json({ error: "reference_image_processing_not_configured" });
    }
    if (e?.code === "reference_image_processing_failed") {
      return res.status(502).json({ error: "reference_image_processing_failed", detail: optionalTrimmedString(e?.message) });
    }
    if (e?.code === "reference_image_upload_failed") {
      return res.status(502).json({ error: "reference_image_upload_failed", detail: optionalTrimmedString(e?.message) });
    }
    next(e);
  }
});

router.post("/icon-upload", async (req, res, next) => {
  try {
    const filename = optionalTrimmedString(req.body?.filename);
    const contentType = optionalTrimmedString(req.body?.contentType);
    const data = optionalTrimmedString(req.body?.data);

    if (!filename || !data) {
      return res.status(400).json({ error: "icon_upload_fields_required" });
    }
    if (contentType && contentType !== "image/svg+xml") {
      return res.status(400).json({ error: "icon_upload_invalid_type" });
    }

    const iconName = parseUploadedIconName(filename);
    const body = decodeSvgUpload(data);
    if (!iconName) {
      return res.status(400).json({ error: "icon_upload_fields_required" });
    }
    if (!body) {
      return res.status(400).json({ error: "icon_upload_invalid_svg" });
    }

    const s3 = getS3Client();
    if (!s3) {
      return res.status(500).json({ error: "icon_upload_not_configured" });
    }

    await s3.client.send(
      new PutObjectCommand({
        Bucket: s3.bucket,
        Key: `icons/${iconName}.svg`,
        Body: body,
        ContentType: "image/svg+xml",
        CacheControl: "public, max-age=31536000, immutable"
      })
    );

    res.json({
      icon: iconName,
      key: `icons/${iconName}.svg`,
      url: getIconUrl(iconName)
    });
  } catch (e) {
    if (e?.name === "InvalidCharacterError") {
      return res.status(400).json({ error: "icon_upload_invalid_svg" });
    }
    // eslint-disable-next-line no-console
    console.error("icon upload failed:", e);
    return res.status(502).json({
      error: "icon_upload_failed",
      detail: optionalTrimmedString(e?.message) || optionalTrimmedString(e?.Code) || optionalTrimmedString(e?.name)
    });
  }
});

router.post("/detect", async (req, res, next) => {
  try {
    const channels = await detectNewChannels(req.ctx.pool);
    res.json({ channels });
  } catch (e) {
    if (e?.code === "detect_command_failed") {
      // eslint-disable-next-line no-console
      console.error("channel detect failed:", e?.message || e);
      return res.status(502).json({ error: "detect_failed" });
    }
    next(e);
  }
});

router.post("/detect/add-all", async (req, res, next) => {
  try {
    const channels = Array.isArray(req.body?.channels) ? req.body.channels : null;
    if (!channels || channels.length === 0) {
      return res.status(400).json({ error: "channels_required" });
    }

    const result = await insertDetectedChannels(req.ctx.pool, channels);
    res.json(result);
  } catch (e) {
    if (e?.code === "reference_image_upload_not_configured") {
      return res.status(500).json({ error: "reference_image_upload_not_configured" });
    }
    if (e?.code === "reference_image_download_failed") {
      return res.status(502).json({ error: "reference_image_download_failed", detail: optionalTrimmedString(e?.message) });
    }
    if (e?.code === "reference_image_processing_not_configured") {
      return res.status(500).json({ error: "reference_image_processing_not_configured" });
    }
    if (e?.code === "reference_image_processing_failed") {
      return res.status(502).json({ error: "reference_image_processing_failed", detail: optionalTrimmedString(e?.message) });
    }
    if (e?.code === "reference_image_upload_failed") {
      return res.status(502).json({ error: "reference_image_upload_failed", detail: optionalTrimmedString(e?.message) });
    }
    next(e);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const channel = await db.getChannel(req.ctx.pool, req.params.id);
    if (!channel) return res.status(404).json({ error: "not_found" });
    res.json(toChannelResponse(channel));
  } catch (e) {
    next(e);
  }
});

router.put("/:id", async (req, res, next) => {
  try {
    const current = await db.getChannel(req.ctx.pool, req.params.id);
    if (!current) return res.status(404).json({ error: "not_found" });

    const youtube_channel_id = optionalTrimmedString(req.body?.youtube_channel_id);
    const input = normalizeChannelInput(req.body, { currentIsActive: current.is_active });
    const { name_short, birthday, color } = input;

    if (youtube_channel_id && youtube_channel_id !== req.params.id) {
      return res.status(400).json({ error: "youtube_channel_id_immutable" });
    }
    if (!name_short) return res.status(400).json({ error: "name_required" });
    if (birthday === INVALID_DATE) return res.status(400).json({ error: "birthday_invalid" });
    if (color === INVALID_COLOR) return res.status(400).json({ error: "color_invalid" });

    const hasConflict = await rejectConflicts(res, req.ctx.pool, {
      name_short,
      excludeChannelId: req.params.id
    });
    if (hasConflict) return;

    const saved = await db.updateChannel(req.ctx.pool, req.params.id, input);
    if (!saved) return res.status(404).json({ error: "not_found" });

    res.json(toChannelResponse(saved));
  } catch (e) {
    next(e);
  }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const deleted = await db.deleteChannel(req.ctx.pool, req.params.id);
    if (!deleted) return res.status(404).json({ error: "not_found" });

    res.json(toChannelResponse(deleted));
  } catch (e) {
    next(e);
  }
});

router.get("/:id/latest", async (req, res, next) => {
  try {
    const latest = await db.getLatestStats(req.ctx.pool, req.params.id);
    if (!latest) return res.status(404).json({ error: "not_found" });
    res.json({
      ...latest,
      last_upload_url: toVideoLink(latest.last_upload_video_id),
      last_live_url: toVideoLink(latest.last_live_video_id)
    });
  } catch (e) {
    next(e);
  }
});

router.get("/:id/timeseries", async (req, res, next) => {
  try {
    const start = req.query.start ? new Date(req.query.start.toString()) : null;
    const end = req.query.end ? new Date(req.query.end.toString()) : null;
    const bucket = req.query.bucket ? req.query.bucket.toString() : null;

    const safeStart = start && !isNaN(start.getTime()) ? start.toISOString() : null;
    const safeEnd = end && !isNaN(end.getTime()) ? end.toISOString() : null;

    if (bucket) {
      const rows = await db.getTimeSeriesBucketed(req.ctx.pool, req.params.id, {
        start: safeStart,
        end: safeEnd,
        bucket
      });
      return res.json(rows);
    }

    const rows = await db.getTimeSeries(req.ctx.pool, req.params.id, { start: safeStart, end: safeEnd });
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
