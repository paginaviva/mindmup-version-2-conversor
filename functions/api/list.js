/**
 * @module list
 * Pages Function that lists the catalogue.
 *
 * Requires catalogue mode and a valid server-side session. The catalogue is
 * never available in anonymous mode.
 */

import { loadVariables } from '../../src/shared/config.js';
import { requireCatalogue } from '../_lib/session-guard.js';
import { CONVERTER_VERSION } from '../../src/shared/version.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
});

/**
 * Builds the item returned to the interface.
 *
 * @param {string} key - R2 object key.
 * @param {Object} object - R2 object entry.
 * @param {Object} data - Parsed JSON-CMJN document.
 * @param {{prefix: string, suffix: string}} paths - Object key parts.
 * @returns {Object} Catalogue item.
 */
export function buildItem(key, object, data, paths) {
  const uuid = key.slice(paths.prefix.length, key.length - paths.suffix.length);
  const metadata = data.metadata || {};
  const custom = object.customMetadata || {};

  return {
    uuid,
    title: metadata.title || 'Sin título',
    source_file: metadata.source_file || '',
    converted_at: metadata.converted_at || '',
    node_count: Number(metadata.node_count) || 0,
    group: custom.group || 'Sin grupo',
    group_path: custom.group_path || '',
    version: custom.version || CONVERTER_VERSION,
  };
}

/**
 * Handles GET /api/list.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<Response>} Catalogue list.
 */
export async function onRequestGet(context) {
  const authorization = await requireCatalogue(context);
  if (!authorization.ok) return authorization.response;

  let variables;
  try {
    variables = await loadVariables(context.env);
  } catch {
    return new Response(JSON.stringify({ error: 'Configuración no disponible' }), {
      status: 500,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }

  const bucket = context.env?.MMUP_BUCKET;
  if (!bucket || typeof bucket.list !== 'function') {
    return new Response(JSON.stringify({ error: 'Almacenamiento no disponible' }), {
      status: 500,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }

  const { outputPrefix, jsonSuffix, listCacheSeconds } = variables.visualizer;
  const items = [];
  let cursor;
  let truncated = true;

  try {
    while (truncated) {
      const options = { prefix: outputPrefix, limit: 1000, include: ['customMetadata'] };
      if (cursor) options.cursor = cursor;
      const page = await bucket.list(options);

      for (const object of page.objects) {
        try {
          const stored = await bucket.get(object.key);
          if (!stored) continue;
          const data = JSON.parse(await stored.text());
          items.push(buildItem(object.key, object, data, { prefix: outputPrefix, suffix: jsonSuffix }));
        } catch {
          // Skip a broken object; the rest of the catalogue remains available.
        }
      }

      truncated = page.truncated === true;
      cursor = page.cursor;
    }
  } catch {
    return new Response(JSON.stringify({ error: 'No se pudo leer el catálogo' }), {
      status: 500,
      headers: { ...JSON_HEADERS, 'Cache-Control': 'no-store' },
    });
  }

  items.sort((left, right) => Date.parse(right.converted_at) - Date.parse(left.converted_at));

  return new Response(JSON.stringify({ success: true, count: items.length, items }), {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'Cache-Control': `private, max-age=${listCacheSeconds}`,
    },
  });
}
