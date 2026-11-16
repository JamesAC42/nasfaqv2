import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { iosVersion, isAppleMobile, keyBytes, pushSupport } from "./push-support.mjs";

// public/sw.js is for push only. A fetch handler or the Cache API there could serve players an old
// build after a deploy, and a service worker is hard to take back once it's installed.
const worker = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const code = worker.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

test("the service worker handles push and notification clicks, and never fetches or caches", () => {
  assert.match(code, /addEventListener\(\s*["']push["']/);
  assert.match(code, /addEventListener\(\s*["']notificationclick["']/);
  assert.doesNotMatch(code, /["']fetch["']/, "no fetch listener");
  assert.doesNotMatch(code, /\bonfetch\b/);
  assert.doesNotMatch(code, /\bcaches\b|\bCacheStorage\b|\bcache\.(add|put|match)/i, "no Cache API");
  assert.doesNotMatch(code, /importScripts/, "nothing pulled in from elsewhere");
});

const IPHONE_18 = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPHONE_16_3 = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1";
const IPAD_DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const all = { serviceWorker: true, pushManager: true, notification: true, secure: true };

test("iPhone and iPad need the Home Screen app; everything else with push just works", () => {
  assert.equal(pushSupport({ ...all, userAgent: ANDROID }), "supported");
  assert.equal(pushSupport({ ...all, userAgent: IPAD_DESKTOP, maxTouchPoints: 0 }), "supported", "a real Mac");
  // In a Safari tab iOS has no PushManager.
  assert.equal(pushSupport({ ...all, pushManager: false, userAgent: IPHONE_18 }), "ios-home-screen");
  assert.equal(pushSupport({ ...all, pushManager: false, userAgent: IPAD_DESKTOP, maxTouchPoints: 5 }), "ios-home-screen", "iPadOS says it's a Mac");
  assert.equal(pushSupport({ ...all, userAgent: IPHONE_18, standalone: true }), "supported", "opened from the Home Screen");
  assert.equal(pushSupport({ ...all, userAgent: IPHONE_16_3, standalone: true }), "ios-update");
  assert.equal(pushSupport({ ...all, pushManager: false, userAgent: ANDROID }), "unsupported");
  assert.equal(pushSupport({ ...all, secure: false, userAgent: ANDROID }), "insecure");
  assert.equal(isAppleMobile({ userAgent: ANDROID }), false);
  assert.deepEqual(iosVersion(IPHONE_16_3), [16, 3]);
  assert.equal(iosVersion(IPAD_DESKTOP), null);
});

test("the public key turns into its 65 bytes", () => {
  const key = Buffer.alloc(65, 7).toString("base64url");
  assert.deepEqual([...keyBytes(key)], [...Buffer.alloc(65, 7)]);
});
