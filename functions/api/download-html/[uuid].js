/**
 * @module download-html
 * Pages Function that downloads a rendered map as a self-contained ZIP bundle.
 *
 * The bundle contains the rendered HTML, every reachable render asset rewritten
 * to a relative path and, when some resources could not be fetched, a
 * "faltantes.txt" report. Missing resources are also summarized in response
 * headers so the browser can warn the user without opening the ZIP.
 */

import { buildHtmlBundle } from '../../../src/shared/html-bundle.js';
import { renderHtml } from '../../_lib/render-html.js';

/** Maximum number of missing URLs exposed to the client. */
const MISSING_SAMPLE_LIMIT = 5;

/** Maximum length of the missing sample header value. */
const MISSING_SAMPLE_MAX_LENGTH = 500;

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
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

/**
 * Converts a value into a safe ASCII file name.
 *
 * Accents are removed, unsupported characters are replaced with hyphens and
 * leading/trailing dots or hyphens are trimmed. The UUID fallback keeps the
 * download usable even when the bundle base name is empty.
 *
 * @param {string} value - Candidate base name.
 * @param {string} [fallback='mapa'] - Value used when nothing remains.
 * @returns {string} ASCII-safe base name without an extension.
 */
function asciiBaseName(value, fallback = 'mapa') {
  const normalized = String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '');

  return normalized.length > 0 ? normalized : fallback;
}

/**
 * Percent-encodes a URL for use inside a response header.
 *
 * Lone surrogate code units make encodeURIComponent throw, so they are removed
 * before the final attempt. URLs come from HTML and must never break the
 * response headers.
 *
 * @param {string} value - Raw URL.
 * @returns {string} ASCII-only encoded value.
 */
function encodeSampleUrl(value) {
  try {
    return encodeURIComponent(value);
  } catch {
    return encodeURIComponent(value.replace(/[\uD800-\uDFFF]/g, ''));
  }
}

/**
 * Builds the X-MMUP-Missing-Sample header value.
 *
 * Each URL is percent-encoded and separated by "%0A" (the encoded newline)
 * because HTTP header values cannot contain literal CR/LF characters. The
 * result is capped at MISSING_SAMPLE_MAX_LENGTH characters without leaving a
 * dangling escape sequence or separator.
 *
 * @param {Array<{ url: string, reason: string }>} missing - Missing resources.
 * @returns {string} Encoded sample of up to five URLs.
 */
function buildMissingSample(missing) {
  const encoded = missing
    .slice(0, MISSING_SAMPLE_LIMIT)
    .map((item) => encodeSampleUrl(String(item?.url ?? '')));

  let sample = encoded.join('%0A');
  if (sample.length > MISSING_SAMPLE_MAX_LENGTH) {
    sample = sample.slice(0, MISSING_SAMPLE_MAX_LENGTH);
    if (sample.endsWith('%0A')) sample = sample.slice(0, -3);

    // Avoid keeping a partial percent-escape at the very end.
    const lastPercent = sample.lastIndexOf('%');
    if (lastPercent !== -1 && sample.length - lastPercent < 3) {
      sample = sample.slice(0, lastPercent);
    }
  }

  return sample;
}

/**
 * Handles GET /api/download-html/{uuid}.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<Response>} ZIP bundle or an error response.
 */
export async function onRequestGet(context) {
  const result = await renderHtml(context);
  if (!result.ok) return result.response;

  // Preserve the visualizer response as-is when it is not a successful render.
  if (result.status !== 200) {
    return new Response(result.html, {
      status: result.status,
      headers: result.headers,
    });
  }

  const uuid = context.params?.uuid;
  const baseName = asciiBaseName(uuid, 'mapa');

  let bundle;
  try {
    bundle = await buildHtmlBundle(result.html, { baseName: uuid });
  } catch (error) {
    if (error instanceof RangeError) {
      return errorResponse(
        413,
        'El HTML es demasiado grande para empaquetar (máximo 30 MB)'
      );
    }
    return errorResponse(500, 'No se pudo empaquetar el HTML');
  }

  const downloadName = asciiBaseName(bundle.baseName, baseName);
  const missing = Array.isArray(bundle.missing) ? bundle.missing : [];

  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${downloadName}.zip"`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'X-MMUP-Missing-Count': String(missing.length),
    'X-MMUP-Missing-Sample': buildMissingSample(missing),
  });

  return new Response(bundle.zip, { status: 200, headers });
}
