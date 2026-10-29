/**
 * @module upload
 * Pages Function that validates an uploaded .mup file and forwards it to the
 * internal converter Worker.
 *
 * Catalogue mode requires a valid session. Anonymous mode applies the
 * configured per-IP limits and returns HTML-only result links.
 */

import { loadConfig } from '../../src/shared/config.js';
import {
  validateContentLength,
  validateContentType,
  validateFile,
  validateFileSize,
  validateMupContent,
} from '../../src/shared/validator.js';
import { requireSession } from '../_lib/session-guard.js';

const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
});

const WINDOW_PREFIX = 'anon-window:';
const DAY_PREFIX = 'anon-day:';
const ACTIVE_PREFIX = 'anon-active:';
const DAY_SECONDS = 86400;

/**
 * Builds a JSON response.
 *
 * @param {number} status - HTTP status.
 * @param {Object} body - Response body.
 * @param {Object} [headers={}] - Extra headers.
 * @returns {Response} JSON response.
 */
function jsonResponse(status, body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

/**
 * Returns a stable client identifier for rate limiting.
 *
 * @param {Request} request - Incoming request.
 * @returns {string} Client IP or a safe fallback.
 */
function clientIp(request) {
  return request.headers.get('CF-Connecting-IP')
    || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
    || 'unknown';
}

/**
 * Reads an integer counter from KV.
 *
 * @param {Object} store - KV namespace.
 * @param {string} key - Counter key.
 * @returns {Promise<number>} Counter value.
 */
async function readCounter(store, key) {
  const raw = await store.get(key);
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Applies the anonymous per-IP limits.
 *
 * @param {Object} env - Environment bindings.
 * @param {Request} request - Incoming request.
 * @param {Object} config - Application configuration.
 * @returns {Promise<{ok: true}|{ok: false, response: Response}>}
 */
async function checkAnonymousLimits(env, request, config) {
  const store = env.CONFIG_KV;
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    return { ok: false, response: jsonResponse(500, { error: 'Configuración no disponible' }) };
  }

  const ip = clientIp(request);
  const activeKey = `${ACTIVE_PREFIX}${ip}`;
  const windowKey = `${WINDOW_PREFIX}${ip}`;
  const dayKey = `${DAY_PREFIX}${ip}`;
  const limits = config.rateLimit;

  if (await store.get(activeKey)) {
    return {
      ok: false,
      response: jsonResponse(429, { error: 'Ya hay una conversión en curso' }, { 'Retry-After': String(config.conversionTimeoutSeconds) }),
    };
  }

  const windowCount = await readCounter(store, windowKey);
  if (windowCount >= limits.maxRequestsPerWindow) {
    return {
      ok: false,
      response: jsonResponse(429, { error: 'Demasiadas conversiones. Inténtalo más tarde.' }, { 'Retry-After': String(limits.windowSeconds) }),
    };
  }

  const dayCount = await readCounter(store, dayKey);
  if (dayCount >= limits.maxRequestsPerDay) {
    return {
      ok: false,
      response: jsonResponse(429, { error: 'Límite diario de conversiones alcanzado.' }, { 'Retry-After': String(DAY_SECONDS) }),
    };
  }

  await store.put(windowKey, String(windowCount + 1), { expirationTtl: limits.windowSeconds });
  await store.put(dayKey, String(dayCount + 1), { expirationTtl: DAY_SECONDS });
  await store.put(activeKey, '1', { expirationTtl: config.conversionTimeoutSeconds });

  return { ok: true, activeKey, store };
}

/**
 * Verifies a Turnstile token when the feature is enabled.
 *
 * @param {Object} env - Environment bindings.
 * @param {string} token - Client token.
 * @param {string} ip - Client IP.
 * @returns {Promise<boolean>} true when Cloudflare accepts the token.
 */
async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET_KEY) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true;
  } catch {
    return false;
  }
}

/**
 * Handles POST /api/upload.
 *
 * @param {Object} context - Pages Functions context.
 * @returns {Promise<Response>} Upload result.
 */
export async function onRequestPost(context) {
  const { request, env } = context;

  let config;
  try {
    config = await loadConfig(env);
  } catch {
    return jsonResponse(500, { error: 'Configuración no disponible' });
  }

  const mode = config.loginEnabled === true ? 'catalogue' : 'anonymous';
  let activeKey;
  let store;

  if (mode === 'catalogue') {
    const authorization = await requireSession(context);
    if (!authorization.ok) return authorization.response;
  } else {
    const limits = await checkAnonymousLimits(env, request, config);
    if (!limits.ok) return limits.response;
    activeKey = limits.activeKey;
    store = limits.store;
  }

  const contentTypeError = validateContentType(request);
  if (contentTypeError) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(400, { error: contentTypeError });
  }

  const lengthError = validateContentLength(request, config.maxUploadBytes);
  if (lengthError) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(413, { error: lengthError });
  }

  let formData;
  try {
    formData = await request.formData();
  } catch {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(400, { error: 'El formulario multipart no es válido' });
  }

  if (mode === 'anonymous' && config.turnstileEnabled === true) {
    const token = formData.get('turnstileToken');
    if (typeof token !== 'string' || token.length === 0 || !(await verifyTurnstile(env, token, clientIp(request)))) {
      if (activeKey) await store.delete(activeKey).catch(() => {});
      return jsonResponse(403, { error: 'Verificación antiabuso fallida' });
    }
  }

  const file = formData.get('file');
  const fileError = validateFile(file, {
    minUploadBytes: config.minUploadBytes,
    maxUploadBytes: config.maxUploadBytes,
  });
  if (fileError) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(400, { error: fileError });
  }

  const sizeError = validateFileSize(file, config.maxUploadBytes);
  if (sizeError) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(413, { error: sizeError });
  }

  const contentCheck = validateMupContent(await file.text());
  if (!contentCheck.valid) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(400, { error: contentCheck.error });
  }

  const converter = env.CONVERTER;
  if (!converter || typeof converter.fetch !== 'function') {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(500, { error: 'Servicio de conversión no disponible' });
  }
  if (!env.INTERNAL_SHARED_SECRET) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(500, { error: 'Configuración no disponible' });
  }

  const forwarded = new FormData();
  forwarded.append('file', file, file.name);

  let converterResponse;
  try {
    converterResponse = await converter.fetch(new Request('https://converter/convertir', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.INTERNAL_SHARED_SECRET}`,
        'X-MMUP-Mode': mode,
      },
      body: forwarded,
    }));
  } catch {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(502, { error: 'No se pudo iniciar la conversión' });
  }

  if (!converterResponse.ok) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(502, { error: 'No se pudo iniciar la conversión' });
  }

  const payload = await converterResponse.json();
  const uuid = payload.uuid;
  if (typeof uuid !== 'string' || uuid.length === 0) {
    if (activeKey) await store.delete(activeKey).catch(() => {});
    return jsonResponse(502, { error: 'Respuesta de conversión no válida' });
  }

  const expiresAt = mode === 'anonymous'
    ? new Date(Date.now() + config.anonymousRetentionHours * 3600 * 1000).toISOString()
    : null;

  return jsonResponse(202, {
    uuid,
    mode,
    statusUrl: `/api/status/${uuid}`,
    htmlUrl: `/html/${uuid}`,
    htmlDownloadUrl: `/api/download-html/${uuid}`,
    downloadUrl: mode === 'catalogue' ? `/api/download/${uuid}` : null,
    expiresAt,
  });
}
