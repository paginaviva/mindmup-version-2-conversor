/**
 * @module layer7-assemble
 * Layer 7 — Final orchestrator (Part 10d): Integrates the 3 sublayers (10a,
 * 10b, 10c), applies cross validations and produces the complete
 * ConversionResult with 10 collections.
 *
 * Responsibilities:
 * 1. Invoke assembleCore (10a) to assemble the base collections.
 * 2. Invoke resolveLinks (10b) to resolve .mup links to UUIDs.
 * 3. Invoke extractIcons, generateEnums and generateIndexes (10c) for the
 *    remaining collections.
 * 4. Validate that there are no orphan references (nodeId must exist in nodes).
 * 5. Validate that all UUIDs are unique within each collection.
 * 6. Assemble the final ConversionResult with the 10 collections.
 *
 * Agnosticism principle: validations log warnings but never throw errors. The
 * conversion always produces a complete result, even with inconsistent data.
 *
 * @see ./layer7-assemble-core.js - Sublayer 10a
 * @see ./layer7-assemble-links.js - Sublayer 10b
 * @see ./layer7-assemble-extra.js - Sublayer 10c
 */

import { assembleCore } from './layer7-assemble-core.js';
import { resolveLinks } from './layer7-assemble-links.js';
import { extractIcons, generateEnums, generateIndexes } from './layer7-assemble-extra.js';

// ---------------------------------------------------------------------------
// Internal validations
// ---------------------------------------------------------------------------

/**
 * Verifies that every nodeId referenced in the secondary collections actually
 * exists in the nodes collection. When orphan references are found, a warning
 * is logged but the conversion is not interrupted.
 *
 * @param {Node[]}  nodes       - Node collection (canonical reference)
 * @param {Note[]}  notes       - Notes that reference nodes through note.nodeId
 * @param {Attribute[]} attributes - Attributes that reference nodes through attribute.nodeId
 * @param {Sticker[]} stickers    - Stickers that reference nodes through sticker.nodeId
 * @param {Icon[]}  icons       - Icons that reference nodes through icon.nodeId
 * @returns {void}
 */
function validateReferences(nodes, notes, attributes, stickers, icons) {
  const nodeIds = new Set();
  for (let i = 0; i < nodes.length; i++) {
    nodeIds.add(nodes[i].node_id);
  }

  // Orphan notes
  for (let i = 0; i < notes.length; i++) {
    if (!nodeIds.has(notes[i].node_id)) {
      console.warn(
        `[Capa 7] Referencia huérfana: note_id=${notes[i].note_id} ` +
        `apunta a node_id=${notes[i].node_id} que no existe en la colección nodes`
      );
    }
  }

  // Orphan attributes
  for (let i = 0; i < attributes.length; i++) {
    if (!nodeIds.has(attributes[i].node_id)) {
      console.warn(
        `[Capa 7] Referencia huérfana: attr_id=${attributes[i].attr_id} ` +
        `apunta a node_id=${attributes[i].node_id} que no existe en la colección nodes`
      );
    }
  }

  // Orphan stickers
  for (let i = 0; i < stickers.length; i++) {
    if (!nodeIds.has(stickers[i].node_id)) {
      console.warn(
        `[Capa 7] Referencia huérfana: sticker_id=${stickers[i].sticker_id} ` +
        `apunta a node_id=${stickers[i].node_id} que no existe en la colección nodes`
      );
    }
  }

  // Orphan icons
  for (let i = 0; i < icons.length; i++) {
    if (!nodeIds.has(icons[i].node_id)) {
      console.warn(
        `[Capa 7] Referencia huérfana: icon_id=${icons[i].icon_id} ` +
        `apunta a node_id=${icons[i].node_id} que no existe en la colección nodes`
      );
    }
  }
}

/**
 * Verifies that there are no duplicated UUIDs within each collection.
 * Each collection uses its corresponding identification field.
 * Duplicates are reported as a warning without interrupting the conversion.
 *
 * @param {Node[]}       nodes        - Node collection
 * @param {Note[]}       notes        - Note collection
 * @param {Attribute[]}  attributes   - Attribute collection
 * @param {Sticker[]}    stickers     - Sticker collection
 * @param {Icon[]}       icons        - Icon collection
 * @param {Link[]}       links        - Link collection
 * @param {ExternalRef[]} externalRefs - External reference collection
 * @returns {void}
 */
function validateUUIDs(nodes, notes, attributes, stickers, icons, links, externalRefs) {
  const collections = [
    { items: nodes,        idField: 'node_id',    name: 'nodes' },
    { items: notes,        idField: 'note_id',    name: 'notes' },
    { items: attributes,   idField: 'attr_id',    name: 'attributes' },
    { items: stickers,     idField: 'sticker_id', name: 'stickers' },
    { items: icons,        idField: 'icon_id',    name: 'icons' },
    { items: links,        idField: 'link_id',    name: 'links' },
    { items: externalRefs, idField: 'ref_id',     name: 'externalRefs' },
  ];

  for (let c = 0; c < collections.length; c++) {
    const { items, idField, name } = collections[c];
    const seen = new Set();

    for (let i = 0; i < items.length; i++) {
      const id = items[i][idField];
      if (seen.has(id)) {
        console.warn(
          `[Capa 7] UUID duplicado en colección ${name}: ${id} ` +
          `(índice ${i})`
        );
      } else {
        seen.add(id);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Layer 7 — Final orchestrator: integrates the 3 assembly sublayers, applies
 * cross validations and produces the complete ConversionResult.
 *
 * Execution flow:
 * 1. Assemble the base collections through assembleCore (maps, nodes, notes,
 *    attributes, stickers, externalRefs).
 * 2. Resolve the original .mup links to UUIDs through resolveLinks.
 * 3. Extract icons and generate enums and indexes through extractIcons,
 *    generateEnums and generateIndexes.
 * 4. Validate cross references: every nodeId in the secondary collections must
 *    exist in the nodes collection.
 * 5. Validate UUID uniqueness within each collection.
 * 6. Return the ConversionResult with the 10 complete collections.
 *
 * Validations never block the conversion (agnosticism principle). Problems are
 * reported as console warnings.
 *
 * @param {Object}        parseResult        - Layer 1 result: {metadata, rawJson}
 * @param {MapMetadata}   parseResult.metadata - Map metadata
 * @param {Object}        parseResult.rawJson  - Original .mup JSON
 * @param {Node[]}        nodes               - Flat node list (Layer 2)
 * @param {Note[]}        notes               - Extracted notes (Layer 3)
 * @param {Attribute[]}   attributes          - Extracted attributes (Layer 4)
 * @param {Sticker[]}     stickers            - Extracted stickers (Layer 5)
 * @param {ExternalRef[]} externalRefs        - Detected URLs (Layer 6)
 * @param {Object}        variables           - Global configuration
 * @param {string}        variables.DEFAULT_LINK_RESOLUTION - Default value for
 *                                        links that cannot be resolved
 * @returns {ConversionResult} Object with the 10 complete collections:
 *   metadata, nodes, notes, attributes, stickers, icons, links, externalRefs,
 *   enums, indexes
 *
 * @example
 * import { parseMup } from './layer1-parse.js';
 * import { flattenNodes } from './layer2-flatten.js';
 * import { extractNotes } from './layer3-notes.js';
 * import { extractAttributes } from './layer4-attributes.js';
 * import { extractStickers } from './layer5-stickers.js';
 * import { extractUrls } from './layer6-urls.js';
 * import { assembleResult } from './layer7-assemble.js';
 *
 * const parseResult = parseMup(mupData, variables);
 * const nodes = flattenNodes(parseResult.rawJson, parseResult.metadata);
 * const notes = extractNotes(nodes, parseResult.rawJson);
 * const attributes = extractAttributes(nodes, parseResult.rawJson);
 * const stickers = extractStickers(nodes, parseResult.rawJson);
 * const externalRefs = extractUrls(nodes, parseResult.rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
 *
 * const result = assembleResult(
 *   parseResult, nodes, notes, attributes, stickers, externalRefs, variables
 * );
 * // result = {
 * //   metadata: { map_id, title, format_version, ... },
 * //   nodes: [ ... ],
 * //   notes: [ ... ],
 * //   attributes: [ ... ],
 * //   stickers: [ ... ],
 * //   icons: [ ... ],
 * //   links: [ ... ],
 * //   externalRefs: [ ... ],
 * //   enums: [ ... ],
 * //   indexes: [ ... ]
 * // }
 */
export function assembleResult(parseResult, nodes, notes, attributes, stickers, externalRefs, variables) {
  // ---------------------------------------------------------------------------
  // Step 1: Assemble the base collections (sublayer 10a)
  // ---------------------------------------------------------------------------
  const core = assembleCore(parseResult, nodes, notes, attributes, stickers, externalRefs);

  // ---------------------------------------------------------------------------
  // Step 2: Resolve the .mup links to UUIDs (sublayer 10b)
  // ---------------------------------------------------------------------------
  const links = resolveLinks(parseResult.rawJson, nodes, variables.DEFAULT_LINK_RESOLUTION);

  // ---------------------------------------------------------------------------
  // Step 3: Extract icons and generate enums and indexes (sublayer 10c)
  // ---------------------------------------------------------------------------
  const icons = extractIcons(parseResult.rawJson, nodes);
  const enums = generateEnums(stickers, attributes, externalRefs);
  const indexes = generateIndexes(nodes);

  // ---------------------------------------------------------------------------
  // Step 4: Validate cross references (warnings, not errors)
  // ---------------------------------------------------------------------------
  validateReferences(core.nodes, core.notes, core.attributes, core.stickers, icons);

  // ---------------------------------------------------------------------------
  // Step 5: Validate UUID uniqueness in each collection (warnings, not errors)
  // ---------------------------------------------------------------------------
  validateUUIDs(core.nodes, core.notes, core.attributes, core.stickers, icons, links, externalRefs);

  // ---------------------------------------------------------------------------
  // Step 6: Assemble the final ConversionResult with the 10 collections
  // ---------------------------------------------------------------------------
  return {
    metadata: core.maps[0],
    nodes: core.nodes,
    notes: core.notes,
    attributes: core.attributes,
    stickers: core.stickers,
    icons,
    links,
    externalRefs,
    enums,
    indexes,
  };
}
