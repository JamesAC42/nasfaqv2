const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool, DEFAULT_STATEMENT_TIMEOUT_MS } = require('../src/db');

test('pools cancel a runaway statement after a minute; migrations opt out', async (t) => {
  const url = 'postgres://test:test@127.0.0.1:1/test';
  const saved = process.env.PG_STATEMENT_TIMEOUT_MS;
  delete process.env.PG_STATEMENT_TIMEOUT_MS;
  const app = createPool(url);
  const migrations = createPool(url, { statementTimeoutMs: 0 });
  process.env.PG_STATEMENT_TIMEOUT_MS = '15000';
  const tuned = createPool(url);
  process.env.PG_STATEMENT_TIMEOUT_MS = 'nonsense';
  const fallback = createPool(url);
  if (saved === undefined) delete process.env.PG_STATEMENT_TIMEOUT_MS;
  else process.env.PG_STATEMENT_TIMEOUT_MS = saved;
  t.after(() => Promise.all([app, migrations, tuned, fallback].map((pool) => pool.end())));
  assert.equal(DEFAULT_STATEMENT_TIMEOUT_MS, 60000);
  assert.equal(app.options.statement_timeout, 60000);
  assert.equal(migrations.options.statement_timeout, 0);
  assert.equal(tuned.options.statement_timeout, 15000);
  assert.equal(fallback.options.statement_timeout, 60000);
});

test('real pg Pool handles an idle connection error without throwing or leaking client data', async (t) => {
  // Pool construction is lazy: this test never opens a database connection.
  const pool = createPool('postgres://test:test@127.0.0.1:1/test');
  t.after(() => pool.end());
  const messages = [];
  t.mock.method(console, 'error', (...args) => messages.push(args));
  const error = Object.assign(new Error('sensitive credentials'), { code: '57P01' });
  assert.doesNotThrow(() => pool.emit('error', error, { password: 'sensitive' }));
  assert.equal(messages[0][1].code, '57P01');
  assert(!JSON.stringify(messages).includes('sensitive'));
  assert.doesNotThrow(() => pool.emit('error', null));
  assert.equal(messages[1][1].code, 'UNKNOWN');
  assert.equal(pool.totalCount, 0);
});
