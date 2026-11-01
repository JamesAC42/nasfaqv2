const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const adminRoutes = require('../src/routes/admin');
const { SITES, siteAnalytics, umamiConfig } = require('../src/services/umami');

const env = { UMAMI_API_KEY: 'umami_secret_key' };
const quiet = { error() {} };
// 2026-11-03 15:30 in New York (EST, after the Nov 1 clock change).
const now = new Date('2026-11-03T20:30:00Z');

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

// Answers like Umami v3 does: counts can be strings (bigint columns), and only days with traffic come back.
function fakeUmami(calls = []) {
  return async (url, init) => {
    calls.push({ url: new URL(url), init });
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith('/pageviews')) {
      return json({
        pageviews: [{ x: '2026-10-31 00:00:00', y: 40 }, { x: '2026-11-02 00:00:00', y: '12' }],
        sessions: [{ x: '2026-10-31 00:00:00', y: 9 }, { x: '2026-11-02 00:00:00', y: 3 }],
      });
    }
    if (pathname.endsWith('/metrics')) {
      const type = searchParams.get('type');
      return json(type === 'path' ? [{ x: '/market', y: 30 }, { x: '', y: 5 }, { x: null, y: 2 }] : type === 'referrer' ? [{ x: 'nasfaq.biz', y: '7' }] : []);
    }
    if (searchParams.get('referrer') === 'nasfaq.biz') return json({ pageviews: 8, visitors: 2, visits: 2, bounces: 1, totaltime: 60 });
    return json({ pageviews: '52', visitors: '12', visits: 14, bounces: 6, totaltime: '700', comparison: { pageviews: 26, visitors: 6, visits: 7, bounces: 2, totaltime: 300 } });
  };
}

const codeOf = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return null;
};

test('umamiConfig needs a key and defaults the base URL', () => {
  assert.equal(umamiConfig({}), null);
  assert.equal(umamiConfig({ UMAMI_API_KEY: '   ' }), null);
  assert.deepEqual(umamiConfig(env), { apiKey: 'umami_secret_key', baseUrl: 'https://umami.fukuin.dev' });
  assert.equal(umamiConfig({ ...env, UMAMI_BASE_URL: 'http://localhost:4100/' }).baseUrl, 'http://localhost:4100');
});

test('asks the right site for New York days, with the key only in the header', async () => {
  const calls = [];
  const result = await siteAnalytics({ site: 'v2', from: '2026-10-31', to: '2026-11-03' }, { env, fetchImpl: fakeUmami(calls), logger: quiet, now });

  for (const { url, init } of calls) {
    assert.equal(url.origin, 'https://umami.fukuin.dev');
    assert.ok(url.pathname.startsWith(`/api/websites/${SITES.v2.id}/`));
    assert.ok(!url.href.includes('umami_secret_key'));
    assert.equal(init.headers.Authorization, 'Bearer umami_secret_key');
    // Midnight Oct 31 in New York is 04:00 UTC (daylight time), and the range stops at `now`.
    assert.equal(url.searchParams.get('startAt'), String(Date.parse('2026-10-31T04:00:00Z')));
    assert.equal(url.searchParams.get('endAt'), String(now.getTime()));
  }
  const chart = calls.find(({ url }) => url.pathname.endsWith('/pageviews')).url.searchParams;
  assert.equal(chart.get('unit'), 'day');
  assert.equal(chart.get('timezone'), 'America/New_York');
  const types = calls.filter(({ url }) => url.pathname.endsWith('/metrics')).map(({ url }) => url.searchParams.get('type'));
  assert.deepEqual(types.sort(), ['country', 'path', 'referrer', 'utmCampaign']);
  assert.ok(!JSON.stringify(result).includes('umami_secret_key'));
});

test('turns counts into numbers, drops blank rows and fills the days without traffic', async () => {
  const result = await siteAnalytics({ site: 'v2', from: '2026-10-31', to: '2026-11-03' }, { env, fetchImpl: fakeUmami(), logger: quiet, now });

  assert.deepEqual(result.totals, { visitors: 12, visits: 14, pageviews: 52, bounces: 6, total_time_sec: 700 });
  assert.deepEqual(result.previous, { visitors: 6, visits: 7, pageviews: 26, bounces: 2, total_time_sec: 300 });
  assert.deepEqual(result.series, [
    { at: '2026-10-31', pageviews: 40, visitors: 9 },
    { at: '2026-11-01', pageviews: 0, visitors: 0 },
    { at: '2026-11-02', pageviews: 12, visitors: 3 },
    { at: '2026-11-03', pageviews: 0, visitors: 0 },
  ]);
  assert.deepEqual(result.pages, [{ label: '/market', count: 30 }]);
  assert.deepEqual(result.referrers, [{ label: 'nasfaq.biz', count: 7 }]);
  assert.equal(result.from_v1.visitors, 2);
});

test('v1 has no "from v1" number, and its calls use its own website id', async () => {
  const calls = [];
  const result = await siteAnalytics({ site: 'v1', from: '2026-11-03', to: '2026-11-03' }, { env, fetchImpl: fakeUmami(calls), logger: quiet, now });
  assert.equal(result.from_v1, null);
  assert.equal(result.host, 'nasfaq.biz');
  assert.ok(calls.every(({ url }) => url.pathname.includes(SITES.v1.id)));
  assert.ok(calls.every(({ url }) => !url.searchParams.has('referrer')));
});

test('short ranges get a bar per hour, and none for hours that have not happened', async () => {
  const fetchImpl = async (url) => {
    if (new URL(url).pathname.endsWith('/pageviews')) return json({ pageviews: [{ x: '2026-11-03 13:00:00', y: 5 }], sessions: [{ x: '2026-11-03 13:00:00', y: 2 }] });
    return json(new URL(url).pathname.endsWith('/metrics') ? [] : {});
  };
  const { unit, series } = await siteAnalytics({ site: 'v2', from: '2026-11-03', to: '2026-11-03' }, { env, fetchImpl, logger: quiet, now });
  assert.equal(unit, 'hour');
  assert.equal(series.length, 16);
  assert.equal(series[0].at, '2026-11-03 00');
  assert.equal(series.at(-1).at, '2026-11-03 15');
  assert.deepEqual(series[13], { at: '2026-11-03 13', pageviews: 5, visitors: 2 });
});

test('the 25-hour day when the clocks go back still has one bar per hour label', async () => {
  const { series } = await siteAnalytics({ site: 'v2', from: '2026-11-01', to: '2026-11-01' }, { env, fetchImpl: fakeUmami(), logger: quiet, now });
  assert.equal(series.length, 24);
  assert.equal(new Set(series.map((point) => point.at)).size, 24);
});

test('rejects a bad site or range before calling Umami', async () => {
  let called = false;
  const options = { env, logger: quiet, now, fetchImpl: async () => { called = true; return json({}); } };
  assert.equal(await codeOf(siteAnalytics({ site: 'nope', from: '2026-11-01', to: '2026-11-02' }, options)), 'invalid_site');
  assert.equal(await codeOf(siteAnalytics({ site: '__proto__', from: '2026-11-01', to: '2026-11-02' }, options)), 'invalid_site');
  for (const [from, to] of [
    ['2026-11-02', '2026-11-01'],
    ['2026-02-30', '2026-03-01'],
    ['yesterday', '2026-11-01'],
    [undefined, '2026-11-01'],
    [['2026-11-01'], '2026-11-01'],
    ['2025-01-01', '2026-11-01'],
    ['2026-11-04', '2026-11-05'],
  ]) {
    assert.equal(await codeOf(siteAnalytics({ site: 'v2', from, to }, options)), 'invalid_range', `${from} to ${to}`);
  }
  assert.equal(called, false);
});

test('says when the key is missing or refused, or Umami is down, without logging the key', async () => {
  const logged = [];
  const logger = { error: (line) => logged.push(line) };
  const range = { site: 'v2', from: '2026-11-01', to: '2026-11-03' };
  assert.equal(await codeOf(siteAnalytics(range, { env: {}, fetchImpl: fakeUmami(), logger, now })), 'analytics_not_configured');
  assert.equal(await codeOf(siteAnalytics(range, { env, fetchImpl: async () => json({}, 401), logger, now })), 'analytics_forbidden');
  assert.equal(await codeOf(siteAnalytics(range, { env, fetchImpl: async () => json({}, 500), logger, now })), 'analytics_unavailable');
  assert.equal(await codeOf(siteAnalytics(range, { env, fetchImpl: async () => { throw new Error('timed out'); }, logger, now })), 'analytics_unavailable');
  const notJson = { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } };
  assert.equal(await codeOf(siteAnalytics(range, { env, fetchImpl: async () => notJson, logger, now })), 'analytics_unavailable');
  assert.ok(logged.length > 0);
  assert.ok(logged.every((line) => !line.includes('umami_secret_key')));
});

test('GET /api/admin/analytics: admins only, and a clear error while the key is unset', async (t) => {
  const saved = process.env.UMAMI_API_KEY;
  delete process.env.UMAMI_API_KEY;
  t.after(() => { if (saved !== undefined) process.env.UMAMI_API_KEY = saved; });

  let user = null;
  const app = express();
  app.use((req, _res, next) => { req.ctx = { user }; next(); });
  app.use('/api/admin', adminRoutes);
  app.use((error, _req, res, _next) => res.status(500).json({ error: String(error.message) }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise((resolve) => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/api/admin/analytics?site=v2&from=2026-11-01&to=2026-11-01`;

  assert.equal((await fetch(url)).status, 401);
  user = { id: 2, username: 'pleb', is_admin: false };
  assert.equal((await fetch(url)).status, 403);
  user = { id: 1, username: 'boss', is_admin: true };
  const response = await fetch(url);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'analytics_not_configured' });
});
