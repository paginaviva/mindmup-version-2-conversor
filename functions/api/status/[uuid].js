/**
 * @module status
 * Pages Function that proxies the conversion status from the internal Worker.
 */

import { loadConfig } from '../../../src/shared/config.js';
import { isValidIdentifier } from '../../../src/shared/identifiers.js';
import { requireSession } from '../../_lib/session-guard.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Handles GET /api/status/{uuid}.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<Response>} Status response.
 */
export async function onRequestGet(context) {
  const { request, env, params } = context;
  const uuid = params?.uuid;

  if (!isValidIdentifier(uuid)) return json(400, { error: 'Identificador inválido' });

  let config;
  try {
    config = await loadConfig(env);
  } catch {
    return json(500, { error: 'Configuración no disponible' });
  }

  const mode = config.loginEnabled === true ? 'catalogue' : 'anonymous';
  if (mode === 'catalogue') {
    const authorization = await requireSession(context);
    if (!authorization.ok) return authorization.response;
  }

  if (!env.CONVERTER || typeof env.CONVERTER.fetch !== 'function' || !env.INTERNAL_SHARED_SECRET) {
    return json(500, { error: 'Servicio de conversión no disponible' });
  }

  let response;
  try {
    response = await env.CONVERTER.fetch(new Request(`https://converter/status/${uuid}`, {
      headers: { Authorization: `Bearer ${env.INTERNAL_SHARED_SECRET}` },
    }));
  } catch {
    return json(502, { error: 'No se pudo consultar el estado' });
  }

  if (!response.ok) return json(502, { error: 'No se pudo consultar el estado' });

  const body = await response.json();
  return json(200, { uuid, status: body.status, mode });
}
