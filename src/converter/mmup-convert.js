/**
 * @module mmup-convert
 * MupConverter Durable Object. Runs the eight conversion layers sequentially.
 *
 * Binding: MMUP_CONVERT_DO -> class MupConverter
 *
 * Routes:
 * - POST /convertir: { uuid, filename, origin } starts convert() in waitUntil.
 * - GET /status: returns the current conversion status from DO storage.
 */

import { loadConfig, loadVariables } from '../shared/config.js';
import { parseMup } from './layers/layer1-parse.js';
import { flattenNodes } from './layers/layer2-flatten.js';
import { extractNotes } from './layers/layer3-notes.js';
import { extractAttributes } from './layers/layer4-attributes.js';
import { extractStickers } from './layers/layer5-stickers.js';
import { extractUrls } from './layers/layer6-urls.js';
import { assembleResult } from './layers/layer7-assemble.js';
import { storeResult } from './layers/layer8-store.js';
import { URL_CLASSIFIER } from './url-classifier.js';
import { resolvePathTemplates } from '../shared/paths.js';

/**
 * Checks that a value is a canonical HTTP(S) origin without a path.
 *
 * @param {*} value - Value to validate.
 * @returns {boolean} true for a valid http(s) origin.
 */
function isValidHttpOrigin(value) {
  if (typeof value !== 'string' || value === '') return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

/**
 * Builds the JSON download URL for a conversion.
 *
 * A configured WORKER_URL always wins over the request origin, so a hostile
 * Host header cannot poison the stored download link.
 *
 * @param {string} [origin] - Request origin.
 * @param {string} uuid - Conversion UUID.
 * @param {Object} [variables] - Behaviour variables.
 * @returns {string|null} Absolute download URL or null when no origin exists.
 */
export function buildDownloadUrl(origin, uuid, variables = {}) {
  const downloadPath = `${variables.API_PATH_DOWNLOAD || '/download'}/${uuid}`;

  if (isValidHttpOrigin(variables.WORKER_URL)) {
    return `${variables.WORKER_URL}${downloadPath}`;
  }

  if (isValidHttpOrigin(origin)) {
    return `${origin}${downloadPath}`;
  }

  return null;
}

/**
 * Extracts the layer options from the behaviour variables.
 *
 * @param {Object} [variables] - Behaviour variables.
 * @returns {{ideasKey: (string|undefined), stickerCategory: (string|undefined), defaultRefType: (string|undefined), urlRegexPattern: (string|undefined)}}
 */
export function layerOptionsFromVariables(variables = {}) {
  return {
    ideasKey: variables.MUP_KEY_IDEAS,
    stickerCategory: variables.DEFAULT_STICKER_CATEGORY,
    defaultRefType: variables.DEFAULT_REF_TYPE,
    urlRegexPattern: variables.URL_REGEX_PATTERN,
  };
}

export class MupConverter {
  /**
   * @param {DurableObjectState} state - Durable Object state.
   * @param {Object} env - Worker bindings, including R2, CONFIG_KV and VARIABLES_KV.
   */
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  /**
   * Durable Object HTTP handler.
   *
   * @param {Request} request - Incoming request.
   * @returns {Promise<Response>} JSON response.
   */
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/convertir' && request.method === 'POST') {
      return this.handleConvert(request);
    }

    if (url.pathname === '/status' && request.method === 'GET') {
      return this.handleStatus();
    }

    return new Response('Not Found', { status: 404 });
  }

  /**
   * POST /convertir: starts the conversion in the background.
   *
   * @param {Request} request - Request with JSON body { uuid, filename, origin }.
   * @returns {Promise<Response>} 202 Accepted with { status: 'started' }.
   */
  async handleConvert(request) {
    const { uuid, filename, origin, mode } = await request.json();
    this.state.waitUntil(this.convert(uuid, filename, origin, mode));

    return new Response(JSON.stringify({ status: 'started' }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * GET /status: returns the current conversion status.
   *
   * @returns {Promise<Response>} 200 with { status }.
   */
  async handleStatus() {
    const status = (await this.state.storage.get('conversionStatus')) || 'unknown';

    return new Response(JSON.stringify({ status }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * Runs the eight conversion layers sequentially.
   *
   * @param {string} uuid - Conversion UUID.
   * @param {string} filename - Original .mup filename.
   * @param {string} [origin] - Origin of the request that woke the DO.
   * @param {string} [mode] - Anonymous or catalogue.
   * @returns {Promise<boolean>} true when the conversion succeeds.
   * @throws {Error} When any layer fails.
   */
  async convert(uuid, filename, origin, mode = 'catalogue') {
    let inputKey;
    let bucket;
    try {
      const config = await loadConfig(this.env);
      const variables = await loadVariables(this.env);
      const layerOptions = layerOptionsFromVariables(variables);
      const startedAt = Date.now();

      bucket = this.env[variables.BINDING_R2];
      if (!bucket) {
        throw new Error(
          `Binding R2 no disponible: "${variables.BINDING_R2}". ` +
            'Verifica que el binding esté configurado en wrangler.',
        );
      }

      const { inputTemplate, outputTemplate } = resolvePathTemplates(mode, variables);
      inputKey = inputTemplate.replace(/\{uuid\}/g, uuid);
      const mupObject = await bucket.get(inputKey);
      if (!mupObject) {
        throw new Error(`Archivo .mup no encontrado en R2: ${inputKey}`);
      }

      const rawJson = JSON.parse(await mupObject.text());

      await this.state.storage.put('conversionStatus', 'parsing');
      const { metadata } = parseMup(rawJson, variables);
      console.log(JSON.stringify({
        level: 'info',
        action: 'conversion_parse_complete',
        uuid,
        duration_ms: Date.now() - startedAt,
      }));

      await this.state.storage.put('conversionStatus', 'flattening');
      const nodes = flattenNodes(rawJson, metadata, layerOptions.ideasKey);
      console.log(JSON.stringify({
        level: 'info',
        action: 'conversion_flatten_complete',
        uuid,
        node_count: nodes.length,
      }));

      await this.state.storage.put('conversionStatus', 'extracting_notes');
      const notes = extractNotes(nodes, rawJson);

      await this.state.storage.put('conversionStatus', 'extracting_attributes');
      const attributes = extractAttributes(nodes, rawJson);

      await this.state.storage.put('conversionStatus', 'extracting_stickers');
      const stickers = extractStickers(nodes, rawJson, layerOptions.stickerCategory);

      await this.state.storage.put('conversionStatus', 'extracting_urls');
      const externalRefs = extractUrls(
        nodes,
        rawJson,
        URL_CLASSIFIER,
        layerOptions.defaultRefType,
        layerOptions.urlRegexPattern,
      );

      metadata.source_file = filename;
      metadata.converted_at = new Date().toISOString();
      metadata.node_count = nodes.length;

      await this.state.storage.put('conversionStatus', 'assembling');
      const result = assembleResult(
        { metadata, rawJson },
        nodes,
        notes,
        attributes,
        stickers,
        externalRefs,
        variables,
      );

      await this.state.storage.put('conversionStatus', 'storing');
      await storeResult(result, uuid, this.env, config, { ...variables, R2_OUTPUT_PATH_TEMPLATE: outputTemplate });
      console.log(JSON.stringify({
        level: 'info',
        action: 'conversion_store_complete',
        uuid,
        duration_ms: Date.now() - startedAt,
      }));

      const downloadUrl = buildDownloadUrl(origin, uuid, variables);
      if (!downloadUrl) {
        console.warn(JSON.stringify({
          level: 'warn',
          action: 'download_url_skipped',
          uuid,
          reason: 'missing_origin_and_worker_url',
        }));
      }

      await this.state.storage.put('conversionStatus', 'completed');
      await this.state.storage.put('conversionResult', {
        uuid,
        filename,
        mode,
        downloadUrl: downloadUrl || null,
        completedAt: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      await this.state.storage.put('conversionStatus', 'error');
      await this.state.storage.put('conversionError', error.message);
      console.error(JSON.stringify({
        level: 'error',
        action: 'conversion_failed',
        uuid,
        error: error.message,
      }));
      throw error;
    } finally {
      if (bucket && inputKey) await bucket.delete(inputKey).catch(() => {});
    }
  }
}
