/**
 * @module index
 * Converter Worker HTTP entry point.
 *
 * Routes:
 * - POST /convertir: receive a .mup file, store it in R2 and wake the DO.
 * - GET /status/{uuid}: conversion status.
 * - GET /download/{uuid}: download the resulting JSON from R2.
 *
 * Bindings: MMUP_CONVERT_DO, MMUP_BUCKET, CONFIG_KV and VARIABLES_KV.
 * Authentication uses the internal shared secret and runs before any KV read.
 */

import { loadConfig, loadVariables } from '../shared/config.js';
import { authenticateRequest } from './auth.js';
import {
  validateContentType,
  validateContentLength,
  validateFile,
  validateFileSize,
  validateMupContent,
} from '../shared/validator.js';
import { isValidIdentifier } from '../shared/identifiers.js';
import { generateUUID } from '../shared/uuid.js';
import { resolvePathTemplates } from '../shared/paths.js';

export { MupConverter } from './mmup-convert.js';

/**
 * Resolves the conversion mode from the `X-MMUP-Mode` header
 * (`anonymous` or `catalogue`).
 *
 * Only `anonymous` and `catalogue` are supported. Unknown or missing values
 * fall back to catalogue mode.
 *
 * @param {string|null} value - Raw header value.
 * @returns {'anonymous'|'catalogue'} Normalized conversion mode.
 */
function resolveMode(value) {
  if (value === 'anonymous') {
    return 'anonymous';
  }
  return 'catalogue';
}

/**
 * Resolves the Durable Object binding.
 *
 * The binding name comes from behaviour variables. The inherited
 * `MMUP_CONVERT_DO` name remains as a deployment fallback.
 *
 * @param {Object} env - Worker bindings.
 * @param {Object} variables - Behaviour variables.
 * @returns {Object|undefined} Durable Object binding.
 */
function resolveDOBinding(env, variables) {
  if (variables.DO_BINDING_NAME) {
    return env[variables.DO_BINDING_NAME] || env.MMUP_CONVERT_DO;
  }
  return env.MMUP_CONVERT_DO;
}

export default {
  /**
   * Worker entry point.
   *
   * @param {Request} request - Incoming request.
   * @param {Object} env - Worker bindings.
   * @param {ExecutionContext} ctx - Execution context.
   * @returns {Promise<Response>} HTTP response.
   */
  async fetch(request, env, ctx) {
    const authError = authenticateRequest(request, env);
    if (authError) {
      return authError;
    }

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const variables = await loadVariables(env);
    const mode = resolveMode(request.headers.get('X-MMUP-Mode'));

    if (method === 'POST' && path === variables.API_PATH_CONVERT) {
      const config = await loadConfig(env);
      return handleConvert(request, env, config, variables, ctx, mode);
    }

    if (method === 'GET' && path.startsWith(`${variables.API_PATH_STATUS}/`)) {
      const uuid = path.slice(variables.API_PATH_STATUS.length + 1);
      return handleStatus(uuid, env, variables);
    }

    if (method === 'GET' && path.startsWith(`${variables.API_PATH_DOWNLOAD}/`)) {
      const uuid = path.slice(variables.API_PATH_DOWNLOAD.length + 1);
      return handleDownload(uuid, env, variables);
    }

    return new Response('Not Found', { status: variables.HTTP_NOT_FOUND });
  },

  /**
   * Scheduled handler: removes expired temporary objects.
   *
   * @param {ScheduledEvent} event - Cron event.
   * @param {Object} env - Worker bindings.
   * @param {ExecutionContext} ctx - Execution context.
   * @returns {Promise<void>}
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(cleanupTemp(env));
  },
};

/**
 * Deletes temporary objects older than the anonymous retention period.
 *
 * @param {Object} env - Worker bindings.
 * @returns {Promise<{deleted: number, scanned: number}>} Cleanup summary.
 */
export async function cleanupTemp(env) {
  let config;
  let variables;
  try {
    config = await loadConfig(env);
    variables = await loadVariables(env);
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', action: 'cleanup_config_failed', error: error.message }));
    return { deleted: 0, scanned: 0 };
  }

  const bucket = env[variables.BINDING_R2];
  if (!bucket || typeof bucket.list !== 'function') {
    console.error(JSON.stringify({ level: 'error', action: 'cleanup_bucket_missing' }));
    return { deleted: 0, scanned: 0 };
  }

  const prefix = variables.R2_TEMP_OUTPUT_PATH_TEMPLATE.split('{uuid}')[0];
  const retentionMs = config.anonymousRetentionHours * 3600 * 1000;
  let cursor;
  let truncated = true;
  let scanned = 0;
  let deleted = 0;

  while (truncated) {
    const options = { prefix, limit: 1000 };
    if (cursor) options.cursor = cursor;
    const page = await bucket.list(options);

    for (const object of page.objects) {
      scanned += 1;
      const uploaded = object.uploaded instanceof Date ? object.uploaded.getTime() : 0;
      if (!uploaded || Date.now() - uploaded >= retentionMs) {
        await bucket.delete(object.key).catch(() => {});
        deleted += 1;
      }
    }

    truncated = page.truncated === true;
    cursor = page.cursor;
  }

  console.log(JSON.stringify({ level: 'info', action: 'cleanup_complete', scanned, deleted }));
  return { deleted, scanned };
}

/**
 * POST /convertir.
 *
 * @param {Request} request - multipart/form-data request.
 * @param {Object} env - Worker bindings.
 * @param {Object} config - Operational configuration.
 * @param {Object} variables - Behaviour variables.
 * @param {ExecutionContext} ctx - Execution context.
 * @param {string} mode - Anonymous or catalogue.
 * @returns {Promise<Response>} 202 with status and download URLs.
 */
async function handleConvert(request, env, config, variables, ctx, mode) {
  const contentTypeError = validateContentType(request);
  if (contentTypeError) {
    return Response.json({ error: contentTypeError }, { status: variables.HTTP_BAD_REQUEST });
  }

  const maxBytes = config.maxUploadBytes;
  const lengthError = validateContentLength(request, maxBytes);
  if (lengthError) {
    return Response.json({ error: lengthError }, { status: variables.HTTP_PAYLOAD_TOO_LARGE });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json(
      { error: 'El formulario multipart no es válido' },
      { status: variables.HTTP_BAD_REQUEST },
    );
  }

  const file = formData.get('file');
  const fileError = validateFile(file, {
    minUploadBytes: config.minUploadBytes,
    maxUploadBytes: config.maxUploadBytes,
  });
  if (fileError) {
    return Response.json({ error: fileError }, { status: variables.HTTP_BAD_REQUEST });
  }

  const sizeError = validateFileSize(file, maxBytes);
  if (sizeError) {
    return Response.json({ error: sizeError }, { status: variables.HTTP_PAYLOAD_TOO_LARGE });
  }

  const fileText = await file.text();
  const contentCheck = validateMupContent(fileText);
  if (!contentCheck.valid) {
    return Response.json({ error: contentCheck.error }, { status: variables.HTTP_BAD_REQUEST });
  }

  const uuid = generateUUID();
  const bucket = env[variables.BINDING_R2];
  if (!bucket) {
    return Response.json(
      { error: 'El binding de R2 no está disponible' },
      { status: variables.HTTP_INTERNAL_ERROR },
    );
  }

  let inputKey;
  let uploadTimeoutId;
  try {
    const { inputTemplate } = resolvePathTemplates(mode, variables);
    inputKey = inputTemplate.replace(/\{uuid\}/g, uuid);
    const timeoutMs = variables.UPLOAD_TIMEOUT_SECONDS * 1000;
    const uploadPromise = bucket.put(inputKey, fileText, {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });
    const timeoutPromise = new Promise((_, reject) => {
      uploadTimeoutId = setTimeout(() => reject(new Error('Tiempo de subida agotado')), timeoutMs);
    });

    await Promise.race([uploadPromise, timeoutPromise]);
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      action: 'r2_upload_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json(
      { error: 'No se pudo subir el archivo' },
      { status: variables.HTTP_INTERNAL_ERROR },
    );
  } finally {
    clearTimeout(uploadTimeoutId);
  }

  const origin = new URL(request.url).origin;
  const doBinding = resolveDOBinding(env, variables);

  if (!doBinding) {
    await bucket.delete(inputKey).catch(() => {});
    return Response.json(
      { error: 'Servicio de conversión no disponible' },
      { status: variables.HTTP_INTERNAL_ERROR },
    );
  }

  try {
    const doId = doBinding.idFromName(uuid);
    const stub = doBinding.get(doId);
    await stub.fetch(new Request('https://dummy/convertir', {
      method: 'POST',
      body: JSON.stringify({ uuid, filename: file.name, origin, mode }),
      headers: { 'Content-Type': 'application/json' },
    }));
  } catch (error) {
    await bucket.delete(inputKey).catch(() => {});
    console.error(JSON.stringify({
      level: 'error',
      action: 'do_wake_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json(
      { error: 'No se pudo iniciar la conversión' },
      { status: variables.HTTP_BAD_GATEWAY || 502 },
    );
  }

  return Response.json(
    {
      uuid,
      statusUrl: `${origin}${variables.API_PATH_STATUS}/${uuid}`,
      downloadUrl: `${origin}${variables.API_PATH_DOWNLOAD}/${uuid}`,
    },
    { status: variables.HTTP_ACCEPTED },
  );
}

/**
 * GET /status/{uuid}.
 *
 * @param {string} uuid - Conversion UUID.
 * @param {Object} env - Worker bindings.
 * @param {Object} variables - Behaviour variables.
 * @returns {Promise<Response>} 200 with { uuid, status }.
 */
async function handleStatus(uuid, env, variables) {
  if (!isValidIdentifier(uuid)) {
    return Response.json({ error: 'Identificador inválido' }, { status: variables.HTTP_BAD_REQUEST });
  }

  const doBinding = resolveDOBinding(env, variables);
  if (doBinding) {
    try {
      const doId = doBinding.idFromName(uuid);
      const stub = doBinding.get(doId);
      const doResponse = await stub.fetch(new Request('https://dummy/status', { method: 'GET' }));
      const doBody = await doResponse.json();
      return Response.json({ uuid, status: doBody.status }, { status: variables.HTTP_OK });
    } catch (error) {
      console.warn(JSON.stringify({
        level: 'warn',
        action: 'do_status_failed',
        error: error instanceof Error ? error.message : String(error),
      }));
      return Response.json({ uuid, status: 'pending' }, { status: variables.HTTP_OK });
    }
  }

  return Response.json({ uuid, status: 'unknown' }, { status: variables.HTTP_OK });
}

/**
 * GET /download/{uuid}.
 *
 * @param {string} uuid - Conversion UUID.
 * @param {Object} env - Worker bindings.
 * @param {Object} variables - Behaviour variables.
 * @returns {Promise<Response>} JSON result, 400 or 404.
 */
async function handleDownload(uuid, env, variables) {
  if (!isValidIdentifier(uuid)) {
    return Response.json({ error: 'Identificador inválido' }, { status: variables.HTTP_BAD_REQUEST });
  }

  const bucket = env[variables.BINDING_R2];
  if (!bucket) {
    return Response.json(
      { error: 'El binding de R2 no está disponible' },
      { status: variables.HTTP_INTERNAL_ERROR },
    );
  }

  try {
    const outputKey = variables.R2_OUTPUT_PATH_TEMPLATE.replace(/\{uuid\}/g, uuid);
    const object = await bucket.get(outputKey);

    if (!object) {
      return Response.json({ error: 'Resultado no encontrado' }, { status: variables.HTTP_NOT_FOUND });
    }

    return new Response(await object.text(), {
      status: variables.HTTP_OK,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: 'error',
      action: 'r2_download_failed',
      error: error instanceof Error ? error.message : String(error),
    }));
    return Response.json(
      { error: 'No se pudo recuperar el resultado' },
      { status: variables.HTTP_INTERNAL_ERROR },
    );
  }
}
