/**
 * Smoke tests for the shared configuration loader and injected validation
 * limits.
 *
 * Run from the project root with:
 *   node test/shared/test-config.js
 */

import assert from 'node:assert/strict';

import {
  CONFIG_KEY,
  VARIABLES_KEY,
  loadConfig,
  loadVariables,
  validateConfig,
  validateVariables,
} from '../../src/shared/config.js';
import {
  validateContentLength,
  validateFile,
  validateFileSize,
} from '../../src/shared/validator.js';

/**
 * Minimal in-memory KV namespace mock.
 *
 * @param {Record<string, string>} entries - Raw key/value pairs.
 * @returns {{get: (key: string) => Promise<string|null>}} KV-like binding.
 */
function createKv(entries = {}) {
  return {
    async get(key) {
      return Object.prototype.hasOwnProperty.call(entries, key) ? entries[key] : null;
    },
  };
}

/**
 * Valid configuration document using the 15 required keys.
 *
 * @type {Object}
 */
const validConfig = {
  schemaVersion: 1,
  loginEnabled: false,
  catalogEnabled: false,
  loginUser: '',
  sessionTtlMinutes: 1440,
  anonymousRetentionHours: 24,
  maxUploadBytes: 16777216,
  minUploadBytes: 1024,
  rateLimit: {
    windowSeconds: 600,
    maxRequestsPerWindow: 2,
    maxRequestsPerDay: 10,
    maxConcurrent: 1,
    appliesToAuthenticated: false,
  },
  loginMaxAttempts: 5,
  loginWindowSeconds: 600,
  allowedOrigins: [],
  configCacheSeconds: 60,
  conversionTimeoutSeconds: 120,
  htmlCacheSeconds: 0,
};

/**
 * Valid variables document mirroring `config.variables.example.json`.
 *
 * @type {Object}
 */
const validVariables = {
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

const tests = [];

/**
 * Registers a test case.
 *
 * @param {string} name - Test name.
 * @param {() => void|Promise<void>} fn - Test body.
 * @returns {void}
 */
function test(name, fn) {
  tests.push({ name, fn });
}

test('loadConfig returns the app-config document', async () => {
  const config = await loadConfig({
    CONFIG_KV: createKv({ [CONFIG_KEY]: JSON.stringify(validConfig) }),
  });

  assert.deepEqual(config, validConfig);
  assert.equal(CONFIG_KEY, 'app-config');
});

test('loadConfig fails explicitly when the KV key is missing', async () => {
  await assert.rejects(
    () => loadConfig({ CONFIG_KV: createKv() }),
    (error) => error instanceof Error
      && error.message.includes(CONFIG_KEY)
      && error.message.includes('CONFIG_KV'),
  );
});

test('loadConfig fails explicitly when the binding is missing', async () => {
  await assert.rejects(() => loadConfig({}), /CONFIG_KV/);
});

test('loadConfig fails explicitly on invalid JSON', async () => {
  await assert.rejects(
    () => loadConfig({ CONFIG_KV: createKv({ [CONFIG_KEY]: '{invalid' }) }),
    /JSON válido/,
  );
});

test('loadConfig names a missing required key', async () => {
  const { loginEnabled, ...incompleteConfig } = validConfig;

  await assert.rejects(
    () => loadConfig({ CONFIG_KV: createKv({ [CONFIG_KEY]: JSON.stringify(incompleteConfig) }) }),
    /loginEnabled/,
  );
});

test('loadConfig names a key with the wrong type', async () => {
  const wrongType = { ...validConfig, loginEnabled: 'false' };

  await assert.rejects(
    () => loadConfig({ CONFIG_KV: createKv({ [CONFIG_KEY]: JSON.stringify(wrongType) }) }),
    (error) => error instanceof Error
      && error.message.includes('loginEnabled')
      && error.message.includes('boolean'),
  );
});

test('validateConfig rejects an invalid schemaVersion', () => {
  assert.throws(
    () => validateConfig({ ...validConfig, schemaVersion: 0 }),
    /schemaVersion/,
  );
});

test('validateVariables accepts the variables example schema', () => {
  assert.deepEqual(validateVariables(validVariables), validVariables);
});

test('validateVariables names a missing converter section', () => {
  const { converter, ...withoutConverter } = validVariables;

  assert.throws(
    () => validateVariables(withoutConverter),
    /falta la sección "converter"/,
  );
});

test('validateVariables names a missing visualizer section', () => {
  const { visualizer, ...withoutVisualizer } = validVariables;

  assert.throws(
    () => validateVariables(withoutVisualizer),
    /falta la sección "visualizer"/,
  );
});

test('validateVariables rejects a non-object converter section', () => {
  const invalid = { ...validVariables, converter: [] };

  assert.throws(
    () => validateVariables(invalid),
    /la sección "converter" debe ser un objeto JSON/,
  );
});

test('validateVariables names a missing converter key', () => {
  const { API_PATH_CONVERT, ...incompleteConverter } = validVariables.converter;
  const invalid = {
    ...validVariables,
    converter: incompleteConverter,
  };

  assert.throws(
    () => validateVariables(invalid),
    /converter\.API_PATH_CONVERT/,
  );
});

test('validateVariables names a converter key with the wrong type', () => {
  const invalid = {
    ...validVariables,
    converter: { ...validVariables.converter, HTTP_OK: '200' },
  };

  assert.throws(
    () => validateVariables(invalid),
    (error) => error instanceof Error
      && error.message.includes('converter.HTTP_OK')
      && error.message.includes('number'),
  );
});

test('validateVariables rejects a non-array allowedOrigins', () => {
  const invalid = {
    ...validVariables,
    visualizer: { ...validVariables.visualizer, allowedOrigins: 'https://example.com' },
  };

  assert.throws(
    () => validateVariables(invalid),
    /visualizer\.allowedOrigins.*array de cadenas/,
  );
});

test('validateVariables rejects allowedOrigins with non-string entries', () => {
  const invalid = {
    ...validVariables,
    visualizer: { ...validVariables.visualizer, allowedOrigins: ['https://example.com', 42] },
  };

  assert.throws(
    () => validateVariables(invalid),
    /visualizer\.allowedOrigins.*array de cadenas/,
  );
});

test('loadVariables returns a flattened converter view', async () => {
  const loaded = await loadVariables({
    VARIABLES_KV: createKv({ [VARIABLES_KEY]: JSON.stringify(validVariables) }),
  });

  assert.equal(loaded.schemaVersion, validVariables.schemaVersion);
  assert.equal(loaded.API_PATH_CONVERT, validVariables.converter.API_PATH_CONVERT);
  assert.equal(loaded.HTTP_NOT_FOUND, validVariables.converter.HTTP_NOT_FOUND);
  assert.deepEqual(loaded.visualizer, validVariables.visualizer);
  assert.equal(Object.hasOwn(loaded, 'converter'), false);
  assert.equal(VARIABLES_KEY, 'app-variables');
});

test('loadVariables fails explicitly when a variables section is missing', async () => {
  const { converter, ...withoutConverter } = validVariables;

  await assert.rejects(
    () => loadVariables({
      VARIABLES_KV: createKv({ [VARIABLES_KEY]: JSON.stringify(withoutConverter) }),
    }),
    /falta la sección "converter"/,
  );
});

test('loadVariables fails explicitly when the KV key is missing', async () => {
  await assert.rejects(
    () => loadVariables({ VARIABLES_KV: createKv() }),
    (error) => error instanceof Error && error.message.includes(VARIABLES_KEY),
  );
});

test('validateFile uses injected minimum and maximum limits', () => {
  const limits = { minUploadBytes: 1024, maxUploadBytes: 4096 };

  assert.equal(validateFile(null), 'No se envió ningún archivo');
  assert.equal(validateFile({ name: 'map.mup', size: 1024 }, limits), null);
  assert.match(
    validateFile({ name: 'map.mup', size: 1023 }, limits),
    /mínimo 1 KB/,
  );
  assert.match(
    validateFile({ name: 'map.mup', size: 4097 }, limits),
    /máximo permitido \(4 KB\)/,
  );
});

test('validateFile requires injected limits instead of defaults', () => {
  assert.throws(
    () => validateFile({ name: 'map.mup', size: 2048 }),
    /minUploadBytes/,
  );
});

test('validateContentLength and validateFileSize use the injected maximum', () => {
  const request = { headers: new Headers({ 'Content-Length': '2049' }) };

  assert.match(validateContentLength(request, 2048), /tamaño máximo permitido/);
  assert.equal(validateFileSize({ name: 'map.mup', size: 2048 }, 2048), null);
  assert.match(validateFileSize({ name: 'map.mup', size: 2049 }, 2048), /máximo permitido/);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`shared smoke tests OK (${passed}/${tests.length})`);
