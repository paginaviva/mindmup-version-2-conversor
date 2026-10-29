/**
 * @module test-session-guard
 * Tests for the Pages Functions session guard.
 */

import assert from 'node:assert/strict';
import { getSession, requireSession, requireCatalogue } from '../../functions/_lib/session-guard.js';
import { buildSessionRecord, generateSessionId, sessionKey, SESSION_COOKIE_NAME } from '../../src/shared/session.js';
import { CONFIG_KEY } from '../../src/shared/config.js';

const CONFIG = {
  schemaVersion: 1,
  loginEnabled: true,
  catalogEnabled: true,
  loginUser: 'admin',
  sessionTtlMinutes: 60,
  anonymousRetentionHours: 24,
  maxUploadBytes: 16777216,
  minUploadBytes: 1024,
  rateLimit: { windowSeconds: 600, maxRequestsPerWindow: 2, maxRequestsPerDay: 10, maxConcurrent: 1, appliesToAuthenticated: false },
  loginMaxAttempts: 5,
  loginWindowSeconds: 600,
  allowedOrigins: [],
  configCacheSeconds: 60,
  conversionTimeoutSeconds: 120,
  htmlCacheSeconds: 0,
};

let total = 0;
let passed = 0;
const failures = [];

async function test(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

function createEnv({ config = CONFIG, sessions = {} } = {}) {
  const store = new Map(Object.entries(sessions));
  store.set(CONFIG_KEY, JSON.stringify(config));
  return {
    CONFIG_KV: {
      async get(key) { return store.has(key) ? store.get(key) : null; },
      async delete(key) { store.delete(key); },
    },
    store,
  };
}

function context(env, sessionId) {
  return {
    env,
    request: new Request('https://pages.test/api/list', {
      headers: sessionId ? { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } : {},
    }),
  };
}

await test('valid session returns the user', async () => {
  const id = generateSessionId();
  const env = createEnv({ sessions: { [sessionKey(id)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) } });
  const session = await getSession(context(env, id));
  assert.equal(session.authenticated, true);
  assert.equal(session.user, 'admin');
});

await test('missing cookie is unauthenticated', async () => {
  assert.equal((await getSession(context(createEnv(), null))).authenticated, false);
});

await test('unknown session is unauthenticated', async () => {
  assert.equal((await getSession(context(createEnv(), 'unknown'))).authenticated, false);
});

await test('expired session is unauthenticated and deleted', async () => {
  const id = generateSessionId();
  const record = buildSessionRecord({ user: 'admin', ttlSeconds: 3600, now: Date.now() - 7200000 });
  const env = createEnv({ sessions: { [sessionKey(id)]: JSON.stringify(record) } });
  assert.equal((await getSession(context(env, id))).authenticated, false);
  assert.equal(env.store.has(sessionKey(id)), false);
});

await test('malformed record is unauthenticated', async () => {
  const id = generateSessionId();
  const env = createEnv({ sessions: { [sessionKey(id)]: '{bad' } });
  assert.equal((await getSession(context(env, id))).authenticated, false);
});

await test('missing KV is unauthenticated', async () => {
  assert.equal((await getSession({ request: new Request('https://pages.test/'), env: {} })).authenticated, false);
});

await test('requireSession returns a 401 response', async () => {
  const result = await requireSession(context(createEnv(), null));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

await test('catalogue disabled returns 404', async () => {
  const result = await requireCatalogue(context(createEnv({ config: { ...CONFIG, catalogEnabled: false } }), null));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 404);
});

await test('login disabled returns 404', async () => {
  const result = await requireCatalogue(context(createEnv({ config: { ...CONFIG, loginEnabled: false } }), null));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 404);
});

await test('catalogue enabled without session returns 401', async () => {
  const result = await requireCatalogue(context(createEnv(), null));
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 401);
});

await test('catalogue enabled with session succeeds', async () => {
  const id = generateSessionId();
  const env = createEnv({ sessions: { [sessionKey(id)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) } });
  const result = await requireCatalogue(context(env, id));
  assert.equal(result.ok, true);
  assert.equal(result.session.user, 'admin');
});

await test('configuration failure returns 500', async () => {
  const result = await requireCatalogue({ env: {}, request: new Request('https://pages.test/') });
  assert.equal(result.ok, false);
  assert.equal(result.response.status, 500);
});

console.log(`\nsession guard tests OK (${passed}/${total})`);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.error.stack);
  process.exit(1);
}
