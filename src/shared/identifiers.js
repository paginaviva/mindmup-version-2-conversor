/**
 * @module identifiers
 * Validation of map identifiers (object keys in R2).
 *
 * Responsibilities:
 * 1. Define the single pattern for valid identifiers (allow list).
 * 2. Reject values made up only of dots ('.', '..', '...'), which pass the
 *    character allow list but are special path components.
 * 3. Expose isValidIdentifier() to validate at system boundaries (HTTP Worker
 *    and Durable Object) before building R2 keys or internal paths.
 *
 * The identifier derives from the R2 object key, which is untrusted data: it
 * can contain '/', '..', quotes or HTML. The allow list prevents path traversal
 * and injection into selectors or HTML.
 *
 * Principle: pure function, no dependencies.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Pattern for valid identifiers.
 *
 * Allow list: 1 to 200 characters of [A-Za-z0-9._-]. Excludes '/', '\', spaces,
 * quotes, '<', '>', ';', '%' and any other special character.
 *
 * Note: this pattern only defines the allowed characters. Rejecting values made
 * up only of dots is handled by isValidIdentifier(), which is the validation
 * entry point.
 *
 * @type {RegExp}
 */
export const IDENTIFIER_PATTERN = /^[A-Za-z0-9._-]{1,200}$/;

/**
 * Pattern for strings made up only of dots ('.', '..', '...').
 *
 * They pass the character allow list, but '.' is the current directory and '..'
 * is the parent directory: they are rejected to prevent path traversal when
 * building object keys or internal paths.
 *
 * @private
 * @type {RegExp}
 */
const DOT_ONLY_PATTERN = /^\.+$/;

/**
 * Validates whether a value is a valid map identifier.
 *
 * Accepts only strings that satisfy IDENTIFIER_PATTERN and are not made up only
 * of dots ('.', '..', '...'). Any other type (number, object, null, undefined)
 * is rejected without coercion.
 *
 * @param {*} value - Value to validate (a string is expected).
 * @returns {boolean} true when it is a valid identifier, false otherwise.
 *
 * @example
 * isValidIdentifier('example-map')             // -> true
 * isValidIdentifier('map.v1_final-2026')       // -> true
 * isValidIdentifier('../secret')               // -> false
 * isValidIdentifier('..')                      // -> false (dots only)
 * isValidIdentifier('<script>alert(1)</script>') // -> false
 * isValidIdentifier(123)                       // -> false (not a string)
 */
export function isValidIdentifier(value) {
  return (
    typeof value === 'string' &&
    !DOT_ONLY_PATTERN.test(value) &&
    IDENTIFIER_PATTERN.test(value)
  );
}
