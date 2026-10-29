/**
 * @module layer2-flatten
 * Layer 2: Recursive flattening of the ideas{} tree into a flat node list.
 *
 * Responsibilities:
 * 1. Recursively traverse the .mup ideas{} tree depth-first (DFS pre-order).
 * 2. Assign a unique UUID to each node through crypto.randomUUID().
 * 3. Assign parent_id based on the parent node (null for the root).
 * 4. Assign depth (0 for the root, 1 for children, etc.).
 * 5. Assign path as an array of UUIDs from the root down to the node.
 * 6. Assign sibling_order within the same parent (Object.keys order).
 * 7. Preserve the original sort_key (the key inside ideas{}).
 * 8. Identify is_leaf (true when it has no children or ideas is empty).
 * 9. Preserve the node original_id (the .mup id field).
 * 10. Handle nodes without a title (title: undefined) - Incident #5.
 *
 * Agnosticism principle: this layer does NOT inspect node values
 * (titles, attr, etc.). It only walks the tree structure and assigns
 * identifiers.
 *
 * See the conversion method documentation, Phase 2: recursive node flattening,
 * the incident log (Incident #1: keys as strings, #5: nodes without a title)
 * and the normalized schema, nodes collection.
 */
import { generateUUID } from '../../shared/uuid.js';

// ---------------------------------------------------------------------------
// Recursive tree traversal
// ---------------------------------------------------------------------------

/**
 * Recursively traverses the ideas{} tree in DFS pre-order and accumulates
 * flat nodes into the `nodes` array.
 *
 * For each entry of the ideas object it creates a Node record with:
 * - Unique UUID (node_id)
 * - map_id of the containing map
 * - parent_id of the parent node (null for the root node)
 * - sort_key as a string of the original key (Incident #1: do not convert to number)
 * - title as-is from the node (Incident #5: it may be undefined)
 * - depth (0 for the root, incremented at every level)
 * - sibling_order (position within the same parent)
 * - path as an array of UUIDs from the root down to the current node
 * - original_id from the .mup id field (string, empty when absent)
 * - is_leaf (true when it has no children or ideas is empty)
 *
 * Traversal order follows Object.keys(), which preserves the insertion order
 * of the properties in the original .mup ideas object.
 *
 * @param {Object}   ideasTree  - ideas object of the current tree level
 * @param {UUID|null} parentId  - UUID of the parent node (null for the root)
 * @param {number}   depth      - Depth in the tree (0 = root)
 * @param {UUID[]}   pathPrefix - Array of UUIDs from the root down to the parent
 * @param {UUID}     mapId      - UUID of the containing map
 * @param {Node[]}   nodes      - Accumulator array (mutated in place)
 * @returns {void}
 */
function traverseIdeas(ideasTree, parentId, depth, pathPrefix, mapId, nodes) {
  const keys = Object.keys(ideasTree);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = ideasTree[key];

    // Defensive safety: skip invalid entries
    // (null, undefined, primitive types - should not occur in valid .mup files)
    if (!value || typeof value !== 'object') {
      continue;
    }

    const nodeId = generateUUID();

    // Leaf detection: no ideas field, ideas is not an object,
    // or ideas is an empty object
    const hasIdeas = Object.prototype.hasOwnProperty.call(value, 'ideas');
    const isLeaf =
      !hasIdeas ||
      !value.ideas ||
      typeof value.ideas !== 'object' ||
      Object.keys(value.ideas).length === 0;

    /** @type {Node} */
    const node = {
      node_id: nodeId,
      map_id: mapId,
      parent_id: parentId,
      sort_key: String(key),
      title: value.title, // Incident #5: it may be undefined
      depth: depth,
      sibling_order: i,
      path: [...pathPrefix, nodeId],
      original_id: value.id !== undefined ? String(value.id) : '',
      is_leaf: isLeaf,
    };

    nodes.push(node);

    // Process children recursively (only when there are non-empty child nodes)
    if (!isLeaf) {
      traverseIdeas(
        value.ideas,
        nodeId,
        depth + 1,
        node.path, // current path as the base for the children
        mapId,
        nodes
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Layer 2: Flattens the ideas{} tree into a flat node list.
 *
 * Receives the complete .mup JSON (already parsed and validated by Layer 1)
 * and the map metadata. It recursively traverses the ideas{} tree depth-first
 * (DFS pre-order), producing one flat node per tree element.
 *
 * The MindMup ideas{} tree uses keys that encode hierarchy and order:
 * - Integers (1, 2, 3) for root nodes
 * - Decimals (0.75, 0.875) for binary fractions between siblings
 * - Composite keys (105.8ae948...) for nodes created by map merges
 * All of them are preserved as strings in sort_key without information loss.
 *
 * @param {Object}       rawJson  - Complete .mup JSON (already parsed object)
 * @param {MapMetadata}  metadata - Map metadata (generated by Layer 1)
 * @param {string}       [ideasKey='ideas'] - Key of the ideas tree inside
 *   rawJson (variables.MUP_KEY_IDEAS). Falls back to 'ideas' when missing or
 *   not a string
 * @returns {Node[]} Flat list of nodes in DFS pre-order
 *
 * @example
 * const { metadata, rawJson } = parseMup(mupData, variables);
 * const nodes = flattenNodes(rawJson, metadata);
 * // nodes[0] = {
 * //   node_id: '550e8400-e29b-41d4-a716-446655440000',
 * //   map_id: 'root',
 * //   parent_id: null,
 * //   sort_key: '1',
 * //   title: 'Root node',
 * //   depth: 0,
 * //   sibling_order: 0,
 * //   path: ['550e8400-e29b-41d4-a716-446655440000'],
 * //   original_id: '',
 * //   is_leaf: false
 * // }
 */
export function flattenNodes(rawJson, metadata, ideasKey = 'ideas') {
  const mapId = metadata.map_id;
  // Configurable key (MUP_KEY_IDEAS) with an 'ideas' fallback
  const key = ideasKey || 'ideas';
  const ideasTree = rawJson[key]; // Guaranteed by Layer 1 validation

  /** @type {Node[]} */
  const nodes = [];

  traverseIdeas(ideasTree, null, 0, [], mapId, nodes);

  return nodes;
}
