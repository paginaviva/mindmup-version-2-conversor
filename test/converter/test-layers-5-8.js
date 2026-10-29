/**
 * Tests unitarios para las capas 5 a 8 del Convertidor MUP
 * (layer5-stickers, layer6-urls, layer7-assemble, layer8-store)
 *
 * Cada sección cubre una capa con tests positivos y negativos.
 * Sigue el patrón Arrange-Act-Assert con console.assert.
 * Incluye además tests de la utilidad normalizeOutputName() (nombrado
 * de salida) y de los formatos de MindMup v3: pegatinas como array
 * de cadenas con prefijo emoji, iconos sin campo de tipo y enlaces con
 * ideaIdFrom/ideaIdTo.
 */

// ============================================================================
// Importaciones: funciones de las capas 5–8
// ============================================================================

import { extractStickers, findStickerCatalogCollisions } from '../../src/converter/layers/layer5-stickers.js';
import { extractUrls } from '../../src/converter/layers/layer6-urls.js';
import { assembleResult } from '../../src/converter/layers/layer7-assemble.js';
import { resolveLinks } from '../../src/converter/layers/layer7-assemble-links.js';
import { extractIcons, generateEnums, generateIndexes } from '../../src/converter/layers/layer7-assemble-extra.js';
import { storeResult } from '../../src/converter/layers/layer8-store.js';
import { URL_CLASSIFIER, DEFAULT_REF_TYPE, classifyUrl } from '../../src/converter/url-classifier.js';
import { normalizeOutputName } from '../../src/shared/output-name.js';

// ============================================================================
// Helpers de test
// ============================================================================

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✅ ${message}`);
  } else {
    console.error(`  ❌ FAIL: ${message}`);
  }
}

function assertStrictEqual(actual, expected, message) {
  assert(actual === expected, `${message} (esperado: ${JSON.stringify(expected)}, recibido: ${JSON.stringify(actual)})`);
}

function assertDeepEqual(actual, expected, message) {
  try {
    const actualStr = JSON.stringify(actual);
    const expectedStr = JSON.stringify(expected);
    assert(actualStr === expectedStr, `${message} (esperado: ${expectedStr}, recibido: ${actualStr})`);
  } catch {
    assert(false, `${message} (error al serializar)`);
  }
}

/**
 * Crea un helper para generar nodos aplanados (Capa 2) con estructura mínima.
 */
function makeNode(overrides = {}) {
  return {
    node_id: overrides.node_id || 'n0',
    map_id: overrides.map_id || 'map-uuid',
    parent_id: overrides.parent_id ?? null,
    sort_key: overrides.sort_key ?? '1',
    title: overrides.title ?? '',
    depth: overrides.depth ?? 0,
    path: overrides.path ?? '1',
    original_id: overrides.original_id ?? 'orig-0',
    is_leaf: overrides.is_leaf ?? true,
  };
}

/**
 * Crea un nodo raw del .mup dentro de ideas{} (estructura interna).
 */
function makeRawNode(overrides = {}) {
  return {
    id: overrides.id ?? 'orig-0',
    title: overrides.title ?? '',
    attr: overrides.attr ?? {},
    ideas: overrides.ideas ?? undefined,
  };
}

// ============================================================================
// Helper de limpieza: aislar la función generateUUID interna no es posible
// desde fuera, pero podemos verificar la estructura (shape) de los objetos.
// ============================================================================
function isValidUUID(str) {
  return typeof str === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(str);
}

// ============================================================================
// CAPA 5: extractStickers()
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Capa 5 — extractStickers()');
console.log('═══════════════════════════════════════════════════════════\n');

// ---------------------------------------------------------------------------
// Test 5.1: Nodo sin attr → array vacío
// ---------------------------------------------------------------------------
{
  // Arrange
  const nodes = [makeNode({ node_id: 'n1', original_id: 'orig-1' })];
  const rawJson = {
    ideas: { '1': makeRawNode({ id: 'orig-1' }) },
  };

  // Act
  const result = extractStickers(nodes, rawJson);

  // Assert
  assert(Array.isArray(result), '5.1: Resultado debe ser un array');
  assertStrictEqual(result.length, 0, '5.1: Nodo sin attr → array vacío');
}

// ---------------------------------------------------------------------------
// Test 5.2: Nodo con attr vacío → array vacío
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n2', original_id: 'orig-2' })];
  const rawJson = {
    ideas: { '1': makeRawNode({ id: 'orig-2', attr: {} }) },
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 0, '5.2: Nodo con attr vacío → array vacío');
}

// ---------------------------------------------------------------------------
// Test 5.3: Nodo con attr pero sin campo stickers → array vacío
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n3', original_id: 'orig-3' })];
  const rawJson = {
    ideas: { '1': makeRawNode({ id: 'orig-3', attr: { position: [0, 0] } }) },
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 0, '5.3: Nodo con attr sin stickers → array vacío');
}

// ---------------------------------------------------------------------------
// Test 5.4: attr.stickers en formato array de objetos → extrae sticker
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n4', original_id: 'orig-4' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-4',
      attr: { stickers: [{ code: '🚀' }] },
    })},
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 1, '5.4: attr.stickers (array objetos) → 1 sticker');
  assert(result[0].sticker_id !== undefined, '5.4: sticker_id presente');
  assert(isValidUUID(result[0].sticker_id), '5.4: sticker_id es UUID válido');
  assertStrictEqual(result[0].node_id, 'n4', '5.4: node_id correcto');
  assertStrictEqual(result[0].emoji_code, '🚀', '5.4: emoji_code correcto');
  assertStrictEqual(result[0].emoji_display, '🚀', '5.4: emoji_display correcto');
  assertStrictEqual(result[0].category, 'travel', '5.4: 🚀 categoría = travel');
}

// ---------------------------------------------------------------------------
// Test 5.5: attr.stickers con sticker conocido → categoría correcta
// ---------------------------------------------------------------------------
{
  const testCases = [
    { code: '❤️', expectedCategory: 'heart' },
    { code: '🔥', expectedCategory: 'fire' },
    { code: '🎉', expectedCategory: 'celebration' },
    { code: '👻', expectedCategory: 'smiley' },
    { code: '📌', expectedCategory: 'office' },
    { code: '⛔', expectedCategory: 'symbol' },
  ];
  for (const { code, expectedCategory } of testCases) {
    const nodes = [makeNode({ node_id: 'n5', original_id: 'orig-5' })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: 'orig-5', attr: { stickers: [{ code }] } })},
    };
    const result = extractStickers(nodes, rawJson);
    assertStrictEqual(result.length, 1, `5.5: ${code} extraído`);
    assertStrictEqual(result[0].category, expectedCategory, `5.5: ${code} → categoría ${expectedCategory}`);
    assertStrictEqual(result[0].emoji_code, code, `5.5: ${code} emoji_code preservado`);
    assertStrictEqual(result[0].emoji_display, code, `5.5: ${code} emoji_display preservado`);
  }
}

// ---------------------------------------------------------------------------
// Test 5.6: attr.styles.stickers (formato array de strings)
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n6', original_id: 'orig-6' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-6',
      attr: { styles: { stickers: ['🌟', '💡'] } },
    })},
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 2, '5.6: attr.styles.stickers → 2 stickers');
  assertStrictEqual(result[0].category, 'star', '5.6: 🌟 categoría = star');
  assertStrictEqual(result[1].category, 'symbol', '5.6: 💡 categoría = symbol');
  assertStrictEqual(result[0].emoji_display, '🌟', '5.6: 🌟 emoji_display correcto');
  assertStrictEqual(result[1].emoji_display, '💡', '5.6: 💡 emoji_display correcto');
}

// ---------------------------------------------------------------------------
// Test 5.7: Sticker no documentado → category = "unknown"
// (principio de agnosticismo)
// ---------------------------------------------------------------------------
{
  // Usamos un código hex que mapea a \u0000 (no está en STICKER_CATEGORIES)
  const nodes = [makeNode({ node_id: 'n7', original_id: 'orig-7' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-7',
      attr: { stickers: [{ code: 'emoji:00000' }] },
    })},
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 1, '5.7: Sticker no documentado extraído');
  assertStrictEqual(result[0].category, 'unknown', '5.7: No documentado → category = unknown');
  assertStrictEqual(result[0].emoji_code, 'emoji:00000', '5.7: emoji_code preservado');
  assert(result[0].emoji_display === '\0' || result[0].emoji_display.codePointAt(0) === 0,
    '5.7: emoji_display es el carácter \\u0000');
}

// ---------------------------------------------------------------------------
// Test 5.8: Sticker con código emoji en formato hex "emoji:XXXXX"
// ---------------------------------------------------------------------------
{
  // emoji:1F680 = 🚀 (rocket, categoría travel)
  const nodes = [makeNode({ node_id: 'n8', original_id: 'orig-8' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-8',
      attr: { stickers: [{ code: 'emoji:1F680' }] },
    })},
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 1, '5.8: Código hex extraído');
  assertStrictEqual(result[0].emoji_code, 'emoji:1F680', '5.8: emoji_code = emoji:1F680');
  assertStrictEqual(result[0].emoji_display, '🚀', '5.8: emoji_display = 🚀');
  assertStrictEqual(result[0].category, 'travel', '5.8: 🚀 categoría = travel');
}

// ---------------------------------------------------------------------------
// Test 5.9: Múltiples stickers en attr.stickers (objeto con claves)
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n9', original_id: 'orig-9' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-9',
      attr: { stickers: { '👍': true, '🎯': true, '💡': true } },
    })},
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 3, '5.9: 3 stickers desde objeto');
  const categories = result.map(s => s.category).sort();
  assertDeepEqual(categories, ['gesture', 'symbol', 'symbol'].sort(),
    '5.9: Categorías correctas (gesture, symbol, symbol)');
  const displays = result.map(s => s.emoji_display).sort();
  assertDeepEqual(displays, ['👍', '💡', '🎯'].sort(), '5.9: emoji_display correctos');
}

// ---------------------------------------------------------------------------
// Test 5.10: attr.stickers (array) + attr.styles.stickers coexistiendo
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n10', original_id: 'orig-10' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-10',
      attr: {
        stickers: [{ code: '📌' }, { code: '📍' }],
        styles: { stickers: ['✅', '❌'] },
      },
    })},
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 4, '5.10: 4 stickers (2+2) de fuentes coexistentes');
  assert(result.every(s => s.sticker_id && isValidUUID(s.sticker_id)), '5.10: Todos tienen UUID válido');
}

// ---------------------------------------------------------------------------
// Test 5.11: Múltiples nodos → stickers de cada nodo se acumulan
// ---------------------------------------------------------------------------
{
  const nodes = [
    makeNode({ node_id: 'n11a', original_id: 'orig-11a' }),
    makeNode({ node_id: 'n11b', original_id: 'orig-11b' }),
  ];
  const rawJson = {
    ideas: {
      '1': makeRawNode({ id: 'orig-11a', attr: { stickers: [{ code: '😀' }] } }),
      '2': makeRawNode({ id: 'orig-11b', attr: { stickers: [{ code: '😢' }] } }),
    },
  };
  const result = extractStickers(nodes, rawJson);
  assertStrictEqual(result.length, 2, '5.11: 2 stickers desde 2 nodos');
  const nodeIds = result.map(s => s.node_id).sort();
  assertDeepEqual(nodeIds, ['n11a', 'n11b'].sort(), '5.11: node_ids de ambos nodos');
}

// ---------------------------------------------------------------------------
// Test 5.12: Nodos vacíos o null → array vacío
// ---------------------------------------------------------------------------
{
  assertStrictEqual(extractStickers([], { ideas: {} }).length, 0, '5.12: nodes vacío → array vacío');
  assertStrictEqual(extractStickers(null, { ideas: {} }).length, 0, '5.12: nodes null → array vacío');
  assertStrictEqual(extractStickers(undefined, { ideas: {} }).length, 0, '5.12: nodes undefined → array vacío');
  assertStrictEqual(extractStickers([makeNode()], null).length, 0, '5.12: rawJson null → array vacío');
}

// ---------------------------------------------------------------------------
// Test 5.13: attr.stickers como array de cadenas con prefijo emoji
// (formato de MindMup v3)
// ---------------------------------------------------------------------------
{
  // Arrange — ["emoji:1F4DD", "emoji:1F680"] = [📝, 🚀]
  const nodes = [makeNode({ node_id: 'n13', original_id: 'orig-13' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-13',
      attr: { stickers: ['emoji:1F4DD', 'emoji:1F680'] },
    })},
  };

  // Act
  const result = extractStickers(nodes, rawJson);

  // Assert — 2 stickers extraídos con display Unicode y categoría correcta
  assertStrictEqual(result.length, 2, '5.13: attr.stickers (array cadenas emoji:) → 2 stickers');
  assert(result.every(s => isValidUUID(s.sticker_id)), '5.13: Todos los sticker_id son UUID válidos');
  assertStrictEqual(result[0].node_id, 'n13', '5.13: node_id correcto');
  assertStrictEqual(result[0].emoji_code, 'emoji:1F4DD', '5.13: emoji_code[0] preservado');
  assertStrictEqual(result[0].emoji_display, '📝', '5.13: emoji_display[0] = 📝');
  assertStrictEqual(result[0].category, 'communication', '5.13: 📝 → categoría communication');
  assertStrictEqual(result[1].emoji_code, 'emoji:1F680', '5.13: emoji_code[1] preservado');
  assertStrictEqual(result[1].emoji_display, '🚀', '5.13: emoji_display[1] = 🚀');
  assertStrictEqual(result[1].category, 'travel', '5.13: 🚀 → categoría travel');
}

// ---------------------------------------------------------------------------
// Test 5.14: Emoji con múltiples puntos de código (tono de piel)
// ---------------------------------------------------------------------------
{
  // Arrange — "emoji:1F469 1F3FB" = 👩 + tono de piel claro (👩🏻)
  const nodes = [makeNode({ node_id: 'n14', original_id: 'orig-14' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-14',
      attr: { stickers: ['emoji:1F469 1F3FB'] },
    })},
  };

  // Act
  const result = extractStickers(nodes, rawJson);

  // Assert — se normaliza a 2 code points y se clasifica por el emoji base
  assertStrictEqual(result.length, 1, '5.14: Emoji multi-código extraído');
  assertStrictEqual(result[0].emoji_code, 'emoji:1F469 1F3FB', '5.14: emoji_code preservado');
  assertStrictEqual(result[0].emoji_display, '👩🏻', '5.14: emoji_display = 👩🏻 (2 code points)');
  assertStrictEqual(result[0].category, 'person', '5.14: 👩🏻 → person (tono de piel ignorado)');
}

// ---------------------------------------------------------------------------
// Test 5.15: Emoji con selector de variación (U+FE0F) clasificado
// ---------------------------------------------------------------------------
{
  // Arrange — variantes sin/con VS16 (el catálogo documenta con VS16)
  const testCases = [
    { code: 'emoji:2764', expectedDisplay: '❤️', expectedCategory: 'heart' },
    { code: 'emoji:2764 FE0F', expectedDisplay: '❤️', expectedCategory: 'heart' },
    { code: 'emoji:2620', expectedDisplay: '☠️', expectedCategory: 'smiley' },
    { code: 'emoji:2620 FE0F', expectedDisplay: '☠️', expectedCategory: 'smiley' },
  ];

  for (const { code, expectedDisplay, expectedCategory } of testCases) {
    const nodes = [makeNode({ node_id: 'n15', original_id: 'orig-15' })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: 'orig-15', attr: { stickers: [code] } }) },
    };

    // Act
    const result = extractStickers(nodes, rawJson);

    // Assert — nunca "unknown": el selector de variación se normaliza
    assertStrictEqual(result.length, 1, `5.15: ${code} extraído`);
    assertStrictEqual(result[0].emoji_display, expectedDisplay, `5.15: ${code} → ${expectedDisplay}`);
    assertStrictEqual(result[0].category, expectedCategory, `5.15: ${code} → ${expectedCategory} (no unknown)`);
  }
}

// ---------------------------------------------------------------------------
// Test 5.16: REGRESIÓN — Dos stickers con tono de piel consecutivos
// (applyCanonicalForm usa SKIN_TONE_MODIFIER_REGEX sin /g; la versión con /g
// hacía RegExp.test() stateful vía lastIndex y el segundo sticker podía
// perder su tono de piel, degradando 👍🏿 a 👍)
// ---------------------------------------------------------------------------
{
  // Arrange — dos pegatinas con tono de piel consecutivas (formato MindMup v3)
  const nodes = [makeNode({ node_id: 'n16', original_id: 'orig-16' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-16',
      attr: { stickers: ['emoji:1F469 1F3FB', 'emoji:1F44D 1F3FF'] },
    })},
  };

  // Act
  const result = extractStickers(nodes, rawJson);

  // Assert — ambas conservan el tono de piel completo en emoji_display
  assertStrictEqual(result.length, 2, '5.16: 2 stickers con tono de piel extraídos');
  assertStrictEqual(result[0].emoji_display, '👩🏻', '5.16: emoji_display[0] = 👩🏻 (U+1F469 U+1F3FB)');
  assertStrictEqual(result[1].emoji_display, '👍🏿', '5.16: emoji_display[1] = 👍🏿 (U+1F44D U+1F3FF)');
  assertDeepEqual(
    Array.from(result[0].emoji_display, (c) => c.codePointAt(0).toString(16).toUpperCase()),
    ['1F469', '1F3FB'],
    '5.16: puntos de código de 👩🏻 = [U+1F469, U+1F3FB]'
  );
  assertDeepEqual(
    Array.from(result[1].emoji_display, (c) => c.codePointAt(0).toString(16).toUpperCase()),
    ['1F44D', '1F3FF'],
    '5.16: puntos de código de 👍🏿 = [U+1F44D, U+1F3FF]'
  );
  assertStrictEqual(result[0].category, 'person', '5.16: 👩🏻 → person (tono ignorado en categoría)');
  assertStrictEqual(result[1].category, 'gesture', '5.16: 👍🏿 → gesture (tono ignorado en categoría)');
}

// ---------------------------------------------------------------------------
// Test 5.17: REGRESIÓN — Teclas no catalogadas (#, *) con regla general
// (base + U+FE0F + U+20E3): '#⃣' → '#️⃣' y '*⃣' → '*️⃣')
// ---------------------------------------------------------------------------
{
  // Arrange — tecla de almohadilla y tecla de asterisco (formato MindMup v3)
  const nodes = [makeNode({ node_id: 'n17', original_id: 'orig-17' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-17',
      attr: { stickers: ['emoji:0023 20E3', 'emoji:002A 20E3'] },
    })},
  };

  // Act
  const result = extractStickers(nodes, rawJson);

  // Assert — se inserta U+FE0F entre la base y U+20E3 (forma canónica)
  assertStrictEqual(result.length, 2, '5.17: 2 teclas extraídas');
  assertStrictEqual(result[0].emoji_display, '#\uFE0F\u20E3', '5.17: emoji:0023 20E3 → #️⃣ (con U+FE0F)');
  assertStrictEqual(result[1].emoji_display, '*\uFE0F\u20E3', '5.17: emoji:002A 20E3 → *️⃣ (con U+FE0F)');
  assertDeepEqual(
    Array.from(result[0].emoji_display, (c) => c.codePointAt(0).toString(16).toUpperCase()),
    ['23', 'FE0F', '20E3'],
    '5.17: puntos de código de #️⃣ = [U+0023, U+FE0F, U+20E3]'
  );
  assertDeepEqual(
    Array.from(result[1].emoji_display, (c) => c.codePointAt(0).toString(16).toUpperCase()),
    ['2A', 'FE0F', '20E3'],
    '5.17: puntos de código de *️⃣ = [U+002A, U+FE0F, U+20E3]'
  );
}

// ---------------------------------------------------------------------------
// Test 5.18: REGRESIÓN — Código emoji sin puntos de código se descarta
// ('emoji:' no produce representación visible → no se crea sticker)
// ---------------------------------------------------------------------------
{
  // Arrange — prefijo "emoji:" sin puntos de código (attr corrupto)
  const nodes = [makeNode({ node_id: 'n18', original_id: 'orig-18' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-18',
      attr: { stickers: ['emoji:'] },
    })},
  };

  // Act
  const result = extractStickers(nodes, rawJson);

  // Assert — emojiDisplay vacío → entrada descartada (longitud 0)
  assertStrictEqual(result.length, 0, '5.18: "emoji:" sin puntos de código → 0 stickers');
}

// ---------------------------------------------------------------------------
// Test 5.19: Nuevos códigos emoji catalogados
// 13 códigos que antes recibían 'unknown'
// ---------------------------------------------------------------------------
{
  const testCases = [
    { code: '⬅', expectedCategory: 'symbol' },    // U+2B05 flecha izquierda
    { code: '⬆', expectedCategory: 'symbol' },    // U+2B06 flecha hacia arriba
    { code: '↩', expectedCategory: 'symbol' },    // U+21A9 flecha de retorno
    { code: '🔗', expectedCategory: 'symbol' },   // U+1F517 enlace
    { code: '🖼', expectedCategory: 'object' },   // U+1F5BC marco de imagen
    { code: '☑', expectedCategory: 'symbol' },    // U+2611 casilla marcada
    { code: '🗄', expectedCategory: 'office' },   // U+1F5C4 archivador
    { code: '🗃', expectedCategory: 'office' },   // U+1F5C3 caja de archivos
    { code: '👓', expectedCategory: 'clothing' }, // U+1F453 gafas
    { code: '🔎', expectedCategory: 'object' },   // U+1F50E lupa
    { code: '✴', expectedCategory: 'symbol' },    // U+2734 estrella de ocho puntas
    { code: '😈', expectedCategory: 'smiley' },   // U+1F608 diablillo
    { code: '🚪', expectedCategory: 'travel' },   // U+1F6AA puerta
  ];

  for (const { code, expectedCategory } of testCases) {
    const nodes = [makeNode({ node_id: 'n19', original_id: 'orig-19' })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: 'orig-19', attr: { stickers: [{ code }] } }) },
    };

    // Act
    const result = extractStickers(nodes, rawJson);

    // Assert — clasificado con su categoría, nunca 'unknown'
    assertStrictEqual(result.length, 1, `5.19: ${code} extraído`);
    assertStrictEqual(result[0].category, expectedCategory,
      `5.19: ${code} → categoría ${expectedCategory} (no unknown)`);
  }
}

// ---------------------------------------------------------------------------
// Test 5.20: Más códigos emoji catalogados
// 🧮 (U+1F9EE, ábaco), ⏱ (U+23F1, cronómetro), ↙ (U+2199, flecha
// abajo-izquierda) y ⬆ (U+2B06, flecha hacia arriba): códigos que antes
// recibían 'unknown'. Se prueban en formato hex (emoji:XXXXX) y como carácter.
// ---------------------------------------------------------------------------
{
  const testCases = [
    { code: 'emoji:1F9EE', expectedDisplay: '🧮', expectedCategory: 'object' },  // ábaco
    { code: 'emoji:23F1', expectedDisplay: '⏱', expectedCategory: 'clock' },    // cronómetro
    { code: 'emoji:2199', expectedDisplay: '↙', expectedCategory: 'symbol' },   // flecha abajo-izquierda
    { code: 'emoji:2B06', expectedDisplay: '⬆', expectedCategory: 'symbol' },   // flecha hacia arriba
    { code: '🧮', expectedDisplay: '🧮', expectedCategory: 'object' },
    { code: '⏱', expectedDisplay: '⏱', expectedCategory: 'clock' },
    { code: '↙', expectedDisplay: '↙', expectedCategory: 'symbol' },
    { code: '⬆', expectedDisplay: '⬆', expectedCategory: 'symbol' },
    // Variantes con selector de variación U+FE0F: normalizan a la clave base
    { code: '⏱️', expectedDisplay: '⏱', expectedCategory: 'clock' },
    { code: '↙️', expectedDisplay: '↙', expectedCategory: 'symbol' },
  ];

  for (const { code, expectedDisplay, expectedCategory } of testCases) {
    const nodes = [makeNode({ node_id: 'n20', original_id: 'orig-20' })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: 'orig-20', attr: { stickers: [code] } }) },
    };

    // Act
    const result = extractStickers(nodes, rawJson);

    // Assert — clasificado con su categoría, nunca 'unknown'
    assertStrictEqual(result.length, 1, `5.20: ${code} extraído`);
    assertStrictEqual(result[0].category, expectedCategory,
      `5.20: ${code} → categoría ${expectedCategory} (no unknown)`);
    assertStrictEqual(result[0].emoji_display, expectedDisplay,
      `5.20: ${code} → emoji_display ${expectedDisplay}`);
  }
}

// ---------------------------------------------------------------------------
// Test 5.21: Categoría por defecto inyectada (DEFAULT_STICKER_CATEGORY)
// ---------------------------------------------------------------------------
{
  // Arrange — un sticker no catalogado y otro catalogado
  const nodes = [makeNode({ node_id: 'n21', original_id: 'orig-21' })];
  const rawJson = {
    ideas: { '1': makeRawNode({
      id: 'orig-21',
      attr: { stickers: [{ code: 'emoji:00000' }, { code: '🚀' }] },
    })},
  };

  // Act — con categoría inyectada y sin ella
  const custom = extractStickers(nodes, rawJson, 'sin_categoria');
  const fallback = extractStickers(nodes, rawJson);

  // Assert — el no catalogado usa la inyectada; el catalogado no cambia
  assertStrictEqual(custom.length, 2, '5.21: 2 stickers extraídos');
  assertStrictEqual(custom[0].category, 'sin_categoria',
    '5.21: no catalogado → categoría por defecto inyectada');
  assertStrictEqual(custom[1].category, 'travel',
    '5.21: catalogado conserva su categoría');
  assertStrictEqual(fallback[0].category, 'unknown',
    '5.21: sin inyección → respaldo unknown');
}

// ---------------------------------------------------------------------------
// Test 5.22: el catálogo no tiene colisiones normalizadas
// ---------------------------------------------------------------------------
{
  // Assert — el catálogo cargado no contiene claves normalizadas repetidas
  assertStrictEqual(findStickerCatalogCollisions().length, 0,
    '5.22: catálogo sin claves normalizadas duplicadas');

  // El detector también identifica colisiones artificiales (❤️ y ❤ normalizan igual)
  const artificial = new Map([
    ['❤️', 'heart'],
    ['❤', 'otro'],
    ['🚀', 'travel'],
  ]);
  const collisions = findStickerCatalogCollisions(artificial);

  assertStrictEqual(collisions.length, 1, '5.22: detector encuentra 1 colisión artificial');
  assertStrictEqual(collisions[0].key, '❤', '5.22: clave colisionada identificada');
  assertDeepEqual(collisions[0].categories, ['heart', 'otro'],
    '5.22: categorías en conflicto identificadas');
}

// ---------------------------------------------------------------------------
// Test 5.23: duplicados depurados con categoría única y coherente
// (antes dependía del orden: la clave normalizada repetida conservaba la
// primera entrada, mientras el Map conservaba la última)
// ---------------------------------------------------------------------------
{
  const testCases = [
    { code: '⭐', expected: 'star' },
    { code: '🔥', expected: 'fire' },
    { code: '💻', expected: 'tech' },
    { code: '📚', expected: 'book' },
    { code: '🌙', expected: 'moon' },
    { code: '🌈', expected: 'nature' },
    { code: '🥳', expected: 'celebration' },
  ];

  for (const { code, expected } of testCases) {
    const nodes = [makeNode({ node_id: 'n23', original_id: 'orig-23' })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: 'orig-23', attr: { stickers: [{ code }] } }) },
    };

    // Act
    const result = extractStickers(nodes, rawJson);

    // Assert — una única categoría determinista para cada clave
    assertStrictEqual(result.length, 1, `5.23: ${code} extraído`);
    assertStrictEqual(result[0].category, expected,
      `5.23: ${code} → categoría coherente (${expected})`);
  }
}

// ============================================================================
// CAPA 6: extractUrls()
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Capa 6 — extractUrls()');
console.log('═══════════════════════════════════════════════════════════\n');

// ---------------------------------------------------------------------------
// Test 6.1: Nodo sin título → array vacío
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nA', title: '' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-A', title: '' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 0, '6.1: Nodo sin título → array vacío');
}

// ---------------------------------------------------------------------------
// Test 6.2: Título sin URL → array vacío
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nB', title: 'Texto sin enlace' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-B', title: 'Texto sin enlace' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 0, '6.2: Título sin URL → array vacío');
}

// ---------------------------------------------------------------------------
// Test 6.3: Detecta URL https en título
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nC', title: 'Visita https://ejemplo.com/pagina' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-C', title: 'Visita https://ejemplo.com/pagina' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 1, '6.3: URL https detectada');
  assertStrictEqual(result[0].url, 'https://ejemplo.com/pagina', '6.3: URL extraída correctamente');
  assert(isValidUUID(result[0].ref_id), '6.3: ref_id es UUID válido');
  assertStrictEqual(result[0].node_id, 'nC', '6.3: node_id correcto');
}

// ---------------------------------------------------------------------------
// Test 6.4: URL de dominio conocido (github → 'code')
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nD', title: 'Repo: https://github.com/example/repo' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-D', title: 'Repo: https://github.com/example/repo' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 1, '6.4: URL github detectada');
  assertStrictEqual(result[0].ref_type, 'code', '6.4: github.com → ref_type = code');
  assertStrictEqual(result[0].url, 'https://github.com/example/repo', '6.4: URL completa correcta');
}

// ---------------------------------------------------------------------------
// Test 6.5: Clasificación de varios dominios conocidos
// ---------------------------------------------------------------------------
{
  const domainTests = [
    { url: 'https://youtube.com/watch?v=abc123', expected: 'video' },
    { url: 'https://twitter.com/user', expected: 'social' },
    { url: 'https://wikipedia.org/wiki/Test', expected: 'reference' },
    { url: 'https://cloudflare.com/docs', expected: 'cloud' },
    { url: 'https://notion.so/MyPage', expected: 'tool' },
    { url: 'https://google.com/search?q=test', expected: 'search' },
  ];

  for (const { url, expected } of domainTests) {
    // Cada test con su propio nodo para evitar interferencias
    const uniqueId = `nE-${Math.random().toString(36).slice(2)}`;
    const nodes = [makeNode({ node_id: uniqueId, title: `Enlace: ${url}` })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: `orig-${uniqueId}`, title: `Enlace: ${url}` }) },
    };
    const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
    assertStrictEqual(result.length, 1, `6.5: URL ${url} detectada`);
    assertStrictEqual(result[0].ref_type, expected, `6.5: ${url} → ${expected}`);
  }
}

// ---------------------------------------------------------------------------
// Test 6.6: Dominio desconocido → 'web_page'
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nF', title: 'Sitio: https://misitio-personal.com/blog' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-F', title: 'Sitio: https://misitio-personal.com/blog' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 1, '6.6: URL dominio desconocido detectada');
  assertStrictEqual(result[0].ref_type, 'web_page', '6.6: Dominio desconocido → web_page');
}

// ---------------------------------------------------------------------------
// Test 6.7: mailto: → 'email' (vía classifyUrl)
// ---------------------------------------------------------------------------
// NOTA: extractUrls() usa regex /https?:\/\/[^\s]+/g que solo captura
// http/https. La clasificación de mailto: ocurre en classifyUrl() de
// url-classifier.js, que es la función que extractUrls() invoca internamente
// para cada URL ya detectada. Verificamos aquí que classifyUrl() clasifica
// correctamente mailto: como 'email'.
{
  assertStrictEqual(classifyUrl('mailto:user@example.com'), 'email', '6.7: classifyUrl(mailto:) → email');
  assertStrictEqual(classifyUrl('mailto:admin@test.org'), 'email', '6.7: classifyUrl(otro mailto) → email');

  // Además verificamos que extractUrls no detecta mailto: en el título
  // (la regex no captura protocolos no http/https — comportamiento esperado)
  const nodes = [makeNode({ node_id: 'nG', title: 'Contacto: mailto:user@example.com' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-G', title: 'Contacto: mailto:user@example.com' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 0, '6.7: extractUrls no captura mailto: (regex solo http/https)');
}

// ---------------------------------------------------------------------------
// Test 6.8: URL pegada al texto sin espacio
// ---------------------------------------------------------------------------
{
  const title = 'texto previohttps://maps.example.org/map/v2/mapa-sintetico';
  const nodes = [makeNode({ node_id: 'nH', title })];
  const rawJson = {
    ideas: { '1': makeRawNode({ id: 'orig-H', title }) },
  };
  // Clasificador inyectado: el dominio sintético se comporta como un mapa
  const classifier = { 'maps.example.org': 'mindmap' };
  const result = extractUrls(nodes, rawJson, classifier, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 1, '6.8: URL pegada al texto detectada');
  assertStrictEqual(result[0].url, 'https://maps.example.org/map/v2/mapa-sintetico', '6.8: URL extraída correctamente');
  assertStrictEqual(result[0].label, 'texto previo', '6.8: Label = texto anterior sin espacio');
  assertStrictEqual(result[0].ref_type, 'mindmap', '6.8: dominio sintético de mapas → mindmap');
}

// ---------------------------------------------------------------------------
// Test 6.9: Múltiples URLs en un mismo título
// ---------------------------------------------------------------------------
{
  const title = 'Repo: https://github.com/a y Docs: https://docs.example.com';
  const nodes = [makeNode({ node_id: 'nI', title })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-I', title }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 2, '6.9: 2 URLs en el mismo título');

  // Primer URL: github.com → code
  assertStrictEqual(result[0].url, 'https://github.com/a', '6.9: Primera URL = github');
  assertStrictEqual(result[0].ref_type, 'code', '6.9: github → code');
  assertStrictEqual(result[0].label, 'Repo:', '6.9: Label primera URL = "Repo:"');

  // Segunda URL: docs.example.com → web_page
  assertStrictEqual(result[1].url, 'https://docs.example.com', '6.9: Segunda URL = docs.example.com');
  assertStrictEqual(result[1].ref_type, 'web_page', '6.9: docs.example.com → web_page');
  // El label de la segunda URL incluye el texto anterior, incluyendo la primera URL
  assert(result[1].label && result[1].label.includes('Repo:'), '6.9: Label segunda URL contiene "Repo:"');
  assert(result[1].label && result[1].label.includes('y Docs:'), '6.9: Label segunda URL contiene "y Docs:"');
}

// ---------------------------------------------------------------------------
// Test 6.10: Extrae label correctamente (texto visible antes de la URL)
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nJ', title: 'Ver video en https://youtube.com/watch?v=abc' })];
  const rawJson = {
    ideas: { '1': makeRawNode({ id: 'orig-J', title: 'Ver video en https://youtube.com/watch?v=abc' }) },
  };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 1, '6.10: URL con label detectada');
  assertStrictEqual(result[0].label, 'Ver video en', '6.10: Label = "Ver video en"');
  assertStrictEqual(result[0].ref_type, 'video', '6.10: youtube → video');
}

// ---------------------------------------------------------------------------
// Test 6.11: Sin label cuando la URL está al inicio del título
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'nK', title: 'https://example.com/inicio' })];
  const rawJson = { ideas: { '1': makeRawNode({ id: 'orig-K', title: 'https://example.com/inicio' }) } };
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
  assertStrictEqual(result.length, 1, '6.11: URL al inicio detectada');
  assertStrictEqual(result[0].label, undefined, '6.11: label = undefined cuando URL al inicio');
  assertStrictEqual(result[0].url, 'https://example.com/inicio', '6.11: URL correcta');
}

// ---------------------------------------------------------------------------
// Test 6.12: Nodos vacíos → array vacío
// ---------------------------------------------------------------------------
{
  assertStrictEqual(extractUrls([], {}, URL_CLASSIFIER, DEFAULT_REF_TYPE).length, 0,
    '6.12: nodes vacío → array vacío');
  assertStrictEqual(extractUrls(null, {}, URL_CLASSIFIER, DEFAULT_REF_TYPE).length, 0,
    '6.12: nodes null → array vacío');
}

// ---------------------------------------------------------------------------
// Test 6.13: Tipos de referencia variados con dominios sintéticos
// (clasificador inyectado; no depende de dominios de servicios reales)
// ---------------------------------------------------------------------------
{
  const domainTests = [
    // Conversaciones con asistentes de IA
    { url: 'https://chat.example.org/sesion/123', expected: 'ai_chat' },
    { url: 'https://asistente.example.org/sesion/456', expected: 'ai_chat' },
    // Documentos y archivos
    { url: 'https://docs.example.org/documento/abc', expected: 'document' },
    { url: 'https://drive.example.org/carpetas/def', expected: 'document' },
    // Mapas
    { url: 'https://maps.example.org/map/v2/ghi', expected: 'mindmap' },
    // Alojamiento de imágenes
    { url: 'https://images.example.org/imagen.png', expected: 'image_host' },
    // Sitios web de producto (example.com cubre sus subdominios por sufijo)
    { url: 'https://producto.example.com/documentacion/', expected: 'web_page' },
    { url: 'https://tienda.example.com/productos/ejemplo/', expected: 'web_page' },
    // Subdominio de example.net cubierto por el sufijo (sin duplicar)
    { url: 'https://developers.example.net/workers/', expected: 'cloud' },
  ];

  const classifier = {
    'chat.example.org': 'ai_chat',
    'asistente.example.org': 'ai_chat',
    'docs.example.org': 'document',
    'drive.example.org': 'document',
    'maps.example.org': 'mindmap',
    'images.example.org': 'image_host',
    'example.com': 'web_page',
    'example.net': 'cloud',
  };

  for (const { url, expected } of domainTests) {
    const uniqueId = `n13-${Math.random().toString(36).slice(2)}`;
    const nodes = [makeNode({ node_id: uniqueId, title: `Enlace: ${url}` })];
    const rawJson = {
      ideas: { '1': makeRawNode({ id: `orig-${uniqueId}`, title: `Enlace: ${url}` }) },
    };
    const result = extractUrls(nodes, rawJson, classifier, DEFAULT_REF_TYPE);
    assertStrictEqual(result.length, 1, `6.13: URL ${url} detectada`);
    assertStrictEqual(result[0].ref_type, expected, `6.13: ${url} → ${expected}`);
  }
}

// ---------------------------------------------------------------------------
// Test 6.14: classifyUrl mantiene las clasificaciones previas
// ---------------------------------------------------------------------------
{
  assertStrictEqual(classifyUrl('https://youtube.com/watch?v=abc'), 'video', '6.14: youtube → video');
  assertStrictEqual(classifyUrl('https://github.com/x/y'), 'code', '6.14: github → code');
  assertStrictEqual(classifyUrl('https://cloudflare.com/docs'), 'cloud', '6.14: cloudflare → cloud');
  assertStrictEqual(classifyUrl('https://google.com/search?q=x'), 'search', '6.14: google.com → search (raíz intacta)');
  assertStrictEqual(classifyUrl('https://notebooklm.google.com/notebook/x'), 'ai_chat',
    '6.14: notebooklm.google.com → ai_chat (subdominio más específico que google.com)');
  assertStrictEqual(classifyUrl('https://misitio-personal.com/blog'), 'web_page', '6.14: dominio desconocido → web_page');
}

// ---------------------------------------------------------------------------
// Test 6.15: el clasificador inyectado se usa de verdad
// ---------------------------------------------------------------------------
{
  // Arrange — clasificador propio con coincidencia por sufijo
  const customClassifier = { 'midominio.test': 'custom_type' };
  const nodes = [
    makeNode({ node_id: 'n15a', title: 'A: https://midominio.test/a' }),
    makeNode({ node_id: 'n15b', title: 'B: https://sub.midominio.test/b' }),
  ];
  const rawJson = { ideas: {} };

  // Act
  const result = extractUrls(nodes, rawJson, customClassifier, 'otro', undefined);

  // Assert — el dominio y su subdominio usan el tipo del clasificador inyectado
  assertStrictEqual(result.length, 2, '6.15: 2 URLs con clasificador inyectado');
  assertStrictEqual(result[0].ref_type, 'custom_type',
    '6.15: dominio del clasificador inyectado → custom_type');
  assertStrictEqual(result[1].ref_type, 'custom_type',
    '6.15: subdominio cubierto por sufijo → custom_type');
}

// ---------------------------------------------------------------------------
// Test 6.16: el tipo por defecto inyectado se usa para http/https
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n16', title: 'Sitio: https://desconocido.test/x' })];
  const rawJson = { ideas: {} };

  // Act — con defaultRefType inyectado y sin él
  const custom = extractUrls(nodes, rawJson, {}, 'otro_tipo', undefined);
  const fallback = extractUrls(nodes, rawJson, undefined, undefined, undefined);

  // Assert
  assertStrictEqual(custom.length, 1, '6.16: URL detectada');
  assertStrictEqual(custom[0].ref_type, 'otro_tipo',
    '6.16: defaultRefType inyectado usado para dominio desconocido');
  assertStrictEqual(fallback[0].ref_type, 'web_page',
    '6.16: sin inyección → DEFAULT_REF_TYPE del módulo');
}

// ---------------------------------------------------------------------------
// Test 6.17: sin clasificador inyectado se respalda en el módulo
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n17', title: 'Repo: https://github.com/x/y' })];
  const rawJson = { ideas: {} };

  // Act
  const result = extractUrls(nodes, rawJson, undefined, undefined, undefined);

  // Assert — classifyUrl() del módulo clasifica el dominio conocido
  assertStrictEqual(result.length, 1, '6.17: URL detectada con respaldo del módulo');
  assertStrictEqual(result[0].ref_type, 'code', '6.17: github → code (clasificador del módulo)');
}

// ---------------------------------------------------------------------------
// Test 6.18: patrón inválido no lanza y usa el patrón por defecto
// ---------------------------------------------------------------------------
{
  const nodes = [makeNode({ node_id: 'n18', title: 'Repo: https://github.com/x/y' })];
  const rawJson = { ideas: {} };

  // Act — '(' es una expresión regular inválida
  let result;
  let threw = false;
  try {
    result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE, '(');
  } catch {
    threw = true;
  }

  // Assert
  assertStrictEqual(threw, false, '6.18: patrón inválido no lanza');
  assertStrictEqual(result.length, 1, '6.18: el respaldo detecta la URL');
  assertStrictEqual(result[0].ref_type, 'code', '6.18: clasificación correcta con respaldo');
}

// ---------------------------------------------------------------------------
// Test 6.19: el patrón válido recibido se usa
// ---------------------------------------------------------------------------
{
  // Arrange — patrón que solo reconoce un dominio
  const nodes = [makeNode({
    node_id: 'n19',
    title: 'A https://solo-este.test/x y https://otro.test/y',
  })];
  const rawJson = { ideas: {} };
  const pattern = 'https?:\\/\\/solo-este\\.test[^\\s]*';

  // Act
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE, pattern);

  // Assert — solo la URL que casa el patrón
  assertStrictEqual(result.length, 1, '6.19: solo casa el patrón recibido');
  assertStrictEqual(result[0].url, 'https://solo-este.test/x', '6.19: URL del patrón');
}

// ---------------------------------------------------------------------------
// Test 6.20: un patrón que casa cadena vacía termina (no bucle infinito)
// ---------------------------------------------------------------------------
{
  // Arrange — 'x*' casa cadena vacía en todas las posiciones del título
  // (el título no contiene ninguna 'x' para forzar coincidencias vacías)
  const nodes = [makeNode({ node_id: 'n20', title: 'sin enlaces' })];
  const rawJson = { ideas: {} };

  // Act — sin el avance de lastIndex esta llamada no terminaría nunca
  const result = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE, 'x*');

  // Assert
  assertStrictEqual(result.length, 0,
    '6.20: patrón de cadena vacía termina sin generar referencias');
}

// ---------------------------------------------------------------------------
// Test 6.21: REGRESIÓN — dirección "www." sin esquema
// Con el patrón por defecto de VARIABLES.URL_REGEX_PATTERN, una dirección
// www. debe clasificarse como página web (antes caía en 'other').
// ---------------------------------------------------------------------------
{
  // Arrange — patrón por defecto de config.js (incluye www.) y dirección sin
  // esquema, como aparecen en títulos de MindMup
  const defaultPattern = '(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)';
  const nodes = [makeNode({ node_id: 'n21', title: 'Visita www.ejemplo.com' })];
  const rawJson = { ideas: {} };

  // Act — con el patrón por defecto explícito y con el respaldo del módulo
  const withPattern = extractUrls(
    nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE, defaultPattern
  );
  const withFallback = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);

  // Assert — detectada y clasificada como web_page (no 'other')
  assertStrictEqual(withPattern.length, 1, '6.21: URL www. detectada con patrón por defecto');
  assertStrictEqual(withPattern[0].url, 'www.ejemplo.com', '6.21: URL extraída con su prefijo www.');
  assertStrictEqual(withPattern[0].ref_type, 'web_page', '6.21: www. → web_page (no other)');
  assertStrictEqual(withFallback.length, 1, '6.21: el respaldo del módulo también detecta www.');
  assertStrictEqual(withFallback[0].ref_type, 'web_page',
    '6.21: respaldo del módulo clasifica www. como web_page');
}

// ---------------------------------------------------------------------------
// Test 6.22: el hostname de una URL www. sin esquema se resuelve contra
// el clasificador inyectado (se prueba con https:// delante)
// ---------------------------------------------------------------------------
{
  const defaultPattern = '(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)';
  const nodes = [makeNode({ node_id: 'n22', title: 'Repo: www.github.com/x/y' })];
  const rawJson = { ideas: {} };

  // Act
  const result = extractUrls(
    nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE, defaultPattern
  );

  // Assert — hostname www.github.com → github.com → code
  assertStrictEqual(result.length, 1, '6.22: URL www.github.com detectada');
  assertStrictEqual(result[0].url, 'www.github.com/x/y', '6.22: URL preservada sin esquema');
  assertStrictEqual(result[0].ref_type, 'code',
    '6.22: hostname sin esquema resuelto contra el clasificador');
}

// ============================================================================
// CAPA 7: assembleResult()
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Capa 7 — assembleResult()');
console.log('═══════════════════════════════════════════════════════════\n');

// ---------------------------------------------------------------------------
// Test 7.1: Ensambla las 10 colecciones con datos mínimos
// ---------------------------------------------------------------------------
{
  const parseResult = {
    metadata: {
      map_id: 'map-full-001',
      title: 'Mapa test',
      author: 'Tester',
      format_version: 3,
      source_file: 'test.mup',
      converted_at: '2026-07-14T12:00:00.000Z',
      node_count: 2,
    },
    rawJson: {
      formatVersion: 3,
      id: 'root',
      title: 'Mapa test',
      ideas: {
        '1': { id: 'orig-root', title: 'Raíz', attr: {} },
        '2': { id: 'orig-hijo', title: 'Hijo', attr: {} },
      },
    },
  };

  const nodes = [
    makeNode({ node_id: 'n7-1', map_id: 'map-full-001', original_id: 'orig-root', title: 'Raíz', depth: 0, path: '1', is_leaf: false }),
    makeNode({ node_id: 'n7-2', map_id: 'map-full-001', original_id: 'orig-hijo', title: 'Hijo', depth: 1, path: '1/2', is_leaf: true }),
  ];

  const notes = [
    { note_id: 'note-1', node_id: 'n7-2', index: 0, text: 'Nota de prueba', char_count: 14, truncated: false },
  ];

  const attributes = [
    { attr_id: 'attr-1', node_id: 'n7-1', attr_type: 'position', value: { x: 100 }, raw_attributes: { position: [100, 0] } },
  ];

  const stickers = [
    { sticker_id: 'stick-1', node_id: 'n7-1', emoji_code: '🚀', emoji_display: '🚀', category: 'travel' },
  ];

  const externalRefs = [
    { ref_id: 'ref-1', node_id: 'n7-2', url: 'https://github.com/test', ref_type: 'code', label: 'Repo' },
  ];

  const VARIABLES = { DEFAULT_LINK_RESOLUTION: 'unresolved' };

  // Act
  const result = assembleResult(parseResult, nodes, notes, attributes, stickers, externalRefs, VARIABLES);

  // Assert
  // 1. Verificar que el resultado es un objeto con 10 claves
  assert(result !== null && typeof result === 'object', '7.1: Resultado es un objeto');
  const expectedKeys = ['metadata', 'nodes', 'notes', 'attributes', 'stickers', 'icons', 'links', 'externalRefs', 'enums', 'indexes'];
  const actualKeys = Object.keys(result).sort();
  assertDeepEqual(actualKeys, expectedKeys.sort(), '7.1: El resultado tiene las 10 colecciones');

  // 2. metadata preservado
  assertStrictEqual(result.metadata.map_id, 'map-full-001', '7.1: metadata.map_id correcto');
  assertStrictEqual(result.metadata.title, 'Mapa test', '7.1: metadata.title correcto');

  // 3. nodes preservados
  assertStrictEqual(result.nodes.length, 2, '7.1: nodes.length = 2');
  assertStrictEqual(result.nodes[0].node_id, 'n7-1', '7.1: Primer node_id correcto');

  // 4. notes preservadas
  assertStrictEqual(result.notes.length, 1, '7.1: notes.length = 1');
  assertStrictEqual(result.notes[0].note_id, 'note-1', '7.1: note_id correcto');

  // 5. attributes preservados
  assertStrictEqual(result.attributes.length, 1, '7.1: attributes.length = 1');
  assertStrictEqual(result.attributes[0].attr_id, 'attr-1', '7.1: attr_id correcto');

  // 6. stickers preservados
  assertStrictEqual(result.stickers.length, 1, '7.1: stickers.length = 1');
  assertStrictEqual(result.stickers[0].sticker_id, 'stick-1', '7.1: sticker_id correcto');

  // 7. externalRefs preservados
  assertStrictEqual(result.externalRefs.length, 1, '7.1: externalRefs.length = 1');
  assertStrictEqual(result.externalRefs[0].ref_id, 'ref-1', '7.1: ref_id correcto');

  // 8. icons generada (vacía porque ningún nodo tiene attr.icon.type='image')
  assert(Array.isArray(result.icons), '7.1: icons es array');
  assertStrictEqual(result.icons.length, 0, '7.1: icons vacío (sin iconos en rawJson)');

  // 9. links generada (vacía porque rawJson no tiene links)
  assert(Array.isArray(result.links), '7.1: links es array');
  assertStrictEqual(result.links.length, 0, '7.1: links vacío (sin links en rawJson)');

  // 10. enums generado
  assert(Array.isArray(result.enums), '7.1: enums es array');
  assert(result.enums.length > 0, '7.1: enums generado con entradas');

  // 11. indexes generado (siempre 4)
  assert(Array.isArray(result.indexes), '7.1: indexes es array');
  assertStrictEqual(result.indexes.length, 4, '7.1: indexes tiene 4 entradas predefinidas');
}

// ---------------------------------------------------------------------------
// Test 7.2: Incluye maps, nodes, notes, attributes, stickers, externalRefs
//           (verificación detallada de contenido)
// ---------------------------------------------------------------------------
{
  // Arrange
  const parseResult = {
    metadata: { map_id: 'map-7-2', title: 'Test 7.2', format_version: 3, node_count: 1, source_file: 't.mup', converted_at: new Date().toISOString() },
    rawJson: { formatVersion: 3, id: 'root', title: 'Test 7.2', ideas: { '1': { id: 'orig-72', title: 'Nodo único', attr: {} } } },
  };
  const nodes = [makeNode({ node_id: 'n72', map_id: 'map-7-2', original_id: 'orig-72', title: 'Nodo único' })];
  const notes = [];
  const attributes = [];
  const stickers = [];
  const externalRefs = [];
  const VARIABLES = { DEFAULT_LINK_RESOLUTION: 'unresolved' };

  const result = assembleResult(parseResult, nodes, notes, attributes, stickers, externalRefs, VARIABLES);

  assertStrictEqual(result.metadata.title, 'Test 7.2', '7.2: metadata.title');
  assertStrictEqual(result.nodes.length, 1, '7.2: 1 nodo');
  assert(result.notes.length === 0, '7.2: notes vacío');
  assert(result.attributes.length === 0, '7.2: attributes vacío');
  assert(result.stickers.length === 0, '7.2: stickers vacío');
  assert(result.externalRefs.length === 0, '7.2: externalRefs vacío');
}

// ---------------------------------------------------------------------------
// Test 7.3: Incluye icons, links, enums, indexes
// ---------------------------------------------------------------------------
{
  // Construimos un rawJson con un icono y un enlace para probar extracción
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    title: 'Test iconos y links',
    ideas: {
      '1': {
        id: 'orig-icon',
        title: 'Nodo con icono',
        attr: {
          icon: { type: 'image', url: 'data:image/png;base64,aGVsbG8=', width: 24, height: 24, position: 'left' },
        },
      },
      '2': {
        id: 'orig-target',
        title: 'Nodo destino',
        attr: {},
      },
    },
    links: [
      { id: 'link-abc', from: 'orig-icon', to: 'orig-target', attr: { style: { color: '#00FF00', lineStyle: 'solid' } } },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'n-icon', map_id: 'map-7-3', original_id: 'orig-icon', title: 'Nodo con icono', is_leaf: false }),
    makeNode({ node_id: 'n-target', map_id: 'map-7-3', original_id: 'orig-target', title: 'Nodo destino' }),
  ];

  const parseResult = {
    metadata: { map_id: 'map-7-3', title: 'Test 7.3', format_version: 3, node_count: 2, source_file: 't.mup', converted_at: new Date().toISOString() },
    rawJson,
  };

  const stickers = [
    { sticker_id: 's-73', node_id: 'n-icon', emoji_code: '⭐', emoji_display: '⭐', category: 'star' },
  ];
  const externalRefs = [];
  const VARIABLES = { DEFAULT_LINK_RESOLUTION: 'unresolved' };

  const result = assembleResult(parseResult, nodes, [], [], stickers, externalRefs, VARIABLES);

  // icons
  assert(Array.isArray(result.icons), '7.3: icons es array');
  assertStrictEqual(result.icons.length, 1, '7.3: 1 icono extraído');
  assertStrictEqual(result.icons[0].node_id, 'n-icon', '7.3: icon node_id correcto');
  assertStrictEqual(result.icons[0].mime_type, 'image/png', '7.3: icon mime_type correcto');
  assertStrictEqual(result.icons[0].base64_length, 8, '7.3: icon base64_length = 8');
  assertStrictEqual(result.icons[0].width, 24, '7.3: icon width = 24');
  assertStrictEqual(result.icons[0].height, 24, '7.3: icon height = 24');
  assertStrictEqual(result.icons[0].position, 'left', '7.3: icon position = left');

  // links
  assert(Array.isArray(result.links), '7.3: links es array');
  assertStrictEqual(result.links.length, 1, '7.3: 1 enlace resuelto');
  assertStrictEqual(result.links[0].from_node_id, 'n-icon', '7.3: link from_node_id correcto');
  assertStrictEqual(result.links[0].to_node_id, 'n-target', '7.3: link to_node_id correcto');
  assertStrictEqual(result.links[0].color, '#00FF00', '7.3: link color correcto');
  assertStrictEqual(result.links[0].line_style, 'solid', '7.3: link line_style correcto');

  // enums
  assert(Array.isArray(result.enums), '7.3: enums es array');
  const stickerCategories = result.enums.filter(e => e.category === 'sticker_categories');
  assert(stickerCategories.length > 0, '7.3: enums incluye sticker_categories');
  assert(stickerCategories.some(e => e.code === 'star'), '7.3: sticker_categories incluye star');

  // indexes
  assert(Array.isArray(result.indexes), '7.3: indexes es array');
  assertStrictEqual(result.indexes.length, 4, '7.3: 4 indexes predefinidos');
  const indexIds = result.indexes.map(i => i.index_id).sort();
  assertDeepEqual(indexIds, ['idx_all_nodes', 'idx_leaf_nodes', 'idx_parent_nodes', 'idx_root_nodes'].sort(),
    '7.3: IDs de indexes correctos');
}

// ---------------------------------------------------------------------------
// Test 7.4: Links se resuelven correctamente (resolveLinks)
// ---------------------------------------------------------------------------
{
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    ideas: {
      '1': { id: 'orig-A', title: 'Nodo A', attr: {} },
      '2': { id: 'orig-B', title: 'Nodo B', attr: {} },
    },
    links: [
      {
        id: 'link-01',
        from: 'orig-A',
        to: 'orig-B',
        attr: {
          style: {
            color: '#FF0000',
            lineStyle: 'dashed',
            arrow: 'to',
            width: 2,
          },
        },
      },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'uuid-A', map_id: 'map-link', original_id: 'orig-A', title: 'Nodo A' }),
    makeNode({ node_id: 'uuid-B', map_id: 'map-link', original_id: 'orig-B', title: 'Nodo B' }),
  ];

  const links = resolveLinks(rawJson, nodes, 'unresolved');

  assertStrictEqual(links.length, 1, '7.4: 1 enlace resuelto');
  assert(isValidUUID(links[0].link_id), '7.4: link_id es UUID válido');
  assertStrictEqual(links[0].map_id, 'map-link', '7.4: map_id correcto');
  assertStrictEqual(links[0].from_node_id, 'uuid-A', '7.4: from_node_id resuelto a UUID');
  assertStrictEqual(links[0].to_node_id, 'uuid-B', '7.4: to_node_id resuelto a UUID');
  assertStrictEqual(links[0].color, '#FF0000', '7.4: color preservado');
  assertStrictEqual(links[0].line_style, 'dashed', '7.4: line_style preservado');
  assertStrictEqual(links[0].arrow, 'to', '7.4: arrow preservado');
  assertStrictEqual(links[0].width, 2, '7.4: width preservado');
  assert(links[0].resolution === undefined, '7.4: Sin resolution cuando ambos nodos existen');
}

// ---------------------------------------------------------------------------
// Test 7.5: Links huérfanos → resolution = DEFAULT_LINK_RESOLUTION
// ---------------------------------------------------------------------------
{
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    ideas: {
      '1': { id: 'orig-A', title: 'Nodo A', attr: {} },
    },
    links: [
      { id: 'link-orphan-1', from: 'orig-A', to: 'nonexistent-node' },
      { id: 'link-orphan-2', from: 'ghost-node', to: 'orig-A' },
      { id: 'link-orphan-3', from: 'ghost-1', to: 'ghost-2' },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'uuid-A', map_id: 'map-orphan', original_id: 'orig-A', title: 'Nodo A' }),
  ];

  const links = resolveLinks(rawJson, nodes, 'unresolved');

  assertStrictEqual(links.length, 3, '7.5: 3 enlaces, incluyendo huérfanos');

  // Link 1: from existe, to no existe
  assertStrictEqual(links[0].from_node_id, 'uuid-A', '7.5: Link 1 from resuelto');
  assertStrictEqual(links[0].to_node_id, null, '7.5: Link 1 to = null (inexistente)');
  assertStrictEqual(links[0].resolution, 'unresolved', '7.5: Link 1 resolution = unresolved');

  // Link 2: from no existe, to existe
  assertStrictEqual(links[1].from_node_id, null, '7.5: Link 2 from = null (inexistente)');
  assertStrictEqual(links[1].to_node_id, 'uuid-A', '7.5: Link 2 to resuelto');
  assertStrictEqual(links[1].resolution, 'unresolved', '7.5: Link 2 resolution = unresolved');

  // Link 3: ambos no existen
  assertStrictEqual(links[2].from_node_id, null, '7.5: Link 3 from = null');
  assertStrictEqual(links[2].to_node_id, null, '7.5: Link 3 to = null');
  assertStrictEqual(links[2].resolution, 'unresolved', '7.5: Link 3 resolution = unresolved');
}

// ---------------------------------------------------------------------------
// Test 7.6: rawJson sin links → links vacío
// ---------------------------------------------------------------------------
{
  const rawJson = { formatVersion: 3, id: 'root', ideas: { '1': { id: 'orig', title: 'Nodo', attr: {} } } };
  const nodes = [makeNode({ node_id: 'uuid', map_id: 'map', original_id: 'orig', title: 'Nodo' })];
  const links = resolveLinks(rawJson, nodes, 'unresolved');
  assertStrictEqual(links.length, 0, '7.6: Sin links en rawJson → array vacío');
}

// ---------------------------------------------------------------------------
// Test 7.7: generateEnums con datos variados
// ---------------------------------------------------------------------------
{
  const stickers = [
    { sticker_id: 's1', node_id: 'n1', emoji_code: '🚀', emoji_display: '🚀', category: 'travel' },
    { sticker_id: 's2', node_id: 'n2', emoji_code: '❤️', emoji_display: '❤️', category: 'heart' },
    { sticker_id: 's3', node_id: 'n3', emoji_code: '🔥', emoji_display: '🔥', category: 'fire' },
  ];
  const attributes = [
    { attr_id: 'a1', node_id: 'n1', attr_type: 'position', value: { x: 100, y: 200 }, raw_attributes: {} },
    { attr_id: 'a2', node_id: 'n2', attr_type: 'style', value: { backgroundColor: '#FF0' }, raw_attributes: {} },
  ];
  const externalRefs = [
    { ref_id: 'r1', node_id: 'n1', url: 'https://github.com/a', ref_type: 'code' },
    { ref_id: 'r2', node_id: 'n2', url: 'https://example.com', ref_type: 'web_page' },
  ];

  const enums = generateEnums(stickers, attributes, externalRefs);
  assert(Array.isArray(enums), '7.7: enums es array');
  assert(enums.length >= 5, '7.7: al menos 5 entradas de enum');

  // sticker_categories
  const sCat = enums.filter(e => e.category === 'sticker_categories');
  assertStrictEqual(sCat.length, 3, '7.7: 3 sticker_categories');

  // attr_types
  const aCat = enums.filter(e => e.category === 'attr_types');
  assert(aCat.length >= 2, '7.7: al menos 2 attr_types (x, y, backgroundColor)');

  // ref_types
  const rCat = enums.filter(e => e.category === 'ref_types');
  assertStrictEqual(rCat.length, 2, '7.7: 2 ref_types (code, web_page)');

  // Verificar formato de enum_id
  const travelEnum = enums.find(e => e.enum_id === 'enum_sticker_categories_travel');
  assert(travelEnum !== undefined, '7.7: enum travel existe');
  assertStrictEqual(travelEnum.code, 'travel', '7.7: enum travel code');
  assertStrictEqual(travelEnum.label, 'Travel', '7.7: enum travel label');
}

// ---------------------------------------------------------------------------
// Test 7.8: generateIndexes siempre devuelve 4 entradas
// ---------------------------------------------------------------------------
{
  const indexes1 = generateIndexes([]);
  assertStrictEqual(indexes1.length, 4, '7.8: 4 indexes con nodes vacío');

  const nodes = [makeNode({ node_id: 'n', depth: 0, is_leaf: false })];
  const indexes2 = generateIndexes(nodes);
  assertStrictEqual(indexes2.length, 4, '7.8: 4 indexes con datos');

  const expectedIds = ['idx_all_nodes', 'idx_root_nodes', 'idx_leaf_nodes', 'idx_parent_nodes'];
  for (const id of expectedIds) {
    assert(indexes2.some(i => i.index_id === id), `7.8: Index ${id} presente`);
  }

  // Verificar estructura de cada index
  for (const idx of indexes2) {
    assert(typeof idx.index_id === 'string' && idx.index_id.length > 0, '7.8: index_id es string no vacío');
    assert(typeof idx.name === 'string' && idx.name.length > 0, '7.8: name es string no vacío');
    assert(typeof idx.type === 'string', '7.8: type es string');
    assert(typeof idx.query === 'object' && !Array.isArray(idx.query), '7.8: query es objeto');
    assert(typeof idx.description === 'string', '7.8: description es string');
  }
}

// ---------------------------------------------------------------------------
// Test 7.9: extractIcons sin iconos → array vacío
// ---------------------------------------------------------------------------
{
  const rawJson = { ideas: { '1': { id: 'orig', title: 'Test', attr: {} } } };
  const nodes = [makeNode({ node_id: 'n', original_id: 'orig' })];
  const icons = extractIcons(rawJson, nodes);
  assertStrictEqual(icons.length, 0, '7.9: Sin iconos → array vacío');
}

// ---------------------------------------------------------------------------
// Test 7.10: extractIcons salta nodos sin attr.icon.type='image'
// ---------------------------------------------------------------------------
{
  const rawJson = {
    ideas: {
      '1': {
        id: 'orig-icon',
        title: 'Icono inválido',
        attr: {
          icon: { type: 'svg', url: 'data:image/svg+xml,...' }, // type != 'image'
        },
      },
    },
  };
  const nodes = [makeNode({ node_id: 'n-icon', original_id: 'orig-icon' })];
  const icons = extractIcons(rawJson, nodes);
  assertStrictEqual(icons.length, 0, '7.10: icon.type=svg → no se extrae');
}

// ---------------------------------------------------------------------------
// Test 7.11: extractIcons extrae icono sin campo type pero con url
// (formato de MindMup v3)
// ---------------------------------------------------------------------------
{
  // Arrange — icono con dirección de imagen presente y sin campo type
  const rawJson = {
    ideas: {
      '1': {
        id: 'orig-icon-nt',
        title: 'Icono sin tipo',
        attr: {
          icon: { url: 'data:image/png;base64,aGVsbG8=', width: 32, height: 32, position: 'center' },
        },
      },
    },
  };
  const nodes = [makeNode({ node_id: 'n-icon-nt', original_id: 'orig-icon-nt' })];

  // Act
  const icons = extractIcons(rawJson, nodes);

  // Assert — se trata como icono de imagen
  assertStrictEqual(icons.length, 1, '7.11: Icono sin type pero con url → 1 icono');
  assert(isValidUUID(icons[0].icon_id), '7.11: icon_id es UUID válido');
  assertStrictEqual(icons[0].node_id, 'n-icon-nt', '7.11: node_id resuelto');
  assertStrictEqual(icons[0].url, 'data:image/png;base64,aGVsbG8=', '7.11: url preservada');
  assertStrictEqual(icons[0].mime_type, 'image/png', '7.11: mime_type deducido de la url');
  assertStrictEqual(icons[0].base64_length, 8, '7.11: base64_length = 8');
  assertStrictEqual(icons[0].width, 32, '7.11: width = 32');
  assertStrictEqual(icons[0].height, 32, '7.11: height = 32');
  assertStrictEqual(icons[0].position, 'center', '7.11: position = center');
}

// ---------------------------------------------------------------------------
// Test 7.12: extractIcons omite icono sin dirección de imagen
// ---------------------------------------------------------------------------
{
  // Arrange — icono sin type y sin url (caso límite)
  const rawJson = {
    ideas: {
      '1': {
        id: 'orig-icon-nourl',
        title: 'Icono sin url',
        attr: { icon: { width: 32 } },
      },
    },
  };
  const nodes = [makeNode({ node_id: 'n-icon-nourl', original_id: 'orig-icon-nourl' })];

  // Act
  const icons = extractIcons(rawJson, nodes);

  // Assert — sin dirección de imagen no es icono de imagen
  assertStrictEqual(icons.length, 0, '7.12: Icono sin url → no se extrae');
}

// ---------------------------------------------------------------------------
// Test 7.13: resolveLinks con campos ideaIdFrom/ideaIdTo (formato v3)
// ---------------------------------------------------------------------------
{
  // Arrange — enlace con los campos de MindMup v3
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    ideas: {
      '1': { id: 'orig-A', title: 'Nodo A', attr: {} },
      '2': { id: 'orig-B', title: 'Nodo B', attr: {} },
    },
    links: [
      {
        id: 'link-v3',
        ideaIdFrom: 'orig-A',
        ideaIdTo: 'orig-B',
        attr: { style: { color: '#123456', lineStyle: 'solid' } },
      },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'uuid-A', map_id: 'map-link-v3', original_id: 'orig-A', title: 'Nodo A' }),
    makeNode({ node_id: 'uuid-B', map_id: 'map-link-v3', original_id: 'orig-B', title: 'Nodo B' }),
  ];

  // Act
  const links = resolveLinks(rawJson, nodes, 'unresolved');

  // Assert — ideaIdFrom/ideaIdTo resuelven a los UUID correctos
  assertStrictEqual(links.length, 1, '7.13: 1 enlace con ideaIdFrom/ideaIdTo');
  assert(isValidUUID(links[0].link_id), '7.13: link_id es UUID válido');
  assertStrictEqual(links[0].map_id, 'map-link-v3', '7.13: map_id correcto');
  assertStrictEqual(links[0].from_node_id, 'uuid-A', '7.13: ideaIdFrom → from_node_id');
  assertStrictEqual(links[0].to_node_id, 'uuid-B', '7.13: ideaIdTo → to_node_id');
  assertStrictEqual(links[0].color, '#123456', '7.13: color preservado');
  assertStrictEqual(links[0].line_style, 'solid', '7.13: line_style preservado');
  assert(links[0].resolution === undefined, '7.13: Sin resolution (ambos nodos existen)');
}

// ---------------------------------------------------------------------------
// Test 7.14: resolveLinks mantiene compatibilidad con from/to (formato antiguo)
// ---------------------------------------------------------------------------
{
  // Arrange — conviven enlaces en formato antiguo y formato v3
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    ideas: {
      '1': { id: 'orig-A', title: 'Nodo A', attr: {} },
      '2': { id: 'orig-B', title: 'Nodo B', attr: {} },
    },
    links: [
      { id: 'link-old-1', from: 'orig-A', to: 'orig-B' },
      { id: 'link-v3-2', ideaIdFrom: 'orig-A', ideaIdTo: 'orig-B' },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'uuid-A', map_id: 'map-link-mix', original_id: 'orig-A', title: 'Nodo A' }),
    makeNode({ node_id: 'uuid-B', map_id: 'map-link-mix', original_id: 'orig-B', title: 'Nodo B' }),
  ];

  // Act
  const links = resolveLinks(rawJson, nodes, 'unresolved');

  // Assert — ambos formatos resuelven correctamente
  assertStrictEqual(links.length, 2, '7.14: 2 enlaces (formato antiguo + v3)');
  assertStrictEqual(links[0].from_node_id, 'uuid-A', '7.14: from/to → from_node_id correcto');
  assertStrictEqual(links[0].to_node_id, 'uuid-B', '7.14: from/to → to_node_id correcto');
  assertStrictEqual(links[1].from_node_id, 'uuid-A', '7.14: ideaIdFrom/ideaIdTo → from_node_id correcto');
  assertStrictEqual(links[1].to_node_id, 'uuid-B', '7.14: ideaIdFrom/ideaIdTo → to_node_id correcto');
  assert(links.every(l => l.resolution === undefined), '7.14: Ningún enlace marcado como unresolved');
}

// ---------------------------------------------------------------------------
// Test 7.15: resolveLinks respalda campo a campo cuando falta ideaId*
// ---------------------------------------------------------------------------
{
  // Arrange — mezcla de campos: ideaId* presente en un extremo, from/to en el otro
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    ideas: {
      '1': { id: 'orig-A', title: 'Nodo A', attr: {} },
      '2': { id: 'orig-B', title: 'Nodo B', attr: {} },
    },
    links: [
      { id: 'link-mixed-1', ideaIdFrom: 'orig-A', to: 'orig-B' },
      { id: 'link-mixed-2', from: 'orig-A', ideaIdTo: 'orig-B' },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'uuid-A', map_id: 'map-link-fallback', original_id: 'orig-A', title: 'Nodo A' }),
    makeNode({ node_id: 'uuid-B', map_id: 'map-link-fallback', original_id: 'orig-B', title: 'Nodo B' }),
  ];

  // Act
  const links = resolveLinks(rawJson, nodes, 'unresolved');

  // Assert — cada extremo usa ideaId* si existe, si no respalda a from/to
  assertStrictEqual(links.length, 2, '7.15: 2 enlaces con respaldo campo a campo');
  assertStrictEqual(links[0].from_node_id, 'uuid-A', '7.15: ideaIdFrom usado cuando existe');
  assertStrictEqual(links[0].to_node_id, 'uuid-B', '7.15: ideaIdTo ausente → respaldo a `to`');
  assertStrictEqual(links[1].from_node_id, 'uuid-A', '7.15: ideaIdFrom ausente → respaldo a `from`');
  assertStrictEqual(links[1].to_node_id, 'uuid-B', '7.15: ideaIdTo usado cuando existe');
  assert(links.every(l => l.resolution === undefined), '7.15: Ningún enlace marcado como unresolved');
}

// ---------------------------------------------------------------------------
// Test 7.16: REGRESIÓN — extractIcons extrae icono con type:'' (cadena vacía)
// y url presente (antes '' se consideraba tipo explícito no imagen y se omitía)
// ---------------------------------------------------------------------------
{
  // Arrange — icono con type vacío y dirección de imagen (caso de MindMup v3)
  const rawJson = {
    ideas: {
      '1': {
        id: 'orig-icon-emptyt',
        title: 'Icono con type vacío',
        attr: {
          icon: { type: '', url: 'data:image/png;base64,AAAA' },
        },
      },
    },
  };
  const nodes = [makeNode({ node_id: 'n-icon-emptyt', original_id: 'orig-icon-emptyt' })];

  // Act
  const icons = extractIcons(rawJson, nodes);

  // Assert — type:'' se trata como ausente → icono de imagen extraído
  assertStrictEqual(icons.length, 1, '7.16: Icono con type:"" y url → 1 icono');
  assert(isValidUUID(icons[0].icon_id), '7.16: icon_id es UUID válido');
  assertStrictEqual(icons[0].node_id, 'n-icon-emptyt', '7.16: node_id resuelto');
  assertStrictEqual(icons[0].url, 'data:image/png;base64,AAAA', '7.16: url preservada');
  assertStrictEqual(icons[0].mime_type, 'image/png', '7.16: mime_type = image/png');
  assertStrictEqual(icons[0].base64_length, 4, '7.16: base64_length = 4');
}

// ---------------------------------------------------------------------------
// Test 7.16a: extractIcons incluye metaData cuando el icono lo aporta
// con claves (objeto no vacío — principio de solo campos presentes)
// ---------------------------------------------------------------------------
{
  // Arrange — icono de imagen con metaData no vacío (formato de MindMup v3)
  const rawJson = {
    ideas: {
      '1': {
        id: 'orig-icon-meta',
        title: 'Icono con metadatos',
        attr: {
          icon: {
            url: 'data:image/png;base64,QUJDRA==',
            width: 34,
            height: 35,
            position: 'left',
            metaData: { optimization: 'fast', alt: 'captura' },
          },
        },
      },
    },
  };
  const nodes = [makeNode({ node_id: 'n-icon-meta', original_id: 'orig-icon-meta' })];

  // Act
  const icons = extractIcons(rawJson, nodes);

  // Assert — metaData presente con las claves originales
  assertStrictEqual(icons.length, 1, '7.16a: Icono con metaData → 1 icono');
  assertStrictEqual(icons[0].node_id, 'n-icon-meta', '7.16a: node_id resuelto');
  assertDeepEqual(icons[0].metaData, { optimization: 'fast', alt: 'captura' },
    '7.16a: metaData incluido con sus claves');
  assertStrictEqual(icons[0].width, 34, '7.16a: width = 34');
  assertStrictEqual(icons[0].height, 35, '7.16a: height = 35');
}

// ---------------------------------------------------------------------------
// Test 7.16b: extractIcons omite metaData cuando está vacío ({}) — el campo
// solo se incluye si tiene claves (principio de solo campos presentes)
// ---------------------------------------------------------------------------
{
  // Arrange — icono de imagen con metaData vacío (formato de MindMup v3)
  const rawJson = {
    ideas: {
      '1': {
        id: 'orig-icon-metavacio',
        title: 'Icono con metaData vacío',
        attr: {
          icon: {
            url: 'data:image/png;base64,QUJDRA==',
            width: 34,
            height: 35,
            position: 'left',
            metaData: {},
          },
        },
      },
    },
  };
  const nodes = [makeNode({ node_id: 'n-icon-metavacio', original_id: 'orig-icon-metavacio' })];

  // Act
  const icons = extractIcons(rawJson, nodes);

  // Assert — metaData omitido (campo ausente), resto de campos intactos
  assertStrictEqual(icons.length, 1, '7.16b: Icono con metaData vacío → 1 icono');
  assertStrictEqual(icons[0].node_id, 'n-icon-metavacio', '7.16b: node_id resuelto');
  assertStrictEqual(icons[0].metaData, undefined, '7.16b: metaData vacío se omite');
  assertStrictEqual(icons[0].url, 'data:image/png;base64,QUJDRA==', '7.16b: url preservada');
  assertStrictEqual(icons[0].position, 'left', '7.16b: position preservada');
}

// ---------------------------------------------------------------------------
// Test 7.17: resolveLinks extrae label de attr.style.label
// La etiqueta textual solo se incluye si existe, es cadena y no está vacía
// ni es solo espacios (principio de solo campos presentes, como el resto).
// ---------------------------------------------------------------------------
{
  // Arrange — enlaces: con label, con label vacío, sin label, con label en
  // enlace NO resuelto (huérfano), y con label de solo espacios
  const rawJson = {
    formatVersion: 3,
    id: 'root',
    ideas: {
      '1': { id: 'orig-A', title: 'Nodo A', attr: {} },
      '2': { id: 'orig-B', title: 'Nodo B', attr: {} },
    },
    links: [
      {
        id: 'link-labeled',
        from: 'orig-A',
        to: 'orig-B',
        attr: {
          style: { color: '#FF6600', lineStyle: 'solid', arrow: 'to', width: 3, label: 'Etiqueta sintética de ejemplo' },
        },
      },
      {
        id: 'link-empty-label',
        from: 'orig-A',
        to: 'orig-B',
        attr: { style: { color: '#008000', label: '' } },
      },
      {
        id: 'link-no-label',
        from: 'orig-A',
        to: 'orig-B',
        attr: { style: { color: '#008080' } },
      },
      {
        id: 'link-huerfano-label',
        from: 'orig-A',
        to: 'orig-inexistente',
        attr: { style: { color: '#FF0000', label: 'Etiqueta en enlace no resuelto' } },
      },
      {
        id: 'link-whitespace-label',
        from: 'orig-A',
        to: 'orig-B',
        attr: { style: { color: '#008000', label: '   ' } },
      },
    ],
  };

  const nodes = [
    makeNode({ node_id: 'uuid-A', map_id: 'map-link-label', original_id: 'orig-A', title: 'Nodo A' }),
    makeNode({ node_id: 'uuid-B', map_id: 'map-link-label', original_id: 'orig-B', title: 'Nodo B' }),
  ];

  // Act
  const links = resolveLinks(rawJson, nodes, 'unresolved');

  // Assert — label conservado cuando existe y no es vacío
  assertStrictEqual(links.length, 5, '7.17: 5 enlaces procesados');
  assertStrictEqual(links[0].label, 'Etiqueta sintética de ejemplo', '7.17: label extraído de attr.style.label');
  assertStrictEqual(links[0].color, '#FF6600', '7.17: color preservado junto a label');
  // Label vacío → campo ausente (no incluido)
  assert(links[1].label === undefined, '7.17: label vacío → campo omitido');
  assertStrictEqual(links[1].color, '#008000', '7.17: color preservado sin label');
  // Sin label en el .mup → campo ausente
  assert(links[2].label === undefined, '7.17: sin label en attr.style → campo omitido');
  // Label en enlace NO resuelto → se conserva junto con resolution
  assertStrictEqual(links[3].label, 'Etiqueta en enlace no resuelto', '7.17: label conservado en enlace no resuelto');
  assertStrictEqual(links[3].resolution, 'unresolved', '7.17: enlace no resuelto marcado con resolution');
  assert(links[3].to_node_id === null, '7.17: to_node_id nulo en enlace no resuelto');
  // Label de solo espacios → campo ausente
  assert(links[4].label === undefined, '7.17: label de solo espacios → campo omitido');
  assert(links.slice(0, 3).every(l => l.resolution === undefined), '7.17: Enlaces resueltos sin resolution');
}

// ============================================================================
// CAPA 8: storeResult()
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Capa 8 — storeResult()');
console.log('═══════════════════════════════════════════════════════════\n');

// ---------------------------------------------------------------------------
// Test 8.1: storeResult es una función async
// ---------------------------------------------------------------------------
{
  assert(typeof storeResult === 'function', '8.1: storeResult es una función');
  // Verificar que devuelve una promesa
  const isAsync = storeResult.constructor.name === 'AsyncFunction' ||
    storeResult.toString().includes('async') ||
    storeResult.toString().includes('Promise');
  assert(isAsync, '8.1: storeResult es async (devuelve Promise)');
}

// ---------------------------------------------------------------------------
// Test 8.2: storeResult llama a bucket.put con los parámetros correctos
// ---------------------------------------------------------------------------
{
  // Arrange
  const result = {
    metadata: { map_id: 'test-map-uuid', title: 'Test' },
    nodes: [],
    notes: [],
    attributes: [],
    stickers: [],
    icons: [],
    links: [],
    externalRefs: [],
    enums: [],
    indexes: [],
  };

  let putCalledWithKey = null;
  let putCalledWithBody = null;
  let putCalledWithOptions = null;

  const mockBucket = {
    put: async (key, body, options) => {
      putCalledWithKey = key;
      putCalledWithBody = body;
      putCalledWithOptions = options;
    },
  };

  const env = { MUP_BUCKET: mockBucket };
  const CONFIG = { R2_BUCKET_NAME: 'example-bucket' };
  const VARIABLES = {
    BINDING_R2: 'MUP_BUCKET',
    R2_OUTPUT_PATH_TEMPLATE: 'output/{uuid}.json',
  };

  // Act
  const key = await storeResult(result, 'test-map-uuid', env, CONFIG, VARIABLES);

  // Assert
  assertStrictEqual(key, 'output/test-map-uuid.json', '8.2: Key generada correctamente');
  assertStrictEqual(putCalledWithKey, 'output/test-map-uuid.json', '8.2: bucket.put recibió la key correcta');
  assert(typeof putCalledWithBody === 'string', '8.2: bucket.put recibió body string (JSON)');

  // Verificar que el body es JSON válido
  try {
    const parsed = JSON.parse(putCalledWithBody);
    assertStrictEqual(parsed.metadata.map_id, 'test-map-uuid', '8.2: JSON body contiene metadata correcto');
  } catch {
    assert(false, '8.2: body es JSON válido');
  }

  assert(putCalledWithOptions !== null, '8.2: bucket.put recibió opciones');
  assertStrictEqual(putCalledWithOptions.httpMetadata.contentType, 'application/json',
    '8.2: Content-Type = application/json');
}

// ---------------------------------------------------------------------------
// Test 8.3: storeResult lanza error si el binding R2 no está disponible
// ---------------------------------------------------------------------------
{
  const result = {
    metadata: { map_id: 'test-uuid' },
    nodes: [],
    notes: [],
    attributes: [],
    stickers: [],
    icons: [],
    links: [],
    externalRefs: [],
    enums: [],
    indexes: [],
  };

  const env = {}; // Sin binding MUP_BUCKET
  const CONFIG = { R2_BUCKET_NAME: 'example-bucket' };
  const VARIABLES = {
    BINDING_R2: 'MUP_BUCKET',
    R2_OUTPUT_PATH_TEMPLATE: 'output/{uuid}.json',
  };

  let errorThrown = false;
  try {
    await storeResult(result, 'test-uuid', env, CONFIG, VARIABLES);
  } catch (err) {
    errorThrown = true;
    assert(err.message.includes('Binding R2 no disponible'), '8.3: Mensaje de error indica binding no disponible');
    assert(err.message.includes('MUP_BUCKET'), '8.3: Mensaje de error menciona el nombre del binding');
  }
  assert(errorThrown, '8.3: storeResult lanza Error cuando falta el binding R2');
}

// ---------------------------------------------------------------------------
// Test 8.4: La key usa R2_OUTPUT_PATH_TEMPLATE con {uuid} reemplazado
// ---------------------------------------------------------------------------
{
  // Arrange
  const result = {
    metadata: { map_id: 'my-custom-uuid-123' },
    nodes: [],
    notes: [],
    attributes: [],
    stickers: [],
    icons: [],
    links: [],
    externalRefs: [],
    enums: [],
    indexes: [],
  };

  let capturedKey = null;
  const mockBucket = { put: async (key) => { capturedKey = key; } };
  const env = { CUSTOM_BUCKET: mockBucket };
  const CONFIG = { R2_BUCKET_NAME: 'custom-bucket' };
  const VARIABLES = {
    BINDING_R2: 'CUSTOM_BUCKET',
    R2_OUTPUT_PATH_TEMPLATE: 'prefix/{uuid}/data.json',
  };

  // Act
  const key = await storeResult(result, 'my-custom-uuid-123', env, CONFIG, VARIABLES);

  // Assert
  assertStrictEqual(key, 'prefix/my-custom-uuid-123/data.json', '8.4: Key con template personalizado');
  assertStrictEqual(capturedKey, 'prefix/my-custom-uuid-123/data.json', '8.4: bucket.put recibe key correcta');
}

// ---------------------------------------------------------------------------
// Test 8.5: Error si el bucket.put lanza excepción
// ---------------------------------------------------------------------------
{
  const result = {
    metadata: { map_id: 'fail-uuid' },
    nodes: [],
    notes: [],
    attributes: [],
    stickers: [],
    icons: [],
    links: [],
    externalRefs: [],
    enums: [],
    indexes: [],
  };

  const mockBucket = {
    put: async () => {
      throw new Error('R2 connection timeout');
    },
  };

  const env = { MUP_BUCKET: mockBucket };
  const CONFIG = { R2_BUCKET_NAME: 'example-bucket' };
  const VARIABLES = {
    BINDING_R2: 'MUP_BUCKET',
    R2_OUTPUT_PATH_TEMPLATE: 'output/{uuid}.json',
  };

  let errorThrown = false;
  try {
    await storeResult(result, 'fail-uuid', env, CONFIG, VARIABLES);
  } catch (err) {
    errorThrown = true;
    assert(err.message.includes('Error al subir'), '8.5: Mensaje de error incluye "Error al subir"');
    assert(err.message.includes('fail-uuid'), '8.5: Mensaje de error incluye el UUID');
    assert(err.message.includes('R2 connection timeout'), '8.5: Mensaje de error incluye causa original');
  }
  assert(errorThrown, '8.5: storeResult lanza Error cuando bucket.put falla');
}

// ============================================================================
// UTILIDAD: normalizeOutputName()
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════');
console.log('  Utilidad — normalizeOutputName()');
console.log('═══════════════════════════════════════════════════════════\n');

// ---------------------------------------------------------------------------
// Test 9.1: Espacios normales → guion medio
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName('mapa de ideas.mup'), 'mapa-de-ideas.mup',
    '9.1: espacios normales → guion medio');
  assertStrictEqual(normalizeOutputName('mi mapa 2026'), 'mi-mapa-2026',
    '9.1: espacios entre palabras → guiones');
}

// ---------------------------------------------------------------------------
// Test 9.2: Espacio de no separación (U+00A0) → guion medio
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName('plan\u00A0maestro.mup'), 'plan-maestro.mup',
    '9.2: U+00A0 → guion medio');
  assertStrictEqual(normalizeOutputName('a\u00A0b\u00A0c'), 'a-b-c',
    '9.2: varios U+00A0 → guiones');
}

// ---------------------------------------------------------------------------
// Test 9.3: Letra eñe → ene (virgulilla eliminada tras descomposición NFD)
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName('España 2026.mup'), 'Espana-2026.mup',
    '9.3: ñ → n (virgulilla eliminada)');
  assertStrictEqual(normalizeOutputName('Año Nuevo'), 'Ano-Nuevo',
    '9.3: ñ en medio de palabra → n');
}

// ---------------------------------------------------------------------------
// Test 9.4: Vocales con tilde → vocal sin tilde
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName('Mapa de Ángeles'), 'Mapa-de-Angeles',
    '9.4: Á → A, é → e');
  assertStrictEqual(normalizeOutputName('Canción de Verano'), 'Cancion-de-Verano',
    '9.4: ó → o');
  assertStrictEqual(normalizeOutputName('Música Clásica'), 'Musica-Clasica',
    '9.4: ú → u, á → a');
}

// ---------------------------------------------------------------------------
// Test 9.5: Conservación de caracteres seguros
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName('abc.def_ghi-123'), 'abc.def_ghi-123',
    '9.5: letras, dígitos, punto, guion bajo y guion medio conservados');
  assertStrictEqual(normalizeOutputName('Mi-Mapa_2026.v2'), 'Mi-Mapa_2026.v2',
    '9.5: mezcla de caracteres seguros conservada');
}

// ---------------------------------------------------------------------------
// Test 9.6: Caracteres fuera del conjunto seguro se eliminan
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName('mapa 100% v2!'), 'mapa-100-v2',
    '9.6: % y ! eliminados');
  assertStrictEqual(normalizeOutputName('ß'), 'salida',
    '9.6: ß (sin descomposición canónica a ASCII) eliminado y respaldo aplicado');
  assertStrictEqual(normalizeOutputName(' mapa '), 'mapa',
    '9.6: guiones iniciales y finales recortados');
  assertStrictEqual(normalizeOutputName('  plan  '), 'plan',
    '9.6: secuencia de espacios colapsada y recortada');
}

// ---------------------------------------------------------------------------
// Test 9.7: Entrada no string → cadena vacía (caso de error)
// ---------------------------------------------------------------------------
{
  assertStrictEqual(normalizeOutputName(null), '', '9.7: null → cadena vacía');
  assertStrictEqual(normalizeOutputName(undefined), '', '9.7: undefined → cadena vacía');
  assertStrictEqual(normalizeOutputName(42), '', '9.7: número → cadena vacía');
}

// ============================================================================
// Resumen final
// ============================================================================
console.log('\n═══════════════════════════════════════════════════════════');
console.log(`  Resumen: ${passedTests}/${totalTests} tests pasados`);
console.log('═══════════════════════════════════════════════════════════\n');

// Exit code para CI
if (passedTests !== totalTests) {
  console.error(`  ⚠️  ${totalTests - passedTests} test(s) FALLARON`);
  process.exit(1);
} else {
  console.log('  🎉 Todos los tests pasaron correctamente.\n');
}
