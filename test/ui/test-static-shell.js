/**
 * @module test-static-shell
 * Comprueba el shell estático del conversor: app/index.html, app/app.js,
 * app/_headers y app/_routes.json.
 *
 * Ejecutar: node test/ui/test-static-shell.js
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'app');

const REQUIRED_IDS = [
  'login-view',
  'login-form',
  'login-user',
  'login-password',
  'login-error',
  'content-view',
  'logout-btn',
  'upload-view',
  'upload-form',
  'upload-file',
  'upload-submit',
  'upload-status',
  'upload-progress',
  'turnstile-container',
  'catalogue-view',
  'search-input',
  'group-filter',
  'catalogue-count',
  'catalogue-table',
  'catalogue-body',
  'catalogue-empty',
  'result-view',
  'result-title',
  'result-frame',
  'result-download-html',
  'result-download',
  'result-expiry',
  'result-new',
];

const REQUIRED_ENDPOINTS = [
  '/api/config',
  '/api/session',
  '/api/login',
  '/api/logout',
  '/api/upload',
  '/api/list',
  '/api/status/',
  '/html/',
];

let total = 0;
let passed = 0;
const failures = [];

function check(name, fn) {
  total += 1;
  try {
    fn();
    passed += 1;
    console.log(`OK   ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL ${name}`);
    console.log(`     ${error.message.split('\n')[0]}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countId(html, id) {
  const pattern = new RegExp(`(?<![\\w-])id="${escapeRegExp(id)}"`, 'g');
  return (html.match(pattern) || []).length;
}

function extractTags(html) {
  return html.match(/<[^>]*>/g) || [];
}

function scriptBlocks(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
}

function hasStyleElement(html) {
  return /<style\b/i.test(html);
}

function hasStyleAttribute(html) {
  return extractTags(html).some((tag) => /\sstyle\s*=/i.test(tag));
}

function hasInlineEventHandler(html) {
  return extractTags(html).some((tag) => /\son[a-z]+\s*=/i.test(tag));
}

function hasInlineScriptContent(html) {
  return scriptBlocks(html).some(
    ([, attributes, body]) => !/\bsrc\s*=/i.test(attributes) || body.trim() !== '',
  );
}

function readAppFile(name) {
  return readFileSync(join(APP_DIR, name), 'utf8');
}

let sources;
try {
  sources = {
    html: readAppFile('index.html'),
    appJs: readAppFile('app.js'),
    headers: readAppFile('_headers'),
    routes: JSON.parse(readAppFile('_routes.json')),
  };
} catch (error) {
  console.log(`FAIL no se pudieron leer los archivos estáticos: ${error.message}`);
  console.log('\nResumen: 0/1 comprobaciones pasadas, 1 fallida.');
  process.exit(1);
}

const { html, appJs, headers, routes } = sources;

// ---------------------------------------------------------------------------
// 1. Identificadores requeridos: presentes exactamente una vez.
// ---------------------------------------------------------------------------
for (const id of REQUIRED_IDS) {
  check(`id="${id}" aparece exactamente una vez`, () => {
    const count = countId(html, id);
    assert.equal(count, 1, `se encontraron ${count} apariciones de id="${id}"`);
  });
}

// ---------------------------------------------------------------------------
// 1b. Acción de visualización: pestaña nueva y sin acceso al opener.
// ---------------------------------------------------------------------------
check('la acción Visualizar abre en una pestaña nueva', () => {
  assert.ok(appJs.includes("action.target = '_blank'"), 'falta target="_blank"');
  assert.ok(appJs.includes("action.rel = 'noopener noreferrer'"), 'falta rel="noopener noreferrer"');
  assert.ok(appJs.includes('action.href = `/html/${encodeURIComponent(item.uuid)}`'), 'el enlace no apunta a /html/{uuid}');
});

// ---------------------------------------------------------------------------
// 1c. Descarga HTML: orden en el panel y cableado del cliente.
// ---------------------------------------------------------------------------
check('index.html coloca result-download-html antes de result-download', () => {
  const htmlIndex = html.indexOf('id="result-download-html"');
  const jsonIndex = html.indexOf('id="result-download"');

  assert.ok(htmlIndex !== -1, 'no se encontró id="result-download-html"');
  assert.ok(jsonIndex !== -1, 'no se encontró id="result-download"');
  assert.ok(
    htmlIndex < jsonIndex,
    'el botón Descargar HTML debe aparecer antes del enlace Descargar JSON',
  );
});

check('app.js lee la cabecera X-MMUP-Missing-Count', () => {
  assert.ok(appJs.includes('X-MMUP-Missing-Count'), 'no se encontró X-MMUP-Missing-Count');
});

check('app.js usa URL.createObjectURL para la descarga', () => {
  assert.ok(appJs.includes('URL.createObjectURL'), 'no se encontró URL.createObjectURL');
});

check('app.js registra el manejador de result-download-html', () => {
  assert.ok(appJs.includes('handleDownloadHtml'), 'no se encontró handleDownloadHtml');
  assert.ok(
    appJs.includes("element('result-download-html').addEventListener('click', handleDownloadHtml)"),
    'no se registró el listener de click sobre result-download-html',
  );
});

// ---------------------------------------------------------------------------
// 2. Sin estilos ni scripts inline.
// ---------------------------------------------------------------------------
check('index.html no contiene un elemento <style>', () => {
  assert.equal(hasStyleElement(html), false, 'se encontró un elemento <style>');
});

check('index.html no contiene atributos style=', () => {
  assert.equal(hasStyleAttribute(html), false, 'se encontró un atributo style=');
});

check('index.html no contiene manejadores de eventos inline', () => {
  assert.equal(hasInlineEventHandler(html), false, 'se encontró un atributo on*= inline');
});

check('los bloques <script> son externos y no tienen contenido inline', () => {
  const blocks = scriptBlocks(html);
  assert.ok(blocks.length > 0, 'no se encontró ningún elemento <script>');
  for (const [, attributes, body] of blocks) {
    assert.match(attributes, /\bsrc\s*=/i, 'hay un <script> sin atributo src');
    assert.equal(body.trim(), '', 'hay contenido inline dentro de un <script>');
  }
});

// ---------------------------------------------------------------------------
// 2b. Autocomprobación de los detectores (casos positivos y negativos).
// ---------------------------------------------------------------------------
check('detector: reconoce un elemento <style> (positivo)', () => {
  assert.equal(hasStyleElement('<style>body{}</style>'), true);
});

check('detector: acepta un <link> sin <style> (negativo)', () => {
  assert.equal(hasStyleElement('<link rel="stylesheet" href="styles.css">'), false);
});

check('detector: reconoce un atributo style= (positivo)', () => {
  assert.equal(hasStyleAttribute('<div style="color:red"></div>'), true);
});

check('detector: acepta un atributo class sin style= (negativo)', () => {
  assert.equal(hasStyleAttribute('<div class="panel"></div>'), false);
});

check('detector: reconoce un manejador inline (positivo)', () => {
  assert.equal(hasInlineEventHandler('<button onclick="go()">Ir</button>'), true);
});

check('detector: acepta un botón sin manejador inline (negativo)', () => {
  assert.equal(hasInlineEventHandler('<button type="button">Ir</button>'), false);
});

check('detector: reconoce script inline (positivo)', () => {
  assert.equal(hasInlineScriptContent('<script>alert(1)</script>'), true);
});

check('detector: acepta script externo vacío (negativo)', () => {
  assert.equal(hasInlineScriptContent('<script src="app.js" defer></script>'), false);
});

// ---------------------------------------------------------------------------
// 3. Hoja de estilos enlazada y app.js diferido.
// ---------------------------------------------------------------------------
check('index.html enlaza styles.css como hoja de estilos', () => {
  const link = extractTags(html).find(
    (tag) => /^<link\b/i.test(tag)
      && /\brel="stylesheet"/i.test(tag)
      && /\bhref="styles\.css"/i.test(tag),
  );
  assert.ok(link, 'no se encontró <link rel="stylesheet" href="styles.css">');
});

check('index.html carga app.js con defer', () => {
  const script = extractTags(html).find(
    (tag) => /^<script\b/i.test(tag) && /\bsrc="app\.js"/i.test(tag),
  );
  assert.ok(script, 'no se encontró <script src="app.js">');
  assert.match(script, /\bdefer\b/i, 'app.js no usa defer');
});

// ---------------------------------------------------------------------------
// 4. Cabeceras de seguridad.
// ---------------------------------------------------------------------------
check("_headers define default-src 'none'", () => {
  assert.match(headers, /default-src 'none'/);
});

check("_headers define script-src 'self'", () => {
  assert.match(headers, /script-src 'self'/);
});

check("_headers define frame-ancestors 'none'", () => {
  assert.match(headers, /frame-ancestors 'none'/);
});

check('_headers declaran los orígenes de Turnstile', () => {
  assert.match(headers, /script-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /connect-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(headers, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
});

// ---------------------------------------------------------------------------
// 5. Rutas de la aplicación.
// ---------------------------------------------------------------------------
check('_routes.json incluye /api/*', () => {
  assert.ok(Array.isArray(routes.include), 'include debe ser un arreglo');
  assert.ok(routes.include.includes('/api/*'), 'falta /api/* en include');
});

check('_routes.json incluye /html/*', () => {
  assert.ok(Array.isArray(routes.include), 'include debe ser un arreglo');
  assert.ok(routes.include.includes('/html/*'), 'falta /html/* en include');
});

// ---------------------------------------------------------------------------
// 6. Endpoints referenciados por app.js.
// ---------------------------------------------------------------------------
for (const endpoint of REQUIRED_ENDPOINTS) {
  check(`app.js referencia ${endpoint}`, () => {
    assert.ok(appJs.includes(endpoint), `no se encontró ${endpoint} en app.js`);
  });
}

check('app.js usa la URL de descarga devuelta por el servidor', () => {
  assert.ok(appJs.includes('download.href = result.downloadUrl'), 'falta download.href = result.downloadUrl');
});

// ---------------------------------------------------------------------------
// Resumen.
// ---------------------------------------------------------------------------
const failed = total - passed;
console.log(`\nResumen: ${passed}/${total} comprobaciones pasadas, ${failed} fallidas.`);

if (failures.length > 0) {
  console.log('Fallos:');
  for (const failure of failures) {
    console.log(` - ${failure.name}: ${failure.error.message}`);
  }
  process.exit(1);
}

console.log('Shell estático OK.');
