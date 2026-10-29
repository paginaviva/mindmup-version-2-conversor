/**
 * Unit tests for the shared session module: cookie handling, session records,
 * identifier generation and PBKDF2 password hashing.
 *
 * Run from the project root with:
 *   node test/shared/test-session.js
 */

import assert from 'node:assert/strict';

import {
  SESSION_COOKIE_NAME,
  buildSessionRecord,
  generateSessionId,
  hashPassword,
  isSessionExpired,
  parseCookies,
  serializeClearSessionCookie,
  serializeSessionCookie,
  sessionKey,
  verifyPassword,
} from '../../src/shared/session.js';

/** Fixed instant used by deterministic timestamp tests. */
const FIXED_NOW = new Date('2026-10-24T10:00:00.000Z');

/** Low iteration count: tests only check behaviour, not production strength. */
const ITERATIONS = 1000;

/** 16-byte deterministic salt. */
const SALT_BASE64 = Buffer.from('0123456789abcdef', 'ascii').toString('base64');

/** Alternative 16-byte deterministic salt. */
const OTHER_SALT_BASE64 = Buffer.from('fedcba9876543210', 'ascii').toString('base64');

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

test('SESSION_COOKIE_NAME uses the __Host- prefix', () => {
  assert.equal(SESSION_COOKIE_NAME, '__Host-mmup_session');
  assert.ok(SESSION_COOKIE_NAME.startsWith('__Host-'));
});

test('generateSessionId returns 32 random bytes as unpadded base64url', () => {
  const sessionId = generateSessionId();

  assert.match(sessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sessionId.includes('='), false);
  assert.equal(Buffer.from(sessionId, 'base64url').length, 32);
});

test('generateSessionId produces unique identifiers', () => {
  const identifiers = new Set(
    Array.from({ length: 100 }, () => generateSessionId()),
  );

  assert.equal(identifiers.size, 100);
});

test('sessionKey prefixes the identifier with session:', () => {
  assert.equal(sessionKey('abc_DEF-123'), 'session:abc_DEF-123');
  assert.throws(() => sessionKey(''), /sessionId/);
  assert.throws(() => sessionKey(null), /sessionId/);
});

test('buildSessionRecord returns ISO timestamps based on ttlSeconds', () => {
  const record = buildSessionRecord({
    user: 'admin',
    ttlSeconds: 3600,
    now: FIXED_NOW,
  });

  assert.deepEqual(record, {
    user: 'admin',
    createdAt: '2026-10-24T10:00:00.000Z',
    expiresAt: '2026-10-24T11:00:00.000Z',
  });
});

test('buildSessionRecord accepts epoch milliseconds and ISO strings', () => {
  const fromNumber = buildSessionRecord({
    user: 'admin',
    ttlSeconds: 60,
    now: FIXED_NOW.getTime(),
  });
  const fromString = buildSessionRecord({
    user: 'admin',
    ttlSeconds: 60,
    now: FIXED_NOW.toISOString(),
  });

  assert.deepEqual(fromNumber, fromString);
});

test('buildSessionRecord validates user, ttlSeconds and now', () => {
  assert.throws(
    () => buildSessionRecord({ user: '', ttlSeconds: 60, now: FIXED_NOW }),
    /user/,
  );
  assert.throws(
    () => buildSessionRecord({ user: 'admin', ttlSeconds: 0, now: FIXED_NOW }),
    /ttlSeconds/,
  );
  assert.throws(
    () => buildSessionRecord({ user: 'admin', ttlSeconds: 60, now: 'not-a-date' }),
    /now/,
  );
  assert.throws(() => buildSessionRecord(null), /user/);
});

test('serializeSessionCookie emits the __Host- cookie with required attributes', () => {
  const cookie = serializeSessionCookie('abc_DEF-123', 3600);

  assert.equal(
    cookie,
    '__Host-mmup_session=abc_DEF-123; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600',
  );
});

test('serializeSessionCookie satisfies __Host- invariants', () => {
  const cookie = serializeSessionCookie('abc_DEF-123', 60);

  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.equal(/Domain=/i.test(cookie), false);
});

test('serializeSessionCookie rejects invalid identifiers and max-age values', () => {
  assert.throws(() => serializeSessionCookie('', 60), /sessionId/);
  assert.throws(() => serializeSessionCookie('a;b', 60), /sessionId/);
  assert.throws(() => serializeSessionCookie('abc', -1), /maxAgeSeconds/);
  assert.throws(() => serializeSessionCookie('abc', 1.5), /maxAgeSeconds/);
});

test('serializeClearSessionCookie expires the same cookie', () => {
  const cookie = serializeClearSessionCookie();

  assert.equal(
    cookie,
    '__Host-mmup_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
  );
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; Secure/);
  assert.equal(/Domain=/i.test(cookie), false);
});

test('parseCookies returns an object of cookie names and values', () => {
  assert.deepEqual(
    parseCookies('a=1; b=two; c=three'),
    { a: '1', b: 'two', c: 'three' },
  );
});

test('parseCookies trims names and values', () => {
  assert.deepEqual(
    parseCookies(' spaced = value ; x=1 '),
    { spaced: 'value', x: '1' },
  );
});

test('parseCookies returns an empty object for missing headers', () => {
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(null), {});
  assert.deepEqual(parseCookies(undefined), {});
});

test('parseCookies keeps the first occurrence of a duplicated name', () => {
  assert.deepEqual(parseCookies('a=1; a=2'), { a: '1' });
});

test('parseCookies percent-decodes values and keeps malformed encodings', () => {
  assert.deepEqual(parseCookies('encoded=a%20b'), { encoded: 'a b' });
  assert.deepEqual(parseCookies('broken=%E0%A4%A'), { broken: '%E0%A4%A' });
});

test('parseCookies ignores empty names and segments without equals', () => {
  assert.deepEqual(parseCookies('=value; noequals; empty='), { empty: '' });
});

test('parseCookies stores __proto__ as an own property without polluting', () => {
  const cookies = parseCookies('__proto__=polluted; name=ok');

  assert.equal(Object.getPrototypeOf(cookies), Object.prototype);
  assert.equal(Object.hasOwn(cookies, '__proto__'), true);
  assert.equal(cookies.__proto__, 'polluted');
  assert.equal({}.polluted, undefined);
});

test('parseCookies rejects non-string headers', () => {
  assert.throws(() => parseCookies(42), /cookieHeader/);
});

test('hashPassword returns base64 of the requested length and is deterministic', async () => {
  const hash = await hashPassword('correct horse battery staple', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });
  const repeated = await hashPassword('correct horse battery staple', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });

  assert.equal(typeof hash, 'string');
  assert.match(hash, /^[A-Za-z0-9+/]+={0,2}$/);
  assert.equal(Buffer.from(hash, 'base64').length, 32);
  assert.equal(hash, repeated);
  assert.equal(hash.includes('correct horse battery staple'), false);
});

test('hashPassword respects a custom derived length', async () => {
  const hash = await hashPassword('secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
    length: 16,
  });

  assert.equal(Buffer.from(hash, 'base64').length, 16);
});

test('hashPassword changes with the salt and the password', async () => {
  const base = await hashPassword('secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });
  const otherSalt = await hashPassword('secret', {
    saltBase64: OTHER_SALT_BASE64,
    iterations: ITERATIONS,
  });
  const otherPassword = await hashPassword('other secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });

  assert.notEqual(base, otherSalt);
  assert.notEqual(base, otherPassword);
});

test('hashPassword rejects missing or invalid parameters', async () => {
  await assert.rejects(
    () => hashPassword('secret', { saltBase64: SALT_BASE64 }),
    /iterations/,
  );
  await assert.rejects(
    () => hashPassword('secret', { saltBase64: SALT_BASE64, iterations: 0 }),
    /iterations/,
  );
  await assert.rejects(
    () => hashPassword('secret', { saltBase64: SALT_BASE64, iterations: ITERATIONS, length: 0 }),
    /length/,
  );
  await assert.rejects(() => hashPassword(null, {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  }), /password/);
  await assert.rejects(() => hashPassword('secret', null), /saltBase64/);
  await assert.rejects(() => verifyPassword('secret', null), /hashBase64/);
});

test('hashPassword rejects malformed base64 salt', async () => {
  await assert.rejects(
    () => hashPassword('secret', { saltBase64: 'not base64!', iterations: ITERATIONS }),
    /saltBase64/,
  );
  await assert.rejects(
    () => hashPassword('secret', { saltBase64: '', iterations: ITERATIONS }),
    /saltBase64/,
  );
});

test('verifyPassword accepts the matching password', async () => {
  const hashBase64 = await hashPassword('correct horse battery staple', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });

  assert.equal(
    await verifyPassword('correct horse battery staple', {
      hashBase64,
      saltBase64: SALT_BASE64,
      iterations: ITERATIONS,
    }),
    true,
  );
});

test('verifyPassword rejects a wrong password', async () => {
  const hashBase64 = await hashPassword('correct horse battery staple', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });

  assert.equal(
    await verifyPassword('wrong password', {
      hashBase64,
      saltBase64: SALT_BASE64,
      iterations: ITERATIONS,
    }),
    false,
  );
});

test('verifyPassword rejects a different iteration count', async () => {
  const hashBase64 = await hashPassword('secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });

  assert.equal(
    await verifyPassword('secret', {
      hashBase64,
      saltBase64: SALT_BASE64,
      iterations: ITERATIONS + 1,
    }),
    false,
  );
});

test('verifyPassword rejects a hash length that differs from length', async () => {
  const hashBase64 = await hashPassword('secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
    length: 64,
  });

  assert.equal(
    await verifyPassword('secret', {
      hashBase64,
      saltBase64: SALT_BASE64,
      iterations: ITERATIONS,
    }),
    false,
  );
});

test('verifyPassword supports a custom derived length', async () => {
  const hashBase64 = await hashPassword('secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
    length: 16,
  });

  assert.equal(
    await verifyPassword('secret', {
      hashBase64,
      saltBase64: SALT_BASE64,
      iterations: ITERATIONS,
      length: 16,
    }),
    true,
  );
});

test('verifyPassword fails explicitly on malformed base64 material', async () => {
  const validHash = await hashPassword('secret', {
    saltBase64: SALT_BASE64,
    iterations: ITERATIONS,
  });

  await assert.rejects(
    () => verifyPassword('secret', {
      hashBase64: '***',
      saltBase64: SALT_BASE64,
      iterations: ITERATIONS,
    }),
    /hashBase64/,
  );
  await assert.rejects(
    () => verifyPassword('secret', {
      hashBase64: validHash,
      saltBase64: '%%%',
      iterations: ITERATIONS,
    }),
    /saltBase64/,
  );
  await assert.rejects(
    () => verifyPassword('secret', { saltBase64: SALT_BASE64, iterations: ITERATIONS }),
    /hashBase64/,
  );
});

test('isSessionExpired compares now against expiresAt', () => {
  const record = buildSessionRecord({
    user: 'admin',
    ttlSeconds: 60,
    now: FIXED_NOW,
  });

  assert.equal(isSessionExpired(record, new Date('2026-10-24T10:00:59.999Z')), false);
  assert.equal(isSessionExpired(record, new Date('2026-10-24T10:01:00.000Z')), true);
  assert.equal(isSessionExpired(record, new Date('2026-10-24T10:02:00.000Z')), true);
  assert.equal(isSessionExpired(record, '2026-10-24T10:01:00.000Z'), true);
});

test('isSessionExpired rejects invalid records and timestamps', () => {
  assert.throws(() => isSessionExpired({}, FIXED_NOW), /expiresAt/);
  assert.throws(() => isSessionExpired(null, FIXED_NOW), /registro de sesión/);
  assert.throws(
    () => isSessionExpired({ expiresAt: 'not-a-date' }, FIXED_NOW),
    /expiresAt/,
  );
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

console.log(`shared session tests OK (${passed}/${tests.length})`);
