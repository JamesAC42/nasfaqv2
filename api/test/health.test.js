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
