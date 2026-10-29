/**
 * @module session
 * Server-side session helpers shared by Pages Functions and Workers.
 *
 * Responsibilities:
 * 1. Generate opaque session identifiers and derive their KV keys.
 * 2. Build and inspect session records with ISO-8601 timestamps.
 * 3. Serialize and parse the `__Host-` session cookie.
 * 4. Hash and verify passwords with PBKDF2-HMAC-SHA-256.
 *
 * Operational values (TTL, PBKDF2 iterations, salt and hash length) are always
 * injected by the caller. This module never reads configuration, never carries
 * a default salt and never hardcodes a session lifetime.
 *
 * Runtime: Web Crypto (`crypto.subtle` and `crypto.getRandomValues`), available
 * in Node.js 22+ and Cloudflare Workers. No external dependencies.
 *
 * @see D11 in `.tmp/sessions/2026-10-23-etapa2-decisiones/decisiones.md`
 */

/** Session cookie name. The `__Host-` prefix is enforced by browsers. */
export const SESSION_COOKIE_NAME = '__Host-mmup_session';

/** Number of random bytes per session identifier (256 bits). */
const SESSION_ID_BYTES = 32;

/**
 * Matches standard padded base64 (empty strings are rejected separately).
 * @type {RegExp}
 */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Matches the base64url alphabet used by session identifiers.
 * @type {RegExp}
 */
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Returns the Web Crypto implementation or fails explicitly.
 *
 * @returns {Crypto} Web Crypto implementation.
 * @throws {Error} When the runtime does not expose Web Crypto.
 */
function getCrypto() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || !cryptoApi.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('No se dispone de Web Crypto en este entorno');
  }
  return cryptoApi;
}

/**
 * Throws when a value is not a non-empty string.
 *
 * @param {*} value - Value to inspect.
 * @param {string} fieldName - Name used in the Spanish error message.
 * @returns {string} The validated string.
 * @throws {TypeError} When the value is not a non-empty string.
 */
function requireNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`El valor "${fieldName}" debe ser una cadena no vacía`);
  }
  return value;
}

/**
 * Throws when a value is not a positive integer.
 *
 * @param {*} value - Value to inspect.
 * @param {string} fieldName - Name used in the Spanish error message.
 * @returns {number} The validated integer.
 * @throws {TypeError} When the value is not an integer greater than or equal to 1.
 */
function requirePositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(`El valor "${fieldName}" debe ser un entero mayor o igual que 1`);
  }
  return value;
}

/**
 * Resolves a date-like value to milliseconds since the Unix epoch.
 *
 * `undefined` resolves to the current time so callers can omit `now` while
 * tests can inject a fixed instant.
 *
 * @param {Date|number|string|undefined} value - Date, epoch milliseconds or ISO string.
 * @param {string} [fieldName='now'] - Name used in the Spanish error message.
 * @returns {number} Epoch milliseconds.
 * @throws {TypeError} When the value cannot be converted to a valid instant.
 */
function resolveInstant(value, fieldName = 'now') {
  if (value === undefined) return Date.now();

  let milliseconds;
  if (value instanceof Date) {
    milliseconds = value.getTime();
  } else if (typeof value === 'number') {
    milliseconds = value;
  } else if (typeof value === 'string') {
    milliseconds = Date.parse(value);
  } else {
    milliseconds = Number.NaN;
  }

  if (!Number.isFinite(milliseconds)) {
    throw new TypeError(`El valor "${fieldName}" debe ser una fecha válida`);
  }
  return milliseconds;
}

/**
 * Encodes bytes as standard padded base64.
 *
 * @param {Uint8Array} bytes - Bytes to encode.
 * @returns {string} Base64 string.
 */
function encodeBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Decodes standard padded base64 into bytes.
 *
 * @param {*} value - Candidate base64 string.
 * @param {string} fieldName - Name used in the Spanish error message.
 * @returns {Uint8Array} Decoded bytes.
 * @throws {TypeError} When the value is not a non-empty string.
 * @throws {Error} When the value is not valid base64.
 */
function decodeBase64(value, fieldName) {
  requireNonEmptyString(value, fieldName);

  if (!BASE64_PATTERN.test(value)) {
    throw new Error(`El valor "${fieldName}" no es base64 válido`);
  }

  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`El valor "${fieldName}" no es base64 válido`);
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/**
 * Encodes bytes as unpadded base64url.
 *
 * @param {Uint8Array} bytes - Bytes to encode.
 * @returns {string} Base64url string without padding.
 */
function encodeBase64Url(bytes) {
  return encodeBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Compares two byte arrays without early exit.
 *
 * The array length is not secret; only the byte contents are compared in
 * constant time.
 *
 * @param {Uint8Array} left - First byte array.
 * @param {Uint8Array} right - Second byte array.
 * @returns {boolean} true when both arrays have the same length and contents.
 */
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

/**
 * Derives PBKDF2-HMAC-SHA-256 bytes from a password.
 *
 * @param {string} password - Plain-text password.
 * @param {{saltBytes: Uint8Array, iterations: number, length: number}} options -
 *        Validated derivation parameters.
 * @returns {Promise<Uint8Array>} Derived key bytes.
 */
async function derivePasswordBytes(password, { saltBytes, iterations, length }) {
  const cryptoApi = getCrypto();
  const encoder = new TextEncoder();
  const keyMaterial = await cryptoApi.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  const bits = await cryptoApi.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    length * 8,
  );

  return new Uint8Array(bits);
}

/**
 * Generates an opaque session identifier.
 *
 * @returns {string} 32 random bytes encoded as unpadded base64url (43 characters).
 * @throws {Error} When the runtime does not expose Web Crypto.
 */
export function generateSessionId() {
  const cryptoApi = getCrypto();
  const bytes = new Uint8Array(SESSION_ID_BYTES);
  cryptoApi.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/**
 * Builds the KV key that stores a session record.
 *
 * @param {string} sessionId - Session identifier from the cookie.
 * @returns {string} Key in the form `session:<id>`.
 * @throws {TypeError} When the identifier is not a non-empty string.
 */
export function sessionKey(sessionId) {
  requireNonEmptyString(sessionId, 'sessionId');
  return `session:${sessionId}`;
}

/**
 * Builds a session record with ISO-8601 timestamps.
 *
 * @param {Object} options - Session parameters.
 * @param {string} options.user - Authenticated user name.
 * @param {number} options.ttlSeconds - Session lifetime in seconds (injected).
 * @param {Date|number|string} [options.now] - Current instant; defaults to now.
 * @returns {{user: string, createdAt: string, expiresAt: string}} Session record.
 * @throws {TypeError} When `user` is empty, `ttlSeconds` is not a positive
 *         finite number or `now` is not a valid date.
 */
export function buildSessionRecord(options = {}) {
  const { user, ttlSeconds, now } = options ?? {};
  requireNonEmptyString(user, 'user');

  if (typeof ttlSeconds !== 'number' || !Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError('El valor "ttlSeconds" debe ser un número finito mayor que cero');
  }

  const createdAtMs = resolveInstant(now, 'now');
  const expiresAtMs = createdAtMs + ttlSeconds * 1000;

  return {
    user,
    createdAt: new Date(createdAtMs).toISOString(),
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

/**
 * Serializes the `__Host-` session cookie.
 *
 * The `__Host-` prefix requires `Secure`, `Path=/` and no `Domain` attribute.
 *
 * @param {string} sessionId - Session identifier.
 * @param {number} maxAgeSeconds - Cookie lifetime in seconds.
 * @returns {string} `Set-Cookie` value.
 * @throws {TypeError} When the identifier is invalid or `maxAgeSeconds` is not
 *         a non-negative integer.
 */
export function serializeSessionCookie(sessionId, maxAgeSeconds) {
  requireNonEmptyString(sessionId, 'sessionId');
  if (!BASE64URL_PATTERN.test(sessionId)) {
    throw new TypeError('El valor "sessionId" contiene caracteres no permitidos');
  }
  if (!Number.isInteger(maxAgeSeconds) || maxAgeSeconds < 0) {
    throw new TypeError('El valor "maxAgeSeconds" debe ser un entero no negativo');
  }

  return `${SESSION_COOKIE_NAME}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/**
 * Serializes the cookie that clears the current session.
 *
 * @returns {string} `Set-Cookie` value with `Max-Age=0`.
 */
export function serializeClearSessionCookie() {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * Decodes a cookie value, keeping the raw text when percent-encoding is broken.
 *
 * @param {string} value - Raw cookie value.
 * @returns {string} Decoded value or the original value when decoding fails.
 */
function decodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Parses a Cookie header into a plain object.
 *
 * Rules:
 * - Missing or empty headers return an empty object.
 * - The first occurrence of a duplicated name wins.
 * - Names and values are trimmed; surrounding quotes are preserved.
 * - Values are percent-decoded when possible; malformed encodings keep the raw text.
 * - `__proto__` is stored as an own property to avoid prototype pollution.
 *
 * @param {string|null|undefined} cookieHeader - Raw `Cookie` header value.
 * @returns {Object<string, string>} Cookie names mapped to values.
 * @throws {TypeError} When the header is neither a string nor nullish.
 */
export function parseCookies(cookieHeader) {
  if (cookieHeader === null || cookieHeader === undefined || cookieHeader === '') {
    return {};
  }
  if (typeof cookieHeader !== 'string') {
    throw new TypeError('El valor "cookieHeader" debe ser una cadena');
  }

  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const segment = part.trim();
    if (segment === '') continue;

    const separator = segment.indexOf('=');
    if (separator <= 0) continue;

    const name = segment.slice(0, separator).trim();
    if (name === '' || Object.hasOwn(cookies, name)) continue;

    const rawValue = segment.slice(separator + 1).trim();
    Object.defineProperty(cookies, name, {
      value: decodeCookieValue(rawValue),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return cookies;
}

/**
 * Validates the shared PBKDF2 options and decodes the salt.
 *
 * @param {Object} options - Candidate options.
 * @param {string} options.saltBase64 - Base64 salt.
 * @param {number} options.iterations - PBKDF2 iteration count.
 * @param {number} [options.length=32] - Derived key length in bytes.
 * @returns {{saltBytes: Uint8Array, iterations: number, length: number}} Validated parameters.
 * @throws {TypeError|Error} When an option is missing, invalid or not base64.
 */
function resolveDerivationOptions(options = {}) {
  const { saltBase64, iterations, length = 32 } = options ?? {};
  const saltBytes = decodeBase64(saltBase64, 'saltBase64');
  return {
    saltBytes,
    iterations: requirePositiveInteger(iterations, 'iterations'),
    length: requirePositiveInteger(length, 'length'),
  };
}

/**
 * Hashes a password with PBKDF2-HMAC-SHA-256.
 *
 * Intended for tests and tooling (for example, generating the
 * `ADMIN_PASSWORD_HASH` secret). Never returns the plain-text password.
 *
 * @param {string} password - Plain-text password.
 * @param {Object} options - Derivation parameters.
 * @param {string} options.saltBase64 - Base64 salt.
 * @param {number} options.iterations - PBKDF2 iteration count (injected).
 * @param {number} [options.length=32] - Derived key length in bytes.
 * @returns {Promise<string>} Base64-encoded derived key.
 * @throws {TypeError|Error} When the password or an option is invalid.
 */
export async function hashPassword(password, options = {}) {
  if (typeof password !== 'string') {
    throw new TypeError('El valor "password" debe ser una cadena');
  }

  const { saltBytes, iterations, length } = resolveDerivationOptions(options ?? {});
  const derived = await derivePasswordBytes(password, { saltBytes, iterations, length });
  return encodeBase64(derived);
}

/**
 * Verifies a password against a stored PBKDF2 hash.
 *
 * The comparison runs in constant time over the derived bytes. A different
 * password, salt, iteration count or key length yields `false`; malformed
 * base64 in the stored material fails explicitly so configuration errors are
 * not mistaken for a wrong password.
 *
 * @param {string} password - Plain-text password to check.
 * @param {Object} options - Stored hash parameters.
 * @param {string} options.hashBase64 - Base64 stored hash.
 * @param {string} options.saltBase64 - Base64 salt.
 * @param {number} options.iterations - PBKDF2 iteration count (injected).
 * @param {number} [options.length=32] - Derived key length in bytes.
 * @returns {Promise<boolean>} true when the password matches the stored hash.
 * @throws {TypeError|Error} When the password, an option or the base64 material
 *         is invalid.
 */
export async function verifyPassword(password, options = {}) {
  if (typeof password !== 'string') {
    throw new TypeError('El valor "password" debe ser una cadena');
  }

  const resolvedOptions = options ?? {};
  const expected = decodeBase64(resolvedOptions.hashBase64, 'hashBase64');
  const { saltBytes, iterations, length } = resolveDerivationOptions(resolvedOptions);

  const derived = await derivePasswordBytes(password, { saltBytes, iterations, length });
  return constantTimeEqual(derived, expected);
}

/**
 * Checks whether a session record has expired.
 *
 * A record is expired when `now` is greater than or equal to `expiresAt`.
 *
 * @param {{expiresAt: string}} record - Session record built by
 *        `buildSessionRecord`.
 * @param {Date|number|string} [now] - Instant to compare; defaults to now.
 * @returns {boolean} true when the session is expired.
 * @throws {TypeError} When the record or its `expiresAt` field is invalid.
 */
export function isSessionExpired(record, now) {
  if (typeof record !== 'object' || record === null || typeof record.expiresAt !== 'string') {
    throw new TypeError('El registro de sesión no es válido: falta "expiresAt"');
  }

  const expiresAtMs = resolveInstant(record.expiresAt, 'expiresAt');
  return resolveInstant(now, 'now') >= expiresAtMs;
}
