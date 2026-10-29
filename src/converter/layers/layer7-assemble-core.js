/**
 * @module layer7-assemble-core
 * Layer 7 (Part 10a): Assembly of the base ConversionResult collections.
 *
 * Responsibilities:
 * 1. Create the `maps` collection with the metadata extracted by Layer 1.
 * 2. Propagate, without modification, the collections received from previous
 *    layers: nodes, notes, attributes, stickers, externalRefs.
 * 3. Do NOT perform validations, link resolution, icon extraction, enums or
 *    indexes — only package what was received.
 *
 * This layer is the meeting point where the results of Layers 1 to 6 converge
 * to form the base skeleton of the ConversionResult. The remaining collections
 * (icons, links, enums, indexes) are added in later steps of Layer 7.
 *
 * Agnosticism principle: this layer neither inspects nor modifies the content
 * of the collections. It only organizes them into the final ConversionResult
 * structure.
 *
 * @see ./layer7-assemble.js - Layer 7 orchestrator
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Assembles the base ConversionResult collections.
 *
 * Receives the parse result (Layer 1) and the lists processed by Layers 2 to 6,
 * and packages them into an object with the initial ConversionResult structure.
 * The `maps` collection is built from the metadata extracted in Layer 1; the
 * rest of the collections are transferred as-is.
 *
 * No cross validations, ID resolutions or additional extractions are
 * performed. This step is purely organizational: it prepares the container so
 * the next sublayers (10b, 10c, etc.) can add the remaining collections
 * (icons, links, enums, indexes).
 *
 * @param {Object}        parseResult  - Layer 1 result: {metadata, rawJson}
 * @param {MapMetadata}   parseResult.metadata - Map metadata
 * @param {Object}        parseResult.rawJson  - Original .mup JSON
 * @param {Node[]}        nodes        - Flat node list (Layer 2)
 * @param {Note[]}        notes        - Extracted notes (Layer 3)
 * @param {Attribute[]}   attributes   - Extracted attributes (Layer 4)
 * @param {Sticker[]}     stickers     - Extracted stickers (Layer 5)
 * @param {ExternalRef[]} externalRefs - Detected URLs (Layer 6)
 * @returns {Object} Object with the 6 base collections:
 *   @property {Object[]}     maps         - maps collection with 1 element: the metadata
 *   @property {Node[]}       nodes        - Flat node collection
 *   @property {Note[]}       notes        - Note collection
 *   @property {Attribute[]}  attributes   - Attribute collection
 *   @property {Sticker[]}    stickers     - Sticker collection
 *   @property {ExternalRef[]} externalRefs - External reference collection
 *
 * @example
 * import { parseMup } from './layer1-parse.js';
 * import { flattenNodes } from './layer2-flatten.js';
 * import { extractNotes } from './layer3-notes.js';
 * import { extractAttributes } from './layer4-attributes.js';
 * import { extractStickers } from './layer5-stickers.js';
 * import { extractUrls } from './layer6-urls.js';
 * import { assembleCore } from './layer7-assemble-core.js';
 *
 * const { metadata, rawJson } = parseMup(mupData, VARIABLES);
 * const nodes = flattenNodes(rawJson, metadata);
 * const notes = extractNotes(nodes, rawJson);
 * const attributes = extractAttributes(nodes, rawJson);
 * const stickers = extractStickers(nodes, rawJson);
 * const externalRefs = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE);
 *
 * const core = assembleCore({ metadata, rawJson }, nodes, notes, attributes, stickers, externalRefs);
 * // core = {
 * //   maps: [{ map_id: 'root', title: 'My map', format_version: 3 }],
 * //   nodes: [ ... ],
 * //   notes: [ ... ],
 * //   attributes: [ ... ],
 * //   stickers: [ ... ],
 * //   externalRefs: [ ... ]
 * // }
 */
export function assembleCore(parseResult, nodes, notes, attributes, stickers, externalRefs) {
  // -------------------------------------------------------------------------
  // maps collection: the metadata extracted in Layer 1 becomes the only record
  // of the maps collection in the ConversionResult.
  // -------------------------------------------------------------------------
  const maps = [parseResult.metadata];

  return {
    maps,
    nodes,
    notes,
    attributes,
    stickers,
    externalRefs,
  };
}
