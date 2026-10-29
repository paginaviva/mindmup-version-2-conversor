/**
 * @module test-worker-units
 * Unit tests for the converter Worker, authentication and configuration.
 *
 * Phase 2 smoke coverage. Phase 3 extends this suite once the KV documents
 * and the session layer are wired.
 */

import assert from 'node:assert/strict';

import worker from '../../src/converter/index.js';
import { MupConverter, buildDownloadUrl, layerOptionsFromVariables } from '../../src/converter/mmup-convert.js';
import { authenticateRequest } from '../../src/converter/auth.js';
import { loadConfig, loadVariables, CONFIG_KEY, VARIABLES_KEY } from '../../src/shared/config.js';
import { validateContentLength, validateFile, validateFileSize, isValidUUID } from '../../src/shared/validator.js';
import { generateUUID } from '../../src/shared/uuid.js';

let total = 0;
let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, error });
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(64));
}

const SECRET = 'test-internal-secret';

const CONFIG_DOCUMENT = {
  schemaVersion: 1,
  loginEnabled: false,
  catalogEnabled: false,
  loginUser: '',
  sessionTtlMinutes: 1440,
  anonymousRetentionHours: 24,
  maxUploadBytes: 16 * 1024 * 1024,
  minUploadBytes: 1024,
  rateLimit: { windowSeconds: 600, maxRequestsPerWindow: 2, maxRequestsPerDay: 10, maxConcurrent: 1, appliesToAuthenticated: false },
  loginMaxAttempts: 5,
  loginWindowSeconds: 600,
  allowedOrigins: [],
  configCacheSeconds: 60,
  conversionTimeoutSeconds: 120,
  htmlCacheSeconds: 0,
};

const VARIABLES_DOCUMENT = {
  schemaVersion: 1,
  converter: {
    API_PATH_CONVERT: '/convertir',
    API_PATH_STATUS: '/status',
    API_PATH_DOWNLOAD: '/download',
    DO_BINDING_NAME: 'MMUP_CONVERT_DO',
    BINDING_R2: 'MMUP_BUCKET',
    R2_INPUT_PATH_TEMPLATE: 'input/{uuid}.mup',
    R2_OUTPUT_PATH_TEMPLATE: 'output/{uuid}.json',
  R2_TEMP_INPUT_PATH_TEMPLATE: 'temp/{uuid}.mup',
  R2_TEMP_OUTPUT_PATH_TEMPLATE: 'temp/{uuid}/output.json',
    UPLOAD_TIMEOUT_SECONDS: 30,
    HTTP_OK: 200,
    HTTP_ACCEPTED: 202,
    HTTP_BAD_REQUEST: 400,
    HTTP_NOT_FOUND: 404,
    HTTP_PAYLOAD_TOO_LARGE: 413,
    HTTP_INTERNAL_ERROR: 500,
    MUP_FORMAT_VERSION: 3,
    MUP_KEY_IDEAS: 'ideas',
    DEFAULT_STICKER_CATEGORY: 'unknown',
    DEFAULT_REF_TYPE: 'web_page',
    DEFAULT_LINK_RESOLUTION: 'unresolved',
    URL_REGEX_PATTERN: '(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)',
    WORKER_URL: '',
  },
  visualizer: {
    allowedOrigins: [],
    outputPrefix: 'output/',
    jsonSuffix: '.json',
    listCacheSeconds: 60,
    corsMaxAgeSeconds: 86400,
    durableObjectBinding: 'MMUP_VISOR_DO',
  },
};

function createKV(store = {}) {
  const stats = { reads: 0 };
  return {
    stats,
    async get(key) {
      stats.reads += 1;
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
  };
}

function createEnv(overrides = {}) {
  const configKV = createKV({ [CONFIG_KEY]: JSON.stringify(CONFIG_DOCUMENT) });
  const variablesKV = createKV({ [VARIABLES_KEY]: JSON.stringify(VARIABLES_DOCUMENT) });
  return {
    INTERNAL_SHARED_SECRET: SECRET,
    CONFIG_KV: configKV,
    VARIABLES_KV: variablesKV,
    ...overrides,
  };
}

function authHeaders() {
  return { Authorization: `Bearer ${SECRET}` };
}

function createDOStub(status = 'completed') {
  return {
    idFromName: (name) => name,
    get: () => ({
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === '/status') {
          return Response.json({ status });
        }
        return Response.json({ status: 'started' }, { status: 202 });
      },
    }),
  };
}

section('Authentication');
await test('1.1 missing Authorization -> 401', async () => {
  const response = authenticateRequest(new Request('https://worker.test/'), { INTERNAL_SHARED_SECRET: SECRET });
  assert.equal(response.status, 401);
});
await test('1.2 wrong secret -> 401', async () => {
  const response = authenticateRequest(new Request('https://worker.test/', { headers: { Authorization: 'Bearer wrong' } }), { INTERNAL_SHARED_SECRET: SECRET });
  assert.equal(response.status, 401);
});
await test('1.3 missing configured secret -> 401', async () => {
  const response = authenticateRequest(new Request('https://worker.test/', { headers: authHeaders() }), {});
  assert.equal(response.status, 401);
});
await test('1.4 correct secret -> null', async () => {
  const response = authenticateRequest(new Request('https://worker.test/', { headers: authHeaders() }), { INTERNAL_SHARED_SECRET: SECRET });
  assert.equal(response, null);
});
await test('1.5 unauthenticated request does not read KV', async () => {
  const env = createEnv();
  const response = await worker.fetch(new Request('https://worker.test/status/abc'), env, {});
  assert.equal(response.status, 401);
  assert.equal(env.CONFIG_KV.stats.reads, 0);
  assert.equal(env.VARIABLES_KV.stats.reads, 0);
});

section('Download URL');
await test('2.1 configured WORKER_URL wins over origin', async () => {
  assert.equal(buildDownloadUrl('https://hostile.test', 'u', { WORKER_URL: 'https://worker.test' }), 'https://worker.test/download/u');
});
await test('2.2 request origin is used when WORKER_URL is empty', async () => {
  assert.equal(buildDownloadUrl('https://origin.test', 'u', {}), 'https://origin.test/download/u');
});
await test('2.3 no origin and no WORKER_URL -> null', async () => {
  assert.equal(buildDownloadUrl('', 'u', {}), null);
});

section('Layer options');
await test('3.1 variables are mapped to layer options', async () => {
  assert.deepEqual(layerOptionsFromVariables({
    MUP_KEY_IDEAS: 'ideas',
    DEFAULT_STICKER_CATEGORY: 'unknown',
    DEFAULT_REF_TYPE: 'web_page',
    URL_REGEX_PATTERN: 'https?://\\S+',
  }), {
    ideasKey: 'ideas',
    stickerCategory: 'unknown',
    defaultRefType: 'web_page',
    urlRegexPattern: 'https?://\\S+',
  });
});

section('Configuration');
await test('4.1 valid configuration loads', async () => {
  const env = createEnv();
  const config = await loadConfig(env);
  assert.equal(config.maxUploadBytes, CONFIG_DOCUMENT.maxUploadBytes);
});
await test('4.2 valid variables load', async () => {
  const env = createEnv();
  const variables = await loadVariables(env);
  assert.equal(variables.BINDING_R2, 'MMUP_BUCKET');
});
await test('4.3 missing binding throws an explicit error', async () => {
  await assert.rejects(() => loadConfig({}), /CONFIG_KV/);
});
await test('4.4 missing key throws an explicit error', async () => {
  await assert.rejects(() => loadConfig({ CONFIG_KV: createKV({}) }), /app-config/);
});
await test('4.5 invalid JSON throws an explicit error', async () => {
  await assert.rejects(() => loadConfig({ CONFIG_KV: createKV({ [CONFIG_KEY]: '{bad' }) }), /JSON válido/);
});
await test('4.6 missing required key throws an explicit error', async () => {
  const invalid = { ...CONFIG_DOCUMENT };
  delete invalid.maxUploadBytes;
  await assert.rejects(() => loadConfig({ CONFIG_KV: createKV({ [CONFIG_KEY]: JSON.stringify(invalid) }) }), /maxUploadBytes/);
});

section('Validators');
await test('5.1 injected minimum and maximum are enforced', async () => {
  const file = new File(['x'.repeat(2048)], 'map.mup', { type: 'application/json' });
  assert.equal(validateFile(file, { minUploadBytes: 1024, maxUploadBytes: 4096 }), null);
  assert.match(validateFile(file, { minUploadBytes: 4096, maxUploadBytes: 8192 }), /demasiado pequeño/);
  assert.match(validateFile(file, { minUploadBytes: 1024, maxUploadBytes: 1024 }), /tamaño máximo/);
});
await test('5.2 content length is checked against the injected limit', async () => {
  const request = new Request('https://worker.test/convertir', { headers: { 'Content-Length': '2048' } });
  assert.match(validateContentLength(request, 1024), /tamaño máximo/);
  assert.equal(validateContentLength(request, 4096), null);
});
await test('5.3 file size is checked against the injected limit', async () => {
  const file = new File(['x'.repeat(2048)], 'map.mup');
  assert.match(validateFileSize(file, 1024), /tamaño máximo/);
  assert.equal(validateFileSize(file, 4096), null);
});
await test('5.4 UUID validation', async () => {
  assert.equal(isValidUUID(generateUUID()), true);
  assert.equal(isValidUUID('not-a-uuid'), false);
});

section('Durable Object');
await test('6.1 unknown route -> 404', async () => {
  const state = { storage: { async get() { return null; }, async put() {} } };
  const response = await new MupConverter(state, createEnv()).fetch(new Request('https://do.test/unknown'));
  assert.equal(response.status, 404);
});
await test('6.2 status defaults to unknown', async () => {
  const state = { storage: { async get() { return null; }, async put() {} } };
  const response = await new MupConverter(state, createEnv()).fetch(new Request('https://do.test/status'));
  assert.deepEqual(await response.json(), { status: 'unknown' });
});
const MUP_TEXT = JSON.stringify({
  formatVersion: 3,
  id: 'mode-test',
  title: 'Mode test',
  ideas: { '1': { id: 'root', title: 'Root', attr: {} } },
});

function createR2() {
  const puts = [];
  const deletes = [];
  return {
    puts,
    deletes,
    async get() { return { async text() { return MUP_TEXT; } }; },
    async put(key, body, options) { puts.push({ key, body, options }); },
    async delete(key) { deletes.push(key); },
  };
}

await test('6.3 convert returns 202 and schedules the pipeline', async () => {
  let scheduled = false;
  const state = {
    storage: { async get() { return null; }, async put() {} },
    waitUntil(promise) { scheduled = true; promise.catch(() => {}); },
  };
  const request = new Request('https://do.test/convertir', {
    method: 'POST',
    body: JSON.stringify({ uuid: generateUUID(), filename: 'map.mup', origin: 'https://origin.test' }),
    headers: { 'Content-Type': 'application/json' },
  });
  const converter = new MupConverter(state, createEnv());
  converter.convert = async () => true;
  const response = await converter.fetch(request);
  assert.equal(response.status, 202);
  assert.equal(scheduled, true);
});

await test('6.4 catalogue mode stores output under output/ and deletes the input', async () => {
  const uuid = generateUUID();
  const bucket = createR2();
  const state = { storage: { async get() { return null; }, async put() {} } };
  const converter = new MupConverter(state, createEnv({ MMUP_BUCKET: bucket }));
  await converter.convert(uuid, 'map.mup', 'https://origin.test', 'catalogue');
  assert.equal(bucket.puts[0].key, `output/${uuid}.json`);
  assert.deepEqual(bucket.deletes, [`input/${uuid}.mup`]);
});

await test('6.5 anonymous mode stores output under temp/ and deletes the input', async () => {
  const uuid = generateUUID();
  const bucket = createR2();
  const state = { storage: { async get() { return null; }, async put() {} } };
  const converter = new MupConverter(state, createEnv({ MMUP_BUCKET: bucket }));
  await converter.convert(uuid, 'map.mup', 'https://origin.test', 'anonymous');
  assert.equal(bucket.puts[0].key, `temp/${uuid}/output.json`);
  assert.deepEqual(bucket.deletes, [`temp/${uuid}.mup`]);
});

section('Worker router');
await test('7.1 status with a valid UUID -> 200', async () => {
  const env = createEnv({ MMUP_CONVERT_DO: createDOStub('completed') });
  const response = await worker.fetch(new Request(`https://worker.test/status/${generateUUID()}`, { headers: authHeaders() }), env, {});
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'completed');
});
await test('7.2 invalid download UUID -> 400', async () => {
  const env = createEnv({ MMUP_CONVERT_DO: createDOStub() });
  const response = await worker.fetch(new Request('https://worker.test/download/..%2Fnot-a-uuid', { headers: authHeaders() }), env, {});
  assert.equal(response.status, 400);
});
await test('7.3 unknown route -> 404', async () => {
  const env = createEnv({ MMUP_CONVERT_DO: createDOStub() });
  const response = await worker.fetch(new Request('https://worker.test/unknown', { headers: authHeaders() }), env, {});
  assert.equal(response.status, 404);
});
await test('7.4 convert with a non-multipart body -> 400', async () => {
  const env = createEnv({ MMUP_CONVERT_DO: createDOStub() });
  const response = await worker.fetch(new Request('https://worker.test/convertir', {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: '{}',
  }), env, {});
  assert.equal(response.status, 400);
});

console.log('\n' + '='.repeat(60));
console.log(`Resultados: ${passed}/${total} pasaron, ${failed} fallaron`);
if (failed > 0) {
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.error.stack}`);
  process.exit(1);
}
console.log('✅ Todos los tests unitarios del Worker pasaron.');
