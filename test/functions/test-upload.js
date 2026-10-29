/**
 * @module test-upload
 * Tests for the upload Pages Function.
 */

import assert from 'node:assert/strict';
import { onRequestPost } from '../../functions/api/upload.js';
import { buildSessionRecord, generateSessionId, sessionKey, SESSION_COOKIE_NAME } from '../../src/shared/session.js';
import { CONFIG_KEY, VARIABLES_KEY } from '../../src/shared/config.js';

const CONFIG = {
  schemaVersion: 1, loginEnabled: false, catalogEnabled: false, loginUser: 'admin',
  sessionTtlMinutes: 60, anonymousRetentionHours: 24, maxUploadBytes: 16777216, minUploadBytes: 1024,
  rateLimit: { windowSeconds: 600, maxRequestsPerWindow: 2, maxRequestsPerDay: 10, maxConcurrent: 1, appliesToAuthenticated: false },
  loginMaxAttempts: 5, loginWindowSeconds: 600, allowedOrigins: [], configCacheSeconds: 60,
  conversionTimeoutSeconds: 120, htmlCacheSeconds: 0,
};

const VARIABLES = {
  schemaVersion: 1,
  converter: { API_PATH_CONVERT: '/convertir', API_PATH_STATUS: '/status', API_PATH_DOWNLOAD: '/download', R2_TEMP_INPUT_PATH_TEMPLATE: 'temp/{uuid}.mup', R2_TEMP_OUTPUT_PATH_TEMPLATE: 'temp/{uuid}/output.json' },
  visualizer: { allowedOrigins: [], outputPrefix: 'output/', jsonSuffix: '.json', listCacheSeconds: 60, corsMaxAgeSeconds: 86400, durableObjectBinding: 'MMUP_VISOR_DO' },
};

const MUP_TEXT = JSON.stringify({ formatVersion: 3, ideas: { root: { title: 'x'.repeat(1200) } } });
const UUID = '00000000-0000-4000-8000-000000000001';

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
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    store,
  };
}

function createConverter(capture) {
  return {
    async fetch(request) {
      capture.mode = request.headers.get('X-MMUP-Mode');
      capture.authorization = request.headers.get('Authorization');
      const body = await request.formData();
      capture.fileName = body.get('file')?.name;
      return Response.json({ uuid: UUID, statusUrl: '/status/x', downloadUrl: '/download/x' }, { status: 202 });
    },
  };
}

function context({ config = CONFIG, sessionId, converter = createConverter({}), store = createKV(config, sessionId ? { [sessionKey(sessionId)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) } : {}), turnstileToken } = {}) {
  const form = new FormData();
  form.append('file', new File([MUP_TEXT], 'mapa.mup', { type: 'application/json' }));
  if (turnstileToken) form.append('turnstileToken', turnstileToken);
  return {
    env: { CONFIG_KV: store, VARIABLES_KV: createKV(), CONVERTER: converter, INTERNAL_SHARED_SECRET: 'secret', TURNSTILE_SECRET_KEY: 'turnstile-secret' },
    request: new Request('https://pages.test/api/upload', {
      method: 'POST',
      headers: sessionId ? { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } : {},
      body: form,
    }),
  };
}

await test('catalogue upload without session returns 401', async () => {
  const response = await onRequestPost(context({ config: { ...CONFIG, loginEnabled: true, catalogEnabled: true } }));
  assert.equal(response.status, 401);
});

await test('anonymous upload returns HTML-only links', async () => {
  const capture = {};
  const response = await onRequestPost(context({ converter: createConverter(capture) }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.mode, 'anonymous');
  assert.equal(body.downloadUrl, null);
  assert.equal(body.htmlUrl, `/html/${UUID}`);
  assert.equal(body.htmlDownloadUrl, `/api/download-html/${UUID}`);
  assert.equal(typeof body.expiresAt, 'string');
  assert.equal(capture.mode, 'anonymous');
  assert.equal(capture.fileName, 'mapa.mup');
});

await test('catalogue upload forwards the session mode and returns JSON download', async () => {
  const sessionId = generateSessionId();
  const capture = {};
  const response = await onRequestPost(context({
    config: { ...CONFIG, loginEnabled: true, catalogEnabled: true },
    sessionId,
    converter: createConverter(capture),
  }));
  const body = await response.json();
  assert.equal(response.status, 202);
  assert.equal(body.mode, 'catalogue');
  assert.equal(body.downloadUrl, `/api/download/${UUID}`);
  assert.equal(body.htmlDownloadUrl, `/api/download-html/${UUID}`);
  assert.equal(capture.mode, 'catalogue');
  assert.equal(capture.authorization, 'Bearer secret');
});

await test('anonymous window limit returns 429', async () => {
  const store = createKV(CONFIG);
  await store.put('anon-window:unknown', '2');
  const response = await onRequestPost(context({ store }));
  assert.equal(response.status, 429);
});

await test('anonymous active conversion returns 429', async () => {
  const store = createKV(CONFIG);
  await store.put('anon-active:unknown', '1');
  const response = await onRequestPost(context({ store }));
  assert.equal(response.status, 429);
});

await test('converter failure returns 502 and releases the active key', async () => {
  const store = createKV(CONFIG);
  const converter = { async fetch() { return new Response('bad', { status: 500 }); } };
  const response = await onRequestPost(context({ store, converter }));
  assert.equal(response.status, 502);
  assert.equal(store.store.has('anon-active:unknown'), false);
});

await test('missing converter returns 500', async () => {
  const ctx = context();
  delete ctx.env.CONVERTER;
  const response = await onRequestPost(ctx);
  assert.equal(response.status, 500);
});

await test('invalid extension returns 400', async () => {
  const ctx = context();
  const form = new FormData();
  form.append('file', new File([MUP_TEXT], 'mapa.txt', { type: 'text/plain' }));
  ctx.request = new Request('https://pages.test/api/upload', { method: 'POST', body: form });
  const response = await onRequestPost(ctx);
  assert.equal(response.status, 400);
});

await test('turnstile enabled without token returns 403', async () => {
  const response = await onRequestPost(context({ config: { ...CONFIG, turnstileEnabled: true, turnstileSiteKey: 'site' } }));
  assert.equal(response.status, 403);
});

await test('turnstile rejection returns 403', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: false });
  try {
    const response = await onRequestPost(context({
      config: { ...CONFIG, turnstileEnabled: true, turnstileSiteKey: 'site' },
      turnstileToken: 'invalid',
    }));
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('turnstile acceptance allows the upload', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ success: true });
  try {
    const response = await onRequestPost(context({
      config: { ...CONFIG, turnstileEnabled: true, turnstileSiteKey: 'site' },
      turnstileToken: 'valid',
    }));
    assert.equal(response.status, 202);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\nupload function tests OK (${passed}/${total})`);
if (failures.length > 0) { for (const failure of failures) console.error(failure.error.stack); process.exit(1); }
