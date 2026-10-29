/**
 * @module test-config
 * Tests for the public configuration Pages Function.
 */

import assert from 'node:assert/strict';
import { onRequestGet, buildPublicConfig } from '../../functions/api/config.js';
import { CONFIG_KEY } from '../../src/shared/config.js';

const BASE_CONFIG = {
  schemaVersion: 1,
  loginEnabled: false,
  catalogEnabled: true,
  loginUser: 'admin',
  sessionTtlMinutes: 1440,
  anonymousRetentionHours: 24,
  maxUploadBytes: 16777216,
  minUploadBytes: 1024,
  rateLimit: { windowSeconds: 600, maxRequestsPerWindow: 2, maxRequestsPerDay: 10, maxConcurrent: 1, appliesToAuthenticated: false },
  loginMaxAttempts: 5,
  loginWindowSeconds: 600,
  allowedOrigins: [],
  configCacheSeconds: 60,
  conversionTimeoutSeconds: 120,
  htmlCacheSeconds: 0,
};

let total = 0;
let passed = 0;
const failures = [];

async function test(name, fn) {
  total += 1;
  try {
    await fn();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`  ❌ ${name}: ${error.message}`);
  }
}

function createEnv(config = BASE_CONFIG) {
  return {
    CONFIG_KV: {
      async get(key) {
        return key === CONFIG_KEY ? JSON.stringify(config) : null;
      },
    },
  };
}

await test('anonymous mode exposes rate limits and disables the catalogue', async () => {
  const response = await onRequestGet({ env: createEnv() });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.mode, 'anonymous');
  assert.equal(body.loginEnabled, false);
  assert.equal(body.catalogEnabled, false);
  assert.equal(body.rateLimit.maxRequestsPerDay, 10);
});

await test('catalogue mode enables the catalogue and hides rate limits', async () => {
  const response = await onRequestGet({ env: createEnv({ ...BASE_CONFIG, loginEnabled: true }) });
  const body = await response.json();
  assert.equal(body.mode, 'catalogue');
  assert.equal(body.catalogEnabled, true);
  assert.equal(body.rateLimit, null);
});

await test('catalogue is forced off when login is disabled', async () => {
  const body = buildPublicConfig({ ...BASE_CONFIG, loginEnabled: false, catalogEnabled: true });
  assert.equal(body.catalogEnabled, false);
});

await test('sensitive fields are not exposed', async () => {
  const response = await onRequestGet({ env: createEnv({ ...BASE_CONFIG, loginEnabled: true }) });
  const body = await response.json();
  for (const key of ['loginUser', 'sessionTtlMinutes', 'loginMaxAttempts', 'loginWindowSeconds', 'allowedOrigins']) {
    assert.equal(key in body, false, `${key} should not be public`);
  }
});

await test('configuration failure returns 500 without internal details', async () => {
  const response = await onRequestGet({ env: {} });
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.equal(body.error, 'Configuración no disponible');
});

await test('response sets a short public cache', async () => {
  const response = await onRequestGet({ env: createEnv() });
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60');
});

console.log(`\nconfig function tests OK (${passed}/${total})`);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.error.stack);
  process.exit(1);
}
