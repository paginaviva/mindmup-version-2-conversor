/**
 * @module auth
 * Internal authentication middleware for the converter Worker.
 *
 * The Worker is not exposed publicly. Pages Functions call it through a
 * service binding and authenticate with the `INTERNAL_SHARED_SECRET` secret.
 * This module does not read KV, so an unauthenticated request is rejected
 * before any configuration or storage access.
 */

/**
 * Compares two strings without early exit.
 *
 * @param {string} left - First string.
 * @param {string} right - Second string.
 * @returns {boolean} true when both strings are identical.
 */
function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;

  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
}

/**
 * Authenticates a request against the internal shared secret.
 *
 * Expects `Authorization: Bearer <secret>`. The secret is read from
 * `env.INTERNAL_SHARED_SECRET`. If the secret is missing, every request is
 * rejected (fail secure).
 *
 * @param {Request} request - Incoming HTTP request.
 * @param {Object} env - Worker environment bindings.
 * @param {Object} [options] - Test-only overrides.
 * @param {string} [options.headerName='Authorization'] - Authorization header name.
 * @param {string} [options.scheme='Bearer'] - Authentication scheme.
 * @param {number} [options.unauthorizedStatus=401] - Rejection status code.
 * @returns {null|Response} null when authenticated, a JSON 401 response otherwise.
 */
export function authenticateRequest(request, env, options = {}) {
  const headerName = options.headerName || 'Authorization';
  const scheme = options.scheme || 'Bearer';
  const unauthorizedStatus = options.unauthorizedStatus || 401;
  const prefix = `${scheme} `;

  const authorization = request.headers.get(headerName);
  if (!authorization || !authorization.startsWith(prefix)) {
    return Response.json({ error: 'No autorizado' }, { status: unauthorizedStatus });
  }

  const token = authorization.slice(prefix.length);
  if (!token) {
    return Response.json({ error: 'No autorizado' }, { status: unauthorizedStatus });
  }

  const expectedSecret = env?.INTERNAL_SHARED_SECRET;
  if (!expectedSecret) {
    return Response.json({ error: 'No autorizado' }, { status: unauthorizedStatus });
  }

  if (!constantTimeEqual(token, expectedSecret)) {
    return Response.json({ error: 'No autorizado' }, { status: unauthorizedStatus });
  }

  return null;
}
