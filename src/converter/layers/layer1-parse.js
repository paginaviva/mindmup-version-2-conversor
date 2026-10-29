/**
 * @module layer1-parse
 * Layer 1: Parsing and validation of the .mup file.
 *
 * Responsibilities:
 * 1. Accept the raw .mup JSON (object or string) and normalize it to an object.
 * 2. Validate that formatVersion matches variables.MUP_FORMAT_VERSION.
 * 3. Validate that the ideas object exists and is not empty.
 * 4. Extract metadata: map_id, title, author, created_at, updated_at,
 *    format_version.
 * 5. Return metadata plus the complete rawJson for the following layers.
 *
 * Agnosticism principle (doc 11): absent optional fields do not cause an
 * error, they are simply omitted from the metadata.
 *
 * See the conversion method documentation, Phase 1: parsing the input JSON,
 * and the incident log, Incident #1: different formatVersion.
 */

/**
 * Validates that formatVersion matches the expected version.
 *
 * @param {Object} parsed - Already parsed .mup JSON object
 * @param {Object} variables - Configuration containing MUP_FORMAT_VERSION
 * @returns {void}
 * @throws {Error} When formatVersion does not match
 */
function validateFormatVersion(parsed, variables) {
  const expected = variables.MUP_FORMAT_VERSION;

  if (parsed.formatVersion !== expected) {
    const received = parsed.formatVersion;
    throw new Error(
      `Formato .mup no soportado. Se esperaba versión ${expected}, se recibió ${received}.`
    );
  }
}

/**
 * Validates that the ideas object exists and is not empty.
 *
 * A map without nodes (empty or missing ideas) cannot be converted.
 * The validation rejects: undefined, null, non-object, and objects without keys.
 *
 * @param {Object} parsed - Already parsed .mup JSON object
 * @returns {void}
 * @throws {Error} When ideas is missing, is not an object, or is empty
 */
function validateIdeas(parsed) {
  if (
    !parsed.ideas ||
    typeof parsed.ideas !== 'object' ||
    Object.keys(parsed.ideas).length === 0
  ) {
    throw new Error(
      'El archivo .mup no contiene un objeto ideas válido o está vacío.'
    );
  }
}

/**
 * Converts a UNIX timestamp (seconds) to an ISO 8601 string.
 *
 * Timestamps in the .mup are seconds since the epoch (according to the
 * MupRawInput typedef specification).
 *
 * Tolerance (W6): a malformed optional timestamp (string, NaN, Infinity or
 * outside the range representable by Date) must not abort the conversion.
 * In those cases null is returned and the caller omits the field.
 *
 * @param {number} timestamp - UNIX timestamp in seconds
 * @returns {string|null} ISO 8601 date, or null when it is not valid
 */
function timestampToISO(timestamp) {
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  const date = new Date(timestamp * 1000);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

/**
 * Extracts the available metadata from the parsed .mup object.
 *
 * Fields always extracted:
 *   - map_id: from the .mup id field (typically "root")
 *   - title: map title (empty when absent)
 *   - format_version: format version
 *
 * Optional fields (only when present in the .mup):
 *   - author: map author
 *   - created_at: creation date (converted from UNIX timestamp to ISO 8601;
 *     omitted when the value is not a finite, representable number)
 *   - updated_at: modification date (converted from UNIX timestamp to
 *     ISO 8601; omitted when the value is not a finite, representable number)
 *   - theme: visual theme declared in the .mup root attr
 *   - themeOverrides: theme adjustments (for example, canvas background color)
 *     declared in the .mup root attr
 *
 * @param {Object} parsed - Already parsed .mup JSON object
 * @returns {MapMetadata} Partial metadata object
 */
function extractMetadata(parsed) {
  /** @type {MapMetadata} */
  const metadata = {
    map_id: parsed.id,
    title: parsed.title || '',
    format_version: parsed.formatVersion,
  };

  // Optional fields: included when present, omitted otherwise
  // (agnosticism principle: an absent optional field is not an error)
  if (parsed.author != null) {
    metadata.author = parsed.author;
  }

  // Optional timestamps: when the value is not a finite, representable number
  // the field is omitted without aborting the conversion (W6, agnosticism)
  if (parsed.created != null) {
    const createdAt = timestampToISO(parsed.created);
    if (createdAt !== null) {
      metadata.created_at = createdAt;
    }
  }

  if (parsed.updated != null) {
    const updatedAt = timestampToISO(parsed.updated);
    if (updatedAt !== null) {
      metadata.updated_at = updatedAt;
    }
  }

  // Map theme: theme and themeOverrides are preserved from the root attr
  // when present (agnosticism principle: an absent optional field is not an error)
  if (parsed.attr && typeof parsed.attr === 'object') {
    if (parsed.attr.theme != null) {
      metadata.theme = parsed.attr.theme;
    }

    if (parsed.attr.themeOverrides != null) {
      metadata.themeOverrides = parsed.attr.themeOverrides;
    }
  }

  return metadata;
}

/**
 * Layer 1: Parses and validates the .mup file.
 *
 * Receives the content of a .mup file (either as a parsed JavaScript object
 * or as a JSON string) and performs the essential validations before passing
 * the data to the following converter layers.
 *
 * Validations:
 * - formatVersion must match variables.MUP_FORMAT_VERSION
 * - The ideas object must exist and contain at least one node
 *
 * @param {Object|string} rawJson - .mup JSON (parsed object or string)
 * @param {Object} variables - Configuration object (variables.MUP_FORMAT_VERSION)
 * @returns {{metadata: MapMetadata, rawJson: Object}}
 *   metadata - Metadata extracted from the .mup
 *   rawJson  - The complete .mup object for later layers
 * @throws {Error} When formatVersion does not match the expected version
 * @throws {Error} When ideas is empty, missing, or not an object
 *
 * @example
 * const { metadata, rawJson } = parseMup(mupObject, { MUP_FORMAT_VERSION: 3 });
 * // metadata = { map_id: "root", title: "My map", format_version: 3 }
 * // rawJson = { formatVersion: 3, id: "root", ideas: {...}, ... }
 *
 * With a theme in the root attr:
 * // metadata.theme = "default"
 * // metadata.themeOverrides = { canvas: { backgroundColor: "#efe9e3" } }
 */
export function parseMup(rawJson, variables) {
  // 1. Normalize input: parse strings into an object
  const parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;

  // 2. Validate formatVersion
  validateFormatVersion(parsed, variables);

  // 3. Validate that ideas exists and is not empty
  validateIdeas(parsed);

  // 4. Extract the available metadata
  const metadata = extractMetadata(parsed);

  // 5. Return metadata plus the complete JSON for the following layers
  return {
    metadata,
    rawJson: parsed,
  };
}
