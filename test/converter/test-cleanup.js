/**
 * @module test-cleanup
 * Tests for the scheduled temp/ cleanup.
 */

import assert from 'node:assert/strict';
import { cleanupTemp } from '../../src/converter/index.js';
import { CONFIG_KEY, VARIABLES_KEY } from '../../src/shared/config.js';

const CONFIG = {
  schemaVersion: 1, loginEnabled: false, catalogEnabled: false, loginUser: '',
  sessionTtlMinutes: 1440, anonymousRetentionHours: 24, maxUploadBytes: 16777216, minUploadBytes: 1024,
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

function createKV() {
  return {
    async get(key) {
      if (key === CONFIG_KEY) return JSON.stringify(CONFIG);
      if (key === VARIABLES_KEY) return JSON.stringify(VARIABLES);
      return null;
    },
  };
}

function createBucket(objects) {
  const deletes = [];
  return {
    deletes,
    async list() { return { objects, truncated: false }; },
    async delete(key) { deletes.push(key); },
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('deletes temp objects older than the retention period', async () => {
  const oldDate = new Date(Date.now() - 25 * 3600 * 1000);
  const newDate = new Date(Date.now() - 1 * 3600 * 1000);
  const bucket = createBucket([
    { key: 'temp/old.json', uploaded: oldDate },
    { key: 'temp/new.json', uploaded: newDate },
  ]);
  const result = await cleanupTemp({ CONFIG_KV: createKV(), VARIABLES_KV: createKV(), MMUP_BUCKET: bucket });
  assert.deepEqual(result, { deleted: 1, scanned: 2 });
  assert.deepEqual(bucket.deletes, ['temp/old.json']);
});

test('missing bucket returns an empty summary without throwing', async () => {
  const result = await cleanupTemp({ CONFIG_KV: createKV(), VARIABLES_KV: createKV() });
  assert.deepEqual(result, { deleted: 0, scanned: 0 });
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    passed += 1;
    console.log(`  ✅ ${entry.name}`);
  } catch (error) {
    console.error(`  ❌ ${entry.name}: ${error.message}`);
    process.exitCode = 1;
  }
}
console.log(`\ncleanup tests OK (${passed}/${tests.length})`);
