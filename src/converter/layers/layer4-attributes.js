/**
 * @module layer4-attributes
 * Layer 4: Extraction of typed attributes plus raw_attributes from nodes.
 *
 * Responsibilities:
 * 1. Walk the flattened nodes (from Layer 2) and extract the `attr` object of
 *    each node from the original .mup JSON.
 * 2. Map the known `attr` fields into a typed `value` object:
 *    position, width, height, style (backgroundColor, color, fontSize,
 *    fontMultiplier, fontFamily, bold, italic, underline, strikethrough,
 *    textAlign), collapsed, icon (type, size), shape, borderStyle,
 *    borderColor, borderWidth, parentConnector (width, color, arrow),
 *    attachment (name, contentType, size - metadata only; the complete content
 *    remains in raw_attributes).
 * 3. Capture the COMPLETE `attr` object as `raw_attributes` (a generic
 *    key-value map) to guarantee zero information loss for attributes that are
 *    not covered - agnosticism principle.
 * 4. Create one Attribute record per node (one for every node that has
 *    attributes present).
 * 5. Handle Incident #9: do not confuse the node width (style.width) with the
 *    icon width (icon.width).
 *
 * Agnosticism principle (doc 11 §4.2.A):
 *   The typed fields cover the known attributes, but raw_attributes preserves
 *   the WHOLE original attr object. Any future or undocumented attribute is
 *   preserved automatically. This ensures zero information loss regardless of
 *   the fields MindMup adds.
 *
 * See the conversion method documentation, Phase 4: attribute extraction, the
 * incident log (Incident #9: width confusion, #10: raw_attributes) and the
 * converter agnosticism notes, section 4.2.A (raw_attributes).
 *
 * @see src/types.js - Attribute typedef
 * @see src/shared/uuid.js - Shared UUID v4 generation
 */

import { generateUUID } from '../../shared/uuid.js';

// ---------------------------------------------------------------------------
// Building the value object with typed fields
// ---------------------------------------------------------------------------

/**
 * Length of the base64 content of a data URI.
 *
 * A data URI has the form "data:{mime};base64,{payload}". This function
 * returns the real attachment size in bytes by decoding the base64 payload
 * (everything after the first comma). When the payload is not valid base64 it
 * returns the payload length as a fallback.
 *
 * @private
 * @param {string} content - Attachment data URI or base64 content
 * @returns {number} Attachment size in bytes
 */
function base64PayloadLength(content) {
  if (typeof content !== 'string') return 0;
  const commaIndex = content.indexOf(',');
  const payload = commaIndex === -1 ? content : content.slice(commaIndex + 1);

  try {
    // atob decodes base64 into a binary string; its length is the number of
    // real bytes of the attached file.
    return atob(payload).length;
  } catch {
    // Non-decodable payload: fall back to the payload length
    return payload.length;
  }
}

/**
 * Extracts the known typed fields from a node `attr` object.
 *
 * Only fields that actually exist in attr are included in the result.
 * Absent fields are omitted (they are not included with a null value).
 *
 * Source (raw attr) to destination (typed value) mapping:
 *   - attr.position (array [x, y, z]) -> value.position (object {x, y, z})
 *   - attr.style.width -> value.width (number) - Incident #9
 *   - attr.style.height -> value.height (number)
 *   - attr.style.backgroundColor -> value.style.backgroundColor (hex string)
 *   - attr.style.color / attr.style.text.color -> value.style.color (hex string)
 *   - attr.style.fontSize -> value.style.fontSize (number)
 *   - attr.style.fontMultiplier -> value.style.fontMultiplier (number;
 *     MindMup v3 font scale multiplier, for example 1.25)
 *   - attr.style.fontFamily -> value.style.fontFamily (string)
 *   - attr.style.bold -> value.style.bold (boolean)
 *   - attr.style.italic -> value.style.italic (boolean)
 *   - attr.style.underline -> value.style.underline (boolean)
 *   - attr.style.strikethrough -> value.style.strikethrough (boolean)
 *   - attr.style.textAlign -> value.style.textAlign (string, e.g. "center")
 *   - attr.collapsed -> value.collapsed (boolean)
 *   - attr.icon.type -> value.icon.type (string)
 *   - attr.icon.size -> value.icon.size (number)
 *   - attr.shape -> value.shape (string)
 *   - attr.borderStyle -> value.borderStyle (string)
 *   - attr.borderColor -> value.borderColor (string)
 *   - attr.borderWidth -> value.borderWidth (number)
 *   - attr.parentConnector.width -> value.parentConnector.width (number)
 *   - attr.parentConnector.color -> value.parentConnector.color (hex string)
 *   - attr.parentConnector.arrow -> value.parentConnector.arrow (string,
 *     for example "to" - connector arrow direction)
 *   - attr.attachment -> value.attachment (object with metadata only:
 *     name, contentType and size - the base64 content size).
 *     The content is NOT duplicated here: it remains in raw_attributes.attachment.
 *
 * @param {Object} attr - Node `attr` object in the original .mup
 * @returns {Object} Object with only the typed fields that are present
 */
function extractTypedFields(attr) {
  /** @type {Object} */
  const value = {};

  // ------------------------------------------------------------------
  // position: from an [x, y, z] array to an {x, y, z} object
  // The z coordinate is only included when the array provides it (three
  // components); with only [x, y] the z field stays absent, consistent
  // with the principle of including only fields that are really present.
  // ------------------------------------------------------------------
  if (attr.position && Array.isArray(attr.position)) {
    value.position = {
      x: attr.position[0],
      y: attr.position[1],
      // The z coordinate is only included when the array provides it
      // (three components); with only [x, y] the z field stays absent,
      // consistent with the principle of including only present fields.
      ...(attr.position.length > 2 ? { z: attr.position[2] } : {}),
    };
  }

  // ------------------------------------------------------------------
  // width: node width (NOT the icon width - Incident #9)
  // It comes from attr.style.width in the original .mup.
  // attr.icon.width belongs to the icon (extracted in another layer).
  // ------------------------------------------------------------------
  if (attr.width !== undefined) {
    value.width = attr.width;
  } else if (attr.style && attr.style.width !== undefined) {
    value.width = attr.style.width;
  }

  // ------------------------------------------------------------------
  // height: node height (NOT the icon height)
  // ------------------------------------------------------------------
  if (attr.height !== undefined) {
    value.height = attr.height;
  } else if (attr.style && attr.style.height !== undefined) {
    value.height = attr.style.height;
  }

  // ------------------------------------------------------------------
  // style: visual style attributes
  // ------------------------------------------------------------------
  if (attr.style) {
    const style = {};

    if (attr.style.backgroundColor != null) {
      style.backgroundColor = attr.style.backgroundColor;
    }

    // color may live in style.color or style.text.color
    if (attr.style.color != null) {
      style.color = attr.style.color;
    } else if (
      attr.style.text &&
      attr.style.text.color != null
    ) {
      style.color = attr.style.text.color;
    }

    if (attr.style.fontSize != null) {
      style.fontSize = attr.style.fontSize;
    }

    // fontMultiplier: font scale multiplier (number, for example 1.25)
    if (attr.style.fontMultiplier != null) {
      style.fontMultiplier = attr.style.fontMultiplier;
    }

    if (attr.style.fontFamily != null) {
      style.fontFamily = attr.style.fontFamily;
    }

    if (attr.style.bold != null) {
      style.bold = attr.style.bold;
    }

    if (attr.style.italic != null) {
      style.italic = attr.style.italic;
    }

    if (attr.style.underline != null) {
      style.underline = attr.style.underline;
    }

    if (attr.style.strikethrough != null) {
      style.strikethrough = attr.style.strikethrough;
    }

    // textAlign: text alignment (string, for example "center" or "left")
    if (attr.style.textAlign != null) {
      style.textAlign = attr.style.textAlign;
    }

    if (Object.keys(style).length > 0) {
      value.style = style;
    }
  }

  // ------------------------------------------------------------------
  // collapsed: collapsed state of the node (boolean)
  // ------------------------------------------------------------------
  if (attr.collapsed !== undefined) {
    value.collapsed = attr.collapsed;
  }

  // ------------------------------------------------------------------
  // icon: {type, size} - icon metadata
  // NOTE: icon.width and icon.height belong to the icons collection,
  //       they are not extracted here (Incident #9).
  // ------------------------------------------------------------------
  if (attr.icon) {
    const icon = {};

    if (attr.icon.type != null) {
      icon.type = attr.icon.type;
    }

    if (attr.icon.size != null) {
      icon.size = attr.icon.size;
    }

    if (Object.keys(icon).length > 0) {
      value.icon = icon;
    }
  }

  // ------------------------------------------------------------------
  // parentConnector: parent connector of the node
  // The width, color and arrow direction are extracted when present;
  // the rest of the object remains available in raw_attributes.
  // ------------------------------------------------------------------
  if (attr.parentConnector && typeof attr.parentConnector === 'object') {
    const parentConnector = {};

    if (attr.parentConnector.width !== undefined) {
      parentConnector.width = attr.parentConnector.width;
    }

    if (attr.parentConnector.color != null) {
      parentConnector.color = attr.parentConnector.color;
    }

    if (attr.parentConnector.arrow != null) {
      parentConnector.arrow = attr.parentConnector.arrow;
    }

    if (Object.keys(parentConnector).length > 0) {
      value.parentConnector = parentConnector;
    }
  }

  // ------------------------------------------------------------------
  // attachment: attachment file metadata
  // ONLY metadata is extracted (name, contentType, size). The base64
  // content is NOT duplicated here: it is already preserved in
  // raw_attributes (zero-loss principle without redundancy). The size is
  // the base64 content length, without the data URI prefix.
  // ------------------------------------------------------------------
  if (attr.attachment && typeof attr.attachment === 'object') {
    const attachment = {};

    if (attr.attachment.name != null) {
      attachment.name = attr.attachment.name;
    }

    if (attr.attachment.contentType != null) {
      attachment.contentType = attr.attachment.contentType;
    }

    // size: base64 content length (after the "data:...;base64," prefix)
    if (attr.attachment.content != null) {
      attachment.size = base64PayloadLength(attr.attachment.content);
    }

    if (Object.keys(attachment).length > 0) {
      value.attachment = attachment;
    }
  }

  // ------------------------------------------------------------------
  // shape: visual shape of the node
  // ------------------------------------------------------------------
  if (attr.shape != null) {
    value.shape = attr.shape;
  }

  // ------------------------------------------------------------------
  // borderStyle, borderColor, borderWidth: border attributes
  // ------------------------------------------------------------------
  if (attr.borderStyle != null) {
    value.borderStyle = attr.borderStyle;
  }

  if (attr.borderColor != null) {
    value.borderColor = attr.borderColor;
  }

  if (attr.borderWidth !== undefined) {
    value.borderWidth = attr.borderWidth;
  }

  return value;
}

/**
 * Builds a single Attribute record for a node.
 *
 * Combines the extracted typed fields with the complete raw_attributes.
 * raw_attributes is a shallow copy of the original attr so the source object
 * is never mutated.
 *
 * @param {UUID}   nodeId - UUID of the node
 * @param {Object} attr   - Node attr object in the .mup (may be null/undefined)
 * @returns {Attribute} Normalized Attribute record
 */
function buildAttribute(nodeId, attr) {
  /** @type {Object} rawAttr */
  let rawAttr = null;

  if (attr && typeof attr === 'object') {
    // Shallow copy of the original attr - the source is not mutated
    rawAttr = { ...attr };
  }

  const typedValue = attr && typeof attr === 'object'
    ? extractTypedFields(attr)
    : {};

  return {
    attr_id: generateUUID(),
    node_id: nodeId,
    attr_type: 'node_attributes',
    value: typedValue,
    raw_attributes: rawAttr,
  };
}

// ---------------------------------------------------------------------------
// Parallel ideas{} tree walk to extract attr per node
// ---------------------------------------------------------------------------

/**
 * Recursively traverses the .mup ideas{} tree in the same DFS pre-order used
 * by layer2-flatten, and extracts the associated `attr` object for each node.
 *
 * The traversal order must match layer2-flatten exactly so the node to attr
 * correspondence stays 1:1. The same skip rules are applied (invalid entries,
 * typeof !== 'object') to keep the alignment.
 *
 * @param {Object}   ideasTree - ideas object of the current tree level
 * @param {Node[]}   nodes     - Flat node list (from Layer 2)
 * @param {Object}   cursor    - Current index inside the nodes array (mutated
 *   in place through its `value` property)
 * @param {Attribute[]} result - Attribute accumulator array (mutated in place)
 * @returns {void}
 */
function traverseAndExtract(ideasTree, nodes, cursor, result) {
  const keys = Object.keys(ideasTree);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = ideasTree[key];

    // Defensive safety: same filter as layer2-flatten
    // to keep the index synchronized
    if (!value || typeof value !== 'object') {
      continue;
    }

    const node = nodes[cursor.value];
    cursor.value++;

    // Extract the attr of the current node and build the Attribute record
    const attr = value.attr !== undefined ? value.attr : null;
    const attribute = buildAttribute(node.node_id, attr);
    result.push(attribute);

    // Recurse into children when they exist (same logic as layer2)
    const hasIdeas = Object.prototype.hasOwnProperty.call(value, 'ideas');
    const isLeaf =
      !hasIdeas ||
      !value.ideas ||
      typeof value.ideas !== 'object' ||
      Object.keys(value.ideas).length === 0;

    if (!isLeaf) {
      traverseAndExtract(value.ideas, nodes, cursor, result);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Layer 4: Extracts the typed attributes plus raw_attributes from the nodes.
 *
 * Receives the flat node list generated by Layer 2 and the original .mup JSON.
 * For each node that has an `attr` object it extracts the known fields into a
 * typed `value` object and also captures the complete `attr` object as
 * `raw_attributes` to guarantee zero information loss.
 *
 * The rawJson ideas{} tree is traversed in DFS pre-order, synchronized with
 * the order of the flattened nodes, so each node is associated with its
 * original `attr`.
 *
 * Incident #9: the node width (attr.style.width) is extracted as value.width.
 * The icon width (attr.icon.width) is NOT included in the typed fields (it
 * remains accessible through raw_attributes).
 *
 * Attachments: value.attachment contains ONLY metadata (name, contentType,
 * size). The base64 content is not duplicated (it remains in
 * raw_attributes.attachment.content).
 *
 * @param {Node[]} nodes   - Flat node list (from Layer 2: layer2-flatten)
 * @param {Object} rawJson - Complete original .mup JSON (already parsed)
 * @returns {Attribute[]} List of Attribute records, one per node
 *
 * @example
 * const nodes = flattenNodes(rawJson, metadata);
 * const attributes = extractAttributes(nodes, rawJson);
 * // attributes[0] = {
 * //   attr_id: '550e8400-e29b-41d4-a716-446655440000',
 * //   node_id: '550e8400-e29b-41d4-a716-446655440001',
 * //   attr_type: 'node_attributes',
 * //   value: {
 * //     position: { x: -79, y: -24, z: 1 },
 * //     style: { backgroundColor: '#FFCC99' },
 * //     collapsed: true
 * //   },
 * //   raw_attributes: {
 * //     position: [-79, -24, 1],
 * //     style: { backgroundColor: '#FFCC99' },
 * //     collapsed: true
 * //   }
 * // }
 */
export function extractAttributes(nodes, rawJson) {
  /** @type {Attribute[]} */
  const attributes = [];

  if (!nodes || nodes.length === 0) {
    return attributes;
  }

  if (!rawJson || !rawJson.ideas || typeof rawJson.ideas !== 'object') {
    return attributes;
  }

  const cursor = { value: 0 };

  traverseAndExtract(rawJson.ideas, nodes, cursor, attributes);

  return attributes;
}
