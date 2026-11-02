const test = require("node:test");
const assert = require("node:assert/strict");
const { publicUser } = require("../src/services/auth");

test("a user's id reaches the client as a number, though pg returns a BIGINT as a string", () => {
  assert.equal(publicUser({ id: "42", username: "peko" }).id, 42);
});
