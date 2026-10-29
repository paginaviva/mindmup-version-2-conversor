/**
 * @module config
 * Pages Function that exposes the public mode flags and limits.
 *
 * Only values needed by the interface are returned. The administrative user,
 * session lifetime, login attempt limits, secrets and internal paths are never
 * exposed.
 */

import { loadConfig } from '../../src/shared/config.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
});

/**
 * Builds the public configuration view.
 *
 * @param {Object} config - Validated application configuration.
 * @returns {Object} Public configuration.
 */
export function buildPublicConfig(config) {
  const loginEnabled = config.loginEnabled === true;

  return {
    mode: loginEnabled ? 'catalogue' : 'anonymous',
    loginEnabled,
    catalogEnabled: loginEnabled && config.catalogEnabled === true,
    maxUploadBytes: config.maxUploadBytes,
    minUploadBytes: config.minUploadBytes,
    anonymousRetentionHours: config.anonymousRetentionHours,
    rateLimit: loginEnabled ? null : config.rateLimit,
    turnstileEnabled: config.turnstileEnabled === true,
    turnstileSiteKey: config.turnstileEnabled === true ? (config.turnstileSiteKey || '') : '',
  };
}

/**
 * Handles GET /api/config.
 *
 * @param {Object} context - Pages Functions context.
 * @param {Object} context.env - Environment bindings.
 * @returns {Promise<Response>} Public configuration or a generic error.
 */
export async function onRequestGet({ env }) {
  try {
    const config = await loadConfig(env);
    return new Response(JSON.stringify(buildPublicConfig(config)), {
      status: 200,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Configuración no disponible' }), {
      status: 500,
      headers: {
        ...JSON_HEADERS,
        'Cache-Control': 'no-store',
      },
    });
  }
}
