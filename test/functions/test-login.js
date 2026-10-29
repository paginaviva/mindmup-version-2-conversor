/**
 * Unit tests for the `/api/login` Pages Function.
 *
 * The tests use an in-memory KV mock and a real `Request`/`Response` pair, so
 * the handler is exercised through its public `onRequestPost(context)` entry
 * point without dependencies or network access.
 *
 * Run from the project root with:
 *   node test/functions/test-login.js
 */

import assert from 'node:assert/strict';

import { onRequestPost } from '../../functions/api/login.js';
import { hashPassword } from '../../src/shared/session.js';

/** Low iteration count: tests check behaviour, not production strength. */
const ITERATIONS = 1000;

/** Deterministic administrative password used only by this suite. */
const PASSWORD = 'correct horse battery staple';

/** 16-byte deterministic PBKDF2 salt. */
const SALT_BASE64 = Buffer.from('0123456789abcdef', 'ascii').toString('base64');

/** Precomputed hash matching PASSWORD, SALT_BASE64 and ITERATIONS. */
const PASSWORD_HASH = await hashPassword(PASSWORD, {
  saltBase64: SALT_BASE64,
  iterations: ITERATIONS,
});

/** Generic authentication message asserted by several cases. */
const INVALID_CREDENTIALS_MESSAGE = 'Usuario o contraseña incorrectos.';

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
 * Builds a valid configuration document with overridable values.
 *
 * @param {Object} [overrides={}] - Values to replace.
 * @returns {Object} Configuration document.
 */
function createConfig(overrides = {}) {
  return {
    schemaVersion: 1,
    loginEnabled: true,
    catalogEnabled: true,
    loginUser: 'admin',
    sessionTtlMinutes: 60,
    anonymousRetentionHours: 24,
    maxUploadBytes: 16777216,
    minUploadBytes: 1024,
    rateLimit: {
      windowSeconds: 600,
      maxRequestsPerWindow: 2,
      maxRequestsPerDay: 10,
      maxConcurrent: 1,
      appliesToAuthenticated: false,
    },
    loginMaxAttempts: 3,
    loginWindowSeconds: 600,
    allowedOrigins: [],
    configCacheSeconds: 60,
    conversionTimeoutSeconds: 120,
    htmlCacheSeconds: 0,
    ...overrides,
  };
}

/**
 * Creates an in-memory CONFIG_KV mock.
 *
 * The configuration document is stored under `app-config`, as the loader
 * expects. Every write is recorded so tests can assert TTLs.
 *
 * @param {Object} config - Configuration document.
 * @returns {Object} KV-like binding with inspection helpers.
 */
function createKv(config) {
  const store = new Map([['app-config', JSON.stringify(config)]]);
  const puts = [];

  return {
    store,
    puts,
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value, options = {}) {
      store.set(key, value);
      puts.push({ key, value, options });
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

/**
 * Builds the environment bindings and exposes the KV mock.
 *
 * @param {Object} config - Configuration document.
 * @param {Object} [secretOverrides={}] - Secret values to replace or remove.
 * @returns {{env: Object, kv: Object}} Environment and KV mock.
 */
function createEnv(config, secretOverrides = {}) {
  const kv = createKv(config);
  const env = {
    CONFIG_KV: kv,
    ADMIN_PASSWORD_HASH: PASSWORD_HASH,
    ADMIN_PASSWORD_SALT: SALT_BASE64,
    ADMIN_PASSWORD_ITERATIONS: String(ITERATIONS),
    ...secretOverrides,
  };

  return { env, kv };
}

/**
 * Builds a POST request with an optional raw body and client IP.
 *
 * @param {Object|null} body - JSON-serializable body.
 * @param {Object} [options={}] - Request options.
 * @param {string|null} [options.ip='203.0.113.10'] - CF-Connecting-IP value.
 * @param {string} [options.rawBody] - Raw body that replaces `body`.
 * @returns {Request} POST request.
 */
function createRequest(body, options = {}) {
  const { ip = '203.0.113.10', rawBody } = options;
  const headers = new Headers();

  if (ip !== null) {
    headers.set('CF-Connecting-IP', ip);
  }

  return new Request('https://example.test/api/login', {
    method: 'POST',
    headers,
    body: rawBody === undefined ? JSON.stringify(body) : rawBody,
  });
}

/**
 * Invokes the Pages Function handler.
 *
 * @param {Object} env - Environment bindings.
 * @param {Request} request - Incoming request.
 * @returns {Promise<Response>} Handler response.
 */
function invoke(env, request) {
  return onRequestPost({ request, env });
}

test('successful login returns the user, a session cookie and clears attempts', async () => {
  const config = createConfig();
  const { env, kv } = createEnv(config);
  const attemptKey = 'login-attempt:203.0.113.10';
  kv.store.set(attemptKey, '2');

  const response = await invoke(env, createRequest({ user: 'admin', password: PASSWORD }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authenticated: true, user: 'admin' });

  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie.startsWith('__Host-mmup_session='));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Max-Age=3600$/);
  assert.equal(/Domain=/i.test(cookie), false);

  assert.equal(kv.store.has(attemptKey), false);
});

test('successful login stores the session record with the configured TTL', async () => {
  const config = createConfig({ sessionTtlMinutes: 45 });
  const { env, kv } = createEnv(config);

  const response = await invoke(env, createRequest({ user: 'admin', password: PASSWORD }));
  assert.equal(response.status, 200);

  const sessionEntry = [...kv.store.keys()].find((key) => key.startsWith('session:'));
  assert.ok(sessionEntry, 'session key must exist');

  const record = JSON.parse(kv.store.get(sessionEntry));
  assert.equal(record.user, 'admin');
  assert.equal(
    Date.parse(record.expiresAt) - Date.parse(record.createdAt),
    45 * 60 * 1000,
  );

  const sessionPut = kv.puts.find((entry) => entry.key === sessionEntry);
  assert.equal(sessionPut.options.expirationTtl, 45 * 60);
});

test('wrong user returns the generic 401 message and counts the failure', async () => {
  const config = createConfig();
  const { env, kv } = createEnv(config);

  const response = await invoke(env, createRequest({ user: 'intruder', password: PASSWORD }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: INVALID_CREDENTIALS_MESSAGE });
  assert.equal(kv.store.get('login-attempt:203.0.113.10'), '1');
  assert.equal(
    [...kv.store.keys()].some((key) => key.startsWith('session:')),
    false,
  );
});

test('wrong password returns the generic 401 message and creates no session', async () => {
  const config = createConfig();
  const { env, kv } = createEnv(config);

  const response = await invoke(env, createRequest({ user: 'admin', password: 'wrong-password' }));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: INVALID_CREDENTIALS_MESSAGE });
  assert.equal(kv.store.get('login-attempt:203.0.113.10'), '1');
  assert.equal(
    [...kv.store.keys()].some((key) => key.startsWith('session:')),
    false,
  );
});

test('login disabled returns 404 and does not touch the attempt counter', async () => {
  const config = createConfig({ loginEnabled: false });
  const { env, kv } = createEnv(config);

  const response = await invoke(env, createRequest({ user: 'admin', password: PASSWORD }));

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'El acceso no está disponible' });
  assert.equal(kv.store.has('login-attempt:203.0.113.10'), false);
  assert.equal(
    [...kv.store.keys()].some((key) => key.startsWith('session:')),
    false,
  );
});

test('missing password secrets fail closed with the generic 401', async () => {
  const config = createConfig();

  for (const secretName of [
    'ADMIN_PASSWORD_HASH',
    'ADMIN_PASSWORD_SALT',
    'ADMIN_PASSWORD_ITERATIONS',
  ]) {
    const { env, kv } = createEnv(config, { [secretName]: undefined });
    const response = await invoke(env, createRequest({ user: 'admin', password: PASSWORD }));

    assert.equal(response.status, 401, secretName);
    assert.deepEqual(
      await response.json(),
      { error: INVALID_CREDENTIALS_MESSAGE },
      secretName,
    );
    assert.equal(
      [...kv.store.keys()].some((key) => key.startsWith('session:')),
      false,
      secretName,
    );
  }
});

test('malformed JSON body returns 400', async () => {
  const config = createConfig();
  const { env } = createEnv(config);

  const response = await invoke(env, createRequest(null, { rawBody: '{"user":' }));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'Solicitud no válida' });
});

test('body without string user and password returns 400', async () => {
  const config = createConfig();
  const { env } = createEnv(config);

  const missingPassword = await invoke(env, createRequest({ user: 'admin' }));
  assert.equal(missingPassword.status, 400);

  const numericUser = await invoke(env, createRequest({ user: 1, password: PASSWORD }));
  assert.equal(numericUser.status, 400);
});

test('rate limit blocks the request after the configured failures', async () => {
  const config = createConfig({ loginMaxAttempts: 3, loginWindowSeconds: 900 });
  const { env, kv } = createEnv(config);
  const attemptKey = 'login-attempt:198.51.100.22';

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await invoke(
      env,
      createRequest({ user: 'admin', password: 'wrong' }, { ip: '198.51.100.22' }),
    );
    assert.equal(response.status, 401);
  }

  assert.equal(kv.store.get(attemptKey), '3');
  const lastPut = kv.puts.filter((entry) => entry.key === attemptKey).at(-1);
  assert.equal(lastPut.options.expirationTtl, 900);

  const blocked = await invoke(
    env,
    createRequest({ user: 'admin', password: PASSWORD }, { ip: '198.51.100.22' }),
  );

  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('retry-after'), '900');
  assert.match((await blocked.json()).error, /Demasiados intentos/);
  assert.equal(kv.store.get(attemptKey), '3');
  assert.equal(
    [...kv.store.keys()].some((key) => key.startsWith('session:')),
    false,
  );
});

test('missing CF-Connecting-IP uses the safe fallback bucket', async () => {
  const config = createConfig();
  const { env, kv } = createEnv(config);

  const response = await invoke(
    env,
    createRequest({ user: 'admin', password: 'wrong' }, { ip: null }),
  );

  assert.equal(response.status, 401);
  assert.equal(kv.store.get('login-attempt:unknown'), '1');
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

console.log(`login function tests OK (${passed}/${tests.length})`);
