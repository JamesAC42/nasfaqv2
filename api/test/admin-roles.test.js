const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const adminRoutes = require('../src/routes/admin');
const { planRoleChange, maskEmail } = require('../src/services/adminConsole');

const admin = { id: 1, username: 'boss', is_admin: true };
const player = { id: 2, username: 'pleb', is_admin: false, can_approve_prediction_markets: false, email_verified: false };

const codeOf = (fn) => {
  try {
    fn();
  } catch (error) {
    return error.code;
  }
  return null;
};

test('role plan: grants and revokes a prediction role, reporting only real changes', () => {
  assert.deepEqual(planRoleChange({ actor: admin, target: player, body: { can_approve_prediction_markets: true } }), {
    updates: { can_approve_prediction_markets: true },
    changed: ['can_approve_prediction_markets'],
  });
  const holder = { ...player, can_approve_prediction_markets: true };
  assert.deepEqual(planRoleChange({ actor: admin, target: holder, body: { can_approve_prediction_markets: false } }).changed, ['can_approve_prediction_markets']);
  // Setting a flag to what it already is is a no-op, not an error.
  assert.deepEqual(planRoleChange({ actor: admin, target: holder, body: { can_approve_prediction_markets: true } }).changed, []);
});

test('role plan: rejects non-admins, unknown fields and non-boolean values', () => {
  assert.equal(codeOf(() => planRoleChange({ actor: player, target: admin, body: { can_manage_assets: true } })), 'forbidden');
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: null, body: { can_manage_assets: true } })), 'user_not_found');
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: player, body: { password_hash: 'x' } })), 'invalid_role');
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: player, body: { can_manage_assets: 'yes' } })), 'invalid_role');
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: player, body: {} })), 'invalid_role');
});

test('role plan: admin flag needs a confirm and an admin cannot demote themselves', () => {
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: player, body: { is_admin: true } })), 'admin_change_needs_confirm');
  assert.deepEqual(planRoleChange({ actor: admin, target: player, body: { is_admin: true, confirm: true } }).changed, ['is_admin']);
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: admin, body: { is_admin: false, confirm: true } })), 'cannot_remove_own_admin');
  // ids can arrive as strings from pg or the session.
  assert.equal(codeOf(() => planRoleChange({ actor: { ...admin, id: '1' }, target: admin, body: { is_admin: false, confirm: true } })), 'cannot_remove_own_admin');
  // Other admins can be demoted (with the confirm).
  const other = { id: 3, is_admin: true };
  assert.deepEqual(planRoleChange({ actor: admin, target: other, body: { is_admin: false, confirm: true } }).changed, ['is_admin']);
});

test('role plan: email can be verified but never unverified', () => {
  assert.deepEqual(planRoleChange({ actor: admin, target: player, body: { email_verified: true } }).changed, ['email_verified']);
  assert.equal(codeOf(() => planRoleChange({ actor: admin, target: { ...player, email_verified: true }, body: { email_verified: false } })), 'cannot_unverify_email');
});

test('maskEmail keeps the domain and hides most of the name', () => {
  assert.equal(maskEmail('pekora@usada.jp'), 'pe****@usada.jp');
  assert.equal(maskEmail(null), null);
});

test('admin routes: 401 signed out, 403 for non-admins, 400 on a bad id', async (t) => {
  const queries = [];
  const pool = { async query(sql) { queries.push(sql); return { rows: [] }; } };
  let user = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.ctx = { pool, user }; next(); });
  app.use('/api/admin', adminRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error.message) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}/api/admin`;
  const patch = (path, body) => fetch(`${base}${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await fetch(`${base}/overview`)).status, 401);
  user = { id: 2, username: 'pleb', is_admin: false, can_approve_prediction_markets: true };
  assert.equal((await fetch(`${base}/overview`)).status, 403);
  assert.equal((await fetch(`${base}/users?q=a`)).status, 403);
  assert.equal((await patch('/users/1/roles', { can_manage_assets: true })).status, 403);
  assert.equal(queries.length, 0, 'no query runs before the admin check');

  user = { ...admin };
  assert.equal((await patch('/users/abc/roles', { can_manage_assets: true })).status, 400);
  const missing = await patch('/users/99/roles', { can_manage_assets: true });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'user_not_found' });
});
