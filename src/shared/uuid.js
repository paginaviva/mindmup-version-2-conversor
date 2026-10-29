/**
 * @module uuid
 * Shared UUID v4 generation for every layer of the converter.
 *
 * Responsibilities:
 * 1. Prefer the runtime's crypto.randomUUID() when it is available.
 * 2. Fall back to a manual RFC 4122 §4.4 implementation for runtimes without
 *    crypto.randomUUID (older Node.js versions, some test runners, etc.).
 * 3. Be the single source of generateUUID: layers that need UUIDs import this
 *    module instead of duplicating the implementation.
 *
 * Modularity principle: one definition, zero duplication between layers.
 */

/**
 * Generates a UUID v4 compatible with RFC 4122.
 *
 * Prefers the runtime's crypto.randomUUID(). Falls back to a manual
 * implementation for runtimes without crypto.randomUUID (older Node.js
 * versions, test runners, Cloudflare Workers with limited compatibility, etc.).
 *
 * @returns {string} UUID v4 in the form xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
 *
 * @example
 * generateUUID() // -> '550e8400-e29b-41d4-a716-446655440000'
 */
export function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // UUID v4 fallback according to RFC 4122 §4.4.
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // where x is random and y is random with the 10xx bits.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    const value = character === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}
