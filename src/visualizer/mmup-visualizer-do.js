/**
 * @module mmup-visualizer-do
 * Durable Object for MMUP JSON visualization.
 *
 * Responsibilities:
 * 1. MupVisualizer class implementing the Cloudflare Durable Object interface.
 * 2. Constructor receives state and env (Worker bindings).
 * 3. fetch(request) handles internal Durable Object requests.
 * 4. Internal route: /convert/{uuid} -> runs the six layers and returns HTML.
 * 5. Runs the six layers sequentially:
 *    - Layer 1: fetchJSON(uuid, env, keyTemplate) - loads the JSON from R2.
 *    - Layer 2: buildTree(json.nodes) - builds the hierarchical tree.
 *    - Layer 3: attachData(tree, notes, externalRefs, links, stickers, icons)
 *      - attaches data to every node.
 *    - Layer 4: applyStyles(tree, attributes) - applies visual styles.
 *    - Layer 5: renderTree(tree, metadata) - renders the tree HTML.
 *    - Layer 6: assembleHTML(treeHTML, metadata, links, stickers, icons,
 *      attachments, { nonce }) - assembles the complete HTML (with attachments
 *      for the internal modal and the CSP nonce received from the Worker in the
 *      internal header).
 * 6. Error handling with specific codes (NOT_FOUND, INVALID_JSON,
 *    INVALID_STRUCTURE) and a generic 500: details only go to the logs.
 * 7. Structured JSON logs for every layer (including timing).
 * 8. Returns a Response with the generated HTML or the appropriate error.
 *
 * The operational storage key template and the CSP nonce are injected by the
 * Worker through internal headers. This module does not hardcode them.
 *
 * The Durable Object provides 30 seconds of CPU (versus the normal Worker
 * limit), which is enough for large maps.
 */

import { fetchJSON } from './layers/layer1-fetch.js';
import { buildTree } from './layers/layer2-tree-builder.js';
import { attachData } from './layers/layer3-attacher.js';
import { applyStyles } from './layers/layer4-styler.js';
import { renderTree } from './layers/layer5-renderer.js';
import { assembleHTML } from './layers/layer6-assembler.js';
import { isValidIdentifier } from './utils/identifiers.js';

// ---------------------------------------------------------------------------
// Internal headers
// ---------------------------------------------------------------------------

/**
 * Internal header that carries the CSP nonce from the Worker.
 *
 * @type {string}
 */
export const NONCE_HEADER = 'X-MMUP-Nonce';

/**
 * Internal header that carries the injected R2 key template from the Worker.
 *
 * @type {string}
 */
export const KEY_TEMPLATE_HEADER = 'X-MMUP-Key-Template';

// ---------------------------------------------------------------------------
// CSP nonce - internal header validation
// ---------------------------------------------------------------------------

/**
 * Accepted CSP nonce pattern (standard or URL-safe base64, 8-64 characters).
 * The Worker generates it with crypto.getRandomValues(); the Durable Object
 * validates it again as defense in depth before inserting it into the HTML.
 *
 * @private
 * @type {RegExp}
 */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]{8,64}$/;

/**
 * Normalizes and validates the nonce received from the Worker.
 *
 * Exported so it can be unit tested.
 *
 * @param {*} value - Value of the internal nonce header.
 * @returns {string} Valid nonce, or an empty string when it is missing or does
 *   not match the pattern.
 */
export function normalizeNonce(value) {
  return (typeof value === 'string' && NONCE_PATTERN.test(value)) ? value : '';
}

// ---------------------------------------------------------------------------
// Durable Object: MupVisualizer
// ---------------------------------------------------------------------------

/**
 * Durable Object for MMUP JSON visualization.
 *
 * Provides 30 seconds of CPU for large-map processing. It receives internal
 * requests from the HTTP Worker and runs the six processing layers to generate
 * self-contained HTML.
 */
export class MupVisualizer {
  /**
   * Durable Object constructor.
   *
   * @param {Object} state - Persistent Durable Object state (Cloudflare).
   * @param {Object} env - Worker bindings (R2 bucket, injected configuration).
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Handles internal Durable Object requests.
   *
   * Supported route:
   * - /convert/{uuid} -> runs the six layers and returns HTML (400 when the
   *   identifier does not satisfy the allow list).
   *
   * Any other route returns 404.
   *
   * @param {Request} request - Internal request from the HTTP Worker.
   * @returns {Promise<Response>} Response with the generated HTML or an error.
   */
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Internal route: /convert/{uuid}.
    if (path.startsWith('/convert/')) {
      const uuid = path.slice('/convert/'.length);
      // Defense in depth: the Worker already validates the identifier, but the
      // Durable Object must not assume its only caller is the Worker.
      if (!isValidIdentifier(uuid)) {
        return new Response('Identificador inválido', { status: 400 });
      }
      // CSP nonce for this request (internal header); when it is missing or
      // invalid, the HTML is generated without a nonce (backward compatible).
      const nonce = normalizeNonce(request.headers.get(NONCE_HEADER));
      // Storage key template injected by the Worker (never hardcoded here).
      const keyTemplate = url.searchParams.get('keyTemplate')
        || request.headers.get(KEY_TEMPLATE_HEADER)
        || '';
      return await this.convert(uuid, nonce, keyTemplate);
    }

    return new Response('Not found', { status: 404 });
  }

  /**
   * Runs the six processing layers to generate HTML from an identifier.
   *
   * Sequential pipeline:
   * 1. Layer 1 (fetch): loads the JSON from R2.
   * 2. Layer 2 (tree-builder): builds the hierarchical tree.
   * 3. Layer 3 (attacher): attaches notes, refs, links, stickers and icons.
   * 4. Layer 4 (styler): applies visual styles.
   * 5. Layer 5 (renderer): renders the tree HTML.
   * 6. Layer 6 (assembler): assembles the complete HTML.
   *
   * Every layer emits a structured JSON log including timing. Errors propagate
   * with specific codes:
   * - NOT_FOUND -> 404
   * - INVALID_JSON -> 400
   * - INVALID_STRUCTURE -> 400
   * - Anything else -> 500
   *
   * @param {string} uuid - Unique identifier of the JSON in R2.
   * @param {string} [nonce=''] - CSP nonce of the request (empty when not
   *   applicable).
   * @param {string} [keyTemplate=''] - Injected R2 key template with the
   *   `{uuid}` placeholder.
   * @returns {Promise<Response>} Response with HTML (200) or an error
   *   (404/400/500).
   */
  async convert(uuid, nonce = '', keyTemplate = '') {
    console.log(JSON.stringify({ level: 'info', action: 'convert_start', uuid }));
    const startTime = Date.now();

    try {
      // Layer 1: load JSON from R2.
      console.log(JSON.stringify({ level: 'info', action: 'layer1_start', uuid }));
      const t1 = Date.now();
      const json = await fetchJSON(uuid, this.env, keyTemplate);
      console.log(JSON.stringify({ level: 'info', action: 'layer1_complete', uuid, duration_ms: Date.now() - t1 }));

      // Layer 2: tree builder.
      console.log(JSON.stringify({ level: 'info', action: 'layer2_start', uuid }));
      const t2 = Date.now();
      const tree = buildTree(json.nodes);
      console.log(JSON.stringify({ level: 'info', action: 'layer2_complete', uuid, duration_ms: Date.now() - t2 }));

      // Layer 3: attacher (notes, refs, links, stickers and icons).
      console.log(JSON.stringify({ level: 'info', action: 'layer3_start', uuid }));
      const t3 = Date.now();
      attachData(tree, json.notes, json.externalRefs, json.links, json.stickers, json.icons);
      console.log(JSON.stringify({ level: 'info', action: 'layer3_complete', uuid, duration_ms: Date.now() - t3 }));

      // Layer 4: styler.
      console.log(JSON.stringify({ level: 'info', action: 'layer4_start', uuid }));
      const t4 = Date.now();
      applyStyles(tree, json.attributes);
      console.log(JSON.stringify({ level: 'info', action: 'layer4_complete', uuid, duration_ms: Date.now() - t4 }));

      // Layer 5: renderer.
      console.log(JSON.stringify({ level: 'info', action: 'layer5_start', uuid }));
      const t5 = Date.now();
      const treeHTML = renderTree(tree, json.metadata);
      console.log(JSON.stringify({ level: 'info', action: 'layer5_complete', uuid, duration_ms: Date.now() - t5 }));

      // Layer 6: assembler (transmits links, stickers, icons and attachments
      // inside MMUP_DATA).
      console.log(JSON.stringify({ level: 'info', action: 'layer6_start', uuid }));
      const t6 = Date.now();
      const attachments = extractAttachments(json);
      const html = assembleHTML(treeHTML, json.metadata, json.links, json.stickers, json.icons, attachments, { nonce });
      console.log(JSON.stringify({ level: 'info', action: 'layer6_complete', uuid, duration_ms: Date.now() - t6, attachments: attachments.length }));

      const totalDuration = Date.now() - startTime;
      console.log(JSON.stringify({ level: 'info', action: 'convert_complete', uuid, total_duration_ms: totalDuration }));

      return new Response(html, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });

    } catch (error) {
      console.error(JSON.stringify({
        level: 'error',
        action: 'convert_error',
        uuid,
        error: error.message,
        code: error.code
      }));

      // Propagate errors with specific codes.
      if (error.code === 'NOT_FOUND') {
        return new Response(error.message, { status: 404 });
      }
      if (error.code === 'INVALID_JSON' || error.code === 'INVALID_STRUCTURE') {
        return new Response(error.message, { status: 400 });
      }

      // The user receives a generic message: the detail is already logged.
      return new Response('Error interno del servidor', { status: 500 });
    }
  }
}

// ---------------------------------------------------------------------------
// Attachment extraction for the internal modal
// ---------------------------------------------------------------------------

/**
 * Extracts the attachments from the MMUP JSON document for the modal.
 *
 * Walks the attributes collection and selects ONLY those with an attachment in
 * raw_attributes.attachment (an object with name, contentType and content).
 * Returns a lightweight array with node_id, name, contentType and content,
 * without exposing the rest of the raw attributes in the HTML.
 *
 * @param {Object} json - MMUP JSON document (must have attributes[]).
 * @returns {Array<Object>} Attachments: [{ node_id, name, contentType, content }].
 */
function extractAttachments(json) {
  const attributes = Array.isArray(json.attributes) ? json.attributes : [];

  return attributes
    .filter((attr) => (
      attr &&
      attr.raw_attributes &&
      typeof attr.raw_attributes.attachment === 'object' &&
      attr.raw_attributes.attachment !== null
    ))
    .map((attr) => {
      const raw = attr.raw_attributes.attachment;
      return {
        node_id: attr.node_id,
        name: raw.name,
        contentType: raw.contentType,
        content: raw.content,
      };
    });
}
