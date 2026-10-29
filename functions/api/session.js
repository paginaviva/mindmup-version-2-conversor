/**
 * @module session
 * Pages Function that reports whether the current request holds a valid
 * server-side session.
 *
 * The cookie is never trusted on its own: the handler reloads the session
 * record from CONFIG_KV, rejects malformed or expired records, deletes them and
 * answers `authenticated: false` for every failure. A missing KV binding is
 * treated as "not authenticated" instead of an internal error so the public
 * page can still render anonymous mode.
 *
 * The response is always `Cache-Control: no-store` because the answer depends
 * on a cookie and must not be cached by browsers or intermediaries.
 *
 * @see D11 in `.tmp/sessions/2026-10-23-etapa2-decisiones/decisiones.md`
 */

import { loadConfig } from '../../src/shared/config.js';
import {
  SESSION_COOKIE_NAME,
  isSessionExpired,
  parseCookies,
  sessionKey,
} from '../../src/shared/session.js';

/** Headers shared by every JSON response from this endpoint. */
const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

/**
 * Builds a JSON response with the module headers.
 *
 * @param {number} status - HTTP status code.
 * @param {Object} body - JSON-serializable response body.
 * @returns {Response} HTTP response.
 */
function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * Builds the response for every unauthenticated case.
 *
 * Using a single factory keeps missing cookie, unknown session, malformed
 * record and expired session indistinguishable to the client.
 *
 * @returns {Response} 200 response with `authenticated: false`.
 */
function unauthenticatedResponse() {
  return jsonResponse(200, { authenticated: false });
}

/**
 * Reads the session identifier from the request cookies.
 *
 * @param {Request} request - Incoming HTTP request.
 * @returns {string|null} Non-empty identifier, or null when absent or empty.
 */
function readSessionId(request) {
  const cookieHeader = request?.headers?.get('Cookie');
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null;
  }
  return sessionId;
}

/**
 * Parses a KV session record.
 *
 * A record is malformed when its value is not a string, is not valid JSON, is
 * not a plain object, or lacks a non-empty `user` and a string `expiresAt`.
 * Timestamp validity is checked later by `isSessionExpired`.
 *
 * @param {*} raw - Raw value read from CONFIG_KV.
 * @returns {{user: string, createdAt: string, expiresAt: string}|null}
 *          Parsed record, or null when it is malformed.
 */
function parseSessionRecord(raw) {
  if (typeof raw !== 'string') return null;

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof record !== 'object' || record === null || Array.isArray(record)) {
    return null;
  }
  if (typeof record.user !== 'string' || record.user.length === 0) {
    return null;
  }
  if (typeof record.expiresAt !== 'string') {
    return null;
  }

  return record;
}

/**
 * Checks whether a parsed record has expired.
 *
 * Invalid timestamps make `isSessionExpired` throw; such records are treated as
 * expired so the caller deletes them and answers unauthenticated.
 *
 * @param {{expiresAt: string}} record - Parsed session record.
 * @returns {boolean} true when expired or when the timestamp is invalid.
 */
function hasExpired(record) {
  try {
    return isSessionExpired(record);
  } catch {
    return true;
  }
}

/**
 * Deletes a session record on a best-effort basis.
 *
 * The response is unauthenticated either way, so a KV delete failure must not
 * turn the request into an unhandled 500.
 *
 * @param {Object} kv - CONFIG_KV binding.
 * @param {string} key - Session KV key.
 * @returns {Promise<void>}
 */
async function deleteSessionRecord(kv, key) {
  try {
    await kv.delete(key);
  } catch {
    // Best effort: the client is already treated as unauthenticated.
  }
}

/**
 * Handles `GET /api/session`.
 *
 * Order of checks:
 * 1. Presence of a non-empty session cookie.
 * 2. Presence of a usable CONFIG_KV binding.
 * 3. Session key lookup.
 * 4. Record shape and expiration.
 *
 * @param {Object} context - Pages Function context.
 * @param {Request} context.request - Incoming HTTP request.
 * @param {Object} context.env - Environment bindings.
 * @returns {Promise<Response>} 200 response with the authentication state.
 */
export async function onRequestGet(context) {
  const sessionId = readSessionId(context?.request);
  if (sessionId === null) {
    return unauthenticatedResponse();
  }

  const kv = context?.env?.CONFIG_KV;
  if (!kv || typeof kv.get !== 'function') {
    return unauthenticatedResponse();
  }

  let config;
  try {
    config = await loadConfig(context.env);
  } catch {
    return unauthenticatedResponse();
  }

  const key = sessionKey(sessionId);
  if (config.loginEnabled !== true) {
    if (typeof kv.delete === 'function') {
      await deleteSessionRecord(kv, key);
    }
    return unauthenticatedResponse();
  }

  let raw;
  try {
    raw = await kv.get(key);
  } catch {
    return unauthenticatedResponse();
  }

  if (raw === null || raw === undefined) {
    return unauthenticatedResponse();
  }

  const record = parseSessionRecord(raw);
  if (record === null || hasExpired(record)) {
    if (typeof kv.delete === 'function') {
      await deleteSessionRecord(kv, key);
    }
    return unauthenticatedResponse();
  }

  return jsonResponse(200, { authenticated: true, user: record.user });
}
