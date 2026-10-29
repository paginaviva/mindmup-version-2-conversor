/**
 * @module test-result-endpoints
 * Tests for status, HTML and JSON download Pages Functions.
 */

import assert from 'node:assert/strict';
import { onRequestGet as statusGet } from '../../functions/api/status/[uuid].js';
import { onRequestGet as htmlGet } from '../../functions/html/[uuid].js';
import { onRequestGet as downloadGet } from '../../functions/api/download/[uuid].js';
import { buildSessionRecord, generateSessionId, sessionKey, SESSION_COOKIE_NAME } from '../../src/shared/session.js';
import { CONFIG_KEY, VARIABLES_KEY } from '../../src/shared/config.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const NONCE = 'viewerNONCE123';
const VIEWER_HTML = '<!doctype html><html><body>ok</body></html>';
const VIEWER_CSP = `default-src 'none'; script-src 'nonce-${NONCE}'`;
const CONFIG = {
  schemaVersion: 1, loginEnabled: true, catalogEnabled: true, loginUser: 'admin',
  sessionTtlMinutes: 60, anonymousRetentionHours: 24, maxUploadBytes: 16777216, minUploadBytes: 1024,
  rateLimit: { windowSeconds: 600, maxRequestsPerWindow: 2, maxRequestsPerDay: 10, maxConcurrent: 1, appliesToAuthenticated: false },
  loginMaxAttempts: 5, loginWindowSeconds: 600, allowedOrigins: [], configCacheSeconds: 60,
  conversionTimeoutSeconds: 120, htmlCacheSeconds: 0,
};
const VARIABLES = {
  schemaVersion: 1,
  converter: {
    API_PATH_CONVERT: '/convertir', API_PATH_STATUS: '/status', API_PATH_DOWNLOAD: '/download',
    DO_BINDING_NAME: 'MMUP_CONVERT_DO', BINDING_R2: 'MMUP_BUCKET',
    R2_INPUT_PATH_TEMPLATE: 'input/{uuid}.mup', R2_OUTPUT_PATH_TEMPLATE: 'output/{uuid}.json',
    R2_TEMP_INPUT_PATH_TEMPLATE: 'temp/{uuid}.mup', R2_TEMP_OUTPUT_PATH_TEMPLATE: 'temp/{uuid}/output.json',
    UPLOAD_TIMEOUT_SECONDS: 30, HTTP_OK: 200, HTTP_ACCEPTED: 202, HTTP_BAD_REQUEST: 400,
    HTTP_NOT_FOUND: 404, HTTP_PAYLOAD_TOO_LARGE: 413, HTTP_INTERNAL_ERROR: 500,
    MUP_FORMAT_VERSION: 3, MUP_KEY_IDEAS: 'ideas', DEFAULT_STICKER_CATEGORY: 'unknown',
    DEFAULT_REF_TYPE: 'web_page', DEFAULT_LINK_RESOLUTION: 'unresolved',
    URL_REGEX_PATTERN: '(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)', WORKER_URL: '',
  },
  visualizer: { allowedOrigins: [], outputPrefix: 'output/', jsonSuffix: '.json', listCacheSeconds: 60, corsMaxAgeSeconds: 86400, durableObjectBinding: 'MMUP_VISOR_DO' },
};

let total = 0;
let passed = 0;
const failures = [];

async function test(name, fn) {
  total += 1;
  try { await fn(); passed += 1; console.log(`  ✅ ${name}`); }
  catch (error) { failures.push({ name, error }); console.error(`  ❌ ${name}: ${error.message}`); }
}

function createKV(config = CONFIG, sessions = {}) {
  const store = new Map(Object.entries(sessions));
  store.set(CONFIG_KEY, JSON.stringify(config));
  store.set(VARIABLES_KEY, JSON.stringify(VARIABLES));
  return { async get(k) { return store.has(k) ? store.get(k) : null; }, async delete(k) { store.delete(k); }, store };
}

function ctx({ env, sessionId, uuid = UUID } = {}) {
  return {
    env,
    params: { uuid },
    request: new Request(`https://pages.test${uuid}`, {
      headers: sessionId ? { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } : {},
    }),
  };
}

function envWith({ config = CONFIG, sessionId, bucket, converter, visualizer } = {}) {
  const sessions = sessionId ? { [sessionKey(sessionId)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) } : {};
  return {
    CONFIG_KV: createKV(config, sessions),
    VARIABLES_KV: createKV(config),
    MMUP_BUCKET: bucket,
    CONVERTER: converter,
    VISUALIZER: visualizer,
    INTERNAL_SHARED_SECRET: 'secret',
  };
}

await test('status rejects an invalid UUID', async () => {
  const response = await statusGet(ctx({ env: envWith(), uuid: '../bad' }));
  assert.equal(response.status, 400);
});

await test('status requires a session in catalogue mode', async () => {
  const converter = { async fetch() { return Response.json({ status: 'completed' }); } };
  const response = await statusGet(ctx({ env: envWith({ converter }) }));
  assert.equal(response.status, 401);
});

await test('status returns the converter status with a session', async () => {
  const sessionId = generateSessionId();
  const converter = { async fetch() { return Response.json({ status: 'completed' }); } };
  const response = await statusGet(ctx({ env: envWith({ sessionId, converter }), sessionId }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'completed');
});

await test('status works in anonymous mode without a session', async () => {
  const converter = { async fetch() { return Response.json({ status: 'started' }); } };
  const response = await statusGet(ctx({ env: envWith({ config: { ...CONFIG, loginEnabled: false }, converter }) }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, 'anonymous');
});

await test('html requires a session in catalogue mode', async () => {
  const visualizer = { async fetch() { return new Response('<html></html>'); } };
  const response = await htmlGet(ctx({ env: envWith({ visualizer }) }));
  assert.equal(response.status, 401);
});

await test('html returns 404 for a missing anonymous result', async () => {
  const bucket = { async head() { return null; } };
  const response = await htmlGet(ctx({ env: envWith({ config: { ...CONFIG, loginEnabled: false }, bucket }) }));
  assert.equal(response.status, 404);
});

await test('html enforces anonymous retention', async () => {
  let deleted = null;
  const bucket = { async head() { return { uploaded: new Date(Date.now() - 25 * 3600 * 1000) }; }, async delete(k) { deleted = k; } };
  const response = await htmlGet(ctx({ env: envWith({ config: { ...CONFIG, loginEnabled: false }, bucket }) }));
  assert.equal(response.status, 404);
  assert.equal(deleted, `temp/${UUID}/output.json`);
});

await test('html injects catalogue download links when a session is present', async () => {
  // Arrange
  const sessionId = generateSessionId();
  const visualizer = {
    async fetch() {
      return new Response(VIEWER_HTML, { headers: { 'Content-Security-Policy': VIEWER_CSP } });
    },
  };

  // Act
  const response = await htmlGet(ctx({ env: envWith({ sessionId, visualizer }), sessionId }));
  const html = await response.text();

  // Assert
  assert.equal(response.status, 200);
  assert.ok(html.includes('mmup-download-toolbar'), 'falta la barra de descargas');
  assert.ok(html.includes('Descargar HTML'), 'falta el botón Descargar HTML');
  assert.ok(html.includes('Descargar JSON'), 'falta el botón Descargar JSON en catálogo');
});

await test('html proxies to the visualizer with the temp key in anonymous mode', async () => {
  // Arrange
  let keyTemplate = null;
  const bucket = { async head() { return { uploaded: new Date() }; } };
  const visualizer = {
    async fetch(request) {
      keyTemplate = request.headers.get('X-MMUP-Key-Template');
      return new Response(VIEWER_HTML, { headers: { 'Content-Security-Policy': VIEWER_CSP } });
    },
  };

  // Act
  const response = await htmlGet(ctx({ env: envWith({ config: { ...CONFIG, loginEnabled: false }, bucket, visualizer }) }));
  const html = await response.text();

  // Assert
  assert.equal(response.status, 200);
  assert.equal(keyTemplate, 'temp/{uuid}/output.json');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(html.includes('mmup-download-toolbar'), 'falta la barra de descargas');
  assert.ok(html.includes('Descargar HTML'), 'falta el botón Descargar HTML');
  assert.equal(html.includes('Descargar JSON'), false, 'anónimo no debe ofrecer JSON');
});

await test('download is unavailable in anonymous mode', async () => {
  const response = await downloadGet(ctx({ env: envWith({ config: { ...CONFIG, loginEnabled: false } }) }));
  assert.equal(response.status, 404);
});

await test('download requires a session in catalogue mode', async () => {
  const response = await downloadGet(ctx({ env: envWith() }));
  assert.equal(response.status, 401);
});

await test('download returns the JSON with the normalized filename', async () => {
  const sessionId = generateSessionId();
  const bucket = { async get() { return { async text() { return JSON.stringify({ metadata: { source_file: 'Mapa sintético 2026.mup' } }); } }; } };
  const response = await downloadGet(ctx({ env: envWith({ sessionId, bucket }), sessionId }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Disposition'), 'attachment; filename="Mapa-sintetico-2026.json"');
});

console.log(`\nresult endpoint tests OK (${passed}/${total})`);
if (failures.length > 0) { for (const failure of failures) console.error(failure.error.stack); process.exit(1); }
