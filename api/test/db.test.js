const test = require('node:test');
const assert = require('node:assert/strict');
const { createPool } = require('../src/db');

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
