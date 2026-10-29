/**
 * @module layer1-fetch
 * Layer 1: fetch and validate the CMJN JSON document from R2.
 *
 * Responsibilities:
 * 1. Build the R2 object key from the identifier and an injected key template.
 * 2. Fetch the object through the R2 binding passed by the caller.
 * 3. Parse the content as JSON.
 * 4. Validate that the JSON contains the critical collections (metadata and
 *    nodes[]).
 * 5. Return the parsed JSON as a JavaScript object.
 *
 * The key template is injected by the caller because the object prefix and
 * suffix are operational values that come from configuration. This module does
 * not hardcode them.
 *
 * Error handling:
 * - MISSING_KEY_TEMPLATE: The injected key template is missing, empty or does
 *   not contain the {uuid} placeholder.
 * - MISSING_BUCKET_BINDING: The environment does not expose the R2 binding.
 * - NOT_FOUND: The identifier does not exist in R2 (null object).
 * - INVALID_JSON: The content is not valid JSON.
 * - INVALID_STRUCTURE: A critical collection is missing (metadata or nodes[]).
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the R2 object key from an identifier and an injected template.
 *
 * The template must be a non-empty string containing the `{uuid}` placeholder,
 * for example a value loaded from configuration. Every occurrence of the
 * placeholder is replaced with the identifier.
 *
 * @param {string} uuid - Unique identifier of the JSON object in R2.
 * @param {string} keyTemplate - Injected template with the `{uuid}` placeholder.
 * @returns {string} R2 object key.
 * @throws {Error} MISSING_KEY_TEMPLATE — The template is missing, is not a
 *         string, is empty or does not contain the `{uuid}` placeholder.
 *
 * @example
 * buildObjectKey('abc123-def456', '{uuid}') // -> 'abc123-def456'
 */
export function buildObjectKey(uuid, keyTemplate) {
  if (
    typeof keyTemplate !== 'string' ||
    keyTemplate.trim() === '' ||
    !keyTemplate.includes('{uuid}')
  ) {
    throw Object.assign(new Error('MISSING_KEY_TEMPLATE'), {
      code: 'MISSING_KEY_TEMPLATE',
    });
  }

  return keyTemplate.replaceAll('{uuid}', String(uuid));
}

/**
 * Fetches and validates a CMJN JSON document from R2.
 *
 * Builds the object key from the injected template, fetches the object from the
 * R2 binding, parses it as JSON and verifies that it contains the critical
 * collections required by later processing (metadata and nodes[]).
 *
 * @param {string} uuid - Unique identifier of the JSON object in R2.
 * @param {Object} env - Worker bindings (must expose the R2 binding).
 * @param {string} keyTemplate - Injected template with the `{uuid}`
 *   placeholder; the operational value is supplied by configuration.
 * @returns {Promise<Object>} Parsed CMJN JSON document.
 * @throws {Error} MISSING_KEY_TEMPLATE — The key template is missing or invalid.
 * @throws {Error} MISSING_BUCKET_BINDING — The R2 binding is not available.
 * @throws {Error} NOT_FOUND — The identifier does not exist in R2 (null object).
 * @throws {Error} INVALID_JSON — The object content is not valid JSON.
 * @throws {Error} INVALID_STRUCTURE — metadata or nodes[] is missing.
 *
 * @example
 * const json = await fetchJSON('abc123-def456', env, keyTemplate);
 * // json = { metadata: {...}, nodes: [...], notes: [...], ... }
 */
export async function fetchJSON(uuid, env, keyTemplate) {
  const key = buildObjectKey(uuid, keyTemplate);

  if (
    typeof env !== 'object' ||
    env === null ||
    typeof env.MMUP_BUCKET?.get !== 'function'
  ) {
    throw Object.assign(new Error('MISSING_BUCKET_BINDING'), {
      code: 'MISSING_BUCKET_BINDING',
    });
  }

  console.log(JSON.stringify({ level: 'info', action: 'fetch', uuid, key }));

  // 1. Fetch the object from R2.
  const object = await env.MMUP_BUCKET.get(key);
  if (!object) {
    console.log(JSON.stringify({ level: 'error', action: 'fetch', code: 'NOT_FOUND', uuid }));
    throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND', uuid });
  }

  // 2. Parse the content as JSON.
  let json;
  try {
    json = await object.json();
  } catch {
    console.log(JSON.stringify({ level: 'error', action: 'fetch', code: 'INVALID_JSON', uuid }));
    throw Object.assign(new Error('INVALID_JSON'), { code: 'INVALID_JSON', uuid });
  }

  // 3. Validate the critical collections.
  if (!json.metadata || !Array.isArray(json.nodes)) {
    console.log(JSON.stringify({ level: 'error', action: 'fetch', code: 'INVALID_STRUCTURE', uuid }));
    throw Object.assign(new Error('INVALID_STRUCTURE'), { code: 'INVALID_STRUCTURE', uuid });
  }

  console.log(JSON.stringify({
    level: 'info',
    action: 'fetch_complete',
    uuid,
    nodeCount: json.nodes.length,
  }));

  return json;
}
