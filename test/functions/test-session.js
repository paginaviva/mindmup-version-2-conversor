/**
 * Unit tests for the `/api/session` and `/api/logout` Pages Functions.
 *
 * The handlers run through their public entry points with an in-memory KV mock
 * and real `Request`/`Response` objects, so no binding, network access or
 * Cloudflare runtime is required.
 *
 * Run from the project root with:
 *   node test/functions/test-session.js
 */

import assert from 'node:assert/strict';

import { onRequestPost as onLogout } from '../../functions/api/logout.js';
import { onRequestGet as onSession } from '../../functions/api/session.js';
import {
  SESSION_COOKIE_NAME,
  buildSessionRecord,
  serializeClearSessionCookie,
  sessionKey,
} from '../../src/shared/session.js';

const CONFIG_DOCUMENT = {
  schemaVersion: 1, loginEnabled: true, catalogEnabled: true, loginUser: 'admin',
  sessionTtlMinutes: 60, anonymousRetentionHours: 24, maxUploadBytes: 16777216, minUploadBytes: 1024,
  rateLimit: { windowSeconds: 600, maxRequestsPerWindow: 2, maxRequestsPerDay: 10, maxConcurrent: 1, appliesToAuthenticated: false },
  loginMaxAttempts: 5, loginWindowSeconds: 600, allowedOrigins: [], configCacheSeconds: 60,
  conversionTimeoutSeconds: 120, htmlCacheSeconds: 0,
};

/** Deterministic identifier used only by these tests. */
const SESSION_ID = 'test-session-identifier';

/** KV key derived from SESSION_ID. */
const SESSION_KEY = sessionKey(SESSION_ID);

/** Session lifetime used only by these tests. */
const TEST_TTL_SECONDS = 3600;

/** Cookie header carrying the test session identifier. */
const SESSION_COOKIE = `${SESSION_COOKIE_NAME}=${SESSION_ID}`;

const tests = [];

/**
 * Registers a test case.
 *
 * @param {string} name - Test name.
 * @param {() => void|Promise<void>} fn - Test body.
 * @returns {void}
 */
function test(name, fn) {
  tests.push({ name, fn });
}

/**
 * Creates an in-memory CONFIG_KV mock.
 *
 * Reads and deletions are recorded so tests can assert whether the handler
 * touched the binding.
 *
 * @param {Object<string, string>} [entries={}] - Initial KV entries.
 * @returns {Object} KV-like binding with inspection helpers.
 */
function createKv(entries = {}) {
  const seeded = { 'app-config': JSON.stringify(CONFIG_DOCUMENT), ...entries };
  return {
    store: new Map(Object.entries(seeded)),
    deletions: [],
    getCalls: 0,
    async get(key) {
      this.getCalls += 1;
      return this.store.has(key) ? this.store.get(key) : null;
    },
    async delete(key) {
      this.deletions.push(key);
      this.store.delete(key);
    },
  };
}

/**
 * Builds a request with an optional Cookie header.
 *
 * @param {'GET'|'POST'} method - HTTP method.
 * @param {string|undefined} cookie - Raw Cookie header value.
 * @returns {Request} Request for the corresponding endpoint.
 */
function createRequest(method, cookie) {
  const headers = new Headers();
  if (cookie !== undefined) {
    headers.set('Cookie', cookie);
  }

  const path = method === 'GET' ? 'session' : 'logout';
  return new Request(`https://example.test/api/${path}`, { method, headers });
}

/**
 * Invokes the session handler.
 *
 * @param {Object|undefined} env - Environment bindings.
 * @param {Request} request - Incoming request.
 * @returns {Promise<Response>} Handler response.
 */
function invokeSession(env, request) {
  return onSession({ request, env });
}

/**
 * Invokes the logout handler.
 *
 * @param {Object|undefined} env - Environment bindings.
 * @param {Request} request - Incoming request.
 * @returns {Promise<Response>} Handler response.
 */
function invokeLogout(env, request) {
  return onLogout({ request, env });
}

/**
 * Builds a valid, non-expired session record.
 *
 * @returns {{user: string, createdAt: string, expiresAt: string}} Session record.
 */
function createSessionRecord() {
  return buildSessionRecord({
    user: 'admin',
    ttlSeconds: TEST_TTL_SECONDS,
  });
}

test('valid session returns the authenticated user', async () => {
  const kv = createKv({ [SESSION_KEY]: JSON.stringify(createSessionRecord()) });

  const response = await invokeSession(
    { CONFIG_KV: kv },
    createRequest('GET', SESSION_COOKIE),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, user: 'admin' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type'), /^application\/json/);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(kv.deletions, []);
});

test('missing cookie returns unauthenticated without reading KV', async () => {
  const kv = createKv();

  const response = await invokeSession({ CONFIG_KV: kv }, createRequest('GET'));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(kv.getCalls, 0);
  assert.deepEqual(kv.deletions, []);
});

test('empty cookie value returns unauthenticated', async () => {
  const kv = createKv();

  const response = await invokeSession(
    { CONFIG_KV: kv },
    createRequest('GET', `${SESSION_COOKIE_NAME}=`),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(kv.getCalls, 0);
});

test('unknown session returns unauthenticated without deleting anything', async () => {
  const kv = createKv();

  const response = await invokeSession(
    { CONFIG_KV: kv },
    createRequest('GET', SESSION_COOKIE),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.equal(kv.getCalls, 2);
  assert.deepEqual(kv.deletions, []);
});

test('expired session is deleted and treated as unauthenticated', async () => {
  const expired = buildSessionRecord({
    user: 'admin',
    ttlSeconds: 60,
    now: Date.now() - 120_000,
  });
  const kv = createKv({ [SESSION_KEY]: JSON.stringify(expired) });

  const response = await invokeSession(
    { CONFIG_KV: kv },
    createRequest('GET', SESSION_COOKIE),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.deepEqual(kv.deletions, [SESSION_KEY]);
  assert.equal(kv.store.has(SESSION_KEY), false);
});

test('malformed session records are deleted and treated as unauthenticated', async () => {
  const malformedRecords = [
    'not-json',
    JSON.stringify(null),
    JSON.stringify([1, 2]),
    JSON.stringify({ expiresAt: createSessionRecord().expiresAt }),
    JSON.stringify({ user: 'admin' }),
    JSON.stringify({ user: '', expiresAt: createSessionRecord().expiresAt }),
    JSON.stringify({ user: 'admin', expiresAt: 'not-a-date' }),
  ];

  for (const raw of malformedRecords) {
    const kv = createKv({ [SESSION_KEY]: raw });

    const response = await invokeSession(
      { CONFIG_KV: kv },
      createRequest('GET', SESSION_COOKIE),
    );

    assert.equal(response.status, 200, raw);
    assert.deepEqual(await response.json(), { authenticated: false }, raw);
    assert.deepEqual(kv.deletions, [SESSION_KEY], raw);
    assert.equal(kv.store.has(SESSION_KEY), false, raw);
  }
});

test('session without CONFIG_KV returns unauthenticated', async () => {
  for (const env of [{}, undefined]) {
    const response = await invokeSession(env, createRequest('GET', SESSION_COOKIE));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('disabled login invalidates an existing session', async () => {
  const kv = createKv({
    'app-config': JSON.stringify({ ...CONFIG_DOCUMENT, loginEnabled: false }),
    [SESSION_KEY]: JSON.stringify(createSessionRecord()),
  });

  const response = await invokeSession(
    { CONFIG_KV: kv },
    createRequest('GET', SESSION_COOKIE),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.deepEqual(kv.deletions, [SESSION_KEY]);
  assert.equal(kv.store.has(SESSION_KEY), false);
});

test('logout with a session deletes the KV record and clears the cookie', async () => {
  const kv = createKv({ [SESSION_KEY]: JSON.stringify(createSessionRecord()) });

  const response = await invokeLogout(
    { CONFIG_KV: kv },
    createRequest('POST', SESSION_COOKIE),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.deepEqual(kv.deletions, [SESSION_KEY]);
  assert.equal(kv.store.has(SESSION_KEY), false);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), serializeClearSessionCookie());
});

test('logout without a cookie still clears the cookie', async () => {
  const kv = createKv();

  const response = await invokeLogout({ CONFIG_KV: kv }, createRequest('POST'));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: false });
  assert.deepEqual(kv.deletions, []);
  assert.equal(response.headers.get('set-cookie'), serializeClearSessionCookie());
});

test('logout without CONFIG_KV still clears the cookie', async () => {
  for (const env of [{}, undefined]) {
    const response = await invokeLogout(env, createRequest('POST', SESSION_COOKIE));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false });
    assert.equal(response.headers.get('set-cookie'), serializeClearSessionCookie());
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('cleared cookie keeps the __Host- invariants', async () => {
  const response = await invokeLogout({}, createRequest('POST'));
  const cookie = response.headers.get('set-cookie');

  assert.equal(
    cookie,
    '__Host-mmup_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  );
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Max-Age=0$/);
  assert.equal(/Domain=/i.test(cookie), false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`session function tests OK (${passed}/${tests.length})`);
