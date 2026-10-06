// Talents' reference pictures (the official full-body art from hololive's site), resized and saved to
// the image CDN as reference-images/<profile_id>.jpg for the art pipeline. Used when channels are added
// from the detector (routes/channels.js) and when an IPO starts tracking new talents (services/ipo.js).
// Without S3 credentials (AWS_ACCESS_KEY_ID etc., e.g. local dev) getS3Client() is null and nothing uploads.

const { PutObjectCommand, S3Client } = require("@aws-sdk/client-s3");

const REFERENCE_IMAGE_CDN_BASE_URL = "https://images.nasfaq.biz/reference-images";
const MAX_REFERENCE_IMAGE_UPLOAD_BYTES = 12 * 1024 * 1024;
const REFERENCE_IMAGE_SCALE = 0.6;
const REFERENCE_IMAGE_JPEG_QUALITY = 76;

function optionalTrimmedString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = value.toString().trim();
  return trimmed ? trimmed : null;
}

function getReferenceImageUrl(filename) {
  if (!filename) return null;
  return `${REFERENCE_IMAGE_CDN_BASE_URL}/${encodeURIComponent(filename)}`;
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

module.exports = {
  getS3Client,
  getReferenceImageUrl,
  normalizeReferenceImageUrl,
  referenceImageBaseName,
  uploadReferenceImageFromUrl,
  maybeUploadReferenceImage,
};
