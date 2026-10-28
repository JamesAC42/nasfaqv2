const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { registerHealthRoutes } = require('../src/health');

test('liveness bypasses database/auth; readiness reports failure then recovery', async (t) => {
  let available = false;
  let queries = 0;
  const app = express();
  registerHealthRoutes(app, { async query() {
    queries++;
    if (!available) throw new Error('secret connection details');
    return { rows: [{ ok: 1 }] };
  }});
  app.use((_req, res) => res.status(401).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let response = await fetch(`${base}/api/live`);
  assert.equal(response.status, 200);
  assert.equal(queries, 0);
  response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: false, db: false });
  available = true;
  response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, db: true });
  assert.equal((await fetch(`${base}/private`)).status, 401);
});

test('readiness callers arriving together share one database check', async (t) => {
  let queries = 0;
  let arrived = 0;
  let finish;
  const app = express();
  app.use((_req, _res, next) => { arrived++; next(); });
  registerHealthRoutes(app, { query() {
    queries++;
    return new Promise(resolve => { finish = () => resolve({ rows: [{ ok: 1 }] }); });
  }});
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const responses = Array.from({ length: 20 }, () => fetch(`${base}/api/health`));
  while (arrived < 20) await new Promise(resolve => setTimeout(resolve, 5));
  finish();
  const statuses = await Promise.all(responses.map(async response => (await response).status));
  assert.deepEqual([...new Set(statuses)], [200]);
  assert.equal(queries, 1);
  // The next probe runs a fresh check.
  const next = fetch(`${base}/api/health`);
  while (queries < 2) await new Promise(resolve => setTimeout(resolve, 5));
  finish();
  assert.equal((await next).status, 200);
});
