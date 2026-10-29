/**
 * @module validator
 * Input validator for .mup files uploaded through multipart/form-data.
 *
 * Provides the chained validations used by the conversion endpoint:
 * 1. Request Content-Type.
 * 2. Maximum body size (Content-Length, before parsing the form).
 * 3. File extracted from the form data (presence, extension, minimum size).
 * 4. Maximum file size (before reading its contents).
 * 5. JSON content of the .mup file (format and required fields).
 *
 * It also exposes isValidUUID() for status and download routes.
 *
 * Upload limits are always injected by the caller. This module does not import
 * configuration defaults and does not hardcode operational limits, so callers
 * can source them from the application configuration.
 *
 * @see ./uuid.js - generateUUID(), reference format for isValidUUID()
 */

// Unit-conversion constants used only to format human-readable messages.
const BYTES_PER_KILOBYTE = 1024;
const BYTES_PER_MEGABYTE = BYTES_PER_KILOBYTE * 1024;

/**
 * Formats a byte count for human-readable error messages.
 *
 * @param {number} bytes - Size in bytes.
 * @returns {string} Human-readable size (for example "10 MB", "512 KB" or "1024 bytes").
 */
function formatBytes(bytes) {
  if (bytes >= BYTES_PER_MEGABYTE) {
    const megabytes = bytes / BYTES_PER_MEGABYTE;
    return `${Number.isInteger(megabytes) ? megabytes : megabytes.toFixed(1)} MB`;
  }
  if (bytes >= BYTES_PER_KILOBYTE) {
    return `${Math.round(bytes / BYTES_PER_KILOBYTE)} KB`;
  }
  return `${bytes} bytes`;
}

/**
 * Asserts that an injected byte limit is a non-negative integer.
 *
 * Throws an explicit error naming the missing or invalid value instead of
 * falling back to a silent default.
 *
 * @param {number} value - Injected byte limit.
 * @param {string} name - Configuration key name used in the error message.
 * @returns {void}
 */
function assertByteLimit(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`El límite "${name}" debe ser un entero no negativo`);
  }
}

/**
 * Validates that the request Content-Type is multipart/form-data.
 *
 * @param {Request} request - Incoming HTTP request.
 * @returns {string|null} null when valid, Spanish error message otherwise.
 */
export function validateContentType(request) {
  const contentType = request.headers.get('Content-Type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return 'Solo se acepta multipart/form-data';
  }
  return null;
}

/**
 * Validates the maximum body size using the Content-Length header.
 *
 * Runs before parsing the multipart form so bodies above the limit are not
 * materialized in memory. If the header is unavailable (for example, requests
 * with chunked transfer encoding), it returns null and validateFileSize()
 * performs the check after the file is extracted.
 *
 * Note: Content-Length includes multipart overhead (boundaries and headers),
 * so the limit is slightly conservative.
 *
 * @param {Request} request - Incoming HTTP request.
 * @param {number} maxBytes - Injected maximum allowed size in bytes.
 * @returns {string|null} null when valid, Spanish error message otherwise.
 * @throws {TypeError} When maxBytes is not a non-negative integer.
 */
export function validateContentLength(request, maxBytes) {
  assertByteLimit(maxBytes, 'maxBytes');

  const rawLength = request.headers.get('Content-Length');
  if (rawLength === null || rawLength === '') return null;

  const length = Number(rawLength);
  if (!Number.isFinite(length) || length <= 0) return null;

  if (length > maxBytes) {
    return `El cuerpo de la petición supera el tamaño máximo permitido (${formatBytes(maxBytes)})`;
  }
  return null;
}

/**
 * Validates the file extracted from the multipart form.
 *
 * Checks that:
 * - The file exists (is not null).
 * - The name ends in .mup.
 * - The size is within the injected minimum and maximum limits.
 *
 * Limits are required for a file that passes the presence and extension
 * checks. Missing limits raise an explicit error rather than using defaults.
 *
 * @param {File|null} file - File obtained through formData.get('file').
 * @param {{minUploadBytes: number, maxUploadBytes: number}} [limits] - Injected
 *        upload limits in bytes.
 * @returns {string|null} null when valid, Spanish error message otherwise.
 * @throws {TypeError} When the injected limits are missing or invalid.
 */
export function validateFile(file, limits = {}) {
  if (!file) {
    return 'No se envió ningún archivo';
  }

  if (!file.name || !file.name.toLowerCase().endsWith('.mup')) {
    return 'El archivo debe tener extensión .mup';
  }

  const { minUploadBytes, maxUploadBytes } = limits ?? {};
  assertByteLimit(minUploadBytes, 'minUploadBytes');
  assertByteLimit(maxUploadBytes, 'maxUploadBytes');

  if (file.size < minUploadBytes) {
    return `El archivo está vacío o es demasiado pequeño (mínimo ${formatBytes(minUploadBytes)})`;
  }

  if (file.size > maxUploadBytes) {
    return `El archivo supera el tamaño máximo permitido (${formatBytes(maxUploadBytes)})`;
  }

  return null;
}

/**
 * Validates the maximum size of a file already extracted from the form.
 *
 * Runs before file.text() so files above the limit are not read into memory.
 * Complements validateContentLength() when the Content-Length header is not
 * available.
 *
 * @param {File|null} file - File obtained from the form data.
 * @param {number} maxBytes - Injected maximum allowed size in bytes.
 * @returns {string|null} null when valid, Spanish error message otherwise.
 * @throws {TypeError} When maxBytes is not a non-negative integer and a file
 *         with a numeric size is provided.
 */
export function validateFileSize(file, maxBytes) {
  if (!file || typeof file.size !== 'number') return null;

  assertByteLimit(maxBytes, 'maxBytes');

  if (file.size > maxBytes) {
    return `El archivo supera el tamaño máximo permitido (${formatBytes(maxBytes)})`;
  }
  return null;
}

/**
 * Validates the JSON content of the .mup file (basic structural validation).
 *
 * Checks that:
 * - The text is valid JSON.
 * - The required `formatVersion` field exists.
 * - The required `ideas` field (node tree) exists.
 *
 * @param {string} text - Full .mup file content as text.
 * @returns {{valid: boolean, error?: string}} Validation result.
 */
export function validateMupContent(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { valid: false, error: 'El archivo no contiene un JSON válido' };
  }

  if (json.formatVersion === undefined || json.formatVersion === null) {
    return { valid: false, error: 'Falta el campo obligatorio formatVersion' };
  }

  if (!json.ideas) {
    return { valid: false, error: 'Falta el árbol de nodos (ideas)' };
  }

  return { valid: true };
}

// ---------------------------------------------------------------------------
// Identifier validation
// ---------------------------------------------------------------------------

/**
 * UUID v4 format produced by ./uuid.js (RFC 4122 §4.4):
 * `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`, with y in [89ab].
 * @type {RegExp}
 */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Checks whether an identifier is a valid UUID v4.
 *
 * Used by status and download routes to reject malformed identifiers with 400
 * before querying the durable object or R2.
 *
 * @param {*} value - Value to validate.
 * @returns {boolean} true when the value is a UUID v4 in generateUUID() format.
 */
export function isValidUUID(value) {
  return typeof value === 'string' && UUID_V4_REGEX.test(value);
}
