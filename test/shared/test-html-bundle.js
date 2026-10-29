/**
 * @module test-html-bundle
 * Unit tests for the HTML bundle builder: resource extraction, URL rewriting,
 * remote URL safety and ZIP assembly.
 *
 * All remote fetches are replaced by a deterministic mock; the suite never
 * touches the network.
 *
 * Run from the project root with:
 *   node test/shared/test-html-bundle.js
 */

import assert from 'node:assert/strict';

import {
  buildHtmlBundle,
  extractAssetUrls,
  isSafeRemoteUrl,
  rewriteAssetUrls,
} from '../../src/shared/html-bundle.js';

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;

const textDecoder = new TextDecoder();

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

/**
 * Reads every entry from a ZIP produced by createZip.
 *
 * Uses the central directory to locate each local header, so entry names and
 * stored bytes are read exactly as a real ZIP reader would.
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

/**
 * Builds a fetch mock from a URL-to-handler map.
 *
 * @param {Record<string, () => Response>} handlers - Per-URL response factories.
 * @returns {{ fetchImpl: typeof fetch, calls: string[] }} Mock fetch and call log.
 */
function createFetchMock(handlers) {
  const calls = [];

  const fetchImpl = async (url) => {
    calls.push(String(url));
    const handler = handlers[String(url)];
    if (typeof handler !== 'function') {
      throw new Error(`fetch inesperado en el test: ${url}`);
    }
    return handler();
  };

  return { fetchImpl, calls };
}

// ---------------------------------------------------------------------------
// 1. extractAssetUrls
// ---------------------------------------------------------------------------
test('extractAssetUrls finds img, source, poster, link, image, srcset and CSS url()', () => {
  // Arrange
  const html = [
    '<img src="https://cdn.example.com/img/a.png">',
    '<source src="https://cdn.example.com/media/video.webm">',
    '<video poster="https://cdn.example.com/img/poster.jpg"></video>',
    '<link rel="stylesheet" href="https://cdn.example.com/css/app.css">',
    '<image href="https://cdn.example.com/svg/logo.svg"></image>',
    '<img srcset="https://cdn.example.com/img/a.png 1x, https://cdn.example.com/img/b.png 2x">',
    "<style>.hero{background:url('https://cdn.example.com/css/bg.png')}</style>",
    '<div style="background-image:url(https://cdn.example.com/css/inline.png)"></div>',
  ].join('\n');

  // Act
  const urls = extractAssetUrls(html);

  // Assert
  assert.deepEqual(urls, [
    'https://cdn.example.com/img/a.png',
    'https://cdn.example.com/media/video.webm',
    'https://cdn.example.com/img/poster.jpg',
    'https://cdn.example.com/css/app.css',
    'https://cdn.example.com/svg/logo.svg',
    'https://cdn.example.com/img/b.png',
    'https://cdn.example.com/css/bg.png',
    'https://cdn.example.com/css/inline.png',
  ]);
});

test('extractAssetUrls ignores navigation links and non-remote schemes (negativo)', () => {
  // Arrange
  const html = [
    '<a href="https://example.com/page">navegación</a>',
    '<img src="data:image/png;base64,AAA">',
    '<img src="blob:https://example.com/0000">',
    '<img src="images/local.png">',
    '<img src="/absolute/local.png">',
    '<img src="//cdn.example.com/protocol-relative.png">',
    '<img src="mailto:someone@example.com">',
    '<img src="javascript:alert(1)">',
    '<img src="#fragment">',
  ].join('\n');

  // Act
  const urls = extractAssetUrls(html);

  // Assert
  assert.deepEqual(urls, []);
});

test('extractAssetUrls ignores commented-out resources (negativo)', () => {
  // Arrange
  const html = [
    '<!-- <img src="https://cdn.example.com/commented.png"> -->',
    '<!-- <style>.x{background:url("https://cdn.example.com/hidden.png")}</style> -->',
    '<img src="https://cdn.example.com/real.png">',
  ].join('\n');

  // Act
  const urls = extractAssetUrls(html);

  // Assert
  assert.deepEqual(urls, ['https://cdn.example.com/real.png']);
});

test('extractAssetUrls returns unique URLs in document order', () => {
  // Arrange
  const html = [
    '<img src="https://cdn.example.com/a.png">',
    '<img src="https://cdn.example.com/a.png">',
    '<img src="https://cdn.example.com/b.png">',
  ].join('\n');

  // Act
  const urls = extractAssetUrls(html);

  // Assert
  assert.deepEqual(urls, [
    'https://cdn.example.com/a.png',
    'https://cdn.example.com/b.png',
  ]);
});

test('extractAssetUrls returns an empty array for empty or invalid input (negativo)', () => {
  assert.deepEqual(extractAssetUrls(''), []);
  assert.deepEqual(extractAssetUrls(null), []);
  assert.deepEqual(extractAssetUrls(undefined), []);
});

// ---------------------------------------------------------------------------
// 2. rewriteAssetUrls
// ---------------------------------------------------------------------------
test('rewriteAssetUrls rewrites mapped resources and preserves quoting', () => {
  // Arrange
  const original = 'https://cdn.example.com/a.png';
  const mapping = new Map([[original, 'mapa_archivos/asset-001.png']]);
  const html = [
    `<img src="${original}">`,
    `<img srcset="${original} 1x">`,
    `<a href="${original}">enlace</a>`,
    `<div style="background:url('${original}')"></div>`,
  ].join('\n');

  // Act
  const rewritten = rewriteAssetUrls(html, mapping);

  // Assert
  assert.ok(
    rewritten.includes('<img src="mapa_archivos/asset-001.png">'),
    'img[src] no se reescribió',
  );
  assert.ok(
    rewritten.includes("<div style=\"background:url('mapa_archivos/asset-001.png')\"></div>"),
    'la url() de CSS no se reescribió conservando las comillas',
  );
  assert.ok(
    rewritten.includes(`<a href="${original}">enlace</a>`),
    'el enlace de navegación no debe reescribirse',
  );
});

test('rewriteAssetUrls leaves unknown URLs untouched (negativo)', () => {
  const html = '<img src="https://cdn.example.com/other.png">';
  const mapping = new Map([['https://cdn.example.com/a.png', 'mapa_archivos/asset-001.png']]);

  assert.equal(rewriteAssetUrls(html, mapping), html);
});

test('rewriteAssetUrls returns the input when the mapping is empty (negativo)', () => {
  const html = '<img src="https://cdn.example.com/a.png">';

  assert.equal(rewriteAssetUrls(html, new Map()), html);
  assert.equal(rewriteAssetUrls(html, null), html);
  assert.equal(rewriteAssetUrls('', new Map([['a', 'b']])), '');
});

// ---------------------------------------------------------------------------
// 3. isSafeRemoteUrl
// ---------------------------------------------------------------------------
test('isSafeRemoteUrl blocks localhost, metadata and private ranges (negativo)', () => {
  const blocked = [
    'http://localhost/x.png',
    'http://localhost.localdomain/x',
    'http://foo.local/x',
    'http://127.0.0.1/x.png',
    'http://127.1.2.3/x',
    'http://10.0.0.5/x',
    'http://172.16.4.4/x',
    'http://192.168.1.10/x',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/x',
    'http://metadata.google.internal/computeMetadata/v1/',
    'http://metadata.goog/',
    'http://instance-data/',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'http://[fe80::1]/x',
  ];

  for (const url of blocked) {
    assert.equal(isSafeRemoteUrl(url), false, `debería bloquear ${url}`);
  }
});

test('isSafeRemoteUrl rejects non-http protocols and malformed values (negativo)', () => {
  for (const url of [
    'ftp://cdn.example.com/x.png',
    'data:image/png;base64,AAA',
    'javascript:alert(1)',
    'mailto:someone@example.com',
    'no es una url',
    '',
  ]) {
    assert.equal(isSafeRemoteUrl(url), false, `debería rechazar ${url}`);
  }

  assert.equal(isSafeRemoteUrl(null), false);
  assert.equal(isSafeRemoteUrl(undefined), false);
  assert.equal(isSafeRemoteUrl(42), false);
});

test('isSafeRemoteUrl accepts public HTTP and HTTPS hosts (positivo)', () => {
  for (const url of [
    'https://cdn.example.com/img/foto.png',
    'http://example.com/',
    'https://sub.example.co.uk/assets/logo.svg',
    'https://8.8.8.8/x',
    'https://[2606:4700:4700::1111]/x',
  ]) {
    assert.equal(isSafeRemoteUrl(url), true, `debería aceptar ${url}`);
  }
});

// ---------------------------------------------------------------------------
// 4. buildHtmlBundle: happy path
// ---------------------------------------------------------------------------
test('buildHtmlBundle rewrites the resource and ships HTML plus asset in the ZIP', async () => {
  // Arrange
  const url = 'https://cdn.example.com/img/foto.png';
  const assetBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const html = `<!doctype html><html><body><img src="${url}" alt="foto"></body></html>`;
  const { fetchImpl, calls } = createFetchMock({
    [url]: () => new Response(assetBytes, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
  });

  // Act
  const result = await buildHtmlBundle(html, { baseName: 'mapa', fetchImpl });
  const entries = readZipEntries(result.zip);
  const htmlEntry = entries.find((entry) => entry.name === 'mapa.html');
  const assetEntry = entries.find((entry) => entry.name === 'mapa_archivos/asset-001.png');

  // Assert
  assert.deepEqual(calls, [url], 'debe descargarse exactamente una vez el recurso');
  assert.equal(result.baseName, 'mapa');
  assert.equal(result.assetCount, 1);
  assert.deepEqual(result.missing, []);
  assert.ok(htmlEntry, 'el ZIP debe contener mapa.html');
  assert.ok(assetEntry, 'el ZIP debe contener mapa_archivos/asset-001.png');
  assert.deepEqual([...assetEntry.data], [...assetBytes]);
  assert.ok(
    htmlEntry.text().includes('src="mapa_archivos/asset-001.png"'),
    'el HTML debe apuntar a la ruta relativa',
  );
  assert.equal(htmlEntry.text().includes(url), false, 'la URL original no debe quedar en el HTML');
});

test('buildHtmlBundle does not add faltantes.txt when everything succeeds (positivo)', async () => {
  // Arrange
  const url = 'https://cdn.example.com/img/ok.png';
  const html = `<img src="${url}">`;
  const { fetchImpl } = createFetchMock({
    [url]: () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
  });

  // Act
  const result = await buildHtmlBundle(html, { baseName: 'mapa', fetchImpl });
  const names = readZipEntries(result.zip).map((entry) => entry.name);

  // Assert
  assert.deepEqual(names.sort(), ['mapa.html', 'mapa_archivos/asset-001.png'].sort());
  assert.equal(names.includes('faltantes.txt'), false);
});

test('buildHtmlBundle handles an HTML without remote resources (positivo)', async () => {
  // Arrange
  const html = [
    '<!doctype html><html><body>',
    '<img src="data:image/png;base64,AAA">',
    '<a href="https://example.com/page">enlace</a>',
    '</body></html>',
  ].join('');
  const { fetchImpl, calls } = createFetchMock({});

  // Act
  const result = await buildHtmlBundle(html, { baseName: 'mapa', fetchImpl });
  const entries = readZipEntries(result.zip);

  // Assert
  assert.deepEqual(calls, [], 'no debe descargarse nada');
  assert.equal(result.assetCount, 0);
  assert.deepEqual(result.missing, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].name, 'mapa.html');
  assert.equal(entries[0].text(), html);
});

// ---------------------------------------------------------------------------
// 5. buildHtmlBundle: missing resources
// ---------------------------------------------------------------------------
test('buildHtmlBundle reports a failed resource, keeps its URL and adds faltantes.txt', async () => {
  // Arrange
  const goodUrl = 'https://cdn.example.com/img/good.png';
  const badUrl = 'https://cdn.example.com/img/broken.png';
  const html = `<img src="${goodUrl}"><img src="${badUrl}">`;
  const { fetchImpl } = createFetchMock({
    [goodUrl]: () => new Response(new Uint8Array([9, 9]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }),
    [badUrl]: () => new Response('not found', { status: 404 }),
  });

  // Act
  const result = await buildHtmlBundle(html, { baseName: 'mapa', fetchImpl });
  const entries = readZipEntries(result.zip);
  const htmlEntry = entries.find((entry) => entry.name === 'mapa.html');
  const missingEntry = entries.find((entry) => entry.name === 'faltantes.txt');

  // Assert
  assert.equal(result.assetCount, 1);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].url, badUrl);
  assert.match(result.missing[0].reason, /404/);
  assert.ok(htmlEntry, 'el HTML debe estar en el ZIP');
  assert.ok(missingEntry, 'el ZIP debe incluir faltantes.txt');
  assert.ok(
    htmlEntry.text().includes(badUrl),
    'la URL del recurso fallido debe conservarse',
  );
  assert.ok(
    htmlEntry.text().includes('mapa_archivos/asset-001.png'),
    'el recurso correcto debe reescribirse igualmente',
  );
  assert.ok(
    missingEntry.text().includes(badUrl),
    'faltantes.txt debe listar la URL que falló',
  );
});

test('buildHtmlBundle counts unsafe URLs as missing without fetching them (negativo)', async () => {
  // Arrange
  const unsafeUrl = 'http://127.0.0.1/x.png';
  const html = `<img src="${unsafeUrl}">`;
  const { fetchImpl, calls } = createFetchMock({});

  // Act
  const result = await buildHtmlBundle(html, { baseName: 'mapa', fetchImpl });
  const names = readZipEntries(result.zip).map((entry) => entry.name);

  // Assert
  assert.deepEqual(calls, [], 'una URL no segura no debe llegar a fetch');
  assert.equal(result.assetCount, 0);
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0].url, unsafeUrl);
  assert.match(result.missing[0].reason, /no segura/);
  assert.ok(names.includes('faltantes.txt'));
});

// ---------------------------------------------------------------------------
// 6. buildHtmlBundle: invalid input
// ---------------------------------------------------------------------------
test('buildHtmlBundle rejects a non-string HTML (negativo)', async () => {
  await assert.rejects(
    () => buildHtmlBundle(null, { baseName: 'mapa', fetchImpl: async () => new Response('') }),
    /html must be a string/,
  );
});

test('buildHtmlBundle rejects a missing or invalid baseName (negativo)', async () => {
  const fetchImpl = async () => new Response('');

  await assert.rejects(
    () => buildHtmlBundle('<p>x</p>', { fetchImpl }),
    /baseName/,
  );
  await assert.rejects(
    () => buildHtmlBundle('<p>x</p>', { baseName: '   ', fetchImpl }),
    /baseName/,
  );
  await assert.rejects(
    () => buildHtmlBundle('<p>x</p>', { baseName: 42, fetchImpl }),
    /baseName/,
  );
});

test('buildHtmlBundle rejects a missing fetch implementation (negativo)', async () => {
  const originalFetch = globalThis.fetch;

  try {
    globalThis.fetch = undefined;
    await assert.rejects(
      () => buildHtmlBundle('<p>x</p>', { baseName: 'mapa' }),
      /fetchImpl/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
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

console.log(`shared html-bundle tests OK (${passed}/${tests.length})`);
