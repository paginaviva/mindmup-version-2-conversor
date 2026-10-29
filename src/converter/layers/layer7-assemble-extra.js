/**
 * @module layer7-assemble-extra
 * Layer 7 — Part 10c: Icon extraction + enum generation + indexes.
 *
 * Responsibilities:
 * 1. Extract icons (attr.icon with an image address) from the original .mup
 *    nodes.
 * 2. Generate the controlled vocabulary (EnumValue[]) from real data:
 *    sticker_categories, attr_types, ref_types.
 * 3. Generate predefined queries (IndexEntry[]) over the flattened nodes.
 *
 * Agnosticism principle: when the raw node has no attr.icon, the icon has no
 * image address, or it explicitly declares a type other than 'image', it is
 * skipped silently without an error. Enums and indexes are always generated,
 * even when their sources are empty.
 *
 * @see ../../shared/uuid.js - Shared UUID v4 generation
 */

import { generateUUID } from '../../shared/uuid.js';

// ---------------------------------------------------------------------------
// Icons — extraction from attr.icon
// ---------------------------------------------------------------------------

/**
 * Extracts the MIME type from a data URL (data URI).
 *
 * The URL has the form "data:image/png;base64,iVBOR...". The part between
 * "data:" and ";base64," is extracted.
 *
 * @param {string} url - Complete data URL
 * @returns {string} MIME type, for example "image/png". Falls back to
 *                   "application/octet-stream"
 *
 * @example
 * extractMimeType('data:image/png;base64,iVBOR') // -> 'image/png'
 */
function extractMimeType(url) {
  if (typeof url !== 'string') return 'application/octet-stream';
  const match = url.match(/^data:([^;,]+)/);
  return match ? match[1] : 'application/octet-stream';
}

/**
 * Extracts the base64 body of a data URL (without the "data:...;base64,"
 * prefix).
 *
 * @param {string} url - Complete data URL
 * @returns {string} Pure base64 string, empty when it cannot be extracted
 *
 * @example
 * extractBase64Body('data:image/png;base64,aGVsbG8=') // -> 'aGVsbG8='
 */
function extractBase64Body(url) {
  if (typeof url !== 'string') return '';
  // Accepts data URIs with or without extra parameters between the type and
  // "base64," (for example "data:image/png;base64,XXX" or
  // "data:image/png;charset=utf-8;base64,XXX")
  const match = url.match(/^data:[^,]*;base64,(.+)$/);
  return match ? match[1] : '';
}

/**
 * Recursively traverses the ideas{} tree of the .mup and extracts icons.
 *
 * The traversal follows the same pre-order DFS as layer2-flatten. The
 * correspondence with the flattened nodes is made through an index built from
 * original_id -> node_id, as in layer5.
 *
 * For each node that has an image icon, an Icon record is generated with:
 * - unique UUID (icon_id)
 * - node_id resolved from original_id (or null when not found)
 * - complete icon URL (data URI)
 * - mime_type deduced from the URL prefix
 * - base64_length: length of the base64 payload
 * - width, height, position: optional fields from attr.icon
 * - metaData: icon metadata object (for example MindMup optimization
 *   attributes); only included when it exists, is an object and has at least
 *   one key (present-fields-only principle: an empty metaData {} is omitted).
 *
 * An icon is considered an image when:
 * - it explicitly declares type === 'image' (documented format), or
 * - it does not declare type and has a present image address (url/data)
 *   (real MindMup v3 format, which omits the type field).
 *
 * The type field with an empty string ('') is treated as absent: an icon with
 * type: '' and a present url is extracted just like one without a type field.
 *
 * @param {Object}               ideasObj            - ideas object of the current level
 * @param {Map<string, string>}  nodeIdByOriginalId  - original_id -> node_id index
 * @param {Icon[]}               accumulator         - Accumulator array (mutated in place)
 * @returns {void}
 */
function traverseAndExtractIcons(ideasObj, nodeIdByOriginalId, accumulator) {
  if (!ideasObj || typeof ideasObj !== 'object') return;

  for (const key of Object.keys(ideasObj)) {
    const rawNode = ideasObj[key];

    // Defensive safety: skip invalid entries
    if (!rawNode || typeof rawNode !== 'object') continue;

    // Resolve node_id through original_id
    const originalId = rawNode.id !== undefined ? String(rawNode.id) : '';
    const nodeId = originalId ? nodeIdByOriginalId.get(originalId) : undefined;

    // Extract the icon when attr.icon exists and meets the image criteria:
    // - type === 'image' (documented format)
    // - type absent with a present url (real MindMup v3 format)
    // - empty type ('') is considered absent: an icon with type:'' and url is extracted
    const icon = rawNode.attr && rawNode.attr.icon;
    const url = icon ? (icon.url || icon.data || '') : '';
    const hasExplicitType =
      icon && icon.type !== undefined && icon.type !== null && icon.type !== '';
    const isImageIcon = hasExplicitType ? icon.type === 'image' : true;

    if (icon && isImageIcon && url.length > 0) {
      const mimeType = extractMimeType(url);
      const base64Body = extractBase64Body(url);

      /** @type {Icon} */
      const iconEntry = {
        icon_id: generateUUID(),
        node_id: nodeId || null,
        url: url,
        width: icon.width !== undefined ? Number(icon.width) : 0,
        height: icon.height !== undefined ? Number(icon.height) : 0,
        position: icon.position || '',
        mime_type: mimeType,
        base64_length: base64Body.length,
      };

      // metaData: only when it exists, is a (non-array) object and has keys
      // (present-fields-only principle — an empty metaData {} is omitted).
      // It is copied so it does not share a reference with the source data.
      if (
        icon.metaData != null &&
        typeof icon.metaData === 'object' &&
        !Array.isArray(icon.metaData) &&
        Object.keys(icon.metaData).length > 0
      ) {
        iconEntry.metaData = { ...icon.metaData };
      }

      accumulator.push(iconEntry);
    }

    // Recurse into children (same logic as layer2/layer4/layer5)
    if (rawNode.ideas && typeof rawNode.ideas === 'object') {
      traverseAndExtractIcons(rawNode.ideas, nodeIdByOriginalId, accumulator);
    }
  }
}

// ---------------------------------------------------------------------------
// Enumerations — controlled vocabulary
// ---------------------------------------------------------------------------

/**
 * Generates a unique identifier for an enum value.
 *
 * The ID follows the pattern `enum_{category}_{code}` where the code is
 * normalized by replacing non-alphanumeric characters with underscores.
 *
 * @param {string} category - Enum category (sticker_categories, attr_types, ref_types)
 * @param {string} code     - Internal code of the value
 * @returns {string} Unique enum identifier
 *
 * @example
 * generateEnumId('sticker_categories', 'symbol') // -> 'enum_sticker_categories_symbol'
 * generateEnumId('attr_types', 'style.backgroundColor') // -> 'enum_attr_types_style_backgroundColor'
 */
function generateEnumId(category, code) {
  const safeCode = String(code).replace(/[^a-zA-Z0-9_]/g, '_');
  return `enum_${category}_${safeCode}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts icons (attr.icon with an image address) from the original .mup
 * nodes.
 *
 * Recursively traverses the ideas{} tree of rawJson in pre-order DFS (same
 * order as layer2-flatten). For each node that has an image icon (explicit
 * type === 'image', or an absent or empty ('') type with a present url — real
 * MindMup v3 format), it extracts the URL data, deduces the MIME type,
 * computes the base64 length, and maps it to the corresponding node_id through
 * the original_id -> node_id index built from the flattened node list.
 *
 * Each Icon includes the metaData field only when the original attr.icon
 * provides it as a non-empty object (present-fields-only principle).
 *
 * @param {Object} rawJson  - Complete original .mup JSON (already parsed object)
 * @param {Node[]} nodes    - Flat node list (generated by Layer 2)
 * @returns {Icon[]} List of extracted icons. Empty when there are no image icons.
 *
 * @example
 * const icons = extractIcons(rawJson, nodes);
 * // icons[0] = {
 * //   icon_id: '550e8400-e29b-41d4-a716-446655440000',
 * //   node_id: '660e8400-e29b-41d4-a716-446655440001',
 * //   url: 'data:image/png;base64,iVBORw0KGgo...',
 * //   width: 32,
 * //   height: 32,
 * //   position: 'center',
 * //   mime_type: 'image/png',
 * //   base64_length: 1482
 * // }
 */
export function extractIcons(rawJson, nodes) {
  /** @type {Icon[]} */
  const icons = [];

  if (!rawJson || typeof rawJson !== 'object' || !Array.isArray(nodes) || nodes.length === 0) {
    return icons;
  }

  // Build the index: original_id -> node_id from the flattened nodes
  /** @type {Map<string, string>} */
  const nodeIdByOriginalId = new Map();
  for (const node of nodes) {
    if (node.original_id) {
      nodeIdByOriginalId.set(node.original_id, node.node_id);
    }
  }

  // Traverse the ideas{} tree and extract icons
  if (rawJson.ideas && typeof rawJson.ideas === 'object') {
    traverseAndExtractIcons(rawJson.ideas, nodeIdByOriginalId, icons);
  }

  return icons;
}

/**
 * Generates the controlled vocabulary from real data.
 *
 * Produces enum values for three categories:
 * - `sticker_categories`: unique categories present in real stickers
 * - `attr_types`: field names (top-level keys) present in the value of the
 *   extracted attributes (position, width, style, collapsed, etc.)
 * - `ref_types`: unique ref_type values present in external references
 *
 * Each EnumValue has a unique enum_id (format `enum_{category}_{code}`), the
 * category it belongs to, the internal code and a descriptive label generated
 * from the code.
 *
 * @param {Sticker[]}    stickers     - Extracted stickers (for real categories)
 * @param {Attribute[]}  attributes   - Extracted attributes (for field names)
 * @param {ExternalRef[]} externalRefs - Extracted URLs (for real ref_types)
 * @returns {EnumValue[]} List of enum values. Empty when all sources are empty,
 *                        but never undefined.
 *
 * @example
 * const enums = generateEnums(stickers, attributes, externalRefs);
 * // enums = [
 * //   { enum_id: 'enum_sticker_categories_symbol',    category: 'sticker_categories', code: 'symbol',  label: 'Symbol' },
 * //   { enum_id: 'enum_sticker_categories_travel',    category: 'sticker_categories', code: 'travel',  label: 'Travel' },
 * //   { enum_id: 'enum_attr_types_position',          category: 'attr_types',         code: 'position', label: 'Position' },
 * //   { enum_id: 'enum_attr_types_style',             category: 'attr_types',         code: 'style',    label: 'Style' },
 * //   { enum_id: 'enum_ref_types_web_page',           category: 'ref_types',          code: 'web_page', label: 'Web Page' },
 * // ]
 */
export function generateEnums(stickers, attributes, externalRefs) {
  /** @type {EnumValue[]} */
  const enums = [];

  // -----------------------------------------------------------------------
  // 1. sticker_categories: unique categories of real stickers
  // -----------------------------------------------------------------------
  if (Array.isArray(stickers) && stickers.length > 0) {
    /** @type {Set<string>} */
    const seenCategories = new Set();
    for (const sticker of stickers) {
      if (sticker.category && !seenCategories.has(sticker.category)) {
        seenCategories.add(sticker.category);
        enums.push({
          enum_id: generateEnumId('sticker_categories', sticker.category),
          category: 'sticker_categories',
          code: sticker.category,
          label: sticker.category.charAt(0).toUpperCase() + sticker.category.slice(1),
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // 2. attr_types: field names (top-level keys) in the value of the
  //    extracted attributes — position, width, style, collapsed, etc.
  // -----------------------------------------------------------------------
  if (Array.isArray(attributes) && attributes.length > 0) {
    /** @type {Set<string>} */
    const seenAttrTypes = new Set();
    for (const attr of attributes) {
      if (attr.value && typeof attr.value === 'object') {
        for (const key of Object.keys(attr.value)) {
          if (!seenAttrTypes.has(key)) {
            seenAttrTypes.add(key);
            const label = key
              .replace(/_/g, ' ')
              .replace(/([A-Z])/g, ' $1')
              .replace(/^./, (character) => character.toUpperCase())
              .trim();
            enums.push({
              enum_id: generateEnumId('attr_types', key),
              category: 'attr_types',
              code: key,
              label: label,
            });
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // 3. ref_types: unique ref_type values of the externalRefs
  // -----------------------------------------------------------------------
  if (Array.isArray(externalRefs) && externalRefs.length > 0) {
    /** @type {Set<string>} */
    const seenRefTypes = new Set();
    for (const ref of externalRefs) {
      if (ref.ref_type && !seenRefTypes.has(ref.ref_type)) {
        seenRefTypes.add(ref.ref_type);
        const label = ref.ref_type
          .replace(/_/g, ' ')
          .replace(/^./, (character) => character.toUpperCase())
          .trim();
        enums.push({
          enum_id: generateEnumId('ref_types', ref.ref_type),
          category: 'ref_types',
          code: ref.ref_type,
          label: label,
        });
      }
    }
  }

  return enums;
}

/**
 * Generates predefined queries (indexes) over the node data.
 *
 * Produces four base indexes:
 * - `all_nodes`: selects every node without filtering
 * - `root_nodes`: only nodes with depth=0 (roots)
 * - `leaf_nodes`: only leaf nodes (is_leaf=true)
 * - `parent_nodes`: only parent nodes (is_leaf=false, i.e. they have children)
 *
 * Each IndexEntry contains an identifier, name, query type, a query object
 * with the applied filters, and a description of the index purpose.
 *
 * @param {Node[]} nodes - Flat node list (from Layer 2)
 * @returns {IndexEntry[]} List of predefined indexes. Always returns exactly
 *                         4 entries regardless of the data.
 *
 * @example
 * const indexes = generateIndexes(nodes);
 * // indexes = [
 * //   { index_id: 'idx_all_nodes',    name: 'Todos los nodos',    type: 'select', query: {},                              description: 'Todos los nodos del mapa' },
 * //   { index_id: 'idx_root_nodes',   name: 'Nodos raíz',        type: 'select', query: { depth: 0 },                     description: 'Nodos raíz del mapa (depth=0)' },
 * //   { index_id: 'idx_leaf_nodes',   name: 'Nodos hoja',        type: 'select', query: { is_leaf: true },                description: 'Nodos hoja (sin hijos)' },
 * //   { index_id: 'idx_parent_nodes', name: 'Nodos padre',       type: 'select', query: { is_leaf: false },               description: 'Nodos padre (con hijos)' },
 * // ]
 */
export function generateIndexes(nodes) {
  /** @type {IndexEntry[]} */
  const indexes = [
    {
      index_id: 'idx_all_nodes',
      name: 'Todos los nodos',
      type: 'select',
      query: {},
      description: 'Todos los nodos del mapa',
    },
    {
      index_id: 'idx_root_nodes',
      name: 'Nodos raíz',
      type: 'select',
      query: { depth: 0 },
      description: 'Nodos raíz del mapa (depth=0)',
    },
    {
      index_id: 'idx_leaf_nodes',
      name: 'Nodos hoja',
      type: 'select',
      query: { is_leaf: true },
      description: 'Nodos hoja (sin hijos)',
    },
    {
      index_id: 'idx_parent_nodes',
      name: 'Nodos padre',
      type: 'select',
      query: { is_leaf: false },
      description: 'Nodos padre (con hijos)',
    },
  ];

  return indexes;
}
