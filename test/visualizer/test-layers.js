/**
 * @module test-layers
 * Tests unitarios para las 6 capas del visualizador mmup-output y utilidades.
 *
 * Ejecutar: node test/visualizer/test-layers.js
 *
 * Cobertura:
 * - Layer 1 (fetchJSON): 5 tests
 * - Layer 2 (buildTree): 7 tests
 * - Layer 3 (attachData): 7 tests
 * - Layer 4 (applyStyles + isTextAttachment): 19 tests
 * - Layer 5 (renderTree): 26 tests (incluye 5 regresiones XSS VIS-C1 y 4 de
 *   la lista de permitidos de esquemas W1)
 * - Layer 6 (assembleHTML): 24 tests (incluye 4 contratos VIS-C2, 2 de
 *   integridad del JS embebido, 6.12b regresión de adjuntos, 3 de nonce CSP
 *   y 1 de validación de color/width del overlay)
 * - Utilidades emoji-map: 12 tests
 * - Utilidades html-templates: 7 tests (incluye U2.3b de mensaje genérico W6)
 * - Seguridad VIS-C3 (identificadores, página estática y Worker): 14 tests
 *   (U3.4/U3.5 leen app.js tras la externalización del script; U3.9-U3.11
 *   cubren el gate de login de la ruta A; U3.12/U3.13 cubren la tabla
 *   ordenable y el formateo UTC)
 * - Datos sintéticos inline: 7 tests (pipeline de los mapas mínimo y completo)
 * Total: 131 tests unitarios
 *
 * Datos de prueba: objetos sintéticos definidos en este archivo. No se leen
 * fixtures reales ni datos de referencia.
 */

import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

// Imports de capas
import { fetchJSON } from '../../src/visualizer/layers/layer1-fetch.js';
import { buildTree } from '../../src/visualizer/layers/layer2-tree-builder.js';
import { attachData } from '../../src/visualizer/layers/layer3-attacher.js';
import { applyStyles, isTextAttachment } from '../../src/visualizer/layers/layer4-styler.js';
import { renderTree, convertEmoji as renderConvertEmoji, escapeHtml as renderEscapeHtml, safeExternalHref } from '../../src/visualizer/layers/layer5-renderer.js';
import { assembleHTML, formatDate, escapeHtml as assemblerEscapeHtml } from '../../src/visualizer/layers/layer6-assembler.js';

// Imports de utilidades
import { convertEmoji, convertStickers } from '../../src/visualizer/utils/emoji-map.js';
import { render404HTML, render400HTML, render500HTML, renderErrorHTML } from '../../src/visualizer/utils/html-templates.js';
import { normalizeNonce } from '../../src/visualizer/mmup-visualizer-do.js';
import { isValidIdentifier, IDENTIFIER_PATTERN } from '../../src/visualizer/utils/identifiers.js';

// Imports del Worker y Durable Object (regresiones VIS-C3)
import visualizerWorker, { MupVisualizer } from '../../src/visualizer/index.js';

// ---------------------------------------------------------------------------
// Datos sintéticos inline
//
// Los objetos reproducen la forma del JSON-CMJN sin depender de mapas reales,
// fixtures de referencia ni archivos externos. Los recuentos, títulos, fechas
// e identificadores son inventados y se mantienen coherentes entre sí.
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MAPA_SINTETICO_COMPLETO = {
  metadata: {
    map_id: 'mapa-sintetico-completo',
    title: 'Mapa sintético completo',
    format_version: 3,
    source_file: 'mapa-sintetico-completo.mup',
    converted_at: '2023-01-01T00:00:00.000Z',
    node_count: 12,
  },
  nodes: [
    { node_id: 'nodo-raiz', parent_id: null, sibling_order: 0, title: 'Mapa sintético completo', depth: 0 },
    { node_id: 'nodo-01', parent_id: 'nodo-raiz', sibling_order: 0, title: 'Nodo sintético 01', depth: 1 },
    { node_id: 'nodo-02', parent_id: 'nodo-raiz', sibling_order: 1, title: 'Nodo sintético 02', depth: 1 },
    { node_id: 'nodo-03', parent_id: 'nodo-raiz', sibling_order: 2, title: 'Nodo sintético 03', depth: 1 },
    { node_id: 'nodo-04', parent_id: 'nodo-raiz', sibling_order: 3, title: 'Nodo sintético 04', depth: 1 },
    { node_id: 'nodo-05', parent_id: 'nodo-raiz', sibling_order: 4, title: 'Nodo sintético 05', depth: 1 },
    { node_id: 'nodo-06', parent_id: 'nodo-raiz', sibling_order: 5, title: 'Nodo sintético 06', depth: 1 },
    { node_id: 'nodo-07', parent_id: 'nodo-raiz', sibling_order: 6, title: 'Nodo sintético 07', depth: 1 },
    { node_id: 'nodo-08', parent_id: 'nodo-raiz', sibling_order: 7, title: 'Nodo sintético 08', depth: 1 },
    { node_id: 'nodo-09', parent_id: 'nodo-raiz', sibling_order: 8, title: 'Nodo sintético 09', depth: 1 },
    { node_id: 'nodo-10', parent_id: 'nodo-raiz', sibling_order: 9, title: 'Nodo sintético 10', depth: 1 },
    { node_id: 'nodo-11', parent_id: 'nodo-raiz', sibling_order: 10, title: 'Nodo sintético 11', depth: 1 },
  ],
  notes: [
    { note_id: 'nota-1', node_id: 'nodo-01', index: 0, text: 'Nota sintética breve', char_count: 20, truncated: false },
    { note_id: 'nota-2', node_id: 'nodo-02', index: 0, text: 'Segunda nota sintética', char_count: 22, truncated: false },
  ],
  externalRefs: [
    { ref_id: 'ref-1', node_id: 'nodo-01', url: 'https://docs.example.com/guia-sintetica', ref_type: 'url', label: 'Guía sintética' },
  ],
  links: [
    { link_id: 'enlace-1', map_id: 'mapa-sintetico-completo', from_node_id: 'nodo-02', to_node_id: 'nodo-03', color: '#3366CC', line_style: 'solid', arrow: 'to', width: 2 },
  ],
  attributes: [
    { attr_id: 'attr-1', node_id: 'nodo-01', attr_type: 'style', value: { style: { backgroundColor: '#FFCC99' } }, raw_attributes: {} },
    { attr_id: 'attr-2', node_id: 'nodo-02', attr_type: 'style', value: {}, raw_attributes: {} },
  ],
  stickers: [
    { sticker_id: 'sticker-1', node_id: 'nodo-01', emoji_code: 'emoji:1F680', emoji_display: '🚀', category: 'travel' },
    { sticker_id: 'sticker-2', node_id: 'nodo-02', emoji_code: 'emoji:1F4CC', emoji_display: '📌', category: 'object' },
  ],
  icons: [
    { icon_id: 'icono-1', node_id: 'nodo-01', url: 'data:image/png;base64,xxxx', width: 32, height: 32, position: 'left' },
  ],
};

const MAPA_SINTETICO_MINIMO = {
  metadata: {
    map_id: 'mapa-sintetico-minimo',
    title: 'Mapa sintético mínimo',
    format_version: 3,
    source_file: 'mapa-sintetico-minimo.mup',
    converted_at: '2023-02-01T00:00:00.000Z',
    node_count: 10,
  },
  nodes: [
    { node_id: 'min-raiz', parent_id: null, sibling_order: 0, title: 'Mapa sintético mínimo', depth: 0 },
    { node_id: 'min-01', parent_id: 'min-raiz', sibling_order: 0, title: 'Hoja mínima 01', depth: 1 },
    { node_id: 'min-02', parent_id: 'min-raiz', sibling_order: 1, title: 'Hoja mínima 02', depth: 1 },
    { node_id: 'min-03', parent_id: 'min-raiz', sibling_order: 2, title: 'Hoja mínima 03', depth: 1 },
    { node_id: 'min-04', parent_id: 'min-raiz', sibling_order: 3, title: 'Hoja mínima 04', depth: 1 },
    { node_id: 'min-05', parent_id: 'min-raiz', sibling_order: 4, title: 'Hoja mínima 05', depth: 1 },
    { node_id: 'min-06', parent_id: 'min-raiz', sibling_order: 5, title: 'Hoja mínima 06', depth: 1 },
    { node_id: 'min-07', parent_id: 'min-raiz', sibling_order: 6, title: 'Hoja mínima 07', depth: 1 },
    { node_id: 'min-08', parent_id: 'min-raiz', sibling_order: 7, title: 'Hoja mínima 08', depth: 1 },
    { node_id: 'min-09', parent_id: 'min-raiz', sibling_order: 8, title: 'Hoja mínima 09', depth: 1 },
  ],
  notes: [],
  externalRefs: [],
  links: [],
  attributes: [],
  stickers: [],
  icons: [],
};

const DATOS_SINTETICOS = {
  completo: MAPA_SINTETICO_COMPLETO,
  minimo: MAPA_SINTETICO_MINIMO,
};

// ---------------------------------------------------------------------------
// Test runner simple
// ---------------------------------------------------------------------------

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
let skippedTests = 0;
const failures = [];

function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failedTests++;
    failures.push({ name, error });
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failedTests++;
    failures.push({ name, error });
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
  }
}

/**
 * Ejecuta un test síncrono con el conjunto sintético compartido.
 */
function testConDatos(name, fn) {
  test(name, () => fn(DATOS_SINTETICOS));
}

/**
 * Ejecuta un test asíncrono con el conjunto sintético compartido.
 */
async function testConDatosAsync(name, fn) {
  await testAsync(name, () => fn(DATOS_SINTETICOS));
}

const APP_DIR = join(__dirname, '../../app');
// The old page tests describe the removed client-side login. The new UI is
// covered by test/ui/test-static-shell.js until the page tests are rewritten.
const PAGE_AVAILABLE = false;

/**
 * Runs a page test only when the new static page exists.
 * Page tests are rewritten in Phase 9 with the server-side session model.
 */
function testPage(name, fn) {
  if (!PAGE_AVAILABLE) {
    skippedTests++;
    console.log(`  ⏭️  ${name} — omitido (página aún no migrada)`);
    return;
  }
  test(name, fn);
}

// ---------------------------------------------------------------------------
// Silence console.log during tests (avoid noise)
// ---------------------------------------------------------------------------

const originalLog = console.log;
const originalError = console.error;
function silenceLogs() {
  console.log = () => {};
  console.error = () => {};
}
function restoreLogs() {
  console.log = originalLog;
  console.error = originalError;
}

// ===========================================================================
// Layer 1: fetchJSON
// ===========================================================================

console.log('\n📦 Testing Layer 1: fetchJSON');

// Helper: crear mock de R2 bucket
function createMockBucket(data) {
  return {
    get: async (key) => {
      if (data[key] === undefined) return null;
      const content = data[key];
      return {
        json: async () => {
          if (typeof content === 'string') {
            // Simular JSON inválido
            throw new Error('Unexpected token');
          }
          return content;
        }
      };
    }
  };
}

await testConDatosAsync('1.1 Fetch exitoso con UUID válido', async ({ completo: mapaSintetico }) => {
  silenceLogs();
  try {
    const mockEnv = {
      MMUP_BUCKET: createMockBucket({
        'output/test-uuid.json': mapaSintetico
      })
    };
    const result = await fetchJSON('test-uuid', mockEnv, 'output/{uuid}.json');
    assert.strictEqual(result.metadata.title, 'Mapa sintético completo');
    assert.strictEqual(result.nodes.length, 12);
  } finally {
    restoreLogs();
  }
});

await testAsync('1.2 Error NOT_FOUND si UUID no existe', async () => {
  silenceLogs();
  try {
    const mockEnv = {
      MMUP_BUCKET: createMockBucket({})
    };
    try {
      await fetchJSON('nonexistent-uuid', mockEnv, 'output/{uuid}.json');
      assert.fail('Debería haber lanzado error');
    } catch (error) {
      assert.strictEqual(error.code, 'NOT_FOUND');
      assert.strictEqual(error.uuid, 'nonexistent-uuid');
    }
  } finally {
    restoreLogs();
  }
});

await testAsync('1.3 Error INVALID_JSON si archivo no es JSON', async () => {
  silenceLogs();
  try {
    const mockEnv = {
      MMUP_BUCKET: createMockBucket({
        'output/bad-json.json': 'this is not json{{{'
      })
    };
    try {
      await fetchJSON('bad-json', mockEnv, 'output/{uuid}.json');
      assert.fail('Debería haber lanzado error');
    } catch (error) {
      assert.strictEqual(error.code, 'INVALID_JSON');
    }
  } finally {
    restoreLogs();
  }
});

await testAsync('1.4 Error INVALID_STRUCTURE si falta metadata', async () => {
  silenceLogs();
  try {
    const mockEnv = {
      MMUP_BUCKET: createMockBucket({
        'output/no-metadata.json': { nodes: [] }
      })
    };
    try {
      await fetchJSON('no-metadata', mockEnv, 'output/{uuid}.json');
      assert.fail('Debería haber lanzado error');
    } catch (error) {
      assert.strictEqual(error.code, 'INVALID_STRUCTURE');
    }
  } finally {
    restoreLogs();
  }
});

await testAsync('1.5 Error INVALID_STRUCTURE si falta nodes[]', async () => {
  silenceLogs();
  try {
    const mockEnv = {
      MMUP_BUCKET: createMockBucket({
        'output/no-nodes.json': { metadata: { title: 'Test' } }
      })
    };
    try {
      await fetchJSON('no-nodes', mockEnv, 'output/{uuid}.json');
      assert.fail('Debería haber lanzado error');
    } catch (error) {
      assert.strictEqual(error.code, 'INVALID_STRUCTURE');
    }
  } finally {
    restoreLogs();
  }
});

// ===========================================================================
// Layer 2: buildTree
// ===========================================================================

console.log('\n🌳 Testing Layer 2: buildTree');

testConDatos('2.1 Construir árbol desde nodos planos (mapa sintético completo)', ({ completo: mapaSintetico }) => {
  const tree = buildTree(mapaSintetico.nodes);
  // Debe tener 1 raíz (el mapa sintético tiene un solo nodo raíz)
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].node_id, mapaSintetico.nodes[0].node_id);
  assert.strictEqual(tree[0].title, 'Mapa sintético completo');
  // Debe tener children
  assert.ok(tree[0].children.length > 0);
});

test('2.2 Array vacío retorna []', () => {
  const tree = buildTree([]);
  assert.deepStrictEqual(tree, []);
});

test('2.3 null/undefined retorna []', () => {
  assert.deepStrictEqual(buildTree(null), []);
  assert.deepStrictEqual(buildTree(undefined), []);
});

test('2.4 Nodos con parent_id null van a roots', () => {
  const nodes = [
    { node_id: 'a', parent_id: null, sibling_order: 0, title: 'Raíz 1' },
    { node_id: 'b', parent_id: null, sibling_order: 0, title: 'Raíz 2' },
  ];
  const tree = buildTree(nodes);
  assert.strictEqual(tree.length, 2);
  assert.strictEqual(tree[0].node_id, 'a');
  assert.strictEqual(tree[1].node_id, 'b');
});

test('2.5 Hijos ordenados por sibling_order', () => {
  const nodes = [
    { node_id: 'root', parent_id: null, sibling_order: 0, title: 'Root' },
    { node_id: 'c', parent_id: 'root', sibling_order: 2, title: 'Tercero' },
    { node_id: 'a', parent_id: 'root', sibling_order: 0, title: 'Primero' },
    { node_id: 'b', parent_id: 'root', sibling_order: 1, title: 'Segundo' },
  ];
  const tree = buildTree(nodes);
  const children = tree[0].children;
  assert.strictEqual(children.length, 3);
  assert.strictEqual(children[0].title, 'Primero');
  assert.strictEqual(children[1].title, 'Segundo');
  assert.strictEqual(children[2].title, 'Tercero');
});

test('2.6 Nodos con parent_id inexistente van a roots', () => {
  const nodes = [
    { node_id: 'a', parent_id: null, sibling_order: 0, title: 'Raíz' },
    { node_id: 'b', parent_id: 'nonexistent', sibling_order: 0, title: 'Órfano' },
  ];
  const tree = buildTree(nodes);
  assert.strictEqual(tree.length, 2);
  const orphan = tree.find(n => n.node_id === 'b');
  assert.ok(orphan);
  assert.strictEqual(orphan.title, 'Órfano');
});

test('2.7 No muta el input original', () => {
  const original = [
    { node_id: 'a', parent_id: null, sibling_order: 0, title: 'Root' },
    { node_id: 'b', parent_id: 'a', sibling_order: 0, title: 'Child' },
  ];
  const originalCopy = JSON.parse(JSON.stringify(original));
  buildTree(original);
  // El array original no debe haber cambiado
  assert.deepStrictEqual(original, originalCopy);
  // Los nodos originales no deben tener children
  assert.strictEqual(original[0].children, undefined);
});

// ===========================================================================
// Layer 3: attachData
// ===========================================================================

console.log('\n🔗 Testing Layer 3: attachData');

test('3.1 Vincular notas a nodos', () => {
  const tree = [
    { node_id: 'a', children: [{ node_id: 'b', children: [] }] }
  ];
  const notes = [
    { node_id: 'a', text: 'Nota raíz', char_count: 10 }
  ];
  attachData(tree, notes, [], []);
  assert.strictEqual(tree[0].notes.length, 1);
  assert.strictEqual(tree[0].notes[0].text, 'Nota raíz');
  // El hijo no tiene notas
  assert.strictEqual(tree[0].children[0].notes.length, 0);
});

test('3.2 Vincular externalRefs a nodos', () => {
  const tree = [
    { node_id: 'a', children: [{ node_id: 'b', children: [] }] }
  ];
  const refs = [
    { node_id: 'b', url: 'https://example.com', label: 'Ejemplo' }
  ];
  attachData(tree, [], refs, []);
  assert.strictEqual(tree[0].externalRefs.length, 0);
  assert.strictEqual(tree[0].children[0].externalRefs.length, 1);
  assert.strictEqual(tree[0].children[0].externalRefs[0].url, 'https://example.com');
});

test('3.3 Vincular links resueltos a nodos', () => {
  const tree = [
    { node_id: 'a', children: [{ node_id: 'b', children: [] }] }
  ];
  const links = [
    { from_node_id: 'a', to_node_id: 'b', color: '#FF0000' }
  ];
  attachData(tree, [], [], links);
  assert.strictEqual(tree[0].links.length, 1);
  assert.strictEqual(tree[0].links[0].color, '#FF0000');
});

test('3.4 Ignorar links no resueltos (from_node_id o to_node_id null)', () => {
  const tree = [
    { node_id: 'a', children: [] }
  ];
  const links = [
    { from_node_id: null, to_node_id: null, color: '#FF0000' },
    { from_node_id: 'a', to_node_id: null, color: '#00FF00' },
    { from_node_id: null, to_node_id: 'a', color: '#0000FF' },
  ];
  attachData(tree, [], [], links);
  assert.strictEqual(tree[0].links.length, 0);
});

test('3.5 Nodos sin datos adjuntos reciben arrays vacíos', () => {
  const tree = [
    { node_id: 'a', children: [{ node_id: 'b', children: [] }] }
  ];
  attachData(tree, [], [], []);
  assert.deepStrictEqual(tree[0].notes, []);
  assert.deepStrictEqual(tree[0].externalRefs, []);
  assert.deepStrictEqual(tree[0].links, []);
  assert.deepStrictEqual(tree[0].stickers, []);
  assert.deepStrictEqual(tree[0].icons, []);
  assert.deepStrictEqual(tree[0].children[0].notes, []);
  assert.deepStrictEqual(tree[0].children[0].externalRefs, []);
  assert.deepStrictEqual(tree[0].children[0].links, []);
  assert.deepStrictEqual(tree[0].children[0].stickers, []);
  assert.deepStrictEqual(tree[0].children[0].icons, []);
});

test('3.6 null/undefined en colecciones no rompe', () => {
  const tree = [
    { node_id: 'a', children: [] }
  ];
  attachData(tree, null, undefined, null);
  assert.deepStrictEqual(tree[0].notes, []);
  assert.deepStrictEqual(tree[0].externalRefs, []);
  assert.deepStrictEqual(tree[0].links, []);
  assert.deepStrictEqual(tree[0].stickers, []);
  assert.deepStrictEqual(tree[0].icons, []);
});

test('3.7 Vincular icons a nodos', () => {
  const tree = [
    { node_id: 'a', children: [{ node_id: 'b', children: [] }] }
  ];
  const icons = [
    { node_id: 'a', url: 'data:image/png;base64,xxxx', width: 32, height: 32 }
  ];
  attachData(tree, [], [], [], [], icons);
  assert.strictEqual(tree[0].icons.length, 1);
  assert.strictEqual(tree[0].icons[0].url, 'data:image/png;base64,xxxx');
  assert.strictEqual(tree[0].icons[0].width, 32);
  assert.strictEqual(tree[0].icons[0].height, 32);
  // El hijo no tiene iconos
  assert.strictEqual(tree[0].children[0].icons.length, 0);
});

// ===========================================================================
// Layer 4: applyStyles
// ===========================================================================

console.log('\n🎨 Testing Layer 4: applyStyles');

test('4.1 Extraer backgroundColor de attributes', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: { style: { backgroundColor: '#FFCC99' } }, raw_attributes: {} }
  ];
  applyStyles(tree, attributes);
  assert.strictEqual(tree[0].style.backgroundColor, '#FFCC99');
});

test('4.2 Extraer stickers de raw_attributes', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: {}, raw_attributes: { stickers: ['emoji:1F5FA', 'emoji:2764'] } }
  ];
  applyStyles(tree, attributes);
  assert.deepStrictEqual(tree[0].stickers, ['emoji:1F5FA', 'emoji:2764']);
});

test('4.3 Nodos sin attributes reciben valores por defecto', () => {
  const tree = [{ node_id: 'a', children: [] }];
  applyStyles(tree, []);
  assert.strictEqual(tree[0].style.backgroundColor, null);
  assert.deepStrictEqual(tree[0].stickers, []);
});

test('4.4 Attributes sin value.style.backgroundColor → null', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: { position: { x: 0, y: 0 } }, raw_attributes: null }
  ];
  applyStyles(tree, attributes);
  assert.strictEqual(tree[0].style.backgroundColor, null);
});

test('4.5 Attributes sin raw_attributes.stickers → []', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: {}, raw_attributes: { position: [0, 0, 1] } }
  ];
  applyStyles(tree, attributes);
  assert.deepStrictEqual(tree[0].stickers, []);
});

test('4.6 Conservar icons adjuntados por Layer 3', () => {
  const tree = [{ node_id: 'a', children: [] }];
  // Layer 3 adjunta un icono real (data URI)
  attachData(tree, [], [], [], [], [
    { node_id: 'a', url: 'data:image/png;base64,xxxx', width: 32, height: 32 }
  ]);
  // Layer 4 tiene un fallback distinto en raw_attributes.icon: NO debe pisar
  const attributes = [
    { node_id: 'a', value: {}, raw_attributes: { icon: { url: 'data:image/png;base64,fallback', width: 16, height: 16 } } }
  ];
  applyStyles(tree, attributes);
  assert.strictEqual(tree[0].icons.length, 1);
  assert.strictEqual(tree[0].icons[0].url, 'data:image/png;base64,xxxx');
  assert.strictEqual(tree[0].icons[0].width, 32);
  assert.strictEqual(tree[0].icons[0].height, 32);
});

test('4.7 Fallback de icons desde raw_attributes.icon', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: {}, raw_attributes: { icon: { url: 'data:image/png;base64,fallback', width: 16, height: 16 } } }
  ];
  applyStyles(tree, attributes);
  assert.strictEqual(tree[0].icons.length, 1);
  assert.strictEqual(tree[0].icons[0].url, 'data:image/png;base64,fallback');
  assert.strictEqual(tree[0].icons[0].width, 16);
});

test('4.8 Exponer attachment desde value.attachment (metadatos + clasificación)', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: { attachment: { name: 'nota.txt', contentType: 'text/plain', size: 42 } }, raw_attributes: {} }
  ];
  applyStyles(tree, attributes);
  // isBinary=false porque text/plain + .txt es texto
  assert.deepStrictEqual(tree[0].attachment, { name: 'nota.txt', contentType: 'text/plain', size: 42, isBinary: false });
});

test('4.9 attachment es null cuando el nodo no tiene adjunto', () => {
  const tree = [{ node_id: 'a', children: [] }];
  // Nodo con attributes pero sin adjunto, y nodo sin attributes
  const attributes = [{ node_id: 'a', value: { style: { backgroundColor: '#FFF' } }, raw_attributes: {} }];
  const tree2 = [{ node_id: 'b', children: [] }];
  applyStyles(tree, attributes);
  applyStyles(tree2, []);
  assert.strictEqual(tree[0].attachment, null);
  assert.strictEqual(tree2[0].attachment, null);
});

test('4.10 applyStyles marca isBinary=false para adjuntos de texto', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: { attachment: { name: 'nota.txt', contentType: 'text/plain', size: 42 } }, raw_attributes: {} }
  ];
  applyStyles(tree, attributes);
  assert.strictEqual(tree[0].attachment.isBinary, false);
  // No muta el objeto original del JSON (inmutabilidad)
  assert.strictEqual(attributes[0].value.attachment.isBinary, undefined);
});

test('4.11 applyStyles marca isBinary=true para adjuntos binarios', () => {
  const tree = [{ node_id: 'a', children: [] }];
  const attributes = [
    { node_id: 'a', value: { attachment: { name: 'datos.zip', contentType: 'application/zip', size: 2048 } }, raw_attributes: {} }
  ];
  applyStyles(tree, attributes);
  assert.strictEqual(tree[0].attachment.isBinary, true);
  assert.strictEqual(tree[0].attachment.name, 'datos.zip');
  assert.strictEqual(tree[0].attachment.contentType, 'application/zip');
});

// --- isTextAttachment: clasificación general texto/binario ---

test('4.12 isTextAttachment: text/plain + .txt → texto', () => {
  assert.strictEqual(isTextAttachment({ name: 'nota.txt', contentType: 'text/plain' }), true);
});

test('4.13 isTextAttachment: application/zip + .zip → binario', () => {
  assert.strictEqual(isTextAttachment({ name: 'datos.zip', contentType: 'application/zip' }), false);
});

test('4.14 isTextAttachment: contentType vacío + .md → texto (por extensión)', () => {
  assert.strictEqual(isTextAttachment({ name: 'README.md', contentType: '' }), true);
});

test('4.15 isTextAttachment: contentType vacío + sin extensión → binario por defecto', () => {
  assert.strictEqual(isTextAttachment({ name: 'archivo-sin-extension', contentType: '' }), false);
});

test('4.16 isTextAttachment: image/png + .png → binario', () => {
  assert.strictEqual(isTextAttachment({ name: 'foto.png', contentType: 'image/png' }), false);
});

test('4.17 isTextAttachment: contentType ausente (undefined) + .json → texto', () => {
  assert.strictEqual(isTextAttachment({ name: 'datos.json' }), true);
  assert.strictEqual(isTextAttachment({ name: 'datos.json', contentType: undefined }), true);
});

test('4.18 isTextAttachment: application/json + .json → texto (por extensión)', () => {
  assert.strictEqual(isTextAttachment({ name: 'datos.json', contentType: 'application/json' }), true);
});

test('4.19 isTextAttachment: mayúsculas insensibles y text/plain sin extensión', () => {
  // Extensión en mayúsculas también es texto
  assert.strictEqual(isTextAttachment({ name: 'NOTA.TXT', contentType: '' }), true);
  // contentType en mayúsculas con prefijo text/ también es texto
  assert.strictEqual(isTextAttachment({ name: 'sin-extension', contentType: 'TEXT/PLAIN' }), true);
  // contentType null se trata como ausente → decisión por extensión
  assert.strictEqual(isTextAttachment({ name: 'doc.txt', contentType: null }), true);
});

// ===========================================================================
// Layer 5: renderTree
// ===========================================================================

console.log('\n🖼️  Testing Layer 5: renderTree');

test('5.1 Generar HTML con role="tree"', () => {
  const tree = [{
    node_id: 'a', title: 'Root', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('role="tree"'));
  assert.ok(html.includes('id="tree-container"'));
});

test('5.2 Generar nodos con role="treeitem"', () => {
  const tree = [{
    node_id: 'a', title: 'Root', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('role="treeitem"'));
  assert.ok(html.includes('data-id="a"'));
});

test('5.3 Convertir stickers a emojis', () => {
  const tree = [{
    node_id: 'a', title: 'Root', children: [],
    style: { backgroundColor: null },
    stickers: ['emoji:1F5FA'],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // El emoji 🗺️ debe estar presente (o su representación Unicode)
  assert.ok(html.includes('class="stickers"'));
  // Verificar que se convirtió el emoji (no el código raw)
  assert.ok(!html.includes('emoji:1F5FA'));
});

test('5.4 Notas ≤100 chars inline (div.note.short)', () => {
  const tree = [{
    node_id: 'a', title: 'Root', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [{ text: 'Nota corta', char_count: 10 }],
    externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="note short"'));
  assert.ok(html.includes('Nota corta'));
  assert.ok(!html.includes('<details'));
});

test('5.5 Notas >100 chars en acordeón (details/summary)', () => {
  const longText = 'A'.repeat(150);
  const tree = [{
    node_id: 'a', title: 'Root', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [{ text: longText, char_count: 150 }],
    externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="note long"'));
  assert.ok(html.includes('<details'));
  assert.ok(html.includes('<summary>'));
  assert.ok(html.includes('150 caracteres'));
});

test('5.6 Enlaces externos con target="_blank"', () => {
  const tree = [{
    node_id: 'a', title: 'Root', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [],
    externalRefs: [{ url: 'https://example.com', label: 'Ejemplo' }],
    links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(html.includes('href="https://example.com"'));
});

test('5.7 Título escapado (anti-XSS)', () => {
  const tree = [{
    node_id: 'a', title: '<script>alert("xss")</script>', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('5.8 Toggle para nodos con hijos (▼)', () => {
  const tree = [{
    node_id: 'a', title: 'Parent', children: [{
      node_id: 'b', title: 'Child', children: [],
      style: { backgroundColor: null }, stickers: [],
      notes: [], externalRefs: [], links: []
    }],
    style: { backgroundColor: null }, stickers: [],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="toggle"'));
  assert.ok(html.includes('▼'));
});

test('5.9 Placeholder para hojas (sin toggle)', () => {
  const tree = [{
    node_id: 'a', title: 'Leaf', children: [],
    style: { backgroundColor: null }, stickers: [],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="toggle-placeholder"'));
  assert.ok(!html.includes('class="toggle"'));
});

test('5.10 Iconos renderizados como <img class="node-icon">', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo con icono', children: [],
    style: { backgroundColor: null }, stickers: [],
    icons: [{ url: 'data:image/png;base64,xxxx', width: 32, height: 32 }],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // Etiqueta <img> con clase node-icon y atributos src/width/height escapados
  assert.ok(html.includes('<img class="node-icon"'));
  assert.ok(html.includes('src="data:image/png;base64,xxxx"'));
  assert.ok(html.includes('width="32"'));
  assert.ok(html.includes('height="32"'));
  assert.ok(html.includes('alt="Icono del nodo"'));
  assert.ok(html.includes('class="icons"'));
});

test('5.11 Nodos sin iconos no generan <img>', () => {
  const tree = [{
    node_id: 'a', title: 'Sin icono', children: [],
    style: { backgroundColor: null }, stickers: [],
    icons: [],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('class="icons"'));
});

test('5.12 Nodo con adjunto de texto renderiza enlace .attachment-link', () => {
  const tree = [{
    node_id: 'a', title: 'Con adjunto', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    attachment: { name: 'nota.txt', contentType: 'text/plain', size: 42, isBinary: false },
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="attachment-link"'));
  assert.ok(html.includes('data-node-id="a"'));
  assert.ok(html.includes('Ver adjunto: nota.txt'));
  assert.ok(html.includes('aria-label="Ver adjunto nota.txt"'));
  // No genera enlace de descarga para adjuntos de texto
  assert.ok(!html.includes('class="attachment-download"'));
});

test('5.13 Nodo sin adjunto no renderiza enlace de adjunto', () => {
  const tree = [{
    node_id: 'a', title: 'Sin adjunto', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    attachment: null,
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('class="attachment-link"'));
  assert.ok(!html.includes('📎'));
});

test('5.14 Nombre de adjunto escapado (anti-XSS)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    attachment: { name: '<script>alert("xss")</script>.txt', contentType: 'text/plain', isBinary: false },
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('5.15 Nodo con adjunto binario renderiza enlace .attachment-download', () => {
  const tree = [{
    node_id: 'a', title: 'Con binario', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    attachment: { name: 'datos.zip', contentType: 'application/zip', size: 2048, isBinary: true },
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="attachment-download"'));
  assert.ok(html.includes('data-node-id="a"'));
  assert.ok(html.includes('download="datos.zip"'));
  assert.ok(html.includes('Descargar adjunto: datos.zip'));
  assert.ok(html.includes('aria-label="Descargar adjunto datos.zip"'));
  // No genera enlace de ventana emergente
  assert.ok(!html.includes('class="attachment-link"'));
});

test('5.16 Nodo con adjunto binario no genera enlace de ventana emergente', () => {
  const tree = [{
    node_id: 'a', title: 'Con binario', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    attachment: { name: 'manual.pdf', contentType: 'application/pdf', size: 100, isBinary: true },
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // Un único enlace 📎 y con la clase de descarga
  assert.ok(!html.includes('class="attachment-link"'));
  assert.strictEqual((html.match(/📎/g) || []).length, 1);
});

test('5.17 Enlace de descarga usa href="#" provisional y escapa el nombre (anti-XSS)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    attachment: { name: '<script>alert("xss")</script>.zip', contentType: 'application/zip', isBinary: true },
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // href provisional: la capa 6 asigna la data URI real desde MMUP_DATA.attachments
  assert.ok(html.includes('href="#" class="attachment-download"'));
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// --- Regresiones XSS VIS-C1: stickers y char_count sin escapar ---

test('5.18 Sticker con HTML en emoji_display se escapa (VIS-C1)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null },
    stickers: [{ emoji_code: 'emoji:1F5FA', emoji_display: '<img src=x onerror=alert(1)>' }],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // La etiqueta cruda no debe aparecer; el texto escapado sí
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('5.19 Sticker de cadena con <script> se escapa (VIS-C1)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null },
    stickers: ['<script>alert("xss")</script>'],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'));
});

test('5.20 Respaldo raw_attributes.stickers se escapa vía applyStyles (VIS-C1)', () => {
  const tree = [{ node_id: 'a', children: [] }];
  // Sin stickers adjuntados por Layer 3: applyStyles usa el respaldo crudo
  attachData(tree, [], [], []);
  const attributes = [
    { node_id: 'a', value: {}, raw_attributes: { stickers: ['<img src=x onerror=alert(1)>'] } }
  ];
  applyStyles(tree, attributes);
  assert.deepStrictEqual(tree[0].stickers, ['<img src=x onerror=alert(1)>']);
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('5.21 char_count con carga se escapa en la nota larga (VIS-C1)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null }, stickers: [],
    // char_count no numérico fuerza la rama larga (details/summary)
    notes: [{ text: 'A'.repeat(150), char_count: '<img src=x onerror=alert(1)>' }],
    externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('class="note long"'));
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('5.22 Respaldo emoji_code con carga se escapa al renderizar (VIS-C1)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null },
    // Objeto sin emoji_display: stickerToEmoji respalda a convertEmoji(emoji_code)
    stickers: [{ emoji_code: '<img src=x onerror=alert(1)>' }],
    notes: [], externalRefs: [], links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // La etiqueta cruda no debe aparecer; el texto escapado sí
  assert.ok(!html.includes('<img src=x onerror'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

// --- W1: lista de permitidos de esquemas en enlaces externos ---

test('5.23 safeExternalHref: permite http, https y mailto', () => {
  assert.strictEqual(safeExternalHref('https://example.com/ruta?q=1'), 'https://example.com/ruta?q=1');
  assert.strictEqual(safeExternalHref('http://example.com'), 'http://example.com');
  assert.strictEqual(safeExternalHref('mailto:persona@example.com'), 'mailto:persona@example.com');
});

test('5.24 safeExternalHref: rechaza esquemas peligrosos y valores no válidos', () => {
  assert.strictEqual(safeExternalHref('javascript:alert(1)'), null);
  assert.strictEqual(safeExternalHref('data:text/html,<script>alert(1)</script>'), null);
  assert.strictEqual(safeExternalHref('vbscript:msgbox(1)'), null);
  assert.strictEqual(safeExternalHref('file:///etc/passwd'), null);
  assert.strictEqual(safeExternalHref('/ruta-relativa'), null);
  assert.strictEqual(safeExternalHref(''), null);
  assert.strictEqual(safeExternalHref('   '), null);
  assert.strictEqual(safeExternalHref(null), null);
  assert.strictEqual(safeExternalHref(undefined), null);
  assert.strictEqual(safeExternalHref(123), null);
  // Variantes de evasión (W-2 de la revisión 2d): el parser normaliza el
  // esquema (minúsculas, tabulador y salto eliminados) y trim() los extremos
  assert.strictEqual(safeExternalHref('JaVaScRiPt:alert(1)'), null);
  assert.strictEqual(safeExternalHref('java\tscript:alert(1)'), null);
  assert.strictEqual(safeExternalHref('java\nscript:alert(1)'), null);
  assert.strictEqual(safeExternalHref('java\u0000script:alert(1)'), null);
  assert.strictEqual(safeExternalHref('DATA:text/html,x'), null);
  assert.strictEqual(safeExternalHref('blob:https://x/y'), null);
  assert.strictEqual(safeExternalHref('about:blank'), null);
  assert.strictEqual(safeExternalHref('  https://example.com  '), 'https://example.com');
});

test('5.25 Enlace externo javascript: se degrada a span no clicable (W1)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    notes: [],
    externalRefs: [{ url: 'javascript:alert(1)', label: 'Enlace malicioso' }],
    links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  // No se emite ningún <a> y el enlace queda como span no clicable
  assert.ok(!html.includes('<a'));
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('<span class="ext-ref">🔗</span>'));
});

test('5.26 Enlaces externos https y mailto generan <a> con href seguro (W1)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    notes: [],
    externalRefs: [
      { url: 'https://example.com', label: 'Web' },
      { url: 'mailto:persona@example.com', label: 'Correo' }
    ],
    links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(html.includes('href="https://example.com"'));
  assert.ok(html.includes('href="mailto:persona@example.com"'));
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.ok(!html.includes('class="ext-ref"'));
});

test('5.27 Variantes de evasión de esquema se degradan a span (W-2 de la revisión 2d)', () => {
  const tree = [{
    node_id: 'a', title: 'Nodo', children: [],
    style: { backgroundColor: null }, stickers: [], icons: [],
    notes: [],
    externalRefs: [
      { url: 'JaVaScRiPt:alert(1)', label: 'Uno' },
      { url: 'java\tscript:alert(1)', label: 'Dos' }
    ],
    links: []
  }];
  const html = renderTree(tree, { title: 'Test' });
  assert.ok(!html.includes('<a'));
  assert.strictEqual((html.match(/<span class="ext-ref">/g) || []).length, 2);
});

test('6.24 normalizeNonce: acepta base64 y rechaza cargas (S-1 de la revisión 2d)', () => {
  assert.strictEqual(normalizeNonce('AbC123+/='), 'AbC123+/=');
  assert.strictEqual(normalizeNonce('abc-_123'), 'abc-_123');
  assert.strictEqual(normalizeNonce('abc'), '');
  assert.strictEqual(normalizeNonce('"onload=alert(1)'), '');
  assert.strictEqual(normalizeNonce('<script>'), '');
  assert.strictEqual(normalizeNonce('a'.repeat(65)), '');
  assert.strictEqual(normalizeNonce(null), '');
  assert.strictEqual(normalizeNonce(123), '');
});

testPage('6.25 _headers de la página estática: CSP coherente con app.js (S-2 de la revisión 2d)', () => {
  const headers = readFileSync(join(__dirname, '../../app/_headers'), 'utf-8');
  const app = readFileSync(join(__dirname, '../../app/app.js'), 'utf-8');
  assert.ok(headers.includes("script-src 'self'"));
  assert.ok(!headers.includes("script-src 'unsafe-inline'"));
  assert.ok(headers.includes("frame-ancestors 'none'"));
  assert.ok(headers.includes('X-Content-Type-Options: nosniff'));
  const match = app.match(/const WORKER_URL = '([^']+)'/);
  assert.ok(match, 'app.js debe declarar WORKER_URL');
  // Fase 3 (ruta A): connect-src incluye 'self' (credenciales.json) y el Worker
  const connect = headers.match(/connect-src ([^;]+)/);
  assert.ok(connect, '_headers debe declarar connect-src');
  assert.ok(connect[1].includes("'self'"), "connect-src debe incluir 'self' (credenciales.json)");
  assert.ok(connect[1].includes(match[1]), 'connect-src debe incluir la URL del Worker');
  // Las credenciales no se cachean: regla específica que anula la caché pública
  assert.ok(headers.includes('/credenciales.json'));
  assert.ok(headers.includes('! Cache-Control'));
  assert.ok(headers.includes('Cache-Control: no-store'));
  // La página se sirve con revalidación para reflejar los cambios de código
  assert.ok(headers.includes('Cache-Control: no-cache'));
  assert.ok(!headers.includes('max-age=3600'));
});

// ===========================================================================
// Layer 6: assembleHTML
// ===========================================================================

console.log('\n📄 Testing Layer 6: assembleHTML');

test('6.1 Generar HTML completo con DOCTYPE', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10, source_file: 'test.mup', converted_at: '2023-07-23T10:00:00Z' }, []);
  assert.ok(html.startsWith('<!DOCTYPE html>'));
  assert.ok(html.includes('<html lang="es">'));
  assert.ok(html.includes('</html>'));
});

test('6.2 Incluir CSS inline en <style>', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  assert.ok(html.includes('<style>'));
  assert.ok(html.includes('</style>'));
  assert.ok(html.includes('.node'));
});

test('6.3 Incluir JavaScript inline en <script>', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  assert.ok(html.includes('<script>'));
  assert.ok(html.includes('toggleNode'));
  assert.ok(html.includes('expandAll') || html.includes('expand-all'));
});

test('6.4 Incluir JSON embebido como MMUP_DATA', () => {
  const links = [{ from_node_id: 'a', to_node_id: 'b', color: '#FF0000' }];
  const metadata = { title: 'Test', node_count: 10 };
  const html = assembleHTML('<div>tree</div>', metadata, links);
  assert.ok(html.includes('const MMUP_DATA ='));
  // Verificar que el JSON contiene los datos
  const match = html.match(/const MMUP_DATA = ({.*?});/s);
  assert.ok(match);
  const data = JSON.parse(match[1]);
  assert.strictEqual(data.metadata.title, 'Test');
  assert.strictEqual(data.links.length, 1);
});

test('6.5 Incluir SVG overlay', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  assert.ok(html.includes('id="links-overlay"'));
  assert.ok(html.includes('<svg'));
  assert.ok(html.includes('pointer-events: none'));
});

test('6.6 Title escapado (anti-XSS)', () => {
  const html = assembleHTML('<div>tree</div>', { title: '<script>alert("xss")</script>', node_count: 10 }, []);
  assert.ok(!html.includes('<title>Visor mmup — <script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

test('6.7 MMUP_DATA embebido contiene stickers e icons', () => {
  const metadata = { title: 'Test', node_count: 10 };
  const links = [{ from_node_id: 'a', to_node_id: 'b', color: '#FF0000' }];
  const stickers = [
    { sticker_id: 's1', node_id: 'a', emoji_code: 'emoji:1F5FA', emoji_display: '🗺️', category: 'travel' }
  ];
  // URL con ';' (data URI real) para verificar que el regex extrae el JSON completo
  const icons = [
    { icon_id: 'i1', node_id: 'a', url: 'data:image/png;base64,xxxx', width: 32, height: 32, position: 'left' }
  ];
  const html = assembleHTML('<div>tree</div>', metadata, links, stickers, icons);
  assert.ok(html.includes('const MMUP_DATA ='));
  // El JSON embebido termina en ;</script> (safeJsonForScript escapa </ dentro de strings)
  const match = html.match(/const MMUP_DATA = ({.*?});\s*<\/script>/s);
  assert.ok(match);
  const data = JSON.parse(match[1]);
  // Las cinco claves deben estar presentes (attachments añadida para el modal)
  assert.deepStrictEqual(Object.keys(data).sort(), ['attachments', 'icons', 'links', 'metadata', 'stickers']);
  assert.strictEqual(data.metadata.title, 'Test');
  assert.strictEqual(data.links.length, 1);
  assert.strictEqual(data.stickers.length, 1);
  assert.strictEqual(data.stickers[0].emoji_display, '🗺️');
  assert.strictEqual(data.icons.length, 1);
  assert.strictEqual(data.icons[0].url, 'data:image/png;base64,xxxx');
  assert.strictEqual(data.icons[0].width, 32);
  assert.strictEqual(data.icons[0].height, 32);
  // attachments por defecto es un array vacío
  assert.deepStrictEqual(data.attachments, []);
});

test('6.8 MMUP_DATA transmite attachments para el modal', () => {
  const metadata = { title: 'Test', node_count: 10 };
  const attachments = [
    { node_id: 'a', name: 'nota.txt', contentType: 'text/plain', content: 'data:text/plain;base64,SG9sYQ==' }
  ];
  const html = assembleHTML('<div>tree</div>', metadata, [], [], [], attachments);
  const match = html.match(/const MMUP_DATA = ({.*?});\s*<\/script>/s);
  assert.ok(match);
  const data = JSON.parse(match[1]);
  assert.strictEqual(data.attachments.length, 1);
  assert.deepStrictEqual(data.attachments[0], {
    node_id: 'a',
    name: 'nota.txt',
    contentType: 'text/plain',
    content: 'data:text/plain;base64,SG9sYQ=='
  });
});

test('6.9 El HTML incluye el modal de adjuntos y el interruptor de tema', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // Modal
  assert.ok(html.includes('id="attachment-modal"'));
  assert.ok(html.includes('class="modal-overlay"'));
  assert.ok(html.includes('class="modal-close"'));
  assert.ok(html.includes('id="attachment-modal-body"'));
  // Interruptor de tema
  assert.ok(html.includes('id="theme-toggle"'));
  assert.ok(html.includes('class="theme-switch"'));
  assert.ok(html.includes('Aplicar tema del mapa'));
  // CSS de modal, adjuntos (ventana emergente y descarga) y tema
  assert.ok(html.includes('.attachment-link'));
  assert.ok(html.includes('.attachment-download'));
  assert.ok(html.includes('.modal-overlay'));
  assert.ok(html.includes('.theme-switch'));
  // JS de apertura/cierre y tema
  assert.ok(html.includes('openAttachmentModal'));
  assert.ok(html.includes('closeAttachmentModal'));
  assert.ok(html.includes('themeOverrides'));
});

test('6.10 El JS del modal decodifica base64 y muestra texto pre-wrap', () => {
  const attachments = [
    { node_id: 'a', name: 'nota.txt', contentType: 'text/plain', content: 'data:text/plain;base64,SG9sYQ==' }
  ];
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, [], [], [], attachments);
  // La lógica decodifica la data URI y asigna textContent (seguro anti-XSS)
  assert.ok(html.includes('decodeAttachmentContent'));
  assert.ok(html.includes('new TextDecoder'));
  assert.ok(html.includes('white-space: pre-wrap'));
  assert.ok(html.includes('a.node_id === nodeId'));
});

test('6.11 El CSS incluye estilos para .attachment-download (descarga directa)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // Diferenciado del enlace de ventana emergente
  assert.ok(html.includes('.attachment-download'));
  assert.ok(html.includes('.attachment-link'));
});

test('6.12 El JS asigna la data URI a los enlaces .attachment-download desde MMUP_DATA', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // Busca los enlaces de descarga renderizados por Layer 5
  assert.ok(html.includes("querySelectorAll('.attachment-download')"));
  // Localiza el adjunto por node_id en MMUP_DATA.attachments
  assert.ok(html.includes('a.node_id === link.dataset.nodeId'));
  // Asigna el href real (data URI del contenido) y el atributo download
  assert.ok(html.includes('link.href = attachment.content'));
  assert.ok(html.includes('link.download = attachment.name'));
});

test('6.12b El JS valida el esquema data: antes de asignar el href (seguridad)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // La guarda evita vectores con esquemas no data (p.ej. javascript:)
  assert.ok(html.includes("attachment.content.startsWith('data:')"));
});

test('6.13 El JS del modal avisa de adjuntos binarios (defensa general)', () => {
  const attachments = [
    { node_id: 'a', name: 'datos.zip', contentType: 'application/zip', content: 'data:application/zip;base64,UEsDBA==' }
  ];
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, [], [], [], attachments);
  // La defensa usa la clasificación general isTextAttachment en el modal
  assert.ok(html.includes('function isTextAttachment'));
  assert.ok(html.includes('es un archivo binario'));
  assert.ok(html.includes('no se puede visualizar como texto'));
});

// --- Contratos de saneo VIS-C2: selectores, índice y escapeHtml del cliente ---

test('6.14 El JS usa CSS.escape en todos los selectores por data-id (VIS-C2)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  assert.ok(html.includes('CSS.escape('));
  assert.ok(html.includes('CSS.escape(nodeId)'));
  assert.ok(html.includes('CSS.escape(link.from_node_id)'));
  assert.ok(html.includes('CSS.escape(link.to_node_id)'));
});

test('6.15 El JS no contiene la concatenación vulnerable del selector (VIS-C2)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // Patrón antiguo: '.node[data-id="' + nodeId + '"]' sin CSS.escape
  assert.ok(!html.includes(`'.node[data-id="' + nodeId + '"]'`));
});

test('6.16 buildIndex construye los items con DOM y replaceChildren (VIS-C2)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // Items creados con DOM + textContent (sin innerHTML)
  assert.ok(html.includes("document.createElement('div')"));
  assert.ok(html.includes('item.dataset.id = nodeId'));
  assert.ok(html.includes('item.textContent = title'));
  assert.ok(html.includes('item.style.paddingLeft'));
  assert.ok(html.includes('replaceChildren(...items)'));
  // Ya no se concatena HTML para el índice
  assert.ok(!html.includes(`html += '<div class="index-item"`));
});

test('6.17 escapeHtml del cliente escapa comillas con reemplazos manuales (VIS-C2)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  assert.ok(html.includes(`.replace(/&/g, '&amp;')`));
  assert.ok(html.includes(`.replace(/</g, '&lt;')`));
  assert.ok(html.includes(`.replace(/>/g, '&gt;')`));
  assert.ok(html.includes(`.replace(/"/g, '&quot;')`));
  assert.ok(html.includes(`.replace(/'/g, '&#039;')`));
});

// --- Integridad del JavaScript embebido (sintaxis y neutralización de cierre) ---

test('6.18 Los bloques <script> del HTML parsean como JavaScript válido', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  // MMUP_DATA + JavaScript del cliente
  assert.strictEqual(scripts.length, 2);
  for (const code of scripts) {
    // new Function solo parsea el cuerpo, sin ejecutarlo
    assert.doesNotThrow(() => new Function(code));
  }
});

test('6.19 MMUP_DATA neutraliza el cierre de script en emoji_display (seguridad)', () => {
  const payload = '</script><script>alert(1)</script>';
  const stickers = [
    { sticker_id: 's1', node_id: 'a', emoji_code: 'emoji:1F5FA', emoji_display: payload }
  ];
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, [], stickers);
  // La secuencia cruda que cerraría el bloque no aparece en el HTML
  assert.ok(!html.includes('</script><script>alert'));
  // safeJsonForScript escapa '</' como '<\/' dentro del JSON embebido
  assert.ok(html.includes('<\\/script><script>alert'));
  // El JSON sigue siendo válido y conserva el valor original
  const match = html.match(/const MMUP_DATA = ({.*?});\s*<\/script>/s);
  assert.ok(match);
  const data = JSON.parse(match[1]);
  assert.strictEqual(data.stickers[0].emoji_display, payload);
});

// --- W2: nonce CSP en las etiquetas <script> ---

test('6.20 assembleHTML aplica el nonce a los dos <script> (W2)', () => {
  const nonce = 'abc123+/=';
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, [], [], [], [], { nonce });
  // Ambos bloques (MMUP_DATA y JS del cliente) llevan el mismo nonce
  assert.strictEqual(html.split(`<script nonce="${nonce}">`).length - 1, 2);
  // No queda ningún <script> inline sin nonce
  assert.ok(!html.includes('<script>'));
});

test('6.21 assembleHTML sin nonce mantiene el comportamiento actual (retrocompatible)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  assert.ok(!html.includes('nonce='));
  assert.ok(html.includes('<script>'));
  assert.strictEqual(html.split('<script>').length - 1, 2);
});

test('6.22 assembleHTML ignora un nonce con formato inválido (defensa en profundidad)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, [], [], [], [], {
    nonce: '"><script>alert(1)</script>'
  });
  // El nonce inválido no se inserta ni rompe el atributo
  assert.ok(!html.includes('nonce='));
  assert.ok(!html.includes('"><script>'));
  assert.ok(html.includes('<script>'));
});

// --- Defensa en profundidad del overlay: color y ancho de links ---

test('6.23 El JS del overlay valida color y ancho antes de usarlos en SVG (W2)', () => {
  const html = assembleHTML('<div>tree</div>', { title: 'Test', node_count: 10 }, []);
  // Helpers de validación presentes en el JS embebido
  assert.ok(html.includes('function safeLinkColor'));
  assert.ok(html.includes('function safeLinkWidth'));
  assert.ok(html.includes('[0-9A-Fa-f]{6}'));
  assert.ok(html.includes("? color : '#808000'"));
  assert.ok(html.includes('Number.isFinite(value) && value > 0 ? value : 2'));
  // Los atributos SVG usan los valores saneados, no el dato crudo
  assert.ok(!html.includes("path.setAttribute('stroke', link.color || '#808000')"));
  assert.ok(!html.includes("path.setAttribute('stroke-width', link.width || 2)"));
  assert.ok(html.includes("path.setAttribute('stroke', strokeColor)"));
  assert.ok(html.includes("path.setAttribute('stroke-width', strokeWidth)"));
});

// ===========================================================================
// Utilidades: emoji-map
// ===========================================================================

console.log('\n😀 Testing Utilities: emoji-map');

test('U1.1 convertEmoji: formato "emoji:XXXX" → Unicode (desde tabla)', () => {
  const result = convertEmoji('emoji:1F5FA');
  assert.strictEqual(result, '🗺️');
});

test('U1.2 convertEmoji: formato "emoji:XXXX" → Unicode (corazón)', () => {
  const result = convertEmoji('emoji:2764');
  assert.strictEqual(result, '❤️');
});

test('U1.3 convertEmoji: fallback si no está en tabla (fromCodePoint)', () => {
  // 1F600 es 😀 que no está en la tabla pero es un código válido
  const result = convertEmoji('emoji:1F600');
  assert.strictEqual(result, '😀');
});

test('U1.4 convertEmoji: fallback si código inválido → sticker original', () => {
  // Código hex inválido que cause error en fromCodePoint
  const result = convertEmoji('emoji:XYZ123');
  // NaN en parseInt → fromCodePoint(NaN) → podría tirar error o devolver algo
  // En realidad parseInt('XYZ123', 16) = NaN, fromCodePoint(NaN) = '\0' o tira error
  // La función debe devolver el sticker original como fallback
  assert.ok(typeof result === 'string');
});

test('U1.5 convertEmoji: texto plano sin formato → tal cual', () => {
  assert.strictEqual(convertEmoji('texto plano'), 'texto plano');
  assert.strictEqual(convertEmoji('hello'), 'hello');
});

test('U1.6 convertEmoji: no-string → String()', () => {
  assert.strictEqual(convertEmoji(123), '123');
  assert.strictEqual(convertEmoji(null), 'null');
});

test('U1.7 convertStickers: array → string separado por espacios', () => {
  const result = convertStickers(['emoji:1F5FA', 'emoji:2764']);
  assert.strictEqual(result, '🗺️ ❤️');
});

test('U1.8 convertStickers: array vacío o null → string vacío', () => {
  assert.strictEqual(convertStickers([]), '');
  assert.strictEqual(convertStickers(null), '');
  assert.strictEqual(convertStickers(undefined), '');
});

test('U1.9 convertEmoji: múltiples puntos de código (tecla numérica 2)', () => {
  // 'emoji:0032 20E3' = U+0032 (dígito 2) + U+20E3 (signo combinante de tecla)
  // La forma canónica incluye U+FE0F (selector de variación) antes del signo
  const result = convertEmoji('emoji:0032 20E3');
  assert.strictEqual(result, '2️⃣');
});

test('U1.10 convertEmoji: múltiples puntos de código (mujer con tono de piel)', () => {
  // 'emoji:1F469 1F3FB' = U+1F469 (mujer) + U+1F3FB (tono de piel claro)
  const result = convertEmoji('emoji:1F469 1F3FB');
  assert.strictEqual(result, '👩🏻');
});

test('U1.11 convertEmoji: reintento sin selector de variación U+FE0F', () => {
  // 'emoji:2764 FE0F' → sin U+FE0F → '2764' está en la tabla → ❤️
  const result = convertEmoji('emoji:2764 FE0F');
  assert.strictEqual(result, '❤️');
});

test('U1.12 convertEmoji: códigos inválidos devuelven el sticker original', () => {
  // > 0x10FFFF (fuera del rango Unicode)
  assert.strictEqual(convertEmoji('emoji:110000'), 'emoji:110000');
  // Punto de código sustituto (U+D800–U+DFFF, produciría par huérfano)
  assert.strictEqual(convertEmoji('emoji:D800'), 'emoji:D800');
  // Hex no numérico → NaN filtrado
  assert.strictEqual(convertEmoji('emoji:XYZ123'), 'emoji:XYZ123');
});

// ===========================================================================
// Utilidades: html-templates
// ===========================================================================

console.log('\n📝 Testing Utilities: html-templates');

test('U2.1 render404HTML: genera HTML con UUID', () => {
  const html = render404HTML('abc-123-def');
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Error 404'));
  assert.ok(html.includes('abc-123-def'));
  assert.ok(html.includes('<code>'));
});

test('U2.2 render400HTML: genera HTML con mensaje', () => {
  const html = render400HTML('UUID inválido');
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Error 400'));
  assert.ok(html.includes('UUID inválido'));
});

test('U2.3 render500HTML: genera HTML con mensaje genérico', () => {
  const html = render500HTML('Error interno del servidor');
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Error 500'));
  assert.ok(html.includes('Error interno del servidor'));
});

test('U2.3b render500HTML ignora detalles internos y usa siempre el genérico (W6)', () => {
  const html = render500HTML('detalle interno: /ruta/secreta del bucket');
  assert.ok(html.includes('Error interno del servidor'));
  assert.ok(!html.includes('detalle interno'));
  assert.ok(!html.includes('/ruta/secreta'));
});

test('U2.4 renderErrorHTML: con UUID muestra bloque code', () => {
  const html = renderErrorHTML('Error', 'Mensaje', 'test-uuid');
  assert.ok(html.includes('<code>test-uuid</code>'));
});

test('U2.5 renderErrorHTML: sin UUID no muestra bloque code', () => {
  const html = renderErrorHTML('Error', 'Mensaje');
  assert.ok(!html.includes('<code>'));
});

test('U2.6 Textos dinámicos escapados (anti-XSS)', () => {
  const html = render404HTML('<script>alert("xss")</script>');
  assert.ok(!html.includes('<script>alert'));
  assert.ok(html.includes('&lt;script&gt;'));
});

// ===========================================================================
// Seguridad VIS-C3: validación de identificadores, página estática y Worker
// ===========================================================================

console.log('\n🔒 Testing Seguridad VIS-C3: identificadores y página estática');

test('U3.1 isValidIdentifier: acepta identificadores válidos', () => {
  assert.ok(IDENTIFIER_PATTERN instanceof RegExp);
  assert.strictEqual(isValidIdentifier('mapa-sintetico'), true);
  assert.strictEqual(isValidIdentifier('mapa-sintetico-completo'), true);
  assert.strictEqual(isValidIdentifier('mapa.v1_final-2023'), true);
  assert.strictEqual(isValidIdentifier('A1'), true);
  assert.strictEqual(isValidIdentifier('a'.repeat(200)), true);
});

test('U3.2 isValidIdentifier: rechaza caracteres fuera de la lista permitida', () => {
  assert.strictEqual(isValidIdentifier('a/b'), false);
  assert.strictEqual(isValidIdentifier('a b'), false);
  assert.strictEqual(isValidIdentifier('a"b'), false);
  assert.strictEqual(isValidIdentifier("a'b"), false);
  assert.strictEqual(isValidIdentifier('a;b'), false);
  assert.strictEqual(isValidIdentifier('<script>alert(1)</script>'), false);
  assert.strictEqual(isValidIdentifier('..%2Fsecreto'), false);
});

test('U3.3 isValidIdentifier: rechaza vacío, demasiado largo y valores no string', () => {
  assert.strictEqual(isValidIdentifier(''), false);
  assert.strictEqual(isValidIdentifier('a'.repeat(201)), false);
  assert.strictEqual(isValidIdentifier(null), false);
  assert.strictEqual(isValidIdentifier(undefined), false);
  assert.strictEqual(isValidIdentifier(123), false);
  assert.strictEqual(isValidIdentifier({}), false);
  assert.strictEqual(isValidIdentifier(['a']), false);
});

test('U3.3b isValidIdentifier: rechaza valores formados solo por puntos', () => {
  // Pasan la lista de caracteres permitidos, pero son componentes especiales
  // de ruta ('.' y '..'); el resto de identificadores no cambia
  assert.strictEqual(isValidIdentifier('.'), false);
  assert.strictEqual(isValidIdentifier('..'), false);
  assert.strictEqual(isValidIdentifier('...'), false);
});

testPage('U3.4 Página estática: encodeURIComponent y node_count numérico (VIS-C3)', () => {
  // Tras la externalización (W2) el script vive en app.js
  const appPath = join(__dirname, '../../app/app.js');
  const appJS = readFileSync(appPath, 'utf-8');
  // El href del botón codifica el identificador; el contador se fuerza a número
  assert.ok(appJS.includes('encodeURIComponent(String(item.uuid))'));
  assert.ok(appJS.includes('Number(item.node_count) || 0'));
});

testPage('U3.5 Página estática: escapeHtml local escapa comillas (VIS-C3)', () => {
  const appPath = join(__dirname, '../../app/app.js');
  const appJS = readFileSync(appPath, 'utf-8');
  // Reemplazos manuales: incluyen comillas simples y dobles
  assert.ok(appJS.includes(`.replace(/"/g, '&quot;')`));
  assert.ok(appJS.includes(`.replace(/'/g, '&#039;')`));
  // Ya no se usa el truco de div.innerHTML (no escapa comillas)
  assert.ok(!appJS.includes('return div.innerHTML'));
});

testPage('U3.8 Página estática: script externalizado para la CSP (W2)', () => {
  const pagePath = join(__dirname, '../../app/index.html');
  const pageHTML = readFileSync(pagePath, 'utf-8');
  // El HTML carga app.js como recurso externo y no conserva script inline
  assert.ok(pageHTML.includes('<script src="app.js"></script>'));
  assert.ok(!pageHTML.includes('<script>'));
});

// --- Fase 3 (ruta A): gate de login de la página de lista ---

testPage('U3.9 Login: index.html incluye formulario accesible y cierre de sesión', () => {
  const pagePath = join(__dirname, '../../app/index.html');
  const pageHTML = readFileSync(pagePath, 'utf-8');
  // Formulario con campos etiquetados de usuario y contraseña
  assert.ok(pageHTML.includes('id="login-form"'));
  assert.ok(pageHTML.includes('for="login-user"'));
  assert.ok(pageHTML.includes('id="login-user"'));
  assert.ok(pageHTML.includes('for="login-password"'));
  assert.ok(pageHTML.includes('id="login-password"'));
  assert.ok(pageHTML.includes('type="password"'));
  // Error con anuncio accesible y lista oculta hasta autenticarse
  assert.ok(pageHTML.includes('id="login-error"'));
  assert.ok(pageHTML.includes('role="alert"'));
  assert.ok(/id="content-view"[^>]*hidden/.test(pageHTML));
  // Botón de cierre de sesión (visible con la sesión iniciada)
  assert.ok(pageHTML.includes('id="logout-btn"'));
  // Aviso si el navegador no ejecuta JavaScript
  assert.ok(pageHTML.includes('<noscript>'));
});

testPage('U3.10 Login: app.js verifica SHA-256 contra credenciales.json y gestiona la sesión', () => {
  const appPath = join(__dirname, '../../app/app.js');
  const appJS = readFileSync(appPath, 'utf-8');
  // Descarga de credenciales.json sin caché
  assert.ok(appJS.includes('credenciales.json'));
  assert.ok(appJS.includes("fetch(CREDENTIALS_URL, { cache: 'no-store' })"));
  // Verificación SHA-256 (Web Crypto) de usuario:contraseña
  assert.ok(appJS.includes('crypto.subtle.digest'));
  assert.ok(appJS.includes("'SHA-256'"));
  assert.ok(appJS.includes("usuario + ':' + contrasena"));
  // Sesión en localStorage y cierre de sesión
  assert.ok(appJS.includes('localStorage.getItem'));
  assert.ok(appJS.includes('localStorage.setItem'));
  assert.ok(appJS.includes('localStorage.removeItem'));
  assert.ok(appJS.includes("getElementById('logout-btn')"));
});

testPage('U3.11 Login: credenciales.json solo guarda usuario y hash SHA-256 (sin contraseña)', () => {
  const credPath = join(__dirname, '../../app/credenciales.json');
  const cred = JSON.parse(readFileSync(credPath, 'utf-8'));
  assert.deepStrictEqual(Object.keys(cred).sort(), ['hash', 'usuario']);
  assert.strictEqual(cred.usuario, 'admin');
  // El hash no se duplica en la prueba: basta el formato (la correspondencia con
  // la contraseña se verificó al implementar y se comprueba en la validación)
  assert.ok(/^[0-9a-f]{64}$/.test(cred.hash), 'hash debe ser 64 caracteres hexadecimales');
  // La contraseña en claro no está presente en el fichero
  assert.strictEqual(cred.contrasena, undefined);
  assert.strictEqual(cred.password, undefined);
});

testPage('U3.12 Página estática: listado en tabla ordenable y título (VIS-C3)', () => {
  const pagePath = join(__dirname, '../../app/index.html');
  const appPath = join(__dirname, '../../app/app.js');
  const pageHTML = readFileSync(pagePath, 'utf-8');
  const appJS = readFileSync(appPath, 'utf-8');

  // Título de la pantalla
  assert.ok(pageHTML.includes('<title>Visualizador MMAP Conversiones</title>'));
  assert.ok(pageHTML.includes('<h1>Visualizador MMAP Conversiones</h1>'));

  // Tabla con las cinco columnas solicitadas, en orden
  assert.ok(appJS.includes('class="map-table"'));
  assert.ok(appJS.includes("renderSortHeader('nombre', 'Nombre MMAP'"));
  assert.ok(appJS.includes("renderSortHeader('fecha', 'Fecha conversión'"));
  assert.ok(appJS.includes("renderSortHeader('nodos', 'Nodos'"));
  assert.ok(appJS.includes("renderSortHeader('version', 'Versión conversor'"));
  assert.ok(appJS.includes('<th scope="col" class="col-action">Visualizar</th>'));

  // Nombre real desde source_file, sin extensión, con fallback defensivo
  assert.ok(appJS.includes('item.source_file'));
  assert.ok(appJS.includes('sourceFile.replace('));
  assert.ok(appJS.includes('mup$/i'));
  assert.ok(appJS.includes("MISSING_NAME = 'No disponible'"));

  // Fecha en UTC con formato DD/MM/AA
  assert.ok(appJS.includes('date.getUTCDate()'));
  assert.ok(appJS.includes('date.getUTCMonth()'));
  assert.ok(appJS.includes('date.getUTCFullYear()'));
  assert.ok(appJS.includes("padStart(2, '0')"));

  // Ordenación accesible: fecha descendente por defecto y aria-sort
  assert.ok(appJS.includes("DEFAULT_SORT = { key: 'fecha', direction: 'desc' }"));
  assert.ok(appJS.includes('aria-sort="${ariaSort}"'));
  assert.ok(appJS.includes('data-sort-key="${key}"'));
});

testPage('U3.13 Página estática: ordenación, fecha UTC y nombre desde source_file', () => {
  const appPath = join(__dirname, '../../app/app.js');
  const appJS = readFileSync(appPath, 'utf-8');
  const elements = new Map();

  const makeElement = () => ({
    innerHTML: '',
    hidden: false,
    value: '',
    textContent: '',
    listeners: {},
    addEventListener(type, listener) { this.listeners[type] = listener; },
    reset() {}
  });

  const documentMock = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, makeElement());
      return elements.get(id);
    }
  };

  const context = vm.createContext({
    document: documentMock,
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {}
    },
    console
  });

  vm.runInContext(appJS, context, { filename: 'app.js' });

  const items = [
    {
      uuid: 'antiguo',
      title: 'Título descriptivo',
      source_file: 'Mapa_Sintetico_Alfa.mup',
      converted_at: '2023-01-05T23:30:00Z',
      node_count: 10
    },
    {
      uuid: 'reciente',
      title: 'Otro título',
      source_file: 'MAPA_SINTETICO_BETA.MUP',
      converted_at: '2023-08-12T10:00:00Z',
      node_count: 3
    },
    {
      uuid: 'sin-archivo',
      source_file: '',
      converted_at: 'fecha-invalida',
      node_count: '7'
    }
  ];

  context.renderMaps(items);
  let html = elements.get('content').innerHTML;

  // Por defecto: fecha descendente; la fecha inválida queda al final
  assert.ok(html.indexOf('MAPA_SINTETICO_BETA') < html.indexOf('Mapa_Sintetico_Alfa'));
  assert.ok(html.indexOf('Mapa_Sintetico_Alfa') < html.indexOf('No disponible'));
  // Nombre sintético sin extensión (también en mayúsculas) y en negrita
  assert.ok(html.includes('<strong>MAPA_SINTETICO_BETA</strong>'));
  assert.ok(html.includes('<strong>Mapa_Sintetico_Alfa</strong>'));
  // Fecha UTC DD/MM/AA: 23:30Z no debe desplazarse al día siguiente
  assert.ok(html.includes('05/01/23'));
  assert.ok(html.includes('12/08/23'));
  // La versión de conversión no está en el contrato: se muestra un guion
  assert.ok(html.includes('Versión conversor'));
  assert.ok(html.includes('>—</td>'));

  // Primer clic en una columna nueva: ascendente
  context.handleSortClick({
    target: { closest: () => ({ dataset: { sortKey: 'nombre' } }) }
  });
  html = elements.get('content').innerHTML;
  assert.ok(html.indexOf('Mapa_Sintetico_Alfa') < html.indexOf('MAPA_SINTETICO_BETA'));
  assert.ok(html.indexOf('MAPA_SINTETICO_BETA') < html.indexOf('No disponible'));

  // Segundo clic en la misma columna: descendente
  context.handleSortClick({
    target: { closest: () => ({ dataset: { sortKey: 'nombre' } }) }
  });
  html = elements.get('content').innerHTML;
  assert.ok(html.indexOf('MAPA_SINTETICO_BETA') < html.indexOf('Mapa_Sintetico_Alfa'));
});

await testAsync('U3.6 Worker: identificador inválido en /visor/mmup-output/ → 400 (VIS-C3)', async () => {
  silenceLogs();
  try {
    // env vacío: la petición debe rechazarse antes de tocar R2 o el DO
    const request = new Request('https://visualizador.test/visor/mmup-output/a%2Fb');
    const response = await visualizerWorker.fetch(request, {}, {});
    assert.strictEqual(response.status, 400);
    const body = await response.text();
    assert.ok(body.includes('Error 400'));
    assert.ok(body.includes('formato válido'));
  } finally {
    restoreLogs();
  }
});

await testAsync('U3.7 DO: ruta interna /convert/{uuid} inválida → 400 (VIS-C3)', async () => {
  silenceLogs();
  try {
    const doInstance = new MupVisualizer({}, {});
    const response = await doInstance.fetch(new Request('http://do/convert/a%2Fb'));
    assert.strictEqual(response.status, 400);
  } finally {
    restoreLogs();
  }
});

// ===========================================================================
// Tests con datos sintéticos inline
// ===========================================================================

console.log('\n🧪 Testing con datos sintéticos');

testConDatos('R1. Pipeline completo con mapa sintético (12 nodos)', ({ completo: mapaSintetico }) => {
  // Layer 2: Build tree
  const tree = buildTree(mapaSintetico.nodes);
  assert.strictEqual(tree.length, 1); // Una sola raíz
  assert.strictEqual(tree[0].title, 'Mapa sintético completo');

  // Layer 3: Attach data
  attachData(tree, mapaSintetico.notes, mapaSintetico.externalRefs, mapaSintetico.links);

  // Verificar que las notas se vincularon
  let totalNotes = 0;
  function countNotes(node) {
    totalNotes += node.notes.length;
    node.children.forEach(countNotes);
  }
  tree.forEach(countNotes);
  assert.strictEqual(totalNotes, mapaSintetico.notes.length);

  // Layer 4: Apply styles
  applyStyles(tree, mapaSintetico.attributes);

  // Layer 5: Render tree
  const treeHTML = renderTree(tree, mapaSintetico.metadata);
  assert.ok(treeHTML.includes('role="tree"'));
  assert.ok(treeHTML.includes('Mapa sintético completo'));

  // Layer 6: Assemble HTML
  const html = assembleHTML(treeHTML, mapaSintetico.metadata, mapaSintetico.links);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('MMUP_DATA'));
});

testConDatos('R2. Pipeline completo con mapa sintético mínimo (10 nodos)', ({ minimo: mapaSintetico }) => {
  const tree = buildTree(mapaSintetico.nodes);
  assert.strictEqual(tree.length, 1);
  assert.strictEqual(tree[0].title, 'Mapa sintético mínimo');

  attachData(tree, mapaSintetico.notes, mapaSintetico.externalRefs, mapaSintetico.links);
  applyStyles(tree, mapaSintetico.attributes);

  const treeHTML = renderTree(tree, mapaSintetico.metadata);
  assert.ok(treeHTML.includes('role="tree"'));

  const html = assembleHTML(treeHTML, mapaSintetico.metadata, mapaSintetico.links);
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('Mapa sintético mínimo'));
});

testConDatos('R3. Stickers del mapa sintético se convierten correctamente', ({ completo: mapaSintetico }) => {
  // Pipeline completo: buildTree → attachData (con stickers e icons) → applyStyles → renderTree
  const tree = buildTree(mapaSintetico.nodes);
  attachData(tree, mapaSintetico.notes, mapaSintetico.externalRefs, mapaSintetico.links, mapaSintetico.stickers, mapaSintetico.icons);
  applyStyles(tree, mapaSintetico.attributes);

  // Buscar el primer nodo con stickers recorriendo el árbol
  function findFirstWithStickers(nodes) {
    for (const n of nodes) {
      if (n.stickers.length > 0) return n;
      const found = findFirstWithStickers(n.children);
      if (found) return found;
    }
    return null;
  }

  const nodeWithStickers = findFirstWithStickers(tree);
  assert.ok(nodeWithStickers, 'Debe existir al menos un nodo con stickers adjuntados');

  // (a) Las pegatinas se adjuntan como objetos de la colección con emoji_display
  assert.ok(nodeWithStickers.stickers.length > 0);
  const sticker = nodeWithStickers.stickers[0];
  assert.strictEqual(typeof sticker, 'object');
  assert.ok(sticker.emoji_code, 'sticker debe tener emoji_code');
  assert.ok(sticker.emoji_display, 'sticker debe tener emoji_display');

  // (b) El HTML renderizado contiene los emojis convertidos (emoji_display directo,
  //     o convertEmoji sobre emoji_code como respaldo)
  const treeHTML = renderTree(tree, mapaSintetico.metadata);
  for (const s of nodeWithStickers.stickers) {
    const emoji = s.emoji_display || convertEmoji(s.emoji_code);
    assert.ok(treeHTML.includes(emoji), `El HTML debe contener el emoji "${emoji}"`);
  }

  // Todos los stickers de la colección se adjuntan a sus nodos (sin huérfanos)
  let totalStickers = 0;
  function countStickers(node) {
    totalStickers += node.stickers.length;
    node.children.forEach(countStickers);
  }
  tree.forEach(countStickers);
  assert.strictEqual(totalStickers, mapaSintetico.stickers.length);
});

testConDatos('R4. Links del mapa sintético se adjuntan cuando están resueltos', ({ completo: mapaSintetico }) => {
  const tree = buildTree(mapaSintetico.nodes);
  attachData(tree, mapaSintetico.notes, mapaSintetico.externalRefs, mapaSintetico.links, mapaSintetico.stickers, mapaSintetico.icons);

  // El mapa sintético tiene 1 link RESUELTO (from_node_id y to_node_id no nulos)
  assert.strictEqual(mapaSintetico.links.length, 1);
  const link = mapaSintetico.links[0];
  assert.ok(link.from_node_id, 'from_node_id no debe ser null');
  assert.ok(link.to_node_id, 'to_node_id no debe ser null');

  // Recorrer el árbol: el link debe adjuntarse al nodo origen
  let totalLinks = 0;
  let fromNode = null;
  function countLinks(node) {
    totalLinks += node.links.length;
    if (node.node_id === link.from_node_id) fromNode = node;
    node.children.forEach(countLinks);
  }
  tree.forEach(countLinks);

  // Total de enlaces adjuntados = 1
  assert.strictEqual(totalLinks, 1);
  // Se adjunta al nodo con node_id === from_node_id
  assert.ok(fromNode, 'El nodo origen debe existir en el árbol');
  assert.strictEqual(fromNode.links.length, 1);
  assert.strictEqual(fromNode.links[0].link_id, link.link_id);
  assert.strictEqual(fromNode.links[0].to_node_id, link.to_node_id);
  // Conserva los atributos de estilo del link
  assert.strictEqual(fromNode.links[0].color, link.color);
  assert.strictEqual(fromNode.links[0].line_style, link.line_style);
  assert.strictEqual(fromNode.links[0].arrow, link.arrow);
  assert.strictEqual(fromNode.links[0].width, link.width);
});

test('R4b. Links con from_node_id null (sintéticos) se ignoran', () => {
  // Caso sin resolver con datos sintéticos: attachData debe ignorarlos (total 0)
  const tree = [
    { node_id: 'a', children: [{ node_id: 'b', children: [] }] }
  ];
  const links = [
    { from_node_id: null, to_node_id: 'b', color: '#FF0000' },
    { from_node_id: 'a', to_node_id: null, color: '#00FF00' },
    { from_node_id: null, to_node_id: null, color: '#0000FF' },
  ];
  attachData(tree, [], [], links);
  assert.strictEqual(tree[0].links.length, 0);
  assert.strictEqual(tree[0].children[0].links.length, 0);
});

test('R5. formatDate funciona con fechas sintéticas', () => {
  const result = formatDate('2023-11-14T22:13:20.000Z');
  assert.ok(result.includes('2023'));
  assert.ok(result.includes('noviembre') || result.includes('14'));
});

test('R6. formatDate con null/invalid → "Fecha desconocida"', () => {
  assert.strictEqual(formatDate(null), 'Fecha desconocida');
  assert.strictEqual(formatDate(undefined), 'Fecha desconocida');
  assert.strictEqual(formatDate(''), 'Fecha desconocida');
  assert.strictEqual(formatDate('invalid'), 'Fecha desconocida');
});

// ===========================================================================
// Resumen
// ===========================================================================

console.log('\n' + '='.repeat(60));
console.log(`📊 Resultados: ${passedTests}/${totalTests} tests pasados`);
if (skippedTests > 0) {
  console.log(`⏭️  ${skippedTests} tests omitidos de forma controlada (sin fallo)`);
}
if (failedTests > 0) {
  console.log(`❌ ${failedTests} tests fallaron:`);
  for (const f of failures) {
    console.log(`   - ${f.name}: ${f.error.message}`);
  }
  process.exit(1);
} else {
  console.log('✅ Todos los tests unitarios pasaron correctamente!');
}
