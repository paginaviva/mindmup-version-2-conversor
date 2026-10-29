/**
 * Tests unitarios — Capas 1 a 4 del Convertidor MUP
 *
 * Cada capa se testea de forma aislada siguiendo el patrón AAA
 * (Arrange-Act-Assert). Se cubren casos positivos (✅) y negativos (❌)
 * para cada comportamiento especificado.
 *
 * Ejecutar: node test/converter/test-layers-1-4.js
 * (Requiere "type": "module" en package.json)
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

import { parseMup } from '../../src/converter/layers/layer1-parse.js';
import { flattenNodes } from '../../src/converter/layers/layer2-flatten.js';
import { extractNotes } from '../../src/converter/layers/layer3-notes.js';
import { extractAttributes } from '../../src/converter/layers/layer4-attributes.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Lee un fixture del disco */
function readFixture(name) {
  return readFileSync(path.join(__dirname, 'fixtures', name), 'utf-8');
}

/** Parsea un fixture como objeto */
function parseFixture(name) {
  return JSON.parse(readFixture(name));
}

let passed = 0;
let failed = 0;

/**
 * Envoltorio de test con try/catch.
 * Las aserciones usan assert() para lanzar y marcar el fallo de verdad.
 */
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ❌ ${name}: ${e.message}`);
  }
}

/**
 * Assert que lanza Error si la condición es falsa.
 *
 * console.assert no lanza: como el runner solo marca fallo cuando la
 * función de test lanza, usarlo producía falsos verdes. Este helper
 * lanza siempre que la condición no se cumpla.
 */
function assert(condition, msg) {
  if (!condition) {
    throw new Error(msg || 'Assertion failed');
  }
}

/** Assert estricto (===) con mensaje */
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(
      `${msg || 'Values differ'}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

/** Assert de igualdad profunda para objetos */
function assertDeepEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `${msg || 'Objects differ'}\n  expected: ${e}\n  actual:   ${a}`
    );
  }
}

/** Assert de tipo UUID v4 */
function assertUUID(str, msg) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert(uuidRegex.test(str), `${msg || 'Expected UUID'} — got: ${str}`);
}

/** Assert lanza error */
function assertThrows(fn, expectedMsg, testName) {
  let threw = false;
  try {
    fn();
  } catch (e) {
    threw = true;
    if (expectedMsg && !e.message.includes(expectedMsg)) {
      throw new Error(
        `${testName || 'Assertion'}: expected message to include "${expectedMsg}", got "${e.message}"`
      );
    }
  }
  if (!threw) {
    throw new Error(`${testName || 'Assertion'}: expected function to throw`);
  }
}

// ---------------------------------------------------------------------------
// Constantes de configuración para tests
// ---------------------------------------------------------------------------
const VARIABLES = { MUP_FORMAT_VERSION: 3 };

// ===========================================================================
// CAPA 1 — parseMup()
// ===========================================================================
console.log('\n📦 Capa 1 — parseMup()');

// --- Test 1.1: Acepta .mup válido (synthetic-empty.mup) ---
test('Acepta .mup válido (synthetic-empty.mup)', () => {
  // Arrange
  const raw = parseFixture('synthetic-empty.mup');

  // Act
  const result = parseMup(raw, VARIABLES);

  // Assert
  assert(result !== null && typeof result === 'object', 'Resultado debe ser objeto');
  assert('metadata' in result, 'Resultado debe tener metadata');
  assert('rawJson' in result, 'Resultado debe tener rawJson');
});

// --- Test 1.2: Rechaza formatVersion !== 3 ---
test('Rechaza formatVersion !== 3 (synthetic-v2.mup)', () => {
  // Arrange
  const raw = parseFixture('synthetic-v2.mup');

  // Act & Assert
  assertThrows(
    () => parseMup(raw, VARIABLES),
    'Formato .mup no soportado',
    'Debería lanzar error de versión'
  );
});

// --- Test 1.3: Rechaza JSON sin ideas ---
test('Rechaza JSON sin ideas', () => {
  // Arrange
  const raw = { formatVersion: 3, id: 'test', title: 'No ideas' };

  // Act & Assert
  assertThrows(
    () => parseMup(raw, VARIABLES),
    'no contiene un objeto ideas',
    'Debería lanzar error por falta de ideas'
  );
});

// --- Test 1.4: Rechaza ideas vacío ---
test('Rechaza ideas vacío', () => {
  // Arrange
  const raw = { formatVersion: 3, id: 'test', ideas: {} };

  // Act & Assert
  assertThrows(
    () => parseMup(raw, VARIABLES),
    'vacío',
    'Debería lanzar error por ideas vacío'
  );
});

// --- Test 1.5: Extrae metadatos correctamente ---
test('Extrae metadatos correctamente', () => {
  // Arrange — fixture con todos los campos opcionales
  const raw = {
    formatVersion: 3,
    id: 'meta-test-map',
    title: 'Metadatos Test',
    author: 'Test Author',
    created: 1700000000,
    updated: 1700000060,
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata } = parseMup(raw, VARIABLES);

  // Assert
  assertEqual(metadata.map_id, 'meta-test-map', 'map_id');
  assertEqual(metadata.title, 'Metadatos Test', 'title');
  assertEqual(metadata.format_version, 3, 'format_version');
  assertEqual(metadata.author, 'Test Author', 'author');
  assertEqual(metadata.created_at, '2023-11-14T22:13:20.000Z', 'created_at');
  assertEqual(metadata.updated_at, '2023-11-14T22:14:20.000Z', 'updated_at');
});

// --- Test 1.6: Metadatos opcionales ausentes se omiten ---
test('Campos opcionales ausentes no aparecen en metadatos', () => {
  // Arrange — .mup sin author, created, updated
  const raw = {
    formatVersion: 3,
    id: 'minimal-map',
    title: 'Mínimo',
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata } = parseMup(raw, VARIABLES);

  // Assert
  assertEqual(metadata.map_id, 'minimal-map', 'map_id');
  assertEqual(metadata.title, 'Mínimo', 'title');
  assertEqual(metadata.format_version, 3, 'format_version');
  assert(
    metadata.author === undefined,
    `author debe ser undefined, got ${metadata.author}`
  );
  assert(
    metadata.created_at === undefined,
    `created_at debe ser undefined, got ${metadata.created_at}`
  );
  assert(
    metadata.updated_at === undefined,
    `updated_at debe ser undefined, got ${metadata.updated_at}`
  );
});

// --- Test 1.7: Extrae theme y themeOverrides del attr raíz ---
test('Extrae theme y themeOverrides del attr raíz si existen', () => {
  // Arrange — .mup con attr raíz que declara tema y ajustes del lienzo
  const raw = {
    formatVersion: 3,
    id: 'themed-map',
    title: 'Con tema',
    attr: {
      theme: 'default',
      themeOverrides: { canvas: { backgroundColor: '#efe9e3' } },
    },
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata } = parseMup(raw, VARIABLES);

  // Assert
  assertEqual(metadata.theme, 'default', 'metadata.theme');
  assertDeepEqual(
    metadata.themeOverrides,
    { canvas: { backgroundColor: '#efe9e3' } },
    'metadata.themeOverrides'
  );
});

// --- Test 1.8: Sin theme en el attr raíz no se incluyen campos ---
test('Sin theme en el attr raíz no se incluyen theme ni themeOverrides', () => {
  // Arrange — .mup con attr raíz vacío y otro sin attr
  const rawEmptyAttr = {
    formatVersion: 3,
    id: 'plain-map',
    title: 'Sin tema',
    attr: {},
    ideas: { '1': { id: 'n1', title: 'N' } },
  };
  const rawNoAttr = {
    formatVersion: 3,
    id: 'no-attr-map',
    title: 'Sin attr',
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata: m1 } = parseMup(rawEmptyAttr, VARIABLES);
  const { metadata: m2 } = parseMup(rawNoAttr, VARIABLES);

  // Assert — principio de agnosticismo: campos ausentes se omiten
  assert(
    m1.theme === undefined,
    `theme debe ser undefined con attr {}, got ${m1.theme}`
  );
  assert(
    m1.themeOverrides === undefined,
    `themeOverrides debe ser undefined con attr {}, got ${m1.themeOverrides}`
  );
  assert(
    m2.theme === undefined && m2.themeOverrides === undefined,
    'Sin attr raíz no debe haber theme ni themeOverrides'
  );
});

// --- Test 1.9: Acepta string JSON como entrada ---
test('Acepta string JSON como entrada', () => {
  // Arrange
  const rawStr = JSON.stringify({
    formatVersion: 3,
    id: 'string-test',
    title: 'Desde string',
    ideas: { '1': { id: 'n1', title: 'N' } },
  });

  // Act
  const result = parseMup(rawStr, VARIABLES);

  // Assert
  assertEqual(result.metadata.map_id, 'string-test', 'map_id desde string');
  assertEqual(result.metadata.title, 'Desde string', 'title desde string');
});

// --- Test 1.10: Rechaza ideas null ---
test('Rechaza ideas null', () => {
  // Arrange
  const raw = { formatVersion: 3, id: 'test', ideas: null };

  // Act & Assert
  assertThrows(
    () => parseMup(raw, VARIABLES),
    'no contiene un objeto ideas',
    'Debería lanzar error por ideas null'
  );
});

// --- Test 1.11: Rechaza ideas que no es objeto (string) ---
test('Rechaza ideas tipo string', () => {
  // Arrange
  const raw = { formatVersion: 3, id: 'test', ideas: 'no-soy-objeto' };

  // Act & Assert
  assertThrows(
    () => parseMup(raw, VARIABLES),
    'no contiene un objeto ideas',
    'Debería lanzar error por ideas string'
  );
});

// --- Test 1.12: rawJson devuelve el objeto original completo ---
test('rawJson conserva el objeto original sin mutar', () => {
  // Arrange
  const raw = parseFixture('synthetic-empty.mup');

  // Act
  const { rawJson } = parseMup(raw, VARIABLES);

  // Assert
  assertEqual(rawJson.formatVersion, 3, 'rawJson.formatVersion');
  assertEqual(rawJson.id, 'empty-test-map', 'rawJson.id');
  assert(
    rawJson.ideas && typeof rawJson.ideas === 'object',
    'rawJson debe tener ideas'
  );
  assert(
    rawJson === raw,
    'rawJson debe ser la misma referencia (no se clona)'
  );
});

// --- Test 1.13: Timestamp numérico válido se convierte a ISO 8601 ---
test('Timestamp numérico válido se convierte a ISO 8601', () => {
  // Arrange — epoch 0 y timestamp con fracción decimal
  const raw = {
    formatVersion: 3,
    id: 'ts-valid',
    created: 0,
    updated: 1700000000.5,
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata } = parseMup(raw, VARIABLES);

  // Assert
  assertEqual(metadata.created_at, '1970-01-01T00:00:00.000Z', 'created_at epoch');
  assertEqual(metadata.updated_at, '2023-11-14T22:13:20.500Z', 'updated_at con fracción');
});

// --- Test 1.14: Timestamp en cadena no aborta y omite el campo ---
test('Timestamp en cadena no aborta la conversión y omite el campo', () => {
  // Arrange — created malformado como string, updated válido
  const raw = {
    formatVersion: 3,
    id: 'ts-string',
    created: '1700000000',
    updated: 1700000060,
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata } = parseMup(raw, VARIABLES);

  // Assert — el inválido se omite, el válido se conserva
  assert(
    metadata.created_at === undefined,
    `created string debe omitirse, got ${metadata.created_at}`
  );
  assertEqual(metadata.updated_at, '2023-11-14T22:14:20.000Z', 'updated válido se conserva');
});

// --- Test 1.15: Timestamp NaN/Infinity/fuera de rango no aborta ---
test('Timestamp NaN o fuera de rango se omite sin abortar', () => {
  // Arrange — NaN y un número finito no representable por Date
  const raw = {
    formatVersion: 3,
    id: 'ts-invalid',
    created: NaN,
    updated: 1e20,
    ideas: { '1': { id: 'n1', title: 'N' } },
  };

  // Act
  const { metadata } = parseMup(raw, VARIABLES);

  // Assert — ambos se omiten y la conversión continúa
  assert(
    metadata.created_at === undefined,
    `NaN debe omitirse, got ${metadata.created_at}`
  );
  assert(
    metadata.updated_at === undefined,
    `timestamp fuera de rango debe omitirse, got ${metadata.updated_at}`
  );
  assertEqual(metadata.map_id, 'ts-invalid', 'la conversión continúa');
});

// ===========================================================================
// CAPA 2 — flattenNodes()
// ===========================================================================
console.log('\n📦 Capa 2 — flattenNodes()');

// --- Test 2.1: Aplana nodo raíz correctamente ---
test('Aplana nodo raíz correctamente', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test-map',
    ideas: {
      '1': { id: 'root-node', title: 'Raíz', attr: {} },
    },
  };
  const metadata = { map_id: 'test-map', title: 'Test', format_version: 3 };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 1, 'Debe devolver exactamente 1 nodo');
  assert(nodes[0] !== null && typeof nodes[0] === 'object', 'Nodo debe ser objeto');
});

// --- Test 2.2: Asigna depth=0 para raíz ---
test('Asigna depth=0 para la raíz', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': { id: 'root', title: 'R', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes[0].depth, 0, 'depth de raíz debe ser 0');
});

// --- Test 2.3: parent_id es null para raíz ---
test('parent_id es null para la raíz', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': { id: 'root', title: 'R', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes[0].parent_id, null, 'parent_id de raíz debe ser null');
});

// --- Test 2.4: path contiene solo el UUID de raíz ---
test('path contiene solo el UUID del nodo raíz', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': { id: 'root', title: 'R', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assert(Array.isArray(nodes[0].path), 'path debe ser array');
  assertEqual(nodes[0].path.length, 1, 'path debe tener exactamente 1 elemento');
  assertEqual(nodes[0].path[0], nodes[0].node_id, 'path[0] debe ser el node_id de raíz');
});

// --- Test 2.5: is_leaf correcto para nodos sin hijos ---
test('is_leaf=true para nodo sin hijos (sin campo ideas)', () => {
  // Arrange — nodo sin campo ideas
  const rawJson = {
    ideas: {
      '1': { id: 'leaf-node', title: 'Hoja', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assert(nodes[0].is_leaf === true, `is_leaf debe ser true, got ${nodes[0].is_leaf}`);
});

// --- Test 2.6: is_leaf false para nodo con hijos ---
test('is_leaf=false para nodo con hijos', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': {
        id: 'parent',
        title: 'Padre',
        attr: {},
        ideas: {
          '0.75': { id: 'child', title: 'Hijo', attr: {}, ideas: {} },
        },
      },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 2, 'Debe aplanar padre + hijo = 2 nodos');
  assert(nodes[0].is_leaf === false, 'Padre debe tener is_leaf=false');
  assert(nodes[1].is_leaf === true, 'Hijo debe tener is_leaf=true');
});

// --- Test 2.7: is_leaf true para nodo con ideas vacío ---
test('is_leaf=true para nodo con ideas={}', () => {
  // Arrange — ideas existe pero está vacío
  const rawJson = {
    ideas: {
      '1': { id: 'empty-ideas', title: 'Vacío', attr: {}, ideas: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assert(nodes[0].is_leaf === true, 'Nodo con ideas={} debe ser is_leaf=true');
});

// --- Test 2.8: Maneja nodos sin título ---
test('Maneja nodos sin título (title undefined)', () => {
  // Arrange — nodo sin campo title
  const rawJson = {
    ideas: {
      '1': { id: 'no-title-node', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assert(
    nodes[0].title === undefined,
    `title debe ser undefined, got ${nodes[0].title}`
  );
});

// --- Test 2.9: sort_key se preserva como string ---
test('sort_key preserva la clave original como string', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': { id: 'n1', title: 'Uno', attr: {} },
      '0.75': { id: 'n2', title: 'Dos', attr: {} },
      '105.synthetic-sort-key': { id: 'n3', title: 'Tres', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 3, 'Debe aplanar 3 nodos');
  assertEqual(nodes[0].sort_key, '1', 'sort_key[0]');
  assertEqual(nodes[1].sort_key, '0.75', 'sort_key[1]');
  assertEqual(nodes[2].sort_key, '105.synthetic-sort-key', 'sort_key[2]');
});

// --- Test 2.10: Árbol con profundidad > 1 ---
test('Aplana árbol con varios niveles (depth se incrementa)', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': {
        id: 'root',
        title: 'R',
        attr: {},
        ideas: {
          '0.75': {
            id: 'child',
            title: 'C',
            attr: {},
            ideas: {
              '0.875': { id: 'grandchild', title: 'GC', attr: {}, ideas: {} },
            },
          },
        },
      },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 3, '3 nodos: root → child → grandchild');
  assertEqual(nodes[0].depth, 0, 'root depth=0');
  assertEqual(nodes[1].depth, 1, 'child depth=1');
  assertEqual(nodes[2].depth, 2, 'grandchild depth=2');
});

// --- Test 2.11: parent_id de hijo apunta al padre ---
test('Hijos tienen parent_id correcto', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': {
        id: 'papa',
        title: 'Papá',
        attr: {},
        ideas: {
          '0.75': { id: 'hijo', title: 'Hijo', attr: {}, ideas: {} },
        },
      },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 2, '2 nodos');
  assertEqual(nodes[1].parent_id, nodes[0].node_id, 'parent_id del hijo debe ser node_id del padre');
});

// --- Test 2.12: path acumula ancestros ---
test('path incluye UUIDs de todos los ancestros', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': {
        id: 'root',
        title: 'R',
        attr: {},
        ideas: {
          '0.75': { id: 'child', title: 'C', attr: {}, ideas: {} },
        },
      },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 2, '2 nodos');
  // Raíz: path = [node_id_0]
  assertEqual(nodes[0].path.length, 1, 'path raíz length=1');
  assertEqual(nodes[0].path[0], nodes[0].node_id, 'path raíz[0]=node_id');
  // Hijo: path = [node_id_0, node_id_1]
  assertEqual(nodes[1].path.length, 2, 'path hijo length=2');
  assertEqual(nodes[1].path[0], nodes[0].node_id, 'path hijo[0]=node_id padre');
  assertEqual(nodes[1].path[1], nodes[1].node_id, 'path hijo[1]=node_id hijo');
});

// --- Test 2.13: original_id capturado ---
test('original_id captura el campo id del .mup', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': {
        id: 'my-custom-id-123',
        title: 'Custom',
        attr: {},
        ideas: {
          '0.75': { id: 42, title: 'Num', attr: {}, ideas: {} },
        },
      },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes[0].original_id, 'my-custom-id-123', 'id string');
  assertEqual(nodes[1].original_id, '42', 'id numérico debe convertirse a string');
});

// --- Test 2.14: original_id vacío si no hay campo id ---
test('original_id vacío cuando el nodo no tiene campo id', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': { title: 'Sin ID', attr: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes[0].original_id, '', 'Sin campo id → original_id=""');
});

// --- Test 2.15: map_id se asigna correctamente ---
test('map_id se asigna desde metadata', () => {
  // Arrange
  const rawJson = {
    ideas: {
      '1': { id: 'n1', title: 'N', attr: {} },
    },
  };
  const metadata = { map_id: 'custom-map-uuid' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes[0].map_id, 'custom-map-uuid', 'map_id');
});

// --- Test 2.16: sibling_order respeta orden de Object.keys ---
test('sibling_order sigue el orden de Object.keys', () => {
  // Arrange
  const rawJson = {
    ideas: {
      'z': { id: 'n1', title: 'Z', attr: {}, ideas: {} },
      'a': { id: 'n2', title: 'A', attr: {}, ideas: {} },
      'm': { id: 'n3', title: 'M', attr: {}, ideas: {} },
    },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata);

  // Assert
  assertEqual(nodes.length, 3, '3 nodos');
  assertEqual(nodes[0].sibling_order, 0, 'primer nodo sibling_order=0');
  assertEqual(nodes[1].sibling_order, 1, 'segundo nodo sibling_order=1');
  assertEqual(nodes[2].sibling_order, 2, 'tercer nodo sibling_order=2');
});

// --- Test 2.17: Clave del árbol configurable (MUP_KEY_IDEAS) ---
test('flattenNodes lee el árbol de la clave ideas recibida', () => {
  // Arrange — el mapa tiene ideas y nodos; se inyecta 'nodos'
  const rawJson = {
    ideas: { '1': { id: 'desde-ideas', title: 'Ideas', attr: {} } },
    nodos: { '1': { id: 'desde-nodos', title: 'Nodos', attr: {} } },
  };
  const metadata = { map_id: 'm1' };

  // Act
  const nodes = flattenNodes(rawJson, metadata, 'nodos');

  // Assert — se usa la clave inyectada, no 'ideas'
  assertEqual(nodes.length, 1, '1 nodo');
  assertEqual(nodes[0].original_id, 'desde-nodos', 'original_id de la clave inyectada');
});

// --- Test 2.18: Respaldo a 'ideas' si la clave no es textual ---
test('flattenNodes respalda a ideas si la clave no es textual', () => {
  // Arrange
  const rawJson = { ideas: { '1': { id: 'n1', title: 'N', attr: {} } } };
  const metadata = { map_id: 'm1' };

  // Act & Assert — undefined, null y cadena vacía caen al respaldo 'ideas'
  for (const key of [undefined, null, '']) {
    const nodes = flattenNodes(rawJson, metadata, key);
    assertEqual(nodes.length, 1, `clave ${JSON.stringify(key)} → respaldo ideas`);
  }
});

// ===========================================================================
// CAPA 3 — extractNotes()
// ===========================================================================
console.log('\n📦 Capa 3 — extractNotes()');

// --- Test 3.1: Nodo sin nota → no genera registro ---
test('Nodo sin nota no genera Note', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': { id: 'no-note-node', title: 'Sin Nota', attr: { position: [0, 0, 1] } },
    },
  };
  const nodes = [
    { node_id: 'uuid-abc', original_id: 'no-note-node' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 0, 'No debe generar notas');
});

// --- Test 3.2: Nodo con nota → genera Note con nodeId correcto ---
test('Nodo con nota genera Note con node_id correcto', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'note-node',
        title: 'Con Nota',
        attr: { note: { index: 0, text: 'Nota de prueba' } },
      },
    },
  };
  const nodes = [
    { node_id: 'fixed-uuid-note-test', original_id: 'note-node' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 1, 'Debe generar exactamente 1 nota');
  assertEqual(notes[0].node_id, 'fixed-uuid-note-test', 'node_id debe coincidir');
  assertEqual(notes[0].text, 'Nota de prueba', 'texto de la nota');
});

// --- Test 3.3: Maneja notas multilínea ---
test('Maneja notas multilínea (preserva \\n)', () => {
  // Arrange
  const multilineText = 'Línea uno\nLínea dos\nLínea tres con más texto';
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'multiline-node',
        title: 'Multilínea',
        attr: { note: { index: 0, text: multilineText } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-multi', original_id: 'multiline-node' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 1, '1 nota');
  assertEqual(notes[0].text, multilineText, 'texto multilínea preservado');
  assertEqual(notes[0].char_count, multilineText.length, 'char_count correcto');
  assert(
    notes[0].text.includes('\n'),
    'El texto debe contener saltos de línea'
  );
});

// --- Test 3.4: Nodo sin attr no causa error ---
test('Nodo sin attr (campo ausente) no causa error ni genera nota', () => {
  // Arrange — nodo sin attr field en rawJson
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': { id: 'no-attr-node', title: 'Sin Attr' },
    },
  };
  const nodes = [
    { node_id: 'uuid-no-attr', original_id: 'no-attr-node' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 0, '0 notas — nodo sin attr');
});

// --- Test 3.5: note.index se extrae del .mup ---
test('Note.index se extrae del campo index original', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'indexed-note',
        title: 'Indexada',
        attr: { note: { index: 5, text: 'Nota con índice' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-index', original_id: 'indexed-note' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 1, '1 nota');
  assertEqual(notes[0].index, 5, 'index debe ser 5');
});

// --- Test 3.6: truncated flag desde el .mup ---
test('Note.truncated se hereda del .mup', () => {
  // Arrange — una nota con truncated=true, otra sin
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'truncated-note',
        title: 'Truncada',
        attr: { note: { index: 0, text: 'Texto truncado', truncated: true } },
      },
      '0.75': {
        id: 'normal-note',
        title: 'Normal',
        attr: { note: { index: 0, text: 'Texto normal' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-trunc', original_id: 'truncated-note' },
    { node_id: 'uuid-norm', original_id: 'normal-note' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 2, '2 notas');
  // Buscar por node_id para evitar depender del orden
  const truncNote = notes.find(n => n.node_id === 'uuid-trunc');
  const normNote = notes.find(n => n.node_id === 'uuid-norm');
  assert(truncNote !== undefined, 'Debe existir nota truncada');
  assert(normNote !== undefined, 'Debe existir nota normal');
  assert(truncNote.truncated === true, 'truncated debe ser true');
  assert(normNote.truncated === false, 'truncated debe ser false (default)');
});

// --- Test 3.7: Texto vacío no genera Note ---
test('Nota con texto vacío no genera registro', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'empty-note',
        title: 'Vacía',
        attr: { note: { index: 0, text: '' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-empty', original_id: 'empty-note' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 0, 'Texto vacío → no genera Note');
});

// --- Test 3.8: Solo nodos con nota generan registros ---
test('Mezcla nodos con/sin nota: solo los que tienen nota generan registros', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'with-note',
        title: 'Con',
        attr: { note: { index: 0, text: 'Nota' } },
      },
      '0.75': {
        id: 'without-note',
        title: 'Sin',
        attr: {},
      },
      '0.875': {
        id: 'also-with',
        title: 'También',
        attr: { note: { index: 1, text: 'Otra nota' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-1', original_id: 'with-note' },
    { node_id: 'uuid-2', original_id: 'without-note' },
    { node_id: 'uuid-3', original_id: 'also-with' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 2, 'Solo 2 de 3 nodos deben generar nota');
});

// --- Test 3.9: note_id es un UUID válido ---
test('note_id es un UUID v4 válido', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'uuid-test',
        title: 'Test',
        attr: { note: { index: 0, text: 'Genera UUID' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-parent', original_id: 'uuid-test' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert
  assertEqual(notes.length, 1, '1 nota');
  assertUUID(notes[0].note_id, 'note_id debe ser UUID v4');
});

// --- Test 3.10: Nodo con attr.note pero sin campo text (undefined) ---
test('Nodo con note.text undefined se maneja como string vacío', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'no-text',
        title: 'Sin text',
        attr: { note: { index: 0 } }, // sin campo text
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-no-text', original_id: 'no-text' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert — text undefined → String(undefined) = 'undefined', pero el código usa String(noteData.text) cuando text !== undefined
  // Si text es undefined, noteData.text !== undefined es false, entonces text = ''
  // Luego text.length === 0 → continue, no genera nota
  assertEqual(notes.length, 0, 'text undefined → no genera Note');
});

// --- Test 3.11: Node con original_id vacío (no tiene id en rawJson) ---
test('Nodo con original_id vacío no genera nota (no hay match)', () => {
  // Arrange — nodo sin id en rawJson, por tanto no indexado
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': { title: 'Sin ID', attr: { note: { index: 0, text: 'Nota' } } },
    },
  };
  const nodes = [
    { node_id: 'uuid-no-match', original_id: '' },
  ];

  // Act
  const notes = extractNotes(nodes, rawJson);

  // Assert — original_id vacío no matchea ningún rawNode indexado
  // Nota: el nodo en rawJson no tiene campo id, por tanto no se indexa
  assertEqual(notes.length, 0, 'original_id vacío → no genera nota');
});

// ===========================================================================
// CAPA 4 — extractAttributes()
// ===========================================================================
console.log('\n📦 Capa 4 — extractAttributes()');

// --- Test 4.1: Nodo sin attr → no falla ---
test('Nodo sin attr (campo ausente) no causa error', () => {
  // Arrange — nodo sin attr en rawJson
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': { id: 'no-attr', title: 'Sin Attr' },
    },
  };
  const nodes = [
    { node_id: 'uuid-noattr', original_id: 'no-attr' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assert(Array.isArray(attrs), 'Debe devolver array');
  assertEqual(attrs.length, 1, '1 Attribute — incluso sin attr se genera registro');
  assert(attrs[0].raw_attributes === null, 'raw_attributes debe ser null');
  assertDeepEqual(attrs[0].value, {}, 'value debe ser objeto vacío');
});

// --- Test 4.2: Extrae position correctamente ---
test('Extrae position como {x, y, z} desde array [x, y, z]', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pos-node',
        title: 'Posición',
        attr: { position: [150, -30, 1] },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pos', original_id: 'pos-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs.length, 1, '1 Attribute');
  assert(
    attrs[0].value.position && typeof attrs[0].value.position === 'object',
    'value.position debe ser objeto'
  );
  assertEqual(attrs[0].value.position.x, 150, 'position.x');
  assertEqual(attrs[0].value.position.y, -30, 'position.y');
  // La coordenada z se conserva en value cuando el array tiene tres componentes
  assertEqual(attrs[0].value.position.z, 1, 'position.z');
});

// --- Test 4.3: raw_attributes captura el attr completo ---
test('raw_attributes contiene el objeto attr original completo', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'full-attr',
        title: 'Completo',
        attr: {
          position: [10, 20, 1],
          style: { backgroundColor: '#FFCC99', width: 300 },
          collapsed: true,
          shape: 'rounded-rectangle',
        },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-full', original_id: 'full-attr' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs.length, 1, '1 Attribute');
  assertDeepEqual(
    attrs[0].raw_attributes,
    {
      position: [10, 20, 1],
      style: { backgroundColor: '#FFCC99', width: 300 },
      collapsed: true,
      shape: 'rounded-rectangle',
    },
    'raw_attributes debe ser copia fiel del attr original'
  );
});

// --- Test 4.4: Atributos extraños se preservan en raw_attributes ---
test('Atributos extraños se preservan en raw_attributes', () => {
  // Arrange — nodo con campos no estándar
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'weird-attr',
        title: 'Extraño',
        attr: {
          position: [0, 0, 1],
          futureField: 'valor futuro',
          experimental: { enabled: true, value: 42 },
          unknown_list: [1, 2, 3],
          custom_data: null,
        },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-weird', original_id: 'weird-attr' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — raw_attributes contiene los campos extraños
  assertEqual(attrs.length, 1, '1 Attribute');
  assert(
    'futureField' in attrs[0].raw_attributes,
    'raw_attributes debe contener futureField'
  );
  assertEqual(attrs[0].raw_attributes.futureField, 'valor futuro', 'futureField');
  assert(
    'experimental' in attrs[0].raw_attributes,
    'raw_attributes debe contener experimental'
  );
  assert(
    'unknown_list' in attrs[0].raw_attributes,
    'raw_attributes debe contener unknown_list'
  );
  assert(
    'custom_data' in attrs[0].raw_attributes,
    'raw_attributes debe contener custom_data (null)'
  );
  assertDeepEqual(
    attrs[0].raw_attributes.experimental,
    { enabled: true, value: 42 },
    'experimental preservado'
  );
  assertDeepEqual(attrs[0].raw_attributes.unknown_list, [1, 2, 3], 'unknown_list');

  // Verificar que estos campos NO están en value (value solo tiene campos tipados)
  assert(
    attrs[0].value.futureField === undefined,
    'value NO debe contener futureField (no tipado)'
  );
});

// --- Test 4.5: Extrae style.backgroundColor ---
test('Extrae style.backgroundColor en value.style', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'bg-node',
        title: 'Fondo',
        attr: { style: { backgroundColor: '#FFCC99' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-bg', original_id: 'bg-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs.length, 1, '1 Attribute');
  assert(
    attrs[0].value.style !== undefined,
    'value debe tener style'
  );
  assertEqual(
    attrs[0].value.style.backgroundColor,
    '#FFCC99',
    'style.backgroundColor'
  );
});

// --- Test 4.6: Extrae style.color desde style.text.color ---
test('Extrae color desde style.text.color', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'text-color-node',
        title: 'Color texto',
        attr: { style: { text: { color: '#CCFFFF' } } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-tc', original_id: 'text-color-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.style.color, '#CCFFFF', 'color desde style.text.color');
});

// --- Test 4.7: Extrae collapsed booleano ---
test('Extrae collapsed como booleano en value', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'collapsed-node',
        title: 'Plegado',
        attr: { collapsed: true },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-coll', original_id: 'collapsed-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.collapsed, true, 'collapsed debe ser true');
});

// --- Test 4.8: Extrae shape ---
test('Extrae shape como string en value', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'shape-node',
        title: 'Forma',
        attr: { shape: 'rectangle' },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-shape', original_id: 'shape-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.shape, 'rectangle', 'shape');
});

// --- Test 4.9: Extrae border attributes ---
test('Extrae borderStyle, borderColor, borderWidth en value', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'border-node',
        title: 'Borde',
        attr: {
          borderStyle: 'dashed',
          borderColor: '#FF0000',
          borderWidth: 3,
        },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-border', original_id: 'border-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.borderStyle, 'dashed', 'borderStyle');
  assertEqual(attrs[0].value.borderColor, '#FF0000', 'borderColor');
  assertEqual(attrs[0].value.borderWidth, 3, 'borderWidth');
});

// --- Test 4.10: Extrae width desde attr.width (con prioridad sobre style.width) ---
test('Extrae width desde attr.width (prioritario sobre style.width)', () => {
  // Arrange — attr.width tiene prioridad sobre style.width
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'width-node',
        title: 'Ancho',
        attr: { width: 500, style: { width: 300 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-width', original_id: 'width-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.width, 500, 'width debe venir de attr.width (no style.width)');
});

// --- Test 4.11: Extrae width desde style.width si attr.width no existe ---
test('Extrae width desde style.width cuando attr.width no está presente', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'style-width-node',
        title: 'Ancho style',
        attr: { style: { width: 300 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-sw', original_id: 'style-width-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.width, 300, 'width desde style.width');
});

// --- Test 4.12: Extrae icon.type e icon.size ---
test('Extrae icon.type e icon.size en value.icon', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'icon-node',
        title: 'Icono',
        attr: { icon: { type: 'emoji', size: 24 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-icon', original_id: 'icon-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assert(
    attrs[0].value.icon !== undefined,
    'value debe tener icon'
  );
  assertEqual(attrs[0].value.icon.type, 'emoji', 'icon.type');
  assertEqual(attrs[0].value.icon.size, 24, 'icon.size');
});

// --- Test 4.13: Nodo con attr vacío {} ---
test('Nodo con attr vacío ({}) genera Attribute con raw_attributes={}', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'empty-attr',
        title: 'Attr Vacío',
        attr: {},
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-empty-attr', original_id: 'empty-attr' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs.length, 1, '1 Attribute');
  assertDeepEqual(attrs[0].raw_attributes, {}, 'raw_attributes debe ser {}');
  assertDeepEqual(attrs[0].value, {}, 'value debe ser {}');
});

// --- Test 4.14: attr_id es un UUID válido ---
test('attr_id es un UUID v4 válido', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'uuid-check',
        title: 'Check',
        attr: { position: [1, 2, 3] },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-check-parent', original_id: 'uuid-check' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs.length, 1, '1 Attribute');
  assertUUID(attrs[0].attr_id, 'attr_id debe ser UUID v4');
});

// --- Test 4.15: attr_type es "node_attributes" ---
test('attr_type es siempre "node_attributes"', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': { id: 'type-check', title: 'Tipo', attr: { position: [0, 0, 1] } },
      '0.75': { id: 'type-check-2', title: 'Tipo2', attr: { collapsed: true } },
    },
  };
  const nodes = [
    { node_id: 'uuid-t1', original_id: 'type-check' },
    { node_id: 'uuid-t2', original_id: 'type-check-2' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs.length, 2, '2 attributes');
  assertEqual(attrs[0].attr_type, 'node_attributes', 'attr_type[0]');
  assertEqual(attrs[1].attr_type, 'node_attributes', 'attr_type[1]');
});

// --- Test 4.16: raw_attributes es shallow copy (no muta si se modifica después) ---
test('raw_attributes es shallow copy del attr original', () => {
  // Arrange — construimos attr, pasamos rawJson, luego verificamos que raw_attributes sea copia
  const originalAttr = { position: [5, 10, 1], style: { backgroundColor: '#FFF' } };
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'copy-test',
        title: 'Copia',
        attr: originalAttr,
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-copy', original_id: 'copy-test' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — raw_attributes no es la misma referencia
  assert(
    attrs[0].raw_attributes !== originalAttr,
    'raw_attributes debe ser copia (no misma referencia)'
  );
  assertDeepEqual(
    attrs[0].raw_attributes,
    originalAttr,
    'raw_attributes debe tener los mismos valores'
  );
});

// --- Test 4.17: Position con dos componentes no incluye z ---
test('Position con dos componentes [x, y] no incluye coordenada z', () => {
  // Arrange — array de posición con solo dos componentes (caso límite)
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pos-xy-node',
        title: 'Posición XY',
        attr: { position: [80, 40] },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pos-xy', original_id: 'pos-xy-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — x e y sí, z ausente (el array no aporta tercera componente)
  assertEqual(attrs.length, 1, '1 Attribute');
  assertEqual(attrs[0].value.position.x, 80, 'position.x');
  assertEqual(attrs[0].value.position.y, 40, 'position.y');
  assert(
    attrs[0].value.position.z === undefined,
    'position.z debe omitirse cuando el array tiene dos componentes'
  );
});

// --- Test 4.18: Position con tres componentes conserva z ---
test('Position con tres componentes conserva la coordenada z en value', () => {
  // Arrange — array de posición con tres componentes
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pos-xyz-node',
        title: 'Posición XYZ',
        attr: { position: [50, 100, 7] },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pos-xyz', original_id: 'pos-xyz-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — x, y y z presentes en el valor tipado
  assertEqual(attrs.length, 1, '1 Attribute');
  assertEqual(attrs[0].value.position.x, 50, 'position.x');
  assertEqual(attrs[0].value.position.y, 100, 'position.y');
  assertEqual(attrs[0].value.position.z, 7, 'position.z debe conservarse (3 componentes)');
});

// --- Test 4.19: Extrae metadatos del adjunto (attachment) ---
test('Extrae attachment con name, contentType y size (sin duplicar content)', () => {
  // Arrange — adjunto con data URI (formato real MindMup v3)
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'attach-node',
        title: 'Con adjunto',
        attr: {
          attachment: {
            name: 'nota.txt',
            contentType: 'text/plain',
            content: 'data:text/plain;base64,77u/SG9sYQ==',
            dataUriEncoded: true,
          },
        },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-attach', original_id: 'attach-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — value.attachment con solo metadatos
  assertEqual(attrs.length, 1, '1 Attribute');
  assertEqual(attrs[0].value.attachment.name, 'nota.txt', 'attachment.name');
  assertEqual(attrs[0].value.attachment.contentType, 'text/plain', 'attachment.contentType');
  assertEqual(
    attrs[0].value.attachment.size,
    7,
    'attachment.size = tamaño real en bytes del contenido decodificado'
  );
  assert(
    attrs[0].value.attachment.content === undefined,
    'value.attachment NO debe duplicar el contenido'
  );
  // El contenido completo permanece en raw_attributes (pérdida cero)
  assertDeepEqual(
    attrs[0].raw_attributes.attachment,
    {
      name: 'nota.txt',
      contentType: 'text/plain',
      content: 'data:text/plain;base64,77u/SG9sYQ==',
      dataUriEncoded: true,
    },
    'raw_attributes.attachment conserva el contenido completo'
  );
});

// --- Test 4.20: attachment omite campos ausentes ---
test('attachment omite name/contentType ausentes (solo campos presentes)', () => {
  // Arrange — adjunto sin name ni contentType (caso límite)
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'attach-min',
        title: 'Adjunto mínimo',
        attr: {
          attachment: { content: 'data:application/octet-stream;base64,QUJD' },
        },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-attach-min', original_id: 'attach-min' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — solo size presente
  assert(
    attrs[0].value.attachment.name === undefined,
    'attachment.name debe omitirse si no existe'
  );
  assert(
    attrs[0].value.attachment.contentType === undefined,
    'attachment.contentType debe omitirse si no existe'
  );
  assertEqual(attrs[0].value.attachment.size, 3, 'attachment.size calculado');
});

// --- Test 4.21: Extrae parentConnector.width ---
test('Extrae parentConnector con width en value', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pc-node',
        title: 'Con conector',
        attr: { parentConnector: { width: 1 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pc', original_id: 'pc-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.parentConnector.width, 1, 'parentConnector.width');
});

// --- Test 4.21b: Extrae parentConnector.color junto a width ---
test('Extrae parentConnector con width y color en value', () => {
  // Arrange — conector parental con ancho y color (formato real)
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pc-color-node',
        title: 'Conector con color',
        attr: { parentConnector: { width: 1, color: '#993300' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pc-color', original_id: 'pc-color-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — ambos campos tipados
  assertEqual(attrs[0].value.parentConnector.width, 1, 'parentConnector.width');
  assertEqual(attrs[0].value.parentConnector.color, '#993300', 'parentConnector.color');
  // raw_attributes conserva el objeto original (pérdida cero)
  assertEqual(attrs[0].raw_attributes.parentConnector.color, '#993300', 'raw_attributes.parentConnector.color');
});

// --- Test 4.21c: Extrae parentConnector.arrow (solo arrow, sin width ni color) ---
test('Extrae parentConnector con solo arrow en value', () => {
  // Arrange — conector parental real con únicamente dirección de flecha
  // (formato real MindMup v3: { arrow: "to" } sin width ni color)
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pc-arrow-node',
        title: 'Conector con flecha',
        attr: { parentConnector: { arrow: 'to' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pc-arrow', original_id: 'pc-arrow-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — arrow tipado aunque width/color estén ausentes
  assertEqual(attrs[0].value.parentConnector.arrow, 'to', 'parentConnector.arrow');
  assertEqual(attrs[0].value.parentConnector.width, undefined, 'width ausente se omite');
  assertEqual(attrs[0].value.parentConnector.color, undefined, 'color ausente se omite');
  // raw_attributes conserva el objeto original (pérdida cero)
  assertEqual(attrs[0].raw_attributes.parentConnector.arrow, 'to', 'raw_attributes.parentConnector.arrow');
});

// --- Test 4.21d: parentConnector.arrow ausente se omite ---
test('parentConnector.arrow ausente no aparece en value', () => {
  // Arrange — conector parental sin arrow (solo width)
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'pc-no-arrow-node',
        title: 'Conector sin flecha',
        attr: { parentConnector: { width: 1 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-pc-no-arrow', original_id: 'pc-no-arrow-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — campos ausentes se omiten (principio del módulo)
  assertEqual(attrs[0].value.parentConnector.width, 1, 'parentConnector.width');
  assertEqual(
    attrs[0].value.parentConnector.arrow,
    undefined,
    'arrow debe omitirse si no existe en attr.parentConnector'
  );
});

// --- Test 4.22: Extrae style.textAlign ---
test('Extrae style.textAlign en value.style', () => {
  // Arrange
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'align-node',
        title: 'Alineado',
        attr: { style: { width: 334, textAlign: 'center' } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-align', original_id: 'align-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert
  assertEqual(attrs[0].value.style.textAlign, 'center', 'style.textAlign');
  assertEqual(attrs[0].value.width, 334, 'width coexiste con textAlign');
});

// --- Test 4.23: Extrae style.fontMultiplier como número ---
test('Extrae style.fontMultiplier en value.style (número)', () => {
  // Arrange — multiplicador de escala de fuente de MindMup v3
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'fm-node',
        title: 'Multiplicador',
        attr: { style: { fontSize: 12, fontMultiplier: 1.25 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-fm', original_id: 'fm-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — fontMultiplier tipado como número, igual que fontSize
  assertEqual(attrs.length, 1, '1 Attribute');
  assertEqual(attrs[0].value.style.fontSize, 12, 'style.fontSize');
  assertEqual(attrs[0].value.style.fontMultiplier, 1.25, 'style.fontMultiplier');
  assertEqual(
    typeof attrs[0].value.style.fontMultiplier,
    'number',
    'fontMultiplier debe ser número'
  );
  // raw_attributes conserva el campo original (pérdida cero)
  assertEqual(
    attrs[0].raw_attributes.style.fontMultiplier,
    1.25,
    'raw_attributes.style.fontMultiplier'
  );
});

// --- Test 4.24: style.fontMultiplier ausente se omite ---
test('style.fontMultiplier ausente no aparece en value.style', () => {
  // Arrange — style solo con fontSize
  const rawJson = {
    formatVersion: 3,
    id: 'test',
    ideas: {
      '1': {
        id: 'no-fm-node',
        title: 'Sin multiplicador',
        attr: { style: { fontSize: 12 } },
      },
    },
  };
  const nodes = [
    { node_id: 'uuid-no-fm', original_id: 'no-fm-node' },
  ];

  // Act
  const attrs = extractAttributes(nodes, rawJson);

  // Assert — campos ausentes se omiten (principio del módulo)
  assertEqual(attrs[0].value.style.fontSize, 12, 'style.fontSize');
  assertEqual(
    attrs[0].value.style.fontMultiplier,
    undefined,
    'fontMultiplier debe omitirse si no existe en attr.style'
  );
});

// ===========================================================================
// Resumen final
// ===========================================================================
console.log('\n' + '='.repeat(50));
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}
