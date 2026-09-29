// Shared bits for the scripts that push static files to the images bucket (upload-art.js,
// seed-gacha-prizes.js). Credentials come from api/.env and are never printed:
// ART_UPLOAD_AWS_ACCESS_KEY_ID / ART_UPLOAD_AWS_SECRET_ACCESS_KEY (a key that can only write the
// art/ and gachaprizes/ prefixes), else the API's AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
const { S3Client, ListObjectsV2Command, PutObjectCommand } = require("@aws-sdk/client-s3");

const IMMUTABLE = "public, max-age=31536000, immutable";

function uploadTarget() {
  const bucket = process.env.ART_S3_BUCKET || process.env.AWS_SW_BUCKET;
  const region = process.env.ART_S3_REGION || process.env.AWS_REGION;
  const accessKeyId = process.env.ART_UPLOAD_AWS_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ART_UPLOAD_AWS_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !region) throw new Error("Set ART_S3_BUCKET (or AWS_SW_BUCKET) and AWS_REGION in api/.env");
  if (!accessKeyId || !secretAccessKey) throw new Error("Set ART_UPLOAD_AWS_ACCESS_KEY_ID / ART_UPLOAD_AWS_SECRET_ACCESS_KEY in api/.env");
  const client = new S3Client({ region, credentials: { accessKeyId, secretAccessKey }, followRegionRedirects: true });
  return { client, bucket, region };
}

async function listKeys(client, bucket, prefix) {
  const keys = new Set();
  let token;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix}/`, ContinuationToken: token }));
    for (const item of page.Contents ?? []) keys.add(item.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

function putObject(client, bucket, key, body, contentType, cacheControl = IMMUTABLE) {
  return client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]);
    })
  );
}

module.exports = { IMMUTABLE, uploadTarget, listKeys, putObject, mapLimit };
