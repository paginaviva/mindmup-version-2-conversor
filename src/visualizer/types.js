/**
 * @module types
 * JSDoc type definitions for every data structure in the visualizer.
 *
 * Responsibilities:
 * 1. Types for the 10 collections of the CMJN JSON document.
 * 2. Types for the visualizer internal structures (tree, styles).
 * 3. Types for API responses (map list).
 *
 * Principle: this module contains no executable code, only JSDoc documentation.
 * The typedefs are used as type references in visualizer functions.
 */

// ---------------------------------------------------------------------------
// Types for the 10 collections of the CMJN JSON document
// ---------------------------------------------------------------------------

/**
 * Map metadata.
 *
 * Contains general map information: identifier, title, format version, original
 * file, conversion timestamp and total node count.
 *
 * @typedef {Object} Metadata
 * @property {string} map_id - Unique map identifier.
 * @property {string} title - Map title.
 * @property {number} format_version - CMJN format version.
 * @property {string} source_file - Name of the original .mup file.
 * @property {string} converted_at - Conversion timestamp in ISO 8601 format.
 * @property {number} node_count - Total number of nodes in the map.
 * @property {string} [theme] - Visual theme declared in the root attr of the
 *   .mup file (for example "default").
 * @property {Object} [themeOverrides] - Theme adjustments declared in the root
 *   attr of the .mup file; the visualizer uses
 *   themeOverrides.canvas.backgroundColor for the theme switch.
 * @property {Object} [themeOverrides.canvas] - Theme canvas adjustments.
 * @property {string} [themeOverrides.canvas.backgroundColor] - Canvas
 *   background color (hex #RRGGBB).
 */

/**
 * Mind map node.
 *
 * Represents an individual node of the map. Contains its identifier, title,
 * position in the tree (parent, depth, order), full path and metadata from the
 * original .mup node.
 *
 * The optional properties (children, notes, externalRefs, links, style,
 * stickers, icons) are added by the processing layers (Layer 2 to Layer 4).
 *
 * @typedef {Object} Node
 * @property {string} node_id - Node UUID.
 * @property {string} map_id - Identifier of the map the node belongs to.
 * @property {string|null} parent_id - Parent node UUID (null when it is a root).
 * @property {string} sort_key - Node sort key.
 * @property {string} title - Node title.
 * @property {number} depth - Depth in the tree (0 = root).
 * @property {number} sibling_order - Order among siblings.
 * @property {string[]} path - Full path from the root (array of node_ids).
 * @property {string} original_id - Original node ID in the .mup file.
 * @property {boolean} is_leaf - Whether it is a leaf (true when it has no
 *   children).
 * @property {Node[]} [children] - Node children (added by Layer 2).
 * @property {Note[]} [notes] - Node notes (added by Layer 3).
 * @property {ExternalRef[]} [externalRefs] - External references (added by
 *   Layer 3).
 * @property {Link[]} [links] - Outgoing node links (added by Layer 3).
 * @property {Sticker[]|string[]} [stickers] - Node stickers (added by Layer 3 as
 *   objects from the stickers collection — with emoji_code and emoji_display —
 *   or by Layer 4 as strings in "emoji:XXXX" format).
 * @property {Icon[]} [icons] - Node icons (added by Layer 3; objects with url,
 *   width, height and position; empty when the node has no icons).
 * @property {NodeStyle} [style] - Node visual style (added by Layer 4).
 * @property {Attachment|null} [attachment] - Node attachment metadata (added by
 *   Layer 4; null when the node has no attachment). The base64 content does not
 *   travel in the tree: it is read from MMUP_DATA.attachments. Includes
 *   isBinary, the text/binary classification computed by Layer 4.
 */

/**
 * Metadata of a file attached to a node.
 *
 * Represents the header of a map attachment (for example a text file embedded
 * by MindMup). It contains metadata only: the base64 content is transmitted
 * separately (MMUP_DATA.attachments) to avoid duplicating it in the tree.
 *
 * Layer 4 adds the isBinary property with the general isTextAttachment()
 * function (src/visualizer/layers/layer4-styler.js): text when contentType
 * starts with 'text/' or the name has a known textual extension (.txt, .md,
 * .markdown, .json, .csv, .xml, .html, .htm, .css, .js); binary otherwise. It is
 * the signal Layer 5 uses to render a direct download link
 * (.attachment-download) instead of opening the modal window.
 *
 * @typedef {Object} Attachment
 * @property {string} name - Attachment file name.
 * @property {string} contentType - Attachment MIME type (may be "").
 * @property {number} size - Real attachment size in bytes (decoded base64
 *   content).
 * @property {boolean} [isBinary] - true when the attachment is classified as
 *   binary (not displayable as text). Layer 4 computes it; it may be missing in
 *   trees that did not go through applyStyles (in that case Layer 5 assumes
 *   text).
 */

/**
 * Icon (image) associated with a node.
 *
 * Represents an image attached to a node, usually a data URI
 * (data:image/png;base64,...) although it may also be a remote URL. Contains the
 * image dimensions and position relative to the node.
 *
 * @typedef {Object} Icon
 * @property {string} icon_id - Icon UUID.
 * @property {string} node_id - UUID of the node it belongs to.
 * @property {string} url - Image URL (data URI or remote URL).
 * @property {number} width - Image width in pixels.
 * @property {number} height - Image height in pixels.
 * @property {string} position - Icon position relative to the node (left,
 *   center, etc.).
 * @property {string} mime_type - MIME type inferred from the URL prefix.
 * @property {number} base64_length - Length of the base64 string (without the
 *   prefix).
 */

/**
 * Sticker (emoji) associated with a node.
 *
 * Represents an emoji attached to a node. Contains the original code
 * ("emoji:XXXXX" format) and its already resolved Unicode visual
 * representation.
 *
 * @typedef {Object} Sticker
 * @property {string} sticker_id - Sticker UUID.
 * @property {string} node_id - UUID of the node it belongs to.
 * @property {string} emoji_code - Emoji code in "emoji:XXXXX" format.
 * @property {string} emoji_display - Emoji visual representation (Unicode
 *   character).
 * @property {string} category - Emoji category according to the enum.
 */

/**
 * Note associated with a node.
 *
 * Represents a text note attached to a node. Contains the full text, its length
 * and whether it is truncated (very long notes may be truncated during
 * conversion).
 *
 * @typedef {Object} Note
 * @property {string} note_id - Note UUID.
 * @property {string} node_id - UUID of the node it belongs to.
 * @property {number} index - Note index (order of appearance).
 * @property {string} text - Full note text.
 * @property {number} char_count - Text length in characters.
 * @property {boolean} truncated - Whether the text is truncated (true when it
 *   was shortened).
 */

/**
 * Node attribute (visual styles, stickers, etc.).
 *
 * Contains the node attributes in two formats: value (processed attributes) and
 * raw_attributes (unprocessed attributes from the .mup file).
 *
 * Visual styles are extracted from value.style.backgroundColor. Stickers are
 * extracted from raw_attributes.stickers.
 *
 * @typedef {Object} Attribute
 * @property {string} attr_id - Attribute UUID.
 * @property {string} node_id - UUID of the node it belongs to.
 * @property {string} attr_type - Attribute type (for example "style",
 *   "stickers").
 * @property {Object} value - Processed attribute value.
 * @property {Object} [value.style] - Node visual styles.
 * @property {string} [value.style.backgroundColor] - Background color (hex
 *   #RRGGBB).
 * @property {Object} raw_attributes - Raw attributes from the .mup file.
 * @property {string[]} [raw_attributes.stickers] - Node stickers
 *   ("emoji:XXXX" format).
 */

/**
 * External reference associated with a node.
 *
 * Represents a link to an external resource (URL) attached to a node. Contains
 * the URL, the reference type and a descriptive label.
 *
 * @typedef {Object} ExternalRef
 * @property {string} ref_id - External reference UUID.
 * @property {string} node_id - UUID of the node it belongs to.
 * @property {string} url - External resource URL.
 * @property {string} ref_type - Reference type (for example "url", "file").
 * @property {string} label - Descriptive reference label.
 */

/**
 * Link between two map nodes.
 *
 * Represents a visual connection between two nodes. Contains the source and
 * target UUIDs, arrow color, line style, direction and width. Unresolved links
 * have a null from_node_id or to_node_id.
 *
 * @typedef {Object} Link
 * @property {string} link_id - Link UUID.
 * @property {string} map_id - Identifier of the map it belongs to.
 * @property {string|null} from_node_id - Source node UUID (null when
 *   unresolved).
 * @property {string|null} to_node_id - Target node UUID (null when unresolved).
 * @property {string} color - Arrow color (hex #RRGGBB, for example "#FF0000").
 * @property {string} line_style - Line style ("solid", "dashed", "dotted").
 * @property {string} arrow - Arrow direction ("to", "from", "both").
 * @property {number} width - Line width in pixels.
 * @property {string} resolution - Link resolution state.
 */

/**
 * Visual style of a node.
 *
 * Contains the visual properties of a node extracted from its attributes.
 * Currently it only includes backgroundColor, but it may be extended in the
 * future.
 *
 * @typedef {Object} NodeStyle
 * @property {string|null} backgroundColor - Node background color (hex #RRGGBB
 *   or null).
 */

// ---------------------------------------------------------------------------
// Types for the full CMJN JSON document structure
// ---------------------------------------------------------------------------

/**
 * Full structure of the CMJN JSON document.
 *
 * Contains the 10 collections of the JSON generated by the MUP converter:
 * metadata, nodes, notes, attributes, stickers, icons, links, externalRefs,
 * enums and indexes.
 *
 * @typedef {Object} MmupOutput
 * @property {Metadata} metadata - Map metadata.
 * @property {Node[]} nodes - Map node collection.
 * @property {Note[]} notes - Notes collection.
 * @property {Attribute[]} attributes - Attributes collection.
 * @property {Sticker[]} stickers - Map stickers collection.
 * @property {Icon[]} icons - Icons collection.
 * @property {Link[]} links - Links between nodes.
 * @property {ExternalRef[]} externalRefs - External references collection.
 * @property {Object[]} enums - Enums collection.
 * @property {Object[]} indexes - Indexes collection.
 */

// ---------------------------------------------------------------------------
// Types for API responses (map list)
// ---------------------------------------------------------------------------

/**
 * Item of the available map list.
 *
 * Represents an individual map in the list of maps available in R2. Contains the
 * UUID, title, original file, conversion date and node count.
 *
 * @typedef {Object} ListItem
 * @property {string} uuid - UUID of the JSON object in R2 (unique identifier).
 * @property {string} title - Map title.
 * @property {string} source_file - Name of the original .mup file.
 * @property {string} converted_at - Conversion timestamp in ISO 8601 format.
 * @property {number} node_count - Total number of map nodes.
 */

/**
 * Map list API response.
 *
 * Response structure of the /visor/api/lista endpoint, which returns the list of
 * maps available in R2.
 *
 * @typedef {Object} ListResponse
 * @property {boolean} success - Whether the operation succeeded (true) or
 *   failed (false).
 * @property {number} count - Number of items in the list.
 * @property {ListItem[]} items - Available map list.
 */
