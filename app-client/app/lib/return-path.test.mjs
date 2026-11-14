import assert from "node:assert/strict";
import { test } from "node:test";
import { forgetLinkIntent, isLinkV1Path, isLocalPath, rememberLinkIntent, takeLinkIntent, withNext } from "./return-path.mjs";

function memoryStorage() {
  const items = new Map();
  return {
    getItem: (key) => (items.has(key) ? items.get(key) : null),
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: (key) => items.delete(key),
    items,
  };
}

test("only paths on this site count as a place to go back to", () => {
  for (const good of ["/link-v1", "/stocks/PEKO", "/link-v1?from=v1", "/profile#trophies"]) assert.equal(isLocalPath(good), true, good);
  for (const bad of [
    "",
    "link-v1",
    "https://evil.example/",
    "//evil.example",
    "/\\evil.example",
    "/%5Cevil.example".replace("%5C", "\\"),
    "/link-v1\nx",
    null,
    undefined,
    42,
    `/${"a".repeat(600)}`,
  ])
    assert.equal(isLocalPath(bad), false, String(bad));
});

test("the account pages never send you back to themselves", () => {
  for (const page of ["/login", "/register", "/register?next=/x", "/forgot-password", "/reset-password/abc"]) assert.equal(isLocalPath(page), false, page);
  // A page that only starts with the same letters is fine.
  assert.equal(isLocalPath("/registered-players"), true);
});

test("the link page is recognized with or without a query", () => {
  assert.equal(isLinkV1Path("/link-v1"), true);
  assert.equal(isLinkV1Path("/link-v1?from=v1"), true);
  assert.equal(isLinkV1Path("/link-v1-other"), false);
  assert.equal(isLinkV1Path("//link-v1"), false);
  assert.equal(isLinkV1Path(null), false);
});

test("withNext keeps a safe destination and drops anything else", () => {
  assert.equal(withNext("/register", "/link-v1"), "/register?next=%2Flink-v1");
  assert.equal(withNext("/login", "//evil.example"), "/login");
  assert.equal(withNext("/login", null), "/login");
});

test("the link errand carries on once, within half an hour", () => {
  const storage = memoryStorage();
  assert.equal(takeLinkIntent(storage), false, "nothing remembered yet");

  rememberLinkIntent(storage, 1_000_000);
  assert.equal(takeLinkIntent(storage, 1_000_000 + 29 * 60_000), true);
  assert.equal(takeLinkIntent(storage, 1_000_000 + 29 * 60_000), false, "reading it clears it, so a reload doesn't go again");

  rememberLinkIntent(storage, 1_000_000);
  assert.equal(takeLinkIntent(storage, 1_000_000 + 31 * 60_000), false, "too old");
  assert.equal(storage.items.size, 0, "an old one is cleared too");

  rememberLinkIntent(storage, 1_000_000);
  assert.equal(takeLinkIntent(storage, 999_000), false, "a time from the future doesn't count");

  storage.setItem("nasfaq.linkV1", "not a time");
  assert.equal(takeLinkIntent(storage), false);

  rememberLinkIntent(storage, 1_000_000);
  forgetLinkIntent(storage);
  assert.equal(takeLinkIntent(storage, 1_000_000), false);
});

test("blocked storage just means pressing the button by hand", () => {
  const blocked = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };
  assert.doesNotThrow(() => rememberLinkIntent(blocked));
  assert.equal(takeLinkIntent(blocked), false);
  assert.doesNotThrow(() => forgetLinkIntent(blocked));
  assert.equal(takeLinkIntent(null), false);
});
