const test = require("node:test");
const assert = require("node:assert/strict");

const s3Bucket = require("../src/s3Bucket");
const mediaCatalog = require("../src/services/mediaCatalog");

const R2 = {
  AWS_ACCESS_KEY_ID: "key",
  AWS_SECRET_ACCESS_KEY: "secret",
  AWS_REGION: "auto",
  AWS_SW_BUCKET: "images",
  AWS_ENDPOINT_URL_S3: "https://example.r2.cloudflarestorage.com",
};

test("image bucket: no client without the AWS_* settings", () => {
  assert.equal(s3Bucket.bucketSettings({}), null);
  assert.equal(s3Bucket.getS3Client({ ...R2, AWS_SW_BUCKET: " " }), null);
});

test("image bucket: an endpoint sends the client to R2 with checksums only when required", () => {
  const options = s3Bucket.clientOptions(s3Bucket.bucketSettings(R2));
  assert.equal(options.endpoint, R2.AWS_ENDPOINT_URL_S3);
  assert.equal(options.region, "auto");
  assert.equal(options.requestChecksumCalculation, "WHEN_REQUIRED");
  assert.equal(options.responseChecksumValidation, "WHEN_REQUIRED");
  assert.equal(options.followRegionRedirects, undefined);
});

test("image bucket: without an endpoint it is plain AWS S3", () => {
  const options = s3Bucket.clientOptions(s3Bucket.bucketSettings({ ...R2, AWS_ENDPOINT_URL_S3: "", AWS_REGION: "us-east-1" }));
  assert.equal(options.endpoint, undefined);
  assert.equal(options.followRegionRedirects, true);
});

test("image bucket: the client is reused until the settings change", () => {
  const first = s3Bucket.getS3Client(R2);
  assert.equal(first.bucket, "images");
  assert.equal(s3Bucket.getS3Client(R2), first);
  assert.notEqual(s3Bucket.getS3Client({ ...R2, AWS_SW_BUCKET: "other" }), first);
});

function fakePool() {
  const queries = [];
  const run = async (sql) => {
    queries.push(String(sql).replace(/\s+/g, " ").trim());
    if (/RETURNING id/.test(sql)) return { rows: [{ id: queries.length }] };
    return { rows: [] };
  };
  return { queries, query: run, connect: async () => ({ query: run, release() {} }) };
}

function withBucket(listing, fn) {
  const original = s3Bucket.getS3Client;
  s3Bucket.getS3Client = () => ({
    bucket: "images",
    client: { send: async (command) => ({ Contents: (listing[command.input.Prefix] || []).map((Key) => ({ Key })) }) },
  });
  return fn().finally(() => {
    s3Bucket.getS3Client = original;
  });
}

const quiet = { log() {}, warn() {} };

test("media catalog: an empty bucket leaves emojis and profile pictures as they are", async () => {
  const pool = fakePool();
  await withBucket({}, async () => {
    const result = await mediaCatalog.syncMediaCatalog(pool, quiet);
    assert.equal(result.emojis.skipped, true);
    assert.equal(result.profilePictures.skipped, true);
  });
  assert.equal(pool.queries.some((sql) => /SET is_deleted = true/.test(sql)), false);
});

test("media catalog: with files present it still retires what the bucket no longer has", async () => {
  const pool = fakePool();
  await withBucket(
    {
      "emojis/": ["emojis/64_ogey.jpg"],
      "profile-pictures/large/": ["profile-pictures/large/256_peko.jpg"],
      "profile-pictures/small/": ["profile-pictures/small/128_peko.jpg"],
    },
    async () => {
      const result = await mediaCatalog.syncMediaCatalog(pool, quiet);
      assert.equal(result.emojis.total, 1);
      assert.equal(result.profilePictures.total, 1);
    }
  );
  assert.equal(pool.queries.filter((sql) => /SET is_deleted = true/.test(sql)).length, 2);
});
