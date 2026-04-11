const path = require("node:path");
const sharp = require("sharp");
const { ListObjectsV2Command, PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const EMOJI_PREFIX = "emojis/";
const PROFILE_PICTURE_LARGE_PREFIX = "profile-pictures/large/";
const PROFILE_PICTURE_SMALL_PREFIX = "profile-pictures/small/";
const EMOJI_CDN_BASE_URL = "https://images.nasfaq.biz/emojis";
const PROFILE_PICTURE_CDN_BASE_URL = "https://images.nasfaq.biz/profile-pictures";

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
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

function sanitizeAssetSlug(value) {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) return null;
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || null;
}

function decodeDataUrl(value) {
  const trimmed = optionalTrimmedString(value);
  if (!trimmed) return null;
  const match = /^data:([^;,]+)?;base64,(.+)$/i.exec(trimmed);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length) return null;
  return {
    contentType: (match[1] || "application/octet-stream").toLowerCase(),
    bytes,
  };
}

async function convertToJpeg(bytes) {
  return sharp(bytes)
    .rotate()
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
}

async function listObjectKeys(prefix) {
  const s3 = getS3Client();
  if (!s3) return [];

  const keys = [];
  let continuationToken = undefined;

  do {
    const response = await s3.client.send(
      new ListObjectsV2Command({
        Bucket: s3.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const item of response.Contents || []) {
      if (item.Key) keys.push(item.Key);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function uploadJpegObject(key, bytes) {
  const s3 = getS3Client();
  if (!s3) {
    const error = new Error("s3_not_configured");
    error.code = "s3_not_configured";
    throw error;
  }

  await s3.client.send(
    new PutObjectCommand({
      Bucket: s3.bucket,
      Key: key,
      Body: bytes,
      ContentType: "image/jpeg",
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

function parseEmojiKey(key) {
  if (!key.startsWith(EMOJI_PREFIX)) return null;
  const filename = path.basename(key);
  const match = /^64_(.+)\.jpg$/i.exec(filename);
  if (!match) return null;
  return {
    filename,
    slug: match[1],
  };
}

function parseProfilePictureKey(key, expectedPrefix, requiredPrefix) {
  if (!key.startsWith(expectedPrefix)) return null;
  const filename = path.basename(key);
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  const match = new RegExp(`^${requiredPrefix}_(.+)$`, "i").exec(base);
  if (!match || !ext) return null;
  return {
    filename,
    slug: match[1],
  };
}

function toEmojiRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    filename: row.filename,
    url: `${EMOJI_CDN_BASE_URL}/${encodeURIComponent(row.filename)}`,
    is_deleted: Boolean(row.is_deleted),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toProfilePictureRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    filename_large: row.filename_large,
    filename_small: row.filename_small,
    url_large: `${PROFILE_PICTURE_CDN_BASE_URL}/large/${encodeURIComponent(row.filename_large)}`,
    url_small: `${PROFILE_PICTURE_CDN_BASE_URL}/small/${encodeURIComponent(row.filename_small)}`,
    is_deleted: Boolean(row.is_deleted),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function syncEmojiCatalog(pool) {
  const keys = await listObjectKeys(EMOJI_PREFIX);
  const parsed = keys
    .map(parseEmojiKey)
    .filter(Boolean)
    .sort((a, b) => a.filename.localeCompare(b.filename));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const seen = parsed.map((item) => item.filename);
    for (const item of parsed) {
      await client.query(
        `
        INSERT INTO market.emojis (name, filename, is_deleted, updated_at)
        VALUES ($1, $2, false, now())
        ON CONFLICT (filename) DO UPDATE
          SET is_deleted = false,
              updated_at = now()
      `,
        [item.slug, item.filename]
      );
    }

    await client.query(
      `
      UPDATE market.emojis
      SET is_deleted = true,
          updated_at = now()
      WHERE NOT (filename = ANY($1::text[]))
    `,
      [seen]
    );

    await client.query("COMMIT");
    return { total: parsed.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function syncProfilePictureCatalog(pool) {
  const [largeKeys, smallKeys] = await Promise.all([
    listObjectKeys(PROFILE_PICTURE_LARGE_PREFIX),
    listObjectKeys(PROFILE_PICTURE_SMALL_PREFIX),
  ]);

  const largeBySlug = new Map(
    largeKeys
      .map((key) => parseProfilePictureKey(key, PROFILE_PICTURE_LARGE_PREFIX, "256"))
      .filter(Boolean)
      .map((item) => [item.slug, item.filename])
  );
  const smallBySlug = new Map(
    smallKeys
      .map((key) => parseProfilePictureKey(key, PROFILE_PICTURE_SMALL_PREFIX, "128"))
      .filter(Boolean)
      .map((item) => [item.slug, item.filename])
  );

  const merged = Array.from(largeBySlug.keys())
    .filter((slug) => smallBySlug.has(slug))
    .sort((a, b) => a.localeCompare(b))
    .map((slug) => ({
      slug,
      filenameLarge: largeBySlug.get(slug),
      filenameSmall: smallBySlug.get(slug),
    }));

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const activeIds = [];
    for (const item of merged) {
      const updated = await client.query(
        `
        UPDATE market.profile_pictures
        SET filename_large = $1,
            filename_small = $2,
            is_deleted = false,
            updated_at = now()
        WHERE filename_large = $1
           OR filename_small = $2
        RETURNING id
      `,
        [item.filenameLarge, item.filenameSmall]
      );

      if (updated.rows[0]?.id) {
        activeIds.push(Number(updated.rows[0].id));
        continue;
      }

      const inserted = await client.query(
        `
        INSERT INTO market.profile_pictures (name, filename_large, filename_small, is_deleted, updated_at)
        VALUES ($1, $2, $3, false, now())
        RETURNING id
      `,
        [item.slug, item.filenameLarge, item.filenameSmall]
      );
      activeIds.push(Number(inserted.rows[0].id));
    }

    await client.query(
      `
      UPDATE market.profile_pictures
      SET is_deleted = true,
          updated_at = now()
      WHERE NOT (id = ANY($1::bigint[]))
    `,
      [activeIds]
    );

    await client.query("COMMIT");
    return { total: merged.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function syncMediaCatalog(pool, logger = console) {
  const s3 = getS3Client();
  if (!s3) {
    logger.log("media catalog sync skipped: S3 env vars are not configured");
    return { emojis: { total: 0 }, profilePictures: { total: 0 }, skipped: true };
  }

  const [emojis, profilePictures] = await Promise.all([syncEmojiCatalog(pool), syncProfilePictureCatalog(pool)]);
  await pool.query(
    `
    UPDATE market.users u
    SET profile_picture_id = pp.id
    FROM market.profile_pictures pp
    WHERE u.profile_picture_id IS NULL
      AND pp.is_deleted = false
      AND (
        u.profile_picture_url = pp.filename_large
        OR u.profile_picture_url = pp.filename_small
        OR u.profile_picture_url = 'https://images.nasfaq.biz/profile-pictures/large/' || pp.filename_large
        OR u.profile_picture_url = 'https://images.nasfaq.biz/profile-pictures/small/' || pp.filename_small
      )
  `
  );
  logger.log(`media catalog sync complete: ${emojis.total} emojis, ${profilePictures.total} profile pictures`);
  return { emojis, profilePictures, skipped: false };
}

async function listAdminEmojis(pool) {
  const { rows } = await pool.query(`
    SELECT id, name, filename, is_deleted, created_at, updated_at
    FROM market.emojis
    ORDER BY is_deleted ASC, lower(name) ASC, id ASC
  `);
  return rows.map(toEmojiRow);
}

async function listAdminProfilePictures(pool) {
  const { rows } = await pool.query(`
    SELECT id, name, filename_large, filename_small, is_deleted, created_at, updated_at
    FROM market.profile_pictures
    ORDER BY is_deleted ASC, lower(name) ASC, id ASC
  `);
  return rows.map(toProfilePictureRow);
}

async function listActiveProfilePictures(pool) {
  const { rows } = await pool.query(`
    SELECT id, name, filename_large, filename_small, is_deleted, created_at, updated_at
    FROM market.profile_pictures
    WHERE is_deleted = false
    ORDER BY lower(name) ASC, id ASC
  `);
  return rows.map(toProfilePictureRow);
}

async function listActiveEmojis(pool) {
  const { rows } = await pool.query(`
    SELECT id, name, filename, is_deleted, created_at, updated_at
    FROM market.emojis
    WHERE is_deleted = false
    ORDER BY lower(name) ASC, id ASC
  `);
  return rows.map(toEmojiRow);
}

async function updateEmoji(pool, emojiId, { name, isDeleted }) {
  const safeName = optionalTrimmedString(name);
  if (!safeName) {
    const error = new Error("invalid_admin_asset");
    error.code = "invalid_admin_asset";
    throw error;
  }

  const { rows } = await pool.query(
    `
    UPDATE market.emojis
    SET name = $2,
        is_deleted = COALESCE($3, is_deleted),
        updated_at = now()
    WHERE id = $1
    RETURNING id, name, filename, is_deleted, created_at, updated_at
  `,
    [emojiId, safeName, typeof isDeleted === "boolean" ? isDeleted : null]
  );

  if (!rows[0]) {
    const error = new Error("admin_asset_not_found");
    error.code = "admin_asset_not_found";
    throw error;
  }

  return toEmojiRow(rows[0]);
}

async function updateProfilePicture(pool, profilePictureId, { name, isDeleted }) {
  const safeName = optionalTrimmedString(name);
  if (!safeName) {
    const error = new Error("invalid_admin_asset");
    error.code = "invalid_admin_asset";
    throw error;
  }

  const { rows } = await pool.query(
    `
    UPDATE market.profile_pictures
    SET name = $2,
        is_deleted = COALESCE($3, is_deleted),
        updated_at = now()
    WHERE id = $1
    RETURNING id, name, filename_large, filename_small, is_deleted, created_at, updated_at
  `,
    [profilePictureId, safeName, typeof isDeleted === "boolean" ? isDeleted : null]
  );

  if (!rows[0]) {
    const error = new Error("admin_asset_not_found");
    error.code = "admin_asset_not_found";
    throw error;
  }

  return toProfilePictureRow(rows[0]);
}

async function createEmoji(pool, { name, imageDataUrl }) {
  const slug = sanitizeAssetSlug(name);
  const decoded = decodeDataUrl(imageDataUrl);
  if (!slug || !decoded) {
    const error = new Error("invalid_admin_asset");
    error.code = "invalid_admin_asset";
    throw error;
  }

  const filename = `64_${slug}.jpg`;
  const jpegBytes = await convertToJpeg(decoded.bytes);
  await uploadJpegObject(`${EMOJI_PREFIX}${filename}`, jpegBytes);

  const { rows } = await pool.query(
    `
    INSERT INTO market.emojis (name, filename, is_deleted, updated_at)
    VALUES ($1, $2, false, now())
    ON CONFLICT (filename) DO UPDATE
      SET is_deleted = false,
          updated_at = now()
    RETURNING id, name, filename, is_deleted, created_at, updated_at
  `,
    [slug, filename]
  );

  return toEmojiRow(rows[0]);
}

async function createProfilePicture(pool, { name, imageLargeDataUrl, imageSmallDataUrl }) {
  const slug = sanitizeAssetSlug(name);
  const decodedLarge = decodeDataUrl(imageLargeDataUrl);
  const decodedSmall = decodeDataUrl(imageSmallDataUrl);
  if (!slug || !decodedLarge || !decodedSmall) {
    const error = new Error("invalid_admin_asset");
    error.code = "invalid_admin_asset";
    throw error;
  }

  const filenameLarge = `256_${slug}.jpg`;
  const filenameSmall = `128_${slug}.jpg`;
  const [largeJpeg, smallJpeg] = await Promise.all([
    convertToJpeg(decodedLarge.bytes),
    convertToJpeg(decodedSmall.bytes),
  ]);

  await Promise.all([
    uploadJpegObject(`${PROFILE_PICTURE_LARGE_PREFIX}${filenameLarge}`, largeJpeg),
    uploadJpegObject(`${PROFILE_PICTURE_SMALL_PREFIX}${filenameSmall}`, smallJpeg),
  ]);

  const { rows } = await pool.query(
    `
    INSERT INTO market.profile_pictures (name, filename_large, filename_small, is_deleted, updated_at)
    VALUES ($1, $2, $3, false, now())
    ON CONFLICT (filename_large) DO UPDATE
      SET filename_small = EXCLUDED.filename_small,
          is_deleted = false,
          updated_at = now()
    RETURNING id, name, filename_large, filename_small, is_deleted, created_at, updated_at
  `,
    [slug, filenameLarge, filenameSmall]
  );

  return toProfilePictureRow(rows[0]);
}

module.exports = {
  createEmoji,
  createProfilePicture,
  listActiveEmojis,
  listActiveProfilePictures,
  listAdminEmojis,
  listAdminProfilePictures,
  syncMediaCatalog,
  updateEmoji,
  updateProfilePicture,
};
