/**
 * @module test-download-html
 * Tests for the HTML ZIP download Pages Function.
 *
 * The visualizer is always mocked and the bundle never reaches the network:
 * fixture HTML either has no remote resources or only unsafe ones, which are
 * rejected before any fetch happens.
 *
 * Run from the project root with:
 *   node test/functions/test-download-html.js
 */

import assert from 'node:assert/strict';

import { onRequestGet as downloadHtmlGet } from '../../functions/api/download-html/[uuid].js';
import { buildSessionRecord, generateSessionId, sessionKey, SESSION_COOKIE_NAME } from '../../src/shared/session.js';
import { CONFIG_KEY, VARIABLES_KEY } from '../../src/shared/config.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const textDecoder = new TextDecoder();
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
    request: new Request(`https://pages.test/api/download-html/${uuid}`, {
      headers: sessionId ? { Cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } : {},
    }),
  };
}

function envWith({ config = CONFIG, sessionId, visualizer } = {}) {
  const sessions = sessionId
    ? { [sessionKey(sessionId)]: JSON.stringify(buildSessionRecord({ user: 'admin', ttlSeconds: 3600 })) }
    : {};
  return {
    CONFIG_KV: createKV(config, sessions),
    VARIABLES_KV: createKV(config),
    MMUP_BUCKET: undefined,
    VISUALIZER: visualizer,
    INTERNAL_SHARED_SECRET: 'secret',
  };
}

function createVisualizer(html) {
  return { async fetch() { return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }); } };
}

/**
 * Reads every entry from a ZIP produced by createZip.
 *
 * Walks the central directory so entry names and stored bytes are read exactly
 * as a real ZIP reader would, without adding a dependency.
 *
 * @param {Uint8Array} zip - ZIP archive.
 * @returns {Array<{ name: string, data: Uint8Array, text: () => string }>} Entries.
 */
function readZipEntries(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocdOffset = zip.length - 22;
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);

  const entries = [];

  for (let index = 0; index < totalEntries; index += 1) {
    assert.equal(
      view.getUint32(offset, true),
      CENTRAL_DIRECTORY_SIGNATURE,
      'el directorio central tiene una firma inesperada',
    );

    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = textDecoder.decode(zip.subarray(offset + 46, offset + 46 + nameLength));

    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const size = view.getUint32(localOffset + 18, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = zip.subarray(dataStart, dataStart + size);

    entries.push({ name, data, text: () => textDecoder.decode(data) });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

await test('download-html rejects an invalid UUID with 400', async () => {
  // Arrange
  const context = ctx({ env: envWith(), uuid: '../bad' });

  // Act
  const response = await downloadHtmlGet(context);

  // Assert
  assert.equal(response.status, 400);
});

await test('download-html requires a session in catalogue mode', async () => {
  // Arrange
  const visualizer = createVisualizer('<!doctype html><p>mapa</p>');
  const context = ctx({ env: envWith({ visualizer }) });

  // Act
  const response = await downloadHtmlGet(context);

  // Assert
  assert.equal(response.status, 401);
});

await test('download-html returns a ZIP with the expected headers for a session', async () => {
  // Arrange
  const sessionId = generateSessionId();
  const visualizer = createVisualizer('<!doctype html><html><body><p>mapa</p></body></html>');
  const context = ctx({ env: envWith({ sessionId, visualizer }), sessionId });

  // Act
  const response = await downloadHtmlGet(context);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Assert
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.equal(response.headers.get('Content-Disposition'), `attachment; filename="${UUID}.zip"`);
  assert.equal(response.headers.get('X-MMUP-Missing-Count'), '0');
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual([...bytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], 'la firma PK\\x03\\x04 falta');
});

await test('download-html packages the clean HTML without the toolbar', async () => {
  // Arrange
  const sessionId = generateSessionId();
  const visualizer = createVisualizer('<!doctype html><html><body><p>mapa</p></body></html>');
  const context = ctx({ env: envWith({ sessionId, visualizer }), sessionId });

  // Act
  const response = await downloadHtmlGet(context);
  const zip = new Uint8Array(await response.arrayBuffer());
  const entries = readZipEntries(zip);
  const htmlEntry = entries.find((entry) => entry.name.endsWith('.html'));

  // Assert
  assert.equal(response.status, 200);
  assert.ok(htmlEntry, 'el ZIP debe contener el HTML empaquetado');
  assert.equal(
    htmlEntry.text().includes('mmup-download-toolbar'),
    false,
    'el HTML del ZIP no debe incluir la barra de descargas',
  );
  assert.equal(
    htmlEntry.text().includes('Descargar HTML'),
    false,
    'el HTML del ZIP no debe incluir los botones de descarga',
  );
});

await test('download-html counts an unsafe resource as missing', async () => {
  // Arrange
  const sessionId = generateSessionId();
  const visualizer = createVisualizer('<!doctype html><html><body><img src="http://127.0.0.1/x.png"></body></html>');
  const context = ctx({ env: envWith({ sessionId, visualizer }), sessionId });

  // Act
  const response = await downloadHtmlGet(context);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const missingCount = Number.parseInt(response.headers.get('X-MMUP-Missing-Count'), 10);

  // Assert
  assert.equal(response.status, 200);
  assert.ok(missingCount > 0, 'X-MMUP-Missing-Count debería ser mayor que cero');
  assert.ok(
    Buffer.from(bytes).includes('faltantes.txt'),
    'el ZIP debería incluir faltantes.txt',
  );
});

await test('download-html still returns 200 and the ZIP signature without resources', async () => {
  // Arrange
  const sessionId = generateSessionId();
  const visualizer = createVisualizer('<!doctype html><html><body><img src="data:image/png;base64,AAA"></body></html>');
  const context = ctx({ env: envWith({ sessionId, visualizer }), sessionId });

  // Act
  const response = await downloadHtmlGet(context);
  const bytes = new Uint8Array(await response.arrayBuffer());

  // Assert
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-MMUP-Missing-Count'), '0');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

console.log(`\ndownload-html function tests OK (${passed}/${total})`);
if (failures.length > 0) { for (const failure of failures) console.error(failure.error.stack); process.exit(1); }
