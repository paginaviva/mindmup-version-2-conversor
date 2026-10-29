/**
 * @module html
 * Pages Function that serves the self-contained HTML for a conversion.
 *
 * Catalogue mode requires a session. Anonymous mode enforces the retention
 * period before proxying the request to the visualizer Worker.
 *
 * The standalone page receives a download toolbar that is injected here only,
 * so the HTML packaged by the ZIP endpoint stays free of application chrome.
 */

import { renderHtml } from '../_lib/render-html.js';
import { extractNonce, injectDownloadToolbar } from '../_lib/html-toolbar.js';

/** Matches an explicit connect-src directive in the viewer CSP. */
const CONNECT_SRC_PATTERN = /(?:^|;)\s*connect-src\b/i;

/**
 * Allows the toolbar script to fetch the ZIP from the same origin.
 *
 * The visualizer CSP starts with `default-src 'none'`, which also blocks
 * `connect-src` and would make the `fetch` used to read the missing-resource
 * headers fail. The directive is only added when it is absent and only for
 * pages that receive the toolbar script.
 *
 * @param {Headers} headers - Response headers to adjust.
 * @returns {void}
 */
function allowToolbarFetch(headers) {
  const csp = headers.get('Content-Security-Policy');
  if (!csp || CONNECT_SRC_PATTERN.test(csp)) return;

  headers.set('Content-Security-Policy', `${csp.replace(/;\s*$/, '')}; connect-src 'self'`);
}

/**
 * Handles GET /html/{uuid}.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<Response>} HTML response.
 */
export async function onRequestGet(context) {
  const result = await renderHtml(context);
  if (!result.ok) return result.response;

  // Never inject the toolbar into an error page or a non-successful render.
  if (result.status !== 200) {
    return new Response(result.html, { status: result.status, headers: result.headers });
  }

  const headers = new Headers(result.headers);
  // The injected fragment changes the body, so the upstream length is stale.
  headers.delete('content-length');

  const nonce = extractNonce(headers);
  if (nonce) allowToolbarFetch(headers);

  const html = injectDownloadToolbar(result.html, {
    uuid: context.params?.uuid,
    mode: result.mode,
    nonce,
  });

  return new Response(html, { status: result.status, headers });
}
