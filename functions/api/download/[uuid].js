/**
 * @module download
 * Pages Function that downloads the JSON result in catalogue mode.
 *
 * Anonymous mode never exposes the JSON file.
 */

import { loadConfig, loadVariables } from '../../../src/shared/config.js';
import { isValidIdentifier } from '../../../src/shared/identifiers.js';
import { normalizeOutputName } from '../../../src/shared/output-name.js';
import { requireSession } from '../../_lib/session-guard.js';

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Handles GET /api/download/{uuid}.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<Response>} JSON file or an error.
 */
export async function onRequestGet(context) {
  const { env, params } = context;
  const uuid = params?.uuid;

  if (!isValidIdentifier(uuid)) return errorResponse(400, 'Identificador inválido');

  let config;
  let variables;
  try {
    config = await loadConfig(env);
    variables = await loadVariables(env);
  } catch {
    return errorResponse(500, 'Configuración no disponible');
  }

  if (config.loginEnabled !== true) {
    return errorResponse(404, 'Resultado no encontrado');
  }

  const authorization = await requireSession(context);
  if (!authorization.ok) return authorization.response;

  const bucket = env.MMUP_BUCKET;
  if (!bucket || typeof bucket.get !== 'function') {
    return errorResponse(500, 'Almacenamiento no disponible');
  }

  const key = `${variables.visualizer.outputPrefix}${uuid}${variables.visualizer.jsonSuffix}`;
  let object;
  try {
    object = await bucket.get(key);
  } catch {
    return errorResponse(500, 'Almacenamiento no disponible');
  }
  if (!object) return errorResponse(404, 'Resultado no encontrado');

  const text = await object.text();
  let filename = uuid;
  try {
    const data = JSON.parse(text);
    const source = data?.metadata?.source_file;
    if (typeof source === 'string' && source.length > 0) {
      filename = normalizeOutputName(source.replace(/\.mup$/i, ''));
    }
  } catch {
    // Keep the UUID fallback when the stored document cannot be parsed.
  }

  return new Response(text, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.json"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
