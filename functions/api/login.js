/**
 * @module login
 * Pages Function that authenticates the administrative user and creates a
 * server-side session.
 *
 * Operational values (user, session lifetime, rate-limit window and maximum
 * attempts) come from `app-config` in CONFIG_KV. The password hash, salt and
 * iteration count come from Cloudflare secrets, never from KV or the request.
 *
 * Failures are deliberately indistinguishable: a wrong user, a wrong password
 * and a missing secret all return the same 401 message. Any configuration or
 * secret error fails closed.
 *
 * @see D11 and D12 in `.tmp/sessions/2026-10-23-etapa2-decisiones/decisiones.md`
 */

import { loadConfig } from '../../src/shared/config.js';
import {
  buildSessionRecord,
  generateSessionId,
  serializeSessionCookie,
  sessionKey,
  verifyPassword,
} from '../../src/shared/session.js';

/** KV key prefix used to count failed attempts per client IP. */
const LOGIN_ATTEMPT_PREFIX = 'login-attempt:';

/** Bucket used when the platform does not provide a client IP. */
const UNKNOWN_IP = 'unknown';

/** Message returned for malformed request bodies. */
const MALFORMED_REQUEST_MESSAGE = 'Solicitud no válida';

/** Message returned when configuration or secrets cannot be used. */
const CONFIGURATION_MESSAGE = 'Configuración no disponible';

/** Message returned when login is disabled and the endpoint does not exist. */
const LOGIN_DISABLED_MESSAGE = 'El acceso no está disponible';

/** Message returned when the per-IP attempt limit has been reached. */
const RATE_LIMIT_MESSAGE = 'Demasiados intentos. Inténtalo de nuevo más tarde.';

/** Generic message shared by every authentication failure. */
const INVALID_CREDENTIALS_MESSAGE = 'Usuario o contraseña incorrectos.';

/** Headers shared by every JSON response. */
const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

/**
 * Builds a JSON response with the module headers.
 *
 * @param {number} status - HTTP status code.
 * @param {Object} body - JSON-serializable response body.
 * @param {Object} [extraHeaders={}] - Additional response headers.
 * @returns {Response} HTTP response.
 */
function jsonResponse(status, body, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * Builds a JSON error response.
 *
 * @param {number} status - HTTP status code.
 * @param {string} message - User-facing Spanish message.
 * @param {Object} [extraHeaders={}] - Additional response headers.
 * @returns {Response} HTTP response.
 */
function errorResponse(status, message, extraHeaders = {}) {
  return jsonResponse(status, { error: message }, extraHeaders);
}

/**
 * Parses and validates the request body.
 *
 * A malformed JSON document, a non-object payload and missing or non-string
 * `user` / `password` fields are rejected. Empty strings are accepted here and
 * handled by the authentication check, so the response stays generic.
 *
 * @param {Request} request - Incoming HTTP request.
 * @returns {Promise<{user: string, password: string}|null>} Credentials or null.
 */
async function readCredentials(request) {
  let payload;
  try {
    payload = await request.json();
  } catch {
    return null;
  }

  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return null;
  }

  const { user, password } = payload;
  if (typeof user !== 'string' || typeof password !== 'string') {
    return null;
  }

  return { user, password };
}

/**
 * Reads and validates the operational values used by the endpoint.
 *
 * @param {Object} config - Validated application configuration.
 * @returns {{user: string, maxAttempts: number, windowSeconds: number, sessionTtlSeconds: number}|null}
 *          Normalized values, or null when a value cannot be used.
 */
function resolveOperationalValues(config) {
  if (typeof config.loginUser !== 'string' || config.loginUser.length === 0) {
    return null;
  }

  const maxAttempts = config.loginMaxAttempts;
  const windowSeconds = config.loginWindowSeconds;
  const sessionTtlSeconds = Math.floor(config.sessionTtlMinutes * 60);

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) return null;
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) return null;
  if (!Number.isInteger(sessionTtlSeconds) || sessionTtlSeconds < 1) return null;

  return {
    user: config.loginUser,
    maxAttempts,
    windowSeconds,
    sessionTtlSeconds,
  };
}

/**
 * Reads the password verification secrets from the environment.
 *
 * @param {Object} env - Pages Function environment bindings.
 * @returns {{hashBase64: string, saltBase64: string, iterations: number}|null}
 *          Verification options, or null when a secret is missing or invalid.
 */
function readPasswordSecrets(env) {
  const hashBase64 = env?.ADMIN_PASSWORD_HASH;
  const saltBase64 = env?.ADMIN_PASSWORD_SALT;
  const iterations = Number(env?.ADMIN_PASSWORD_ITERATIONS);

  if (typeof hashBase64 !== 'string' || hashBase64.length === 0) return null;
  if (typeof saltBase64 !== 'string' || saltBase64.length === 0) return null;
  if (!Number.isInteger(iterations) || iterations < 1) return null;

  return { hashBase64, saltBase64, iterations };
}

/**
 * Checks the submitted credentials against the configured user and secrets.
 *
 * Missing or malformed secrets fail closed. Verification errors (for example,
 * malformed base64) are treated as a mismatch, never as a successful login.
 *
 * @param {{user: string, password: string}} credentials - Submitted credentials.
 * @param {Object} config - Validated application configuration.
 * @param {Object} env - Pages Function environment bindings.
 * @returns {Promise<boolean>} true only when both user and password match.
 */
async function credentialsMatch(credentials, config, env) {
  if (credentials.user !== config.loginUser) return false;

  const secrets = readPasswordSecrets(env);
  if (secrets === null) return false;

  try {
    return await verifyPassword(credentials.password, secrets);
  } catch {
    return false;
  }
}

/**
 * Reads the client IP used for the rate-limit bucket.
 *
 * @param {Request} request - Incoming HTTP request.
 * @returns {string} Client IP or the safe fallback bucket.
 */
function readClientIp(request) {
  const headerValue = request?.headers?.get('CF-Connecting-IP');
  if (typeof headerValue !== 'string' || headerValue.trim().length === 0) {
    return UNKNOWN_IP;
  }
  return headerValue.trim();
}

/**
 * Reads the current failed-attempt count stored in KV.
 *
 * @param {Object} kv - CONFIG_KV binding.
 * @param {string} key - Rate-limit key.
 * @returns {Promise<number>} Non-negative attempt count.
 */
async function readAttemptCount(kv, key) {
  const raw = await kv.get(key);
  const count = Number(raw);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

/**
 * Stores the incremented failed-attempt count with the configured window TTL.
 *
 * @param {Object} kv - CONFIG_KV binding.
 * @param {string} key - Rate-limit key.
 * @param {number} attempts - Attempt count before this failure.
 * @param {number} windowSeconds - KV expiration TTL in seconds.
 * @returns {Promise<void>}
 */
async function recordFailedAttempt(kv, key, attempts, windowSeconds) {
  await kv.put(key, String(attempts + 1), { expirationTtl: windowSeconds });
}

/**
 * Creates the session record, stores it in KV and builds the login response.
 *
 * @param {Object} env - Pages Function environment bindings.
 * @param {string} user - Authenticated user name.
 * @param {number} ttlSeconds - Session lifetime and KV expiration TTL.
 * @returns {Promise<Response>} 200 response with the session cookie.
 */
async function createSessionResponse(env, user, ttlSeconds) {
  const sessionId = generateSessionId();
  const record = buildSessionRecord({ user, ttlSeconds });

  await env.CONFIG_KV.put(sessionKey(sessionId), JSON.stringify(record), {
    expirationTtl: ttlSeconds,
  });

  return jsonResponse(
    200,
    { authenticated: true, user },
    { 'Set-Cookie': serializeSessionCookie(sessionId, ttlSeconds) },
  );
}

/**
 * Handles `POST /api/login`.
 *
 * Order of checks:
 * 1. Body shape (400).
 * 2. Configuration load and login switch (500 / 404).
 * 3. Per-IP attempt window (429).
 * 4. User and password verification (401, generic).
 * 5. Session creation and cookie (200).
 *
 * @param {Object} context - Pages Function context.
 * @param {Request} context.request - Incoming HTTP request.
 * @param {Object} context.env - Environment bindings and secrets.
 * @returns {Promise<Response>} HTTP response.
 */
export async function onRequestPost(context) {
  const credentials = await readCredentials(context?.request);
  if (credentials === null) {
    return errorResponse(400, MALFORMED_REQUEST_MESSAGE);
  }

  const env = context?.env;
  let config;
  try {
    config = await loadConfig(env);
  } catch {
    return errorResponse(500, CONFIGURATION_MESSAGE);
  }

  if (!config.loginEnabled) {
    return errorResponse(404, LOGIN_DISABLED_MESSAGE);
  }

  const values = resolveOperationalValues(config);
  if (values === null) {
    return errorResponse(500, CONFIGURATION_MESSAGE);
  }

  const kv = env.CONFIG_KV;
  const attemptKey = `${LOGIN_ATTEMPT_PREFIX}${readClientIp(context.request)}`;
  const attempts = await readAttemptCount(kv, attemptKey);

  if (attempts >= values.maxAttempts) {
    return errorResponse(429, RATE_LIMIT_MESSAGE, {
      'Retry-After': String(values.windowSeconds),
    });
  }

  if (!(await credentialsMatch(credentials, config, env))) {
    await recordFailedAttempt(kv, attemptKey, attempts, values.windowSeconds);
    return errorResponse(401, INVALID_CREDENTIALS_MESSAGE);
  }

  await kv.delete(attemptKey);
  return createSessionResponse(env, values.user, values.sessionTtlSeconds);
}
