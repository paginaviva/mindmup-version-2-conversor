/**
 * @module logout
 * Pages Function that closes the current server-side session.
 *
 * The handler deletes the KV record when a cookie and binding are available and
 * always clears the browser cookie, even if the record is already gone. Missing
 * bindings and KV failures never turn logout into an internal error: the client
 * must be able to leave the authenticated state under any circumstances.
 *
 * @see D11 in `.tmp/sessions/2026-10-23-etapa2-decisiones/decisiones.md`
 */

import {
  SESSION_COOKIE_NAME,
  parseCookies,
  serializeClearSessionCookie,
  sessionKey,
} from '../../src/shared/session.js';

/** Headers shared by the logout response. */
const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

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
 * Deletes the session record on a best-effort basis.
 *
 * Cookie clearing is the observable contract of logout; a KV failure must not
 * prevent it.
 *
 * @param {Object} kv - CONFIG_KV binding.
 * @param {string} key - Session KV key.
 * @returns {Promise<void>}
 */
async function deleteSessionRecord(kv, key) {
  try {
    await kv.delete(key);
  } catch {
    // Best effort: the cookie is cleared regardless.
  }
}

/**
 * Handles `POST /api/logout`.
 *
 * @param {Object} context - Pages Function context.
 * @param {Request} context.request - Incoming HTTP request.
 * @param {Object} context.env - Environment bindings.
 * @returns {Promise<Response>} 200 response that clears the session cookie.
 */
export async function onRequestPost(context) {
  const sessionId = readSessionId(context?.request);

  if (sessionId !== null) {
    const kv = context?.env?.CONFIG_KV;
    if (kv && typeof kv.delete === 'function') {
      await deleteSessionRecord(kv, sessionKey(sessionId));
    }
  }

  return new Response(JSON.stringify({ authenticated: false }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'Set-Cookie': serializeClearSessionCookie(),
    },
  });
}
