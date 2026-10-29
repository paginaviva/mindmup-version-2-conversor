/**
 * @module test-html-toolbar
 * Unit tests for the download toolbar injected into the standalone HTML view.
 *
 * The module is pure: it reads a CSP nonce from headers and returns a string,
 * so the suite uses real `Headers` objects and plain-object doubles only. No
 * network or DOM is involved.
 *
 * Run from the project root with:
 *   node test/functions/test-html-toolbar.js
 */

import assert from 'node:assert/strict';

import { extractNonce, injectDownloadToolbar } from '../../functions/_lib/html-toolbar.js';

const UUID = '00000000-0000-4000-8000-000000000001';
const NONCE = 'abc123XYZ';
const BASE_HTML = '<!doctype html><html><body>ok</body></html>';

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

// ---------------------------------------------------------------------------
// 1. extractNonce
// ---------------------------------------------------------------------------
await test('extractNonce reads the nonce from a Headers instance (positivo)', async () => {
  // Arrange
  const headers = new Headers({
    'Content-Security-Policy': "default-src 'none'; script-src 'nonce-abc+/=_-123'",
  });

  // Act
  const nonce = extractNonce(headers);

  // Assert
  assert.equal(nonce, 'abc+/=_-123');
});

await test('extractNonce reads the nonce from a plain object with any header case (positivo)', async () => {
  // Arrange
  const lowerCaseHeaders = {
    'content-security-policy': "default-src 'none'; script-src 'nonce-plainNONCE'",
  };
  const mixedCaseHeaders = {
    'Content-Security-Policy': "default-src 'none'; script-src 'nonce-MixedCase'",
  };

  // Act
  const lowerNonce = extractNonce(lowerCaseHeaders);
  const mixedNonce = extractNonce(mixedCaseHeaders);

  // Assert
  assert.equal(lowerNonce, 'plainNONCE');
  assert.equal(mixedNonce, 'MixedCase');
});

await test('extractNonce returns an empty string without CSP or without a nonce (negativo)', async () => {
  // Arrange / Act / Assert
  assert.equal(extractNonce(null), '');
  assert.equal(extractNonce(undefined), '');
  assert.equal(extractNonce({}), '');
  assert.equal(
    extractNonce(new Headers({ 'Content-Security-Policy': "default-src 'none'" })),
    '',
  );
});

await test('extractNonce rejects malformed, unsafe or oversized nonces (negativo)', async () => {
  // Arrange
  const quotedNonce = {
    'Content-Security-Policy': "default-src 'none'; script-src 'nonce-abc\"def'",
  };
  const oversizedNonce = {
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${'a'.repeat(129)}'`,
  };

  // Act
  const quotedResult = extractNonce(quotedNonce);
  const oversizedResult = extractNonce(oversizedNonce);

  // Assert
  assert.equal(quotedResult, '');
  assert.equal(oversizedResult, '');
});

// ---------------------------------------------------------------------------
// 2. injectDownloadToolbar: placement
// ---------------------------------------------------------------------------
await test('injectDownloadToolbar inserts the toolbar immediately before the last closing body tag (positivo)', async () => {
  // Arrange
  const html = '<body>uno</body><body>dos</body>';

  // Act
  const result = injectDownloadToolbar(html, { uuid: UUID, mode: 'catalogue' });

  // Assert
  const firstBodyClose = result.indexOf('</body>');
  const secondBodyOpen = result.indexOf('<body>dos');
  const lastBodyClose = result.lastIndexOf('</body>');
  const toolbarIndex = result.indexOf('id="mmup-download-toolbar"');

  assert.ok(toolbarIndex > firstBodyClose, 'la barra no debe insertarse antes del primer cierre');
  assert.ok(toolbarIndex > secondBodyOpen, 'la barra debe quedar dentro del último body');
  assert.ok(toolbarIndex < lastBodyClose, 'la barra debe insertarse antes del último </body>');
  assert.equal(result.endsWith('</body>'), true);
});

await test('injectDownloadToolbar returns the HTML unchanged when there is no closing body tag (negativo)', async () => {
  // Arrange
  const html = '<html><body>sin cierre';

  // Act
  const result = injectDownloadToolbar(html, { uuid: UUID, mode: 'catalogue' });

  // Assert
  assert.equal(result, html);
});

// ---------------------------------------------------------------------------
// 3. injectDownloadToolbar: mode-dependent links
// ---------------------------------------------------------------------------
await test('catalogue mode offers both HTML and JSON downloads (positivo)', async () => {
  // Arrange
  const options = { uuid: UUID, mode: 'catalogue', nonce: NONCE };

  // Act
  const result = injectDownloadToolbar(BASE_HTML, options);

  // Assert
  assert.ok(result.includes('Descargar HTML'), 'falta el botón Descargar HTML');
  assert.ok(result.includes('Descargar JSON'), 'falta el botón Descargar JSON');
});

await test('anonymous mode offers only the HTML download (negativo)', async () => {
  // Arrange
  const options = { uuid: UUID, mode: 'anonymous', nonce: NONCE };

  // Act
  const result = injectDownloadToolbar(BASE_HTML, options);

  // Assert
  assert.ok(result.includes('Descargar HTML'), 'falta el botón Descargar HTML');
  assert.equal(result.includes('Descargar JSON'), false, 'anónimo no debe ofrecer JSON');
});

await test('the toolbar links point to the download endpoints for the UUID (positivo)', async () => {
  // Arrange
  const options = { uuid: UUID, mode: 'catalogue' };

  // Act
  const result = injectDownloadToolbar(BASE_HTML, options);

  // Assert
  assert.ok(
    result.includes(`/api/download-html/${UUID}`),
    'falta el enlace al ZIP de HTML',
  );
  assert.ok(
    result.includes(`/api/download/${UUID}`),
    'falta el enlace al JSON en modo catálogo',
  );
});

// ---------------------------------------------------------------------------
// 4. injectDownloadToolbar: inline script and nonce
// ---------------------------------------------------------------------------
await test('a valid nonce adds the inline script with the iframe guard (positivo)', async () => {
  // Arrange
  const options = { uuid: UUID, mode: 'catalogue', nonce: NONCE };

  // Act
  const result = injectDownloadToolbar(BASE_HTML, options);

  // Assert
  assert.ok(
    result.includes(`<script nonce="${NONCE}">`),
    'falta la etiqueta script con el nonce validado',
  );
  assert.ok(
    result.includes('window.self !== window.top'),
    'falta la comprobación para no duplicar la barra dentro de un iframe',
  );
});

await test('without a nonce the toolbar has no script (negativo)', async () => {
  // Arrange
  const options = { uuid: UUID, mode: 'anonymous' };

  // Act
  const result = injectDownloadToolbar(BASE_HTML, options);

  // Assert
  assert.equal(result.includes('<script'), false);
});

await test('an unsafe nonce is ignored and no script is injected (negativo)', async () => {
  // Arrange
  const options = { uuid: UUID, mode: 'catalogue', nonce: 'bad"nonce' };

  // Act
  const result = injectDownloadToolbar(BASE_HTML, options);

  // Assert
  assert.equal(result.includes('<script'), false);
  assert.equal(result.includes('bad"nonce'), false);
});

console.log(`\nhtml toolbar tests OK (${passed}/${total})`);
if (failures.length > 0) {
  for (const failure of failures) console.error(failure.error.stack);
  process.exit(1);
}
