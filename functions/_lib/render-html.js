/**
 * @module render-html
 * Shared rendering flow for the self-contained HTML view.
 *
 * Encapsulates identifier validation, configuration loading, catalogue
 * authorization, anonymous retention checks and the visualizer proxy. Callers
 * receive the rendered HTML and headers, or a ready-to-return error response.
 */

import { loadConfig, loadVariables } from '../../src/shared/config.js';
import { isValidIdentifier } from '../../src/shared/identifiers.js';
import { requireSession } from './session-guard.js';

/**
 * Builds a plain-text error response.
 *
 * @param {number} status - HTTP status code.
 * @param {string} message - Spanish user-facing message.
 * @returns {Response} Plain-text response with caching disabled.
 */
function errorResponse(status, message) {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Renders the self-contained HTML for a conversion.
 *
 * Catalogue mode requires a valid session and reads from the published output
 * prefix. Anonymous mode looks up the temporary object and enforces the
 * retention window, deleting expired objects before reporting a missing map.
 *
 * @param {Object} context - Pages Functions context.
 * @param {Object} context.env - Environment bindings.
 * @param {Object} [context.params] - Route parameters.
 * @param {Request} context.request - Incoming request.
 * @returns {Promise<
 *   { ok: true, html: string, mode: 'catalogue' | 'anonymous', headers: Headers, status: number }
 *   | { ok: false, response: Response }
 * >} Rendered HTML payload or an error response. The success payload also
 *     carries the upstream status so callers can reproduce the visualizer
 *     response exactly.
 */
export async function renderHtml(context) {
  const { env, params } = context;
  const uuid = params?.uuid;

  if (!isValidIdentifier(uuid)) return { ok: false, response: errorResponse(400, 'Identificador no válido') };

  let config;
  let variables;
  try {
    config = await loadConfig(env);
    variables = await loadVariables(env);
  } catch {
    return { ok: false, response: errorResponse(500, 'Configuración no disponible') };
  }

  const mode = config.loginEnabled === true ? 'catalogue' : 'anonymous';
  let keyTemplate;

  if (mode === 'catalogue') {
    const authorization = await requireSession(context);
    if (!authorization.ok) return { ok: false, response: authorization.response };
    keyTemplate = `${variables.visualizer.outputPrefix}{uuid}${variables.visualizer.jsonSuffix}`;
  } else {
    keyTemplate = variables.R2_TEMP_OUTPUT_PATH_TEMPLATE;
    const objectKey = keyTemplate.replaceAll('{uuid}', uuid);
    const bucket = env.MMUP_BUCKET;
    if (!bucket || typeof bucket.head !== 'function') {
      return { ok: false, response: errorResponse(500, 'Almacenamiento no disponible') };
    }

    let object;
    try {
      object = await bucket.head(objectKey);
    } catch {
      return { ok: false, response: errorResponse(500, 'Almacenamiento no disponible') };
    }
    if (!object) return { ok: false, response: errorResponse(404, 'Mapa no encontrado') };

    const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : 0;
    const expiresAt = uploaded + config.anonymousRetentionHours * 3600 * 1000;
    if (!uploaded || Date.now() >= expiresAt) {
      if (typeof bucket.delete === 'function') await bucket.delete(objectKey).catch(() => {});
      return { ok: false, response: errorResponse(404, 'Mapa no encontrado') };
    }
  }

  if (!env.VISUALIZER || typeof env.VISUALIZER.fetch !== 'function') {
    return { ok: false, response: errorResponse(500, 'Visualizador no disponible') };
  }

  let response;
  try {
    const visualizerUrl = new URL(`https://visualizer/visor/mmup-output/${uuid}`);
    visualizerUrl.searchParams.set('keyTemplate', keyTemplate);
    response = await env.VISUALIZER.fetch(new Request(visualizerUrl.toString(), {
      headers: { 'X-MMUP-Key-Template': keyTemplate },
    }));
  } catch {
    return { ok: false, response: errorResponse(502, 'No se pudo generar la visualización') };
  }

  const html = await response.text();
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'private, no-store');

  return { ok: true, html, mode, headers, status: response.status };
}
