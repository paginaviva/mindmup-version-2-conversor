/**
 * @module session-guard
 * Shared authorization helpers for Pages Functions.
 *
 * Catalogue routes require both an enabled catalogue and a valid server-side
 * session. The helpers never trust a client-side flag.
 */

import { loadConfig } from '../../src/shared/config.js';
import {
  SESSION_COOKIE_NAME,
  isSessionExpired,
  parseCookies,
  sessionKey,
} from '../../src/shared/session.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

/**
 * Builds a JSON error response.
 *
 * @param {number} status - HTTP status.
 * @param {string} message - Spanish user-facing message.
 * @returns {Response} JSON response.
 */
function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: JSON_HEADERS,
  });
}

/**
 * Reads and validates the current session.
 *
 * Missing bindings, missing cookies, malformed records and expired records are
 * reported as unauthenticated instead of throwing.
 *
 * @param {Object} context - Pages Functions context.
 * @param {Request} context.request - Incoming request.
 * @param {Object} context.env - Environment bindings.
 * @returns {Promise<{authenticated: false}|{authenticated: true, user: string, sessionId: string}>}
 */
export async function getSession({ request, env }) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return { authenticated: false };

  const store = env?.CONFIG_KV;
  if (!store || typeof store.get !== 'function') return { authenticated: false };

  let raw;
  try {
    raw = await store.get(sessionKey(sessionId));
  } catch {
    return { authenticated: false };
  }
  if (!raw) return { authenticated: false };

  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    return { authenticated: false };
  }

  if (typeof record !== 'object' || record === null || typeof record.user !== 'string') {
    return { authenticated: false };
  }

  try {
    if (isSessionExpired(record, Date.now())) {
      if (typeof store.delete === 'function') {
        await store.delete(sessionKey(sessionId)).catch(() => {});
      }
      return { authenticated: false };
    }
  } catch {
    return { authenticated: false };
  }

  return { authenticated: true, user: record.user, sessionId };
}

/**
 * Requires a valid session.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<{ok: true, session: Object}|{ok: false, response: Response}>}
 */
export async function requireSession(context) {
  const session = await getSession(context);
  if (!session.authenticated) {
    return { ok: false, response: errorResponse(401, 'No autorizado') };
  }
  return { ok: true, session };
}

/**
 * Requires catalogue mode and a valid session.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<{ok: true, session: Object}|{ok: false, response: Response}>}
 */
export async function requireCatalogue(context) {
  let config;
  try {
    config = await loadConfig(context.env);
  } catch {
    return { ok: false, response: errorResponse(500, 'Configuración no disponible') };
  }

  if (config.loginEnabled !== true || config.catalogEnabled !== true) {
    return { ok: false, response: errorResponse(404, 'Catálogo no disponible') };
  }

  return requireSession(context);
}
