/**
 * @module test-list
 * Tests for the catalogue list Pages Function.
 */

import assert from 'node:assert/strict';
import { onRequestGet } from '../../functions/api/list.js';
import { buildSessionRecord, generateSessionId, sessionKey, SESSION_COOKIE_NAME } from '../../src/shared/session.js';
import { CONFIG_KEY, VARIABLES_KEY } from '../../src/shared/config.js';

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
  visualizer: {
    allowedOrigins: [], outputPrefix: 'output/', jsonSuffix: '.json',
    listCacheSeconds: 60, corsMaxAgeSeconds: 86400, durableObjectBinding: 'MMUP_VISOR_DO',
  },
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
  return { async get(key) { return store.has(key) ? store.get(key) : null; }, async delete(key) { store.delete(key); }, store };
}

function createBucket(pages) {
  const pageList = [...pages];
  return {
    async list() { return pageList.shift(); },
    async get(key) {
      const index = key.includes('a') ? 0 : 1;
      return { async text() { return JSON.stringify({ metadata: {
        title: index === 0 ? 'Mapa A' : 'Mapa B',
        source_file: index === 0 ? 'mapa-a.mup' : 'mapa-b.mup',
        converted_at: index === 0 ? '2026-10-22T10:00:00.000Z' : '2026-10-23T10:00:00.000Z',
        node_count: index + 1,
      } }); } };
    },
  };
}

function context(env, sessionId) {
  return {
    env,
    request: new Request('https://pages.test/api/list', {
      headers: sessionId ? { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } : {},
    }),
  };
}

function sessionEnv(sessions = {}) {
  return { CONFIG_KV: createKV(CONFIG, sessions), VARIABLES_KV: createKV(), MMUP_BUCKET: createBucket([
    { objects: [
      { key: 'output/a.json', customMetadata: { group: 'Grupo A', group_path: 'A' } },
      { key: 'output/b.json', customMetadata: { group: 'Grupo B', group_path: 'B' } },
    ], truncated: false },
  ]) };
}

await test('unauthorized request returns 401', async () => {
  const response = await onRequestGet(context(sessionEnv(), null));
  assert.equal(response.status, 401);
});

await test('login disabled returns 404', async () => {
  const env = sessionEnv();
  env.CONFIG_KV = createKV({ ...CONFIG, loginEnabled: false });
  const response = await onRequestGet(context(env, null));
  assert.equal(response.status, 404);
});

await test('catalogue disabled returns 404', async () => {
  const env = sessionEnv();
  env.CONFIG_KV = createKV({ ...CONFIG, catalogEnabled: false });
  const response = await onRequestGet(context(env, null));
  assert.equal(response.status, 404);
});

await test('valid session returns items sorted by date', async () => {
  const id = generateSessionId();
  const env = sessionEnv({ [sessionKey(id)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) });
  const response = await onRequestGet(context(env, id));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.count, 2);
  assert.equal(body.items[0].title, 'Mapa B');
  assert.equal(body.items[0].group, 'Grupo B');
  assert.equal(body.items[0].uuid, 'b');
  assert.equal(body.items[0].version, 'v7');
  assert.equal(response.headers.get('Cache-Control'), 'private, max-age=60');
});

await test('pagination follows the cursor', async () => {
  const id = generateSessionId();
  const env = sessionEnv({ [sessionKey(id)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) });
  env.MMUP_BUCKET = createBucket([
    { objects: [{ key: 'output/a.json', customMetadata: { group: 'A' } }], truncated: true, cursor: 'next' },
    { objects: [{ key: 'output/b.json', customMetadata: { group: 'B' } }], truncated: false },
  ]);
  const response = await onRequestGet(context(env, id));
  const body = await response.json();
  assert.equal(body.count, 2);
});

await test('missing bucket returns 500', async () => {
  const id = generateSessionId();
  const env = sessionEnv({ [sessionKey(id)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) });
  delete env.MMUP_BUCKET;
  const response = await onRequestGet(context(env, id));
  assert.equal(response.status, 500);
});

console.log(`\nlist function tests OK (${passed}/${total})`);
if (failures.length > 0) { for (const failure of failures) console.error(failure.error.stack); process.exit(1); }
