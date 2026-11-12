// The image bucket behind https://images.nasfaq.biz. It is Cloudflare R2, which speaks the S3 API:
// AWS_ENDPOINT_URL_S3 points the SDK at the R2 endpoint and AWS_REGION is "auto". Plain AWS S3 still
// works by leaving the endpoint unset. Without the AWS_* settings (local dev, tests) there is no
// client and nothing uploads.
const { S3Client } = require("@aws-sdk/client-s3");

function trimmed(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function bucketSettings(env = process.env) {
  const accessKeyId = trimmed(env.AWS_ACCESS_KEY_ID);
  const secretAccessKey = trimmed(env.AWS_SECRET_ACCESS_KEY);
  const region = trimmed(env.AWS_REGION);
  const bucket = trimmed(env.AWS_SW_BUCKET);
  if (!accessKeyId || !secretAccessKey || !region || !bucket) return null;
  const endpoint = trimmed(env.AWS_ENDPOINT_URL_S3) || trimmed(env.AWS_ENDPOINT_URL);
  return { accessKeyId, secretAccessKey, region, bucket, endpoint };
}

function clientOptions({ accessKeyId, secretAccessKey, region, endpoint }) {
  const options = { region, credentials: { accessKeyId, secretAccessKey } };
  if (endpoint) {
    // An S3-compatible store (R2): send and check checksums only when an operation requires them.
    options.endpoint = endpoint;
    options.requestChecksumCalculation = "WHEN_REQUIRED";
    options.responseChecksumValidation = "WHEN_REQUIRED";
  } else {
    options.followRegionRedirects = true;
  }
  return options;
}

let cached = null;

/** { bucket, client } for the image bucket, or null when it isn't configured. */
function getS3Client(env = process.env) {
  const settings = bucketSettings(env);
  if (!settings) return null;
  const key = JSON.stringify(settings);
  if (cached?.key !== key) {
    cached = { key, value: { bucket: settings.bucket, client: new S3Client(clientOptions(settings)) } };
  }
  return cached.value;
}

module.exports = { bucketSettings, clientOptions, getS3Client };
