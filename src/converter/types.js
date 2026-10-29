/**
 * @module types
 * Shared JSDoc typedefs for the converter pipeline.
 *
 * These types document the JSON-CMJN contract. The collection and field names
 * are part of the output format and must not be renamed.
 */

/**
 * @typedef {Object} MapMetadata
 * @property {string} map_id - Stable map identifier.
 * @property {string} title - Map title.
 * @property {number} format_version - MindMup format version (3).
 * @property {string} source_file - Original .mup filename.
 * @property {string} converted_at - ISO 8601 conversion timestamp.
 * @property {number} node_count - Number of flattened nodes.
 */

/**
 * @typedef {Object} MapNode
 * @property {string} node_id - Generated UUID.
 * @property {string} map_id - Parent map identifier.
 * @property {string|null} parent_id - Parent node UUID or null for the root.
 * @property {string} sort_key - Original sibling key.
 * @property {string} title - Node title.
 * @property {number} depth - Depth from the root.
 * @property {number} sibling_order - Position among siblings.
 * @property {string[]} path - UUID path from the root.
 * @property {string} original_id - Original MindMup node id.
 * @property {boolean} is_leaf - Whether the node has no children.
 */

/**
 * @typedef {Object} MapNote
 * @property {string} note_id - Generated UUID.
 * @property {string} node_id - Owning node UUID.
 * @property {number} index - Original note index.
 * @property {string} text - Note text.
 * @property {number} char_count - Character count.
 * @property {boolean} truncated - Whether the source marked it as truncated.
 */

/**
 * @typedef {Object} MapAttribute
 * @property {string} attr_id - Generated UUID.
 * @property {string} node_id - Owning node UUID.
 * @property {string} attr_type - Attribute type.
 * @property {Object} value - Typed attribute value.
 * @property {Object} [raw_attributes] - Original attribute object.
 */

/**
 * @typedef {Object} MapSticker
 * @property {string} sticker_id - Generated UUID.
 * @property {string} node_id - Owning node UUID.
 * @property {string} emoji_code - Source emoji code.
 * @property {string} emoji_display - Display emoji.
 * @property {string} category - Sticker category.
 */

/**
 * @typedef {Object} MapIcon
 * @property {string} icon_id - Generated UUID.
 * @property {string} node_id - Owning node UUID.
 * @property {string} url - Data URL or remote URL.
 * @property {number} [width] - Icon width.
 * @property {number} [height] - Icon height.
 * @property {string} [position] - Icon position.
 * @property {string} [mime_type] - MIME type.
 * @property {number} [base64_length] - Decoded payload length.
 */

/**
 * @typedef {Object} MapLink
 * @property {string} link_id - Generated UUID.
 * @property {string} map_id - Map identifier.
 * @property {string|null} from_node_id - Source node UUID.
 * @property {string|null} to_node_id - Target node UUID.
 * @property {string} [color] - Link color.
 * @property {string} [line_style] - Link line style.
 * @property {string} [arrow] - Arrow style.
 * @property {number} [width] - Link width.
 * @property {string} [resolution] - Resolution state for unresolved links.
 */

/**
 * @typedef {Object} ExternalReference
 * @property {string} ref_id - Generated UUID.
 * @property {string} node_id - Owning node UUID.
 * @property {string} url - Referenced URL.
 * @property {string} ref_type - Classified reference type.
 * @property {string} [label] - Link label.
 */

/**
 * @typedef {Object} EnumEntry
 * @property {string} enum_id - Stable enum identifier.
 * @property {string} category - Enum category.
 * @property {string} code - Enum code.
 * @property {string} label - Human-readable label.
 */

/**
 * @typedef {Object} IndexEntry
 * @property {string} index_id - Stable index identifier.
 * @property {string} name - Human-readable name.
 * @property {string} type - Index type.
 * @property {Object} query - Query definition.
 * @property {string} description - Human-readable description.
 */

/**
 * @typedef {Object} ConversionResult
 * @property {MapMetadata} metadata
 * @property {MapNode[]} nodes
 * @property {MapNote[]} notes
 * @property {MapAttribute[]} attributes
 * @property {MapSticker[]} stickers
 * @property {MapIcon[]} icons
 * @property {MapLink[]} links
 * @property {ExternalReference[]} externalRefs
 * @property {EnumEntry[]} enums
 * @property {IndexEntry[]} indexes
 */

export {};
