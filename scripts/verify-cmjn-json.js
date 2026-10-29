#!/usr/bin/env node
/**
 * @file verify-cmjn-json.js
 * Verificación en profundidad del JSON-CMNJ generado por el conversor MUP.
 *
 * Propósito:
 *   Verifica que un JSON-CMNJ (10 colecciones) es una conversión fiel del
 *   mapa MindMup v3 original (.mup), comparando el JSON contra la fuente
 *   mediante recorrido DFS pre-order sincronizado con el orden de aplanado
 *   del conversor.
 *
 * Uso:
 *   node scripts/verify-cmjn-json.js <mapa.mup> <json-cmnj.json>
 *
 *   Ejemplo:
 *   node scripts/verify-cmjn-json.js \
 *     mapa-ejemplo.mup \
 *     conversion-ejemplo.json
 *
 * Argumentos:
 *   1. Ruta del mapa original en formato MindMup v3 (.mup, JSON con
 *      formatVersion: 3, id: "root", ideas: {...}, links: [...]).
 *   2. Ruta del JSON-CMNJ resultante de la conversión (10 colecciones:
 *      metadata, nodes, notes, attributes, stickers, icons, links,
 *      externalRefs, enums, indexes).
 *
 * Comprobaciones:
 *   1. Conteos coincidentes con la fuente: nodos, pegatinas, notas,
 *      enlaces e iconos.
 *   2. Títulos íntegros: 0 discrepancias (mismos titles en el mismo
 *      orden DFS pre-order; títulos vacíos/ausentes deben coincidir).
 *   3. Orden de nodos preservado: sort_key de nodes[] idéntico a la
 *      secuencia de claves de ideas{} en DFS pre-order.
 *   4. Enlaces resueltos: 0 enlaces con resolution === 'unresolved' o
 *      con from_node_id/to_node_id nulos.
 *   5. Pegatinas: 0 con category === 'unknown'.
 *   6. Criterio correcto de la Capa 4: UN registro Attribute por nodo
 *      (attributes.length === nodes.length); raw_attributes null si el
 *      nodo original no tiene attr (o lo tiene null), {} si el attr es
 *      vacío, y con EXACTAMENTE las mismas claves que el attr original
 *      si tiene contenido (pérdida cero, todas las claves, no una
 *      muestra).
 *   7. Referencias cruzadas: todos los node_id de las colecciones
 *      secundarias (notes, attributes, stickers, icons, externalRefs,
 *      links) existen en nodes.
 *   8. Unicidad de UUIDs por colección: 0 duplicados en nodes (node_id),
 *      notes (note_id), attributes (attr_id), stickers (sticker_id),
 *      icons (icon_id), links (link_id) y externalRefs (ref_id).
 *   9. Las 10 colecciones presentes y metadatos completos (map_id,
 *      title, format_version, source_file, converted_at, node_count).
 *   A. Tema del mapa (capa 1): theme/themeOverrides del attr raíz
 *      conservados en metadata con los mismos valores (comparación
 *      exacta); si el attr raíz no los declara, tampoco deben aparecer
 *      en metadata.
 *   B. Adjuntos (capa 4): por cada nodo con attr.attachment objeto, el
 *      registro Attribute alineado (misma posición DFS pre-order que la
 *      comprobación 6) tipa value.attachment con name, contentType y
 *      size (size = longitud REAL del payload base64 decodificado,
 *      réplica de base64PayloadLength de la Capa 4) y conserva en
 *      raw_attributes.attachment TODAS las claves del original con los
 *      mismos valores, content completo sin truncar (pérdida cero).
 *   C. Estilos de enlace (capa 7): cada enlace del mapa con attr.style
 *      conserva color (de style.color), line_style (de style.lineStyle),
 *      arrow (de style.arrow) y width (de style.width) campo a campo en
 *      el mismo orden de aparición; los campos ausentes no aparecen en
 *      el JSON. Alineación de la posición i del mapa con links[i] del
 *      JSON, robustecida por ideaIdFrom/ideaIdTo resueltos a node_id.
 *   D. Detalles de iconos (capa 7, subcapa 10c): por cada icono de
 *      imagen del mapa (mismo criterio que extractIcons: attr.icon con
 *      type 'image' o type ausente/vacío y url/data presente), el
 *      registro de la colección icons conserva node_id resuelto al nodo
 *      aplanado correcto, url íntegra, mime_type deducido de la data URI
 *      (extraerMimeTypeDeUrl), base64_length real (payload tras la
 *      primera coma decodificado con atob, respaldo a la longitud del
 *      payload), width/height/position campo a campo y metaData solo si
 *      el original lo declara no vacío ({} o ausente → omitido).
 *
 * Salida:
 *   Imprime [PASADO]/[FALLADO] por comprobación con los valores reales
 *   comparados (truncados si son muy largos), un resumen final
 *   (=== RESUMEN ===) con el total de comprobaciones y fallos, y termina
 *   con código de salida 0 si todo pasa o 1 si algo falla.
 *
 * Estilo:
 *   JavaScript ESM puro (import/export), sin dependencias externas.
 *
 * Suposiciones documentadas:
 *   - El conteo de pegatinas del mapa replica los formatos que procesa
 *     la Capa 5: attr.stickers (array de objetos con `code`, array de
 *     cadenas "emoji:XXXX", u objeto con claves emoji) más
 *     attr.styles.stickers (array de cadenas). Un código "emoji:" sin
 *     puntos de código no produce representación visible y no cuenta.
 *   - El conteo de notas del mapa replica el filtro de la Capa 3: solo
 *     nodos con campo `id` definido (indexables por original_id) y con
 *     attr.note.text no vacío tras conversión a string.
 *   - El conteo de iconos replica el criterio de la Capa 7 (10c):
 *     nodos con attr.icon que declara type 'image' (o type ausente o
 *     vacío) y con url/data presente.
 *   - En la comprobación 7, los extremos de enlace nulos (from_node_id /
 *     to_node_id) se omiten: su detección es responsabilidad de la
 *     comprobación 4.
 *   - Se asume que los ids de nodo del .mup son únicos (si hubiera ids
 *     duplicados, la Capa 3 indexaría el último y el conteo de notas
 *     podría diferir; caso límite no presente en mapas válidos).
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ============================================================================
// Constantes de esquema
// ============================================================================

/** Las 10 colecciones del JSON-CMNJ. */
const COLECCIONES_CMNJ = [
  'metadata',
  'nodes',
  'notes',
  'attributes',
  'stickers',
  'icons',
  'links',
  'externalRefs',
  'enums',
  'indexes',
];

/** Campos obligatorios del metadata. */
const CAMPOS_METADATA = [
  'map_id',
  'title',
  'format_version',
  'source_file',
  'converted_at',
  'node_count',
];

/** Valor por defecto de resolución de enlaces del conversor. */
const RESOLUCION_NO_RESUELTO = 'unresolved';

// ============================================================================
// Acumuladores y función check()
// ============================================================================

let pasadas = 0;
let fallos = 0;

/**
 * Registra el resultado de una comprobación: acumula contadores e imprime
 * [PASADO] o [FALLADO] con el nombre y el detalle del valor real recibido.
 *
 * @param {string} nombre    - Nombre descriptivo de la comprobación
 * @param {boolean} condicion - true si la comprobación pasa
 * @param {string} detalle   - Detalle con los valores reales comparados
 * @returns {void}
 */
function check(nombre, condicion, detalle) {
  if (condicion) {
    pasadas++;
    console.log(`[PASADO] ${nombre}: ${detalle}`);
  } else {
    fallos++;
    console.error(`[FALLADO] ${nombre}: ${detalle}`);
  }
}

/**
 * Longitud máxima de un valor en los mensajes de detalle. Evita volcar
 * contenidos completos de mapas (adjuntos, data URIs, notas largas).
 */
const MAX_LONGITUD_DETALLE = 200;

/**
 * Recorta un texto para que no sature la salida.
 *
 * @param {string} texto - Texto ya formateado
 * @returns {string} Texto truncado con indicación de la longitud original
 */
function truncarDetalle(texto) {
  if (texto.length <= MAX_LONGITUD_DETALLE) {
    return texto;
  }
  return `${texto.slice(0, MAX_LONGITUD_DETALLE)}… (${texto.length} caracteres)`;
}

/**
 * Formatea un valor para mensajes de detalle, distinguiendo undefined,
 * null, cadenas (entre comillas) y el resto (JSON.stringify). Los valores
 * largos se truncan para no volcar contenidos completos de mapas.
 *
 * @param {*} valor - Valor a formatear
 * @returns {string} Representación legible del valor
 */
function formatearValor(valor) {
  if (valor === undefined) return 'undefined';
  if (valor === null) return 'null';
  if (typeof valor === 'string') return truncarDetalle(`"${valor}"`);

  let serializado;
  try {
    serializado = JSON.stringify(valor);
  } catch {
    serializado = String(valor);
  }

  return truncarDetalle(serializado === undefined ? String(valor) : serializado);
}

// ============================================================================
// Lectura de archivos
// ============================================================================

/**
 * Lee y parsea un archivo JSON (el .mup y el JSON-CMNJ son ambos JSON).
 * Si el archivo no existe o no es JSON válido, imprime el error y
 * termina con código de salida 1.
 *
 * @param {string} ruta    - Ruta del archivo a leer
 * @param {string} etiqueta - Descripción del archivo para el mensaje de error
 * @returns {Object} Objeto parseado
 */
function leerJson(ruta, etiqueta) {
  try {
    return JSON.parse(readFileSync(ruta, 'utf-8'));
  } catch (error) {
    console.error(`[ERROR] No se pudo leer el ${etiqueta} "${ruta}": ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Recorrido del mapa original (sincronizado con las Capas 2 y 4)
// ============================================================================

/**
 * Recorre recursivamente ideas{} del .mup en DFS pre-order (Object.keys)
 * aplicando el MISMO filtro defensivo que layer2-flatten y
 * layer4-attributes: las entradas no válidas (null, undefined, tipos
 * primitivos) se saltan para mantener la sincronización de índices.
 *
 * Devuelve la lista de nodos del mapa en el orden exacto en que el
 * convertidor los aplanó, cada uno con su clave (sort_key original) y
 * su nodo crudo (title, id, attr, ideas).
 *
 * @param {Object} rawJson - JSON del .mup ya parseado
 * @returns {Array<{clave: string, nodo: Object}>} Nodos del mapa en orden DFS pre-order
 */
function obtenerNodosDelMapaEnOrden(rawJson) {
  const resultado = [];
  const ideas = rawJson && rawJson.ideas;

  if (!ideas || typeof ideas !== 'object') {
    return resultado;
  }

  (function recorrer(ideasObj) {
    const claves = Object.keys(ideasObj);

    for (let i = 0; i < claves.length; i++) {
      const clave = claves[i];
      const nodo = ideasObj[clave];

      // Seguridad defensiva: mismo filtro que layer2/layer4
      if (!nodo || typeof nodo !== 'object') {
        continue;
      }

      resultado.push({ clave, nodo });

      // Misma detección de hoja que layer2: sin ideas, ideas no objeto
      // o ideas vacío → no se recurre
      const tieneIdeas = Object.prototype.hasOwnProperty.call(nodo, 'ideas');
      const esHoja =
        !tieneIdeas ||
        !nodo.ideas ||
        typeof nodo.ideas !== 'object' ||
        Object.keys(nodo.ideas).length === 0;

      if (!esHoja) {
        recorrer(nodo.ideas);
      }
    }
  })(ideas);

  return resultado;
}

// ============================================================================
// Conteos derivados de la fuente (mapa .mup)
// ============================================================================

/**
 * Determina si un código de sticker crudo produce representación visible.
 *
 * Replica el criterio de la Capa 5 (pushStickerEntry):
 * un código no textual o vacío se descarta, y un código con prefijo
 * "emoji:" sin puntos de código no produce display y tampoco cuenta.
 *
 * @param {*} codigo - Código emoji crudo (string o valor no textual)
 * @returns {boolean} true si la Capa 5 generaría un sticker visible
 */
function codigoProduceDisplay(codigo) {
  if (typeof codigo !== 'string' || codigo.length === 0) {
    return false;
  }

  // Formato hex "emoji:XXXX" o "emoji:XXXX XXXX": sin puntos de código
  // tras el prefijo no hay representación visible
  if (codigo.startsWith('emoji:')) {
    return codigo.slice(6).trim().length > 0;
  }

  // Carácter emoji directo: siempre visible
  return true;
}

/**
 * Cuenta los stickers que la Capa 5 extraería del attr de un nodo.
 *
 * Replica los formatos soportados por extractStickersFromAttr:
 *   - attr.stickers como array de objetos {code} (1 por elemento con code)
 *   - attr.stickers como array de cadenas "emoji:XXXX" (1 por elemento)
 *   - attr.stickers como objeto con claves emoji (1 por clave)
 *   - attr.styles.stickers como array de cadenas (1 por elemento)
 * Los arrays de formato indeterminado (mixto) no producen stickers
 * (la Capa 5 los deriva al extractor de objeto, que ignora arrays).
 *
 * @param {*} attr - Objeto attr del nodo en el .mup (puede ser null/undefined)
 * @returns {number} Número de stickers declarados en el nodo
 */
function contarStickersDeAttr(attr) {
  if (!attr || typeof attr !== 'object') {
    return 0;
  }

  let total = 0;

  // 1. attr.stickers en cualquiera de sus formatos
  if (Object.prototype.hasOwnProperty.call(attr, 'stickers')) {
    const stickers = attr.stickers;

    if (Array.isArray(stickers)) {
      const esFormatoObjetos =
        stickers.length > 0 &&
        typeof stickers[0] === 'object' &&
        stickers[0] !== null &&
        'code' in stickers[0];
      const esFormatoCadenas =
        stickers.length === 0 || stickers.every((s) => typeof s === 'string');

      if (esFormatoObjetos) {
        // Formato 1: [{code: "🚀", category?: "symbol"}]
        for (const sticker of stickers) {
          if (sticker && typeof sticker === 'object' && codigoProduceDisplay(sticker.code)) {
            total++;
          }
        }
      } else if (esFormatoCadenas) {
        // Formato 3: ["emoji:1F4DD", ...] (MindMup v3 real) o array vacío
        for (const codigo of stickers) {
          if (codigoProduceDisplay(codigo)) {
            total++;
          }
        }
      }
      // Array mixto/indeterminado: la Capa 5 no produce stickers
    } else if (stickers && typeof stickers === 'object') {
      // Formato 2: {"🚀": true, "❤️": true} (objeto con claves emoji)
      for (const codigo of Object.keys(stickers)) {
        if (codigoProduceDisplay(codigo)) {
          total++;
        }
      }
    }
  }

  // 2. attr.styles?.stickers como array de cadenas
  if (
    attr.styles &&
    typeof attr.styles === 'object' &&
    Object.prototype.hasOwnProperty.call(attr.styles, 'stickers') &&
    Array.isArray(attr.styles.stickers)
  ) {
    for (const codigo of attr.styles.stickers) {
      if (codigoProduceDisplay(codigo)) {
        total++;
      }
    }
  }

  return total;
}

/**
 * Cuenta las notas que la Capa 3 extraería del mapa.
 *
 * Replica el flujo de extractNotes: solo nodos con campo `id` definido
 * (indexables por original_id), con attr.note objeto, y con
 * text = String(attr.note.text) no vacío.
 *
 * @param {Array<{clave: string, nodo: Object}>} nodosDelMapa - Nodos del mapa en orden DFS
 * @returns {number} Número de notas declaradas en el mapa
 */
function contarNotasDelMapa(nodosDelMapa) {
  let total = 0;

  for (const { nodo } of nodosDelMapa) {
    // Sin id definido no se indexa en la Capa 3 → no genera nota
    if (nodo.id === undefined) {
      continue;
    }

    const attr = nodo.attr;
    if (!attr || typeof attr !== 'object') {
      continue;
    }

    const nota = attr.note;
    if (!nota || typeof nota !== 'object') {
      continue;
    }

    const texto = nota.text !== undefined ? String(nota.text) : '';
    if (texto.length > 0) {
      total++;
    }
  }

  return total;
}

/**
 * Cuenta los enlaces del mapa que la Capa 7 (10b) procesaría.
 *
 * Replica el filtro defensivo de resolveLinks: solo entradas del array
 * rawJson.links que sean objetos válidos.
 *
 * @param {Object} rawJson - JSON del .mup ya parseado
 * @returns {number} Número de enlaces declarados en el mapa
 */
function contarEnlacesDelMapa(rawJson) {
  if (!rawJson.links || !Array.isArray(rawJson.links)) {
    return 0;
  }

  let total = 0;
  for (const enlace of rawJson.links) {
    if (enlace && typeof enlace === 'object') {
      total++;
    }
  }
  return total;
}

/**
 * Cuenta los iconos que la Capa 7 (10c) extraería del mapa.
 *
 * Replica el criterio de traverseAndExtractIcons: attr.icon presente,
 * type explícito 'image' (o type ausente/vacío), y url/data presente.
 *
 * @param {Array<{clave: string, nodo: Object}>} nodosDelMapa - Nodos del mapa en orden DFS
 * @returns {number} Número de iconos declarados en el mapa
 */
function contarIconosDelMapa(nodosDelMapa) {
  let total = 0;

  for (const { nodo } of nodosDelMapa) {
    const icon = nodo.attr && nodo.attr.icon;
    if (!icon) {
      continue;
    }

    const url = icon.url || icon.data || '';

    // type vacío ('') se considera ausente (formato real MindMup v3)
    const tieneTypeExplicito =
      icon.type !== undefined && icon.type !== null && icon.type !== '';
    const esIconoImagen = tieneTypeExplicito ? icon.type === 'image' : true;

    if (esIconoImagen && url.length > 0) {
      total++;
    }
  }

  return total;
}

// ============================================================================
// Comprobación 6 — verificación nodo a nodo del criterio de la Capa 4
// ============================================================================

/**
 * Verifica el criterio de la Capa 4 recorriendo el mapa en DFS pre-order
 * y comparando nodo a nodo con attributes[i]:
 *   - attributes.length === nodes.length (un registro por nodo)
 *   - nodo sin attr o attr null → raw_attributes === null
 *   - attr vacío {} → raw_attributes es objeto vacío {}
 *   - attr con contenido → raw_attributes con EXACTAMENTE las mismas
 *     claves y los mismos valores que el attr original (pérdida cero)
 *   - el node_id de cada registro Attribute corresponde al node_id del
 *     nodo aplanado en la misma posición (alineación nodo ≅ atributo)
 *
 * @param {Object} json - JSON-CMNJ completo
 * @param {Array<{clave: string, nodo: Object}>} nodosDelMapa - Nodos del mapa en orden DFS
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarCriterioCapa4(json, nodosDelMapa) {
  const atributos = Array.isArray(json.attributes) ? json.attributes : null;
  const nodos = Array.isArray(json.nodes) ? json.nodes : [];

  if (atributos === null) {
    return { ok: false, detalle: `colección attributes ausente o no es un array (recibido: ${formatearValor(json.attributes)})` };
  }

  if (atributos.length !== nodos.length) {
    return {
      ok: false,
      detalle: `attributes.length=${atributos.length} ≠ nodes.length=${nodos.length} (la Capa 4 debe crear UN registro por nodo)`,
    };
  }

  if (nodos.length !== nodosDelMapa.length) {
    return {
      ok: false,
      detalle: `nodes.length=${nodos.length} ≠ nodos del mapa=${nodosDelMapa.length}; no se puede alinear nodo a nodo`,
    };
  }

  const discrepancias = [];
  let sinAttr = 0;
  let attrVacio = 0;
  let attrConContenido = 0;

  for (let i = 0; i < nodosDelMapa.length; i++) {
    const nodo = nodosDelMapa[i].nodo;
    // Mismo criterio que buildAttribute: attr undefined → null
    const attr = nodo.attr !== undefined ? nodo.attr : null;
    const registro = atributos[i];

    if (!registro || typeof registro !== 'object') {
      discrepancias.push(`índice ${i} (sort_key "${nodosDelMapa[i].clave}"): registro Attribute ausente`);
      continue;
    }

    // Alineación: el registro debe pertenecer al nodo de la misma posición
    if (registro.node_id !== nodos[i].node_id) {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): node_id=${formatearValor(registro.node_id)} ` +
          `no corresponde al nodo ${formatearValor(nodos[i].node_id)}`
      );
    }

    const raw = registro.raw_attributes;

    if (attr === null || attr === undefined) {
      sinAttr++;
      if (raw !== null) {
        discrepancias.push(
          `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): nodo sin attr, raw_attributes esperado null, recibido ${formatearValor(raw)}`
        );
      }
    } else if (typeof attr === 'object') {
      if (Object.keys(attr).length === 0) {
        attrVacio++;
        const esObjetoVacio =
          raw !== null && typeof raw === 'object' && Object.keys(raw).length === 0;
        if (!esObjetoVacio) {
          discrepancias.push(
            `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): attr vacío {}, raw_attributes esperado {}, recibido ${formatearValor(raw)}`
          );
        }
      } else {
        attrConContenido++;
        if (raw === null || typeof raw !== 'object') {
          discrepancias.push(
            `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): attr con contenido, raw_attributes esperado objeto, recibido ${formatearValor(raw)}`
          );
        } else {
          const clavesAttr = Object.keys(attr).sort();
          const clavesRaw = Object.keys(raw).sort();

          // Pérdida cero: TODAS las claves, no una muestra
          if (JSON.stringify(clavesAttr) !== JSON.stringify(clavesRaw)) {
            discrepancias.push(
              `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): claves de raw_attributes [${clavesRaw.join(', ')}] ≠ claves del attr original [${clavesAttr.join(', ')}]`
            );
          } else if (JSON.stringify(attr) !== JSON.stringify(raw)) {
            discrepancias.push(
              `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): valores de raw_attributes no coinciden con el attr original (posible pérdida de contenido)`
            );
          }
        }
      }
    } else {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): attr con tipo inesperado ${typeof attr}`
      );
    }
  }

  const resumen = `attributes.length=${atributos.length} = nodes.length; raw_attributes verificadas nodo a nodo (sin attr→null: ${sinAttr}, vacías {}: ${attrVacio}, con contenido: ${attrConContenido})`;

  if (discrepancias.length === 0) {
    return { ok: true, detalle: `${resumen}; 0 discrepancias` };
  }

  return {
    ok: false,
    detalle: `${resumen}; ${discrepancias.length} discrepancia(s); primera: ${discrepancias[0]}`,
  };
}

// ============================================================================
// Comprobaciones 7 y 8 — referencias cruzadas y unicidad de UUIDs
// ============================================================================

/**
 * Verifica que todos los node_id de las colecciones secundarias existan
 * en la colección nodes. Los extremos de enlace nulos se omiten aquí:
 * su detección es responsabilidad de la comprobación 4.
 *
 * @param {Object} json - JSON-CMNJ completo
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarReferenciasCruzadas(json) {
  const nodos = Array.isArray(json.nodes) ? json.nodes : [];
  const nodeIds = new Set();
  for (const nodo of nodos) {
    if (nodo && nodo.node_id !== undefined) {
      nodeIds.add(nodo.node_id);
    }
  }

  const coleccionesConNodeId = [
    { nombre: 'notes', campoId: 'note_id', items: json.notes },
    { nombre: 'attributes', campoId: 'attr_id', items: json.attributes },
    { nombre: 'stickers', campoId: 'sticker_id', items: json.stickers },
    { nombre: 'icons', campoId: 'icon_id', items: json.icons },
    { nombre: 'externalRefs', campoId: 'ref_id', items: json.externalRefs },
  ];

  const huerfanas = [];

  for (const { nombre, campoId, items } of coleccionesConNodeId) {
    if (!Array.isArray(items)) {
      huerfanas.push(`colección ${nombre} ausente o no es un array (no verificable)`);
      continue;
    }

    for (const item of items) {
      if (item && !nodeIds.has(item.node_id)) {
        huerfanas.push(`${nombre}.${formatearValor(item[campoId])} → node_id=${formatearValor(item.node_id)} no existe en nodes`);
      }
    }
  }

  if (Array.isArray(json.links)) {
    for (const enlace of json.links) {
      if (!enlace) {
        continue;
      }
      if (enlace.from_node_id != null && !nodeIds.has(enlace.from_node_id)) {
        huerfanas.push(`links.${formatearValor(enlace.link_id)} → from_node_id=${formatearValor(enlace.from_node_id)} no existe en nodes`);
      }
      if (enlace.to_node_id != null && !nodeIds.has(enlace.to_node_id)) {
        huerfanas.push(`links.${formatearValor(enlace.link_id)} → to_node_id=${formatearValor(enlace.to_node_id)} no existe en nodes`);
      }
    }
  }

  if (huerfanas.length === 0) {
    return { ok: true, detalle: `0 referencias huérfanas (${nodeIds.size} node_id canónicos en nodes)` };
  }

  return {
    ok: false,
    detalle: `${huerfanas.length} referencia(s) huérfana(s); primera: ${huerfanas[0]}`,
  };
}

/**
 * Verifica que no haya UUIDs duplicados dentro de cada colección.
 *
 * @param {Object} json - JSON-CMNJ completo
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarUnicidadUuids(json) {
  const colecciones = [
    { nombre: 'nodes', campo: 'node_id', items: json.nodes },
    { nombre: 'notes', campo: 'note_id', items: json.notes },
    { nombre: 'attributes', campo: 'attr_id', items: json.attributes },
    { nombre: 'stickers', campo: 'sticker_id', items: json.stickers },
    { nombre: 'icons', campo: 'icon_id', items: json.icons },
    { nombre: 'links', campo: 'link_id', items: json.links },
    { nombre: 'externalRefs', campo: 'ref_id', items: json.externalRefs },
  ];

  const duplicados = [];

  for (const { nombre, campo, items } of colecciones) {
    if (!Array.isArray(items)) {
      continue;
    }

    const vistos = new Set();
    const registrados = new Set();

    for (const item of items) {
      if (!item) {
        continue;
      }
      const id = item[campo];
      if (id === undefined || id === null) {
        continue;
      }
      if (vistos.has(id)) {
        if (!registrados.has(id)) {
          registrados.add(id);
          duplicados.push(`${nombre}.${campo}=${formatearValor(id)}`);
        }
      } else {
        vistos.add(id);
      }
    }
  }

  if (duplicados.length === 0) {
    return { ok: true, detalle: '0 UUIDs duplicados en las 7 colecciones auditadas' };
  }

  return {
    ok: false,
    detalle: `${duplicados.length} UUID(s) duplicado(s); primero: ${duplicados[0]}`,
  };
}

// ============================================================================
// Comprobaciones A, B, C y D — tema del mapa, adjuntos, estilos de enlace
// y detalles de iconos
// ============================================================================

/**
 * Longitud real del payload base64 de una data URI de adjunto.
 *
 * Réplica exacta de base64PayloadLength de la Capa 4 real
 * (src/converter/layers/layer4-attributes.js): descarta el prefijo
 * de la data URI hasta la primera coma y decodifica el payload con atob;
 * la longitud de la cadena binaria resultante es el tamaño del adjunto
 * en bytes. Si el payload no decodifica, devuelve como respaldo la
 * longitud del payload; si content no es una cadena, devuelve 0.
 *
 * @param {*} content - Data URI del adjunto (p.ej. "data:text/plain;base64,77u/...")
 * @returns {number} Tamaño del adjunto en bytes
 */
function base64PayloadLength(content) {
  if (typeof content !== 'string') return 0;
  const commaIndex = content.indexOf(',');
  const payload = commaIndex === -1 ? content : content.slice(commaIndex + 1);

  try {
    // atob decodifica base64 a una cadena binaria; su longitud es el
    // número de bytes reales del archivo adjunto
    return atob(payload).length;
  } catch {
    // Payload no decodificable: respaldo con la longitud del payload
    return payload.length;
  }
}

/**
 * Verifica la conservación del tema del mapa en metadata (capa 1).
 *
 * Replica el criterio de parseMup (layer1-parse.js): si el attr de la
 * raíz del .mup declara theme o themeOverrides (valor != null), la capa 1
 * los copia a metadata con los mismos valores; si no los declara, no
 * deben aparecer en metadata (principio de agnosticismo: campo opcional
 * ausente no es error). La comparación es exacta (deep equal vía
 * JSON.stringify, mismo criterio que la comprobación 6).
 *
 * @param {Object} mapa - JSON del .mup ya parseado
 * @param {Object} json - JSON-CMNJ completo
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarTemaDelMapa(mapa, json) {
  const metadata = json.metadata && typeof json.metadata === 'object' ? json.metadata : null;

  if (metadata === null) {
    return {
      ok: false,
      detalle: 'metadata ausente o no es un objeto; no se puede verificar theme/themeOverrides',
    };
  }

  const attrRaiz = mapa.attr && typeof mapa.attr === 'object' ? mapa.attr : null;
  const discrepancias = [];
  const declarados = [];

  // theme: si el attr raíz lo declara debe viajar a metadata con el
  // mismo valor; si no, no debe aparecer
  if (attrRaiz && attrRaiz.theme != null) {
    declarados.push(`theme=${formatearValor(attrRaiz.theme)}`);
    if (JSON.stringify(metadata.theme) !== JSON.stringify(attrRaiz.theme)) {
      discrepancias.push(
        `theme: esperado ${formatearValor(attrRaiz.theme)}, recibido ${formatearValor(metadata.theme)}`
      );
    }
  } else if (metadata.theme !== undefined) {
    discrepancias.push(
      `theme no declarado en el attr raíz pero presente en metadata: ${formatearValor(metadata.theme)}`
    );
  }

  // themeOverrides: idéntico criterio
  if (attrRaiz && attrRaiz.themeOverrides != null) {
    declarados.push(`themeOverrides=${formatearValor(attrRaiz.themeOverrides)}`);
    if (JSON.stringify(metadata.themeOverrides) !== JSON.stringify(attrRaiz.themeOverrides)) {
      discrepancias.push(
        `themeOverrides: esperado ${formatearValor(attrRaiz.themeOverrides)}, recibido ${formatearValor(metadata.themeOverrides)}`
      );
    }
  } else if (metadata.themeOverrides !== undefined) {
    discrepancias.push(
      `themeOverrides no declarado en el attr raíz pero presente en metadata: ${formatearValor(metadata.themeOverrides)}`
    );
  }

  if (discrepancias.length === 0) {
    return {
      ok: true,
      detalle:
        declarados.length === 0
          ? 'theme/themeOverrides no declarados en el attr raíz; ausentes de metadata (coherente, 0 discrepancias)'
          : `${declarados.join(', ')} conservados en metadata con los mismos valores; 0 discrepancias`,
    };
  }

  return {
    ok: false,
    detalle: `${discrepancias.length} discrepancia(s) en el tema del mapa; primera: ${discrepancias[0]}`,
  };
}

/**
 * Verifica el tipado de adjuntos de la Capa 4.
 *
 * Por cada nodo del mapa con attr.attachment objeto, el registro
 * Attribute alineado (misma posición DFS pre-order que la comprobación 6)
 * debe tener:
 *   - value.attachment con SOLO los metadatos presentes: name (si el
 *     original lo declara != null), contentType (ídem) y size (longitud
 *     REAL del payload base64 decodificado vía base64PayloadLength).
 *   - raw_attributes.attachment con TODAS las claves del original
 *     (name, contentType, dataUriEncoded, content, ...) y los mismos
 *     valores: pérdida cero, content completo sin truncar.
 * Si el mapa no declara adjuntos, la comprobación pasa con «0 adjuntos».
 *
 * @param {Object} json - JSON-CMNJ completo
 * @param {Array<{clave: string, nodo: Object}>} nodosDelMapa - Nodos del mapa en orden DFS
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarAdjuntos(json, nodosDelMapa) {
  const atributos = Array.isArray(json.attributes) ? json.attributes : null;

  if (atributos === null) {
    return {
      ok: false,
      detalle: 'colección attributes ausente o no es un array; no se puede verificar adjuntos',
    };
  }

  let adjuntosEnMapa = 0;
  let tipadosCorrectos = 0;
  let integrosCorrectos = 0;
  const discrepancias = [];

  for (let i = 0; i < nodosDelMapa.length; i++) {
    const nodo = nodosDelMapa[i].nodo;
    const attr = nodo.attr !== undefined ? nodo.attr : null;

    // Mismo filtro que la Capa 4: solo attr.attachment objeto tipa adjunto
    if (!attr || typeof attr !== 'object' || !attr.attachment || typeof attr.attachment !== 'object') {
      continue;
    }

    const adjuntoOriginal = attr.attachment;
    adjuntosEnMapa++;

    const registro = atributos[i];
    if (!registro || typeof registro !== 'object') {
      discrepancias.push(`índice ${i} (sort_key "${nodosDelMapa[i].clave}"): registro Attribute ausente`);
      continue;
    }

    // --- value.attachment: metadatos tipados (solo los presentes) ---
    const esperadoTipado = {};
    if (adjuntoOriginal.name != null) {
      esperadoTipado.name = adjuntoOriginal.name;
    }
    if (adjuntoOriginal.contentType != null) {
      esperadoTipado.contentType = adjuntoOriginal.contentType;
    }
    if (adjuntoOriginal.content != null) {
      esperadoTipado.size = base64PayloadLength(adjuntoOriginal.content);
    }

    const valorAdjunto =
      registro.value && typeof registro.value === 'object' ? registro.value.attachment : undefined;
    // Si el adjunto no aporta ninguno de name/contentType/content, la Capa 4
    // no emite value.attachment (objeto vacío → campo omitido en el JSON)
    const esperadoAusente = Object.keys(esperadoTipado).length === 0;
    const tipadoOk = esperadoAusente
      ? valorAdjunto === undefined
      : JSON.stringify(valorAdjunto) === JSON.stringify(esperadoTipado);

    if (tipadoOk) {
      tipadosCorrectos++;
    } else {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): value.attachment=${formatearValor(valorAdjunto)} ` +
          `≠ esperado ${formatearValor(esperadoTipado)}`
      );
    }

    // --- raw_attributes.attachment: pérdida cero (todas las claves, content completo) ---
    const raw = registro.raw_attributes;
    const rawAdjunto = raw && typeof raw === 'object' ? raw.attachment : undefined;
    const integroOk = JSON.stringify(rawAdjunto) === JSON.stringify(adjuntoOriginal);

    if (integroOk) {
      integrosCorrectos++;
    } else {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): raw_attributes.attachment=${formatearValor(rawAdjunto)} ` +
          `≠ adjunto original (posible truncado del content o pérdida de claves)`
      );
    }
  }

  if (adjuntosEnMapa === 0) {
    return { ok: true, detalle: '0 adjuntos declarados en el mapa (nada que verificar)' };
  }

  if (discrepancias.length === 0) {
    return {
      ok: true,
      detalle:
        `${adjuntosEnMapa} adjunto(s) en el mapa: ${tipadosCorrectos} tipados correctamente ` +
        `(name/contentType/size real) y ${integrosCorrectos} íntegros en raw_attributes.attachment; 0 discrepancias`,
    };
  }

  return {
    ok: false,
    detalle:
      `${adjuntosEnMapa} adjunto(s) en el mapa: ${tipadosCorrectos} tipados, ` +
      `${integrosCorrectos} íntegros en raw_attributes; ${discrepancias.length} discrepancia(s); ` +
      `primera: ${discrepancias[0]}`,
  };
}

/**
 * Verifica la conservación de los estilos de enlace (capa 7, subcapa 10b).
 *
 * Replica resolveLinks (layer7-assemble-links.js): por cada enlace válido
 * del mapa, en el MISMO orden de aparición que links[i] del JSON, se
 * comparan campo a campo los estilos derivados de attr.style:
 *   - color      (de style.color)      → link.color,      conversión String()
 *   - line_style (de style.lineStyle)  → link.line_style, conversión String()
 *   - arrow      (de style.arrow)      → link.arrow,      conversión String()
 *   - width      (de style.width)      → link.width,      conversión Number()
 * Los campos ausentes en attr.style no deben aparecer en el registro del
 * JSON. La alineación posición i del mapa == links[i] del JSON se
 * robustece resolviendo ideaIdFrom/ideaIdTo (o from/to) a node_id con el
 * mismo índice original_id → node_id que construye la Capa 7.
 *
 * @param {Object} mapa - JSON del .mup ya parseado
 * @param {Object} json - JSON-CMNJ completo
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarEstilosEnlaces(mapa, json) {
  // Enlaces válidos del mapa en orden de aparición (mismo filtro defensivo
  // de resolveLinks: solo entradas objeto) — cada uno genera UN registro
  // en links[] del JSON, así que la posición i se alinea 1:1
  const enlacesDelMapa = Array.isArray(mapa.links)
    ? mapa.links.filter((enlace) => enlace && typeof enlace === 'object')
    : [];
  const enlacesJson = Array.isArray(json.links) ? json.links : null;

  if (enlacesJson === null) {
    return { ok: false, detalle: 'colección links ausente o no es un array; no se puede verificar estilos' };
  }

  if (enlacesJson.length !== enlacesDelMapa.length) {
    return {
      ok: false,
      detalle: `links.length=${enlacesJson.length} ≠ enlaces válidos del mapa=${enlacesDelMapa.length}; no se puede alinear posición a posición`,
    };
  }

  // Índice original_id → node_id (mismo que construye la Capa 7 sobre los
  // nodos aplanados; aquí se reutiliza la colección nodes del JSON)
  const originalIdToNodeId = new Map();
  for (const nodo of Array.isArray(json.nodes) ? json.nodes : []) {
    if (nodo && nodo.original_id && nodo.original_id.length > 0) {
      originalIdToNodeId.set(nodo.original_id, nodo.node_id);
    }
  }

  const CAMPOS_ESTILO = ['color', 'line_style', 'arrow', 'width'];
  const discrepancias = [];
  let conEstilo = 0;
  let conservados = 0;

  for (let i = 0; i < enlacesDelMapa.length; i++) {
    const enlaceMapa = enlacesDelMapa[i];
    const enlaceJson = enlacesJson[i];

    if (!enlaceJson || typeof enlaceJson !== 'object') {
      discrepancias.push(`índice ${i}: registro links ausente en el JSON`);
      continue;
    }

    // Robustez de alineación: ideaIdFrom/ideaIdTo (con respaldo from/to)
    // deben resolver a los mismos from_node_id/to_node_id del JSON
    const fromOriginalId = String(
      enlaceMapa.ideaIdFrom != null ? enlaceMapa.ideaIdFrom : enlaceMapa.from
    );
    const toOriginalId = String(enlaceMapa.ideaIdTo != null ? enlaceMapa.ideaIdTo : enlaceMapa.to);
    const fromEsperado = originalIdToNodeId.get(fromOriginalId) || null;
    const toEsperado = originalIdToNodeId.get(toOriginalId) || null;

    if (enlaceJson.from_node_id !== fromEsperado || enlaceJson.to_node_id !== toEsperado) {
      discrepancias.push(
        `índice ${i}: alineación por ideaIdFrom/ideaIdTo fallida — ` +
          `from esperado ${formatearValor(fromEsperado)}, recibido ${formatearValor(enlaceJson.from_node_id)}; ` +
          `to esperado ${formatearValor(toEsperado)}, recibido ${formatearValor(enlaceJson.to_node_id)}`
      );
      continue;
    }

    // Mismo acceso a estilo que resolveLinks: attr.style si attr es objeto
    const style =
      enlaceMapa.attr && typeof enlaceMapa.attr === 'object' && enlaceMapa.attr.style
        ? enlaceMapa.attr.style
        : {};

    if (style && typeof style === 'object' && Object.keys(style).length > 0) {
      conEstilo++;
    }

    // Campos esperados con la misma conversión que la Capa 7
    const esperados = [];
    if (style.color !== undefined) {
      esperados.push(['color', String(style.color)]);
    }
    if (style.lineStyle !== undefined) {
      esperados.push(['line_style', String(style.lineStyle)]);
    }
    if (style.arrow !== undefined) {
      esperados.push(['arrow', String(style.arrow)]);
    }
    if (style.width !== undefined) {
      esperados.push(['width', Number(style.width)]);
    }

    let okEnlace = true;

    // Campos declarados: deben coincidir con los valores del JSON
    for (const [campo, valorEsperado] of esperados) {
      if (enlaceJson[campo] !== valorEsperado) {
        discrepancias.push(
          `índice ${i}: ${campo} esperado ${formatearValor(valorEsperado)}, recibido ${formatearValor(enlaceJson[campo])}`
        );
        okEnlace = false;
      }
    }

    // Campos ausentes en attr.style: no deben aparecer en el JSON
    for (const campo of CAMPOS_ESTILO) {
      if (!esperados.some(([c]) => c === campo) && enlaceJson[campo] !== undefined) {
        discrepancias.push(
          `índice ${i}: ${campo} no declarado en attr.style pero presente en el JSON: ${formatearValor(enlaceJson[campo])}`
        );
        okEnlace = false;
      }
    }

    if (okEnlace) {
      conservados++;
    }
  }

  if (discrepancias.length === 0) {
    return {
      ok: true,
      detalle:
        `${conEstilo} enlace(s) con attr.style de ${enlacesDelMapa.length}; ` +
        `color/line_style/arrow/width conservados campo a campo; 0 discrepancias`,
    };
  }

  return {
    ok: false,
    detalle:
      `${discrepancias.length} discrepancia(s) en ${enlacesDelMapa.length} enlace(s) ` +
      `(${conEstilo} con attr.style, ${conservados} conservados); primera: ${discrepancias[0]}`,
  };
}

// ============================================================================
// Comprobación D — detalles de iconos de imagen (capa 7, subcapa 10c)
// ============================================================================

/**
 * Deduce el tipo MIME de la URL de un icono (data URI o URL convencional).
 *
 * Réplica de extractMimeType de la Capa 7 real
 * (src/converter/layers/layer7-assemble-extra.js): captura el tipo
 * de contenido tras "data:" hasta el primer ";" o "," (p.ej.
 * "data:image/png;base64,iVBOR..." → "image/png"); si la URL no es una
 * data URI, devuelve el fallback "application/octet-stream" (mismo
 * criterio de la Capa 7).
 *
 * @param {*} url - URL del icono
 * @returns {string} Tipo MIME deducido
 */
function extraerMimeTypeDeUrl(url) {
  if (typeof url !== 'string') return 'application/octet-stream';
  const match = url.match(/^data:([^;,]+)/);
  return match ? match[1] : 'application/octet-stream';
}

/**
 * Réplica de extractBase64Body de la Capa 7 (layer7-assemble-extra.js).
 *
 * Devuelve el payload base64 puro (texto tras ";base64," de la data URI),
 * sin decodificar. La Capa 7 define base64_length como la longitud de ESTE
 * texto (extractBase64Body(url).length) — criterio distinto del de la Capa 4
 * (adjuntos, size = bytes decodificados). No confundir ambos.
 *
 * @param {string} url - Data URI del icono
 * @returns {string} Texto base64 puro, vacío si no se puede extraer
 */
function extraerPayloadBase64(url) {
  if (typeof url !== 'string') return '';
  const match = url.match(/^data:[^,]*;base64,(.+)$/);
  return match ? match[1] : '';
}

/**
 * Verifica los detalles de los iconos de imagen (capa 7, subcapa 10c).
 *
 * La comprobación es general: los mapas llegan por argumento y no se
 * asume ningún contenido concreto.
 *
 * Por cada nodo del mapa con attr.icon que sea icono de imagen (mismo
 * criterio que extractIcons/traverseAndExtractIcons: url/data presente y
 * type 'image' explícito o type ausente/vacío), el registro icons[k]
 * alineado por posición DFS pre-order (el conteo icons.length ya lo cubre
 * la comprobación 1; aquí el foco es el detalle) debe tener:
 *   - node_id resuelto al nodo aplanado correcto (índice original_id →
 *     node_id, misma construcción que la Capa 7)
 *   - url íntegra (data URI o URL conservada)
 *   - mime_type deducido de la data URI (extraerMimeTypeDeUrl)
 *   - base64_length = longitud del TEXTO base64 tras ";base64," (réplica de
 *     extractBase64Body de la Capa 7; NO es la longitud de los bytes
 *     decodificados — ese es el criterio de la Capa 4 para adjuntos)
 *   - width/height/position = Number(icon.width)/Number(icon.height)/
 *     icon.position con los defaults 0/0/'' de la Capa 7
 *   - metaData conservado solo si el original lo declara objeto no vacío;
 *     si es {} vacío o ausente, el campo debe estar AUSENTE (principio de
 *     solo campos presentes)
 * Si el mapa no declara iconos de imagen, la comprobación pasa con
 * «0 iconos de imagen (nada que verificar)».
 *
 * @param {Object} json - JSON-CMNJ completo
 * @param {Array<{clave: string, nodo: Object}>} nodosDelMapa - Nodos del mapa en orden DFS
 * @returns {{ok: boolean, detalle: string}} Resultado de la verificación
 */
function verificarDetallesIconos(json, nodosDelMapa) {
  const iconos = Array.isArray(json.icons) ? json.icons : null;

  if (iconos === null) {
    return {
      ok: false,
      detalle: 'colección icons ausente o no es un array; no se puede verificar detalles de iconos',
    };
  }

  const iconosEnMapa = contarIconosDelMapa(nodosDelMapa);

  if (iconosEnMapa === 0) {
    return { ok: true, detalle: '0 iconos de imagen (nada que verificar)' };
  }

  if (iconos.length !== iconosEnMapa) {
    return {
      ok: false,
      detalle: `icons.length=${iconos.length} ≠ iconos de imagen del mapa=${iconosEnMapa}; no se puede alinear posición a posición (el conteo lo cubre la comprobación 1)`,
    };
  }

  // Índice original_id → node_id (misma construcción que la Capa 7 sobre
  // los nodos aplanados; aquí se reutiliza la colección nodes del JSON)
  const originalIdToNodeId = new Map();
  for (const nodo of Array.isArray(json.nodes) ? json.nodes : []) {
    if (nodo && nodo.original_id && nodo.original_id.length > 0) {
      originalIdToNodeId.set(nodo.original_id, nodo.node_id);
    }
  }

  const discrepancias = [];
  let nodeIdCorrectos = 0;
  let urlsCorrectas = 0;
  let mimeCorrectos = 0;
  let base64Correctos = 0;
  let geometriaCorrectos = 0;
  let metaDataCorrectos = 0;
  let posicionIcono = 0;

  for (let i = 0; i < nodosDelMapa.length; i++) {
    const nodo = nodosDelMapa[i].nodo;
    const icon = nodo.attr && nodo.attr.icon;
    if (!icon) {
      continue;
    }

    // Mismo criterio que extractIcons (y que contarIconosDelMapa): url/data
    // presente y type 'image' explícito o type ausente/vacío ('')
    const url = icon.url || icon.data || '';
    const tieneTypeExplicito =
      icon.type !== undefined && icon.type !== null && icon.type !== '';
    const esIconoImagen = tieneTypeExplicito ? icon.type === 'image' : true;

    if (!esIconoImagen || url.length === 0) {
      continue;
    }

    // Alineación por posición: el k-ésimo icono de imagen del mapa en
    // orden DFS pre-order es icons[k] del JSON (mismo orden de la Capa 7)
    const registro = iconos[posicionIcono];
    posicionIcono++;

    if (!registro || typeof registro !== 'object') {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): registro icons ausente para el icono de imagen`
      );
      continue;
    }

    // --- node_id resuelto: mismo acceso que la Capa 7 (original_id → node_id) ---
    const originalId = nodo.id !== undefined ? String(nodo.id) : '';
    const nodeIdEsperado = originalId ? originalIdToNodeId.get(originalId) || null : null;

    if (registro.node_id !== nodeIdEsperado) {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): node_id=${formatearValor(registro.node_id)} ` +
          `≠ esperado ${formatearValor(nodeIdEsperado)} (debe resolver al nodo aplanado con ese attr.icon)`
      );
    } else {
      nodeIdCorrectos++;
    }

    // --- url íntegra (data URI o URL conservada) ---
    if (registro.url !== url) {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): url=${formatearValor(registro.url)} ≠ esperada ${formatearValor(url)}`
      );
    } else {
      urlsCorrectas++;
    }

    // --- mime_type deducido de la data URI (réplica de extractMimeType) ---
    const mimeEsperado = extraerMimeTypeDeUrl(url);
    if (registro.mime_type !== mimeEsperado) {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): mime_type=${formatearValor(registro.mime_type)} ` +
          `≠ esperado ${formatearValor(mimeEsperado)}`
      );
    } else {
      mimeCorrectos++;
    }

    // --- base64_length: longitud del payload base64 (texto, sin decodificar)
    // Réplica de la Capa 7 real (layer7-assemble-extra.js, extractIcons):
    //   base64_length: extractBase64Body(url).length  → longitud del texto
    //   tras ";base64,". NO es la longitud de los bytes decodificados (ese es
    //   el criterio de la Capa 4 para adjuntos, size — criterios distintos).
    // Criterio verificado contra la implementación de la Capa 7: la
    // comprobación D no debe usar base64PayloadLength (bytes decodificados).
    const base64Esperado = extraerPayloadBase64(url).length;
    if (registro.base64_length !== base64Esperado) {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): base64_length=${formatearValor(registro.base64_length)} ` +
          `≠ esperado ${formatearValor(base64Esperado)} (longitud del texto base64 tras ";base64,")`
      );
    } else {
      base64Correctos++;
    }

    // --- width/height/position: mismos defaults y conversiones de la Capa 7 ---
    const widthEsperado = icon.width !== undefined ? Number(icon.width) : 0;
    const heightEsperado = icon.height !== undefined ? Number(icon.height) : 0;
    const positionEsperada = icon.position || '';
    if (
      registro.width !== widthEsperado ||
      registro.height !== heightEsperado ||
      registro.position !== positionEsperada
    ) {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): geometría esperada ` +
          `width=${formatearValor(widthEsperado)}, height=${formatearValor(heightEsperado)}, ` +
          `position=${formatearValor(positionEsperada)}; recibido ` +
          `width=${formatearValor(registro.width)}, height=${formatearValor(registro.height)}, ` +
          `position=${formatearValor(registro.position)}`
      );
    } else {
      geometriaCorrectos++;
    }

    // --- metaData: solo si el original lo declara objeto no vacío; si es {}
    // vacío o ausente, el campo debe estar AUSENTE (principio de solo
    // campos presentes, mismo filtro de la Capa 7) ---
    const metaDataOriginal = icon.metaData;
    const metaDataEsperado =
      metaDataOriginal != null &&
      typeof metaDataOriginal === 'object' &&
      !Array.isArray(metaDataOriginal) &&
      Object.keys(metaDataOriginal).length > 0
        ? { ...metaDataOriginal }
        : undefined;

    const metaDataOk =
      metaDataEsperado === undefined
        ? registro.metaData === undefined
        : JSON.stringify(registro.metaData) === JSON.stringify(metaDataEsperado);

    if (metaDataOk) {
      metaDataCorrectos++;
    } else {
      discrepancias.push(
        `índice ${i} (sort_key "${nodosDelMapa[i].clave}"): metaData=${formatearValor(registro.metaData)} ` +
          `≠ esperado ${formatearValor(metaDataEsperado)} ({} vacío o ausente debe omitirse)`
      );
    }
  }

  if (discrepancias.length === 0) {
    return {
      ok: true,
      detalle:
        `${iconosEnMapa} icono(s) de imagen: ${nodeIdCorrectos} con node_id resuelto, ` +
        `${urlsCorrectas} con url íntegra, ${mimeCorrectos} con mime_type correcto, ` +
        `${base64Correctos} con base64_length real, ${geometriaCorrectos} con ` +
        `width/height/position conservados, ${metaDataCorrectos} con metaData correcto; ` +
        `0 discrepancias`,
    };
  }

  return {
    ok: false,
    detalle:
      `${iconosEnMapa} icono(s) de imagen: ${nodeIdCorrectos} con node_id resuelto, ` +
      `${urlsCorrectas} con url íntegra, ${mimeCorrectos} con mime_type correcto, ` +
      `${base64Correctos} con base64_length real, ${geometriaCorrectos} con ` +
      `width/height/position conservados, ${metaDataCorrectos} con metaData correcto; ` +
      `${discrepancias.length} discrepancia(s); primera: ${discrepancias[0]}`,
  };
}

// ============================================================================
// Punto de entrada
// ============================================================================

/**
 * Ejecuta la verificación completa: lee los dos archivos, aplica las 9
 * comprobaciones principales más las 4 adicionales (A: tema del mapa,
 * B: adjuntos, C: estilos de enlace, D: detalles de iconos) e imprime
 * el resumen final.
 *
 * @returns {void} Termina con process.exit(0) si todo pasa o process.exit(1) si algo falla
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length !== 2) {
    console.error('Uso: node scripts/verify-cmjn-json.js <mapa.mup> <json-cmnj.json>');
    process.exit(1);
  }

  const [rutaMapa, rutaJson] = args;

  const mapa = leerJson(rutaMapa, 'mapa original (.mup)');
  const json = leerJson(rutaJson, 'JSON-CMNJ');

  // Ambos archivos deben ser objetos JSON (un .mup y un JSON-CMNJ válidos
  // nunca son null, arrays o primitivos)
  if (!mapa || typeof mapa !== 'object' || Array.isArray(mapa)) {
    console.error(`[ERROR] El mapa original "${rutaMapa}" no contiene un objeto JSON válido.`);
    process.exit(1);
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    console.error(`[ERROR] El JSON-CMNJ "${rutaJson}" no contiene un objeto JSON válido.`);
    process.exit(1);
  }

  console.log('Verificación en profundidad del JSON-CMNJ');
  console.log(`  Mapa original : ${basename(rutaMapa)}`);
  console.log(`  JSON-CMNJ     : ${basename(rutaJson)}`);

  // Nodos del mapa en el orden exacto de aplanado (DFS pre-order,
  // mismo filtro que las Capas 2 y 4)
  const nodosDelMapa = obtenerNodosDelMapaEnOrden(mapa);

  // --------------------------------------------------------------------------
  // Comprobación 1: Conteos coincidentes con la fuente
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 1: Conteos coincidentes con la fuente ──');

  // 1.1 Nodos: metadata.node_count === nodes.length === entradas de ideas{}
  const nodeCountMeta = json.metadata && json.metadata.node_count;
  const nodesLength = Array.isArray(json.nodes) ? json.nodes.length : null;

  check(
    'Nodos: conteo coincide con la fuente',
    nodeCountMeta === nodosDelMapa.length && nodesLength === nodosDelMapa.length,
    `recibido: metadata.node_count=${formatearValor(nodeCountMeta)}, nodes.length=${formatearValor(nodesLength)}, entradas de ideas{} del mapa=${nodosDelMapa.length}`
  );

  // 1.2 Pegatinas: stickers.length === suma de stickers declarados en el mapa
  let stickersEnMapa = 0;
  for (const { nodo } of nodosDelMapa) {
    stickersEnMapa += contarStickersDeAttr(nodo.attr);
  }
  const stickersLength = Array.isArray(json.stickers) ? json.stickers.length : null;

  check(
    'Pegatinas: conteo coincide con la fuente',
    stickersLength === stickersEnMapa,
    `recibido: stickers.length=${formatearValor(stickersLength)}, stickers declarados en el mapa (attr.stickers + attr.styles.stickers)=${stickersEnMapa}`
  );

  // 1.3 Notas: notes.length === nodos con attr.note.text no vacío
  const notasEnMapa = contarNotasDelMapa(nodosDelMapa);
  const notesLength = Array.isArray(json.notes) ? json.notes.length : null;

  check(
    'Notas: conteo coincide con la fuente',
    notesLength === notasEnMapa,
    `recibido: notes.length=${formatearValor(notesLength)}, nodos del mapa con attr.note.text no vacío=${notasEnMapa}`
  );

  // 1.4 Enlaces: links.length === número de enlaces del mapa
  const enlacesEnMapa = contarEnlacesDelMapa(mapa);
  const linksLength = Array.isArray(json.links) ? json.links.length : null;

  check(
    'Enlaces: conteo coincide con la fuente',
    linksLength === enlacesEnMapa,
    `recibido: links.length=${formatearValor(linksLength)}, enlaces declarados en el mapa (rawJson.links)=${enlacesEnMapa}`
  );

  // 1.5 Iconos: icons.length === nodos con attr.icon con url presente
  const iconosEnMapa = contarIconosDelMapa(nodosDelMapa);
  const iconsLength = Array.isArray(json.icons) ? json.icons.length : null;

  check(
    'Iconos: conteo coincide con la fuente',
    iconsLength === iconosEnMapa,
    `recibido: icons.length=${formatearValor(iconsLength)}, nodos del mapa con attr.icon con url presente=${iconosEnMapa}`
  );

  // --------------------------------------------------------------------------
  // Comprobación 2: Títulos íntegros (0 discrepancias)
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 2: Títulos íntegros ──');

  const discrepanciasTitulos = [];
  for (let i = 0; i < nodosDelMapa.length; i++) {
    const tituloJson = json.nodes && json.nodes[i] ? json.nodes[i].title : undefined;
    const tituloMapa = nodosDelMapa[i].nodo.title;
    // Títulos vacíos o ausentes (undefined) deben coincidir: '' === ''
    if ((tituloJson ?? '') !== (tituloMapa ?? '')) {
      discrepanciasTitulos.push({
        indice: i,
        clave: nodosDelMapa[i].clave,
        tituloJson,
        tituloMapa,
      });
    }
  }

  check(
    'Títulos: 0 discrepancias con el mapa en orden DFS pre-order',
    discrepanciasTitulos.length === 0,
    discrepanciasTitulos.length === 0
      ? `0 discrepancias en ${nodosDelMapa.length} nodos (títulos vacíos/ausentes coinciden)`
      : `recibido: ${discrepanciasTitulos.length} discrepancia(s); primera en índice ${discrepanciasTitulos[0].indice} ` +
        `(sort_key "${discrepanciasTitulos[0].clave}"): título JSON=${formatearValor(discrepanciasTitulos[0].tituloJson)} ` +
        `vs título mapa=${formatearValor(discrepanciasTitulos[0].tituloMapa)}`
  );

  // --------------------------------------------------------------------------
  // Comprobación 3: Orden de nodos preservado (sort_key === claves ideas{})
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 3: Orden de nodos preservado ──');

  const discrepanciasOrden = [];
  for (let i = 0; i < nodosDelMapa.length; i++) {
    const sortKey = json.nodes && json.nodes[i] ? json.nodes[i].sort_key : undefined;
    const claveMapa = nodosDelMapa[i].clave;
    if (sortKey !== claveMapa) {
      discrepanciasOrden.push({ indice: i, sortKey, claveMapa });
    }
  }

  check(
    'Orden: sort_key de nodes[] idéntico a las claves de ideas{} en DFS pre-order',
    discrepanciasOrden.length === 0,
    discrepanciasOrden.length === 0
      ? `0 discrepancias: ${nodosDelMapa.length} sort_key coinciden con el orden del mapa`
      : `recibido: ${discrepanciasOrden.length} discrepancia(s); primera en índice ${discrepanciasOrden[0].indice}: ` +
        `sort_key=${formatearValor(discrepanciasOrden[0].sortKey)} vs clave ideas{}=${formatearValor(discrepanciasOrden[0].claveMapa)}`
  );

  // --------------------------------------------------------------------------
  // Comprobación 4: Enlaces resueltos
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 4: Enlaces resueltos ──');

  const enlacesConProblema = Array.isArray(json.links)
    ? json.links.filter(
        (enlace) =>
          enlace &&
          (enlace.resolution === RESOLUCION_NO_RESUELTO ||
            enlace.from_node_id == null ||
            enlace.to_node_id == null)
      )
    : [];

  check(
    `Enlaces: 0 con resolution="${RESOLUCION_NO_RESUELTO}" o con from_node_id/to_node_id nulos`,
    enlacesConProblema.length === 0,
    enlacesConProblema.length === 0
      ? `0 enlaces unresolved de ${Array.isArray(json.links) ? json.links.length : 0}`
      : `recibido: ${enlacesConProblema.length} enlace(s) con problema; primero: ` +
        `link_id=${formatearValor(enlacesConProblema[0].link_id)}, ` +
        `resolution=${formatearValor(enlacesConProblema[0].resolution)}, ` +
        `from_node_id=${formatearValor(enlacesConProblema[0].from_node_id)}, ` +
        `to_node_id=${formatearValor(enlacesConProblema[0].to_node_id)}`
  );

  // --------------------------------------------------------------------------
  // Comprobación 5: Pegatinas sin categoría "unknown"
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 5: Pegatinas sin categoría "unknown" ──');

  const stickersUnknown = Array.isArray(json.stickers)
    ? json.stickers.filter((sticker) => sticker && sticker.category === 'unknown')
    : [];

  check(
    'Pegatinas: 0 con category === "unknown"',
    stickersUnknown.length === 0,
    stickersUnknown.length === 0
      ? `0 pegatinas "unknown" de ${Array.isArray(json.stickers) ? json.stickers.length : 0}`
      : `recibido: ${stickersUnknown.length} pegatina(s) "unknown"; primera: ` +
        `sticker_id=${formatearValor(stickersUnknown[0].sticker_id)}, ` +
        `emoji_code=${formatearValor(stickersUnknown[0].emoji_code)}`
  );

  // --------------------------------------------------------------------------
  // Comprobación 6: Criterio correcto de la Capa 4
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 6: Criterio de la Capa 4 (un registro Attribute por nodo) ──');

  const capa4 = verificarCriterioCapa4(json, nodosDelMapa);
  check('Capa 4: attributes.length === nodes.length y raw_attributes fieles nodo a nodo', capa4.ok, capa4.detalle);

  // --------------------------------------------------------------------------
  // Comprobación 7: Referencias cruzadas
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 7: Referencias cruzadas ──');

  const referencias = verificarReferenciasCruzadas(json);
  check('Referencias cruzadas: todos los node_id de colecciones secundarias existen en nodes', referencias.ok, referencias.detalle);

  // --------------------------------------------------------------------------
  // Comprobación 8: Unicidad de UUIDs por colección
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 8: Unicidad de UUIDs por colección ──');

  const unicidad = verificarUnicidadUuids(json);
  check('Unicidad de UUIDs: 0 duplicados en las 7 colecciones auditadas', unicidad.ok, unicidad.detalle);

  // --------------------------------------------------------------------------
  // Comprobación 9: 10 colecciones presentes y metadatos completos
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación 9: Colecciones y metadatos ──');

  // 9.1 Las 10 colecciones presentes y tipadas correctamente
  const coleccionesAusentes = COLECCIONES_CMNJ.filter(
    (nombre) => !(nombre in json) || json[nombre] === undefined || json[nombre] === null
  );
  const tiposIncorrectos = [];
  for (const nombre of COLECCIONES_CMNJ) {
    if (nombre === 'metadata') {
      if (nombre in json && json[nombre] !== null && json[nombre] !== undefined) {
        const esObjeto = typeof json[nombre] === 'object' && !Array.isArray(json[nombre]);
        if (!esObjeto) {
          tiposIncorrectos.push(`metadata no es un objeto (recibido: ${typeof json[nombre]})`);
        }
      }
    } else if (nombre in json && json[nombre] !== null && json[nombre] !== undefined) {
      if (!Array.isArray(json[nombre])) {
        tiposIncorrectos.push(`${nombre} no es un array (recibido: ${typeof json[nombre]})`);
      }
    }
  }

  check(
    'Colecciones: las 10 colecciones del JSON-CMNJ presentes y tipadas',
    coleccionesAusentes.length === 0 && tiposIncorrectos.length === 0,
    coleccionesAusentes.length === 0 && tiposIncorrectos.length === 0
      ? `10/10 colecciones presentes: ${COLECCIONES_CMNJ.join(', ')}`
      : `recibido: ausentes=[${coleccionesAusentes.join(', ')}], ${tiposIncorrectos.join('; ')}`
  );

  // 9.2 Metadatos completos
  const metadata = json.metadata && typeof json.metadata === 'object' ? json.metadata : null;
  const camposMetaAusentes = metadata
    ? CAMPOS_METADATA.filter((campo) => metadata[campo] === undefined || metadata[campo] === null)
    : [...CAMPOS_METADATA];

  check(
    'Metadatos: map_id, title, format_version, source_file, converted_at y node_count presentes',
    camposMetaAusentes.length === 0,
    camposMetaAusentes.length === 0
      ? `map_id=${formatearValor(metadata.map_id)}, title=${formatearValor(metadata.title)}, ` +
        `format_version=${formatearValor(metadata.format_version)}, source_file=${formatearValor(metadata.source_file)}, ` +
        `converted_at=${formatearValor(metadata.converted_at)}, node_count=${formatearValor(metadata.node_count)}`
      : `faltan: ${camposMetaAusentes.join(', ')}`
  );

  // --------------------------------------------------------------------------
  // Comprobación A: Tema del mapa (theme/themeOverrides en metadata, capa 1)
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación A: Tema del mapa (theme/themeOverrides en metadata) ──');

  const tema = verificarTemaDelMapa(mapa, json);
  check(
    'Tema: theme/themeOverrides del attr raíz conservados en metadata (o ausentes si no se declaran)',
    tema.ok,
    tema.detalle
  );

  // --------------------------------------------------------------------------
  // Comprobación B: Adjuntos (attr.attachment tipado e íntegro, capa 4)
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación B: Adjuntos (attr.attachment tipado e íntegro) ──');

  const adjuntos = verificarAdjuntos(json, nodosDelMapa);
  check(
    'Adjuntos: value.attachment con name/contentType/size reales y raw_attributes.attachment íntegro',
    adjuntos.ok,
    adjuntos.detalle
  );

  // --------------------------------------------------------------------------
  // Comprobación C: Estilos de enlace conservados (capa 7)
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación C: Estilos de enlace conservados ──');

  const estilos = verificarEstilosEnlaces(mapa, json);
  check(
    'Enlaces: color, line_style, arrow y width de attr.style conservados campo a campo',
    estilos.ok,
    estilos.detalle
  );

  // --------------------------------------------------------------------------
  // Comprobación D: Detalles de iconos (capa 7, subcapa 10c)
  // --------------------------------------------------------------------------
  console.log('\n── Comprobación D: Detalles de iconos ──');

  const detallesIconos = verificarDetallesIconos(json, nodosDelMapa);
  check(
    'Iconos: node_id, url, mime_type, base64_length, width/height/position y metaData correctos',
    detallesIconos.ok,
    detallesIconos.detalle
  );

  // --------------------------------------------------------------------------
  // Resumen final y código de salida
  // --------------------------------------------------------------------------
  console.log('\n=== RESUMEN ===');
  console.log(`Comprobaciones: ${pasadas + fallos}`);
  console.log(`Pasadas: ${pasadas}`);
  console.log(`Fallos: ${fallos}`);

  process.exit(fallos > 0 ? 1 : 0);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
