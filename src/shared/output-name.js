/**
 * @module output-name
 * Base output filename normalization for converted files.
 *
 * Responsibilities:
 * 1. Replace whitespace sequences (including the non-breaking space U+00A0)
 *    with a hyphen.
 * 2. Transliterate characters outside the basic printable ASCII set to their
 *    ASCII equivalent (for example, the Spanish enye to "n" and accented
 *    vowels to their unaccented form) through Unicode NFD normalization and
 *    removal of combining diacritical marks.
 * 3. Keep only safe characters: unaccented letters, digits, dot, underscore
 *    and hyphen (the extension dot is preserved).
 *
 * The function is pure (same input -> same output), has no side effects and
 * no external dependencies. It does not touch the unique-identifier template
 * (the {uuid} placeholder), which callers manage independently.
 */

// ---------------------------------------------------------------------------
// Normalization regular expressions
// ---------------------------------------------------------------------------

/**
 * Whitespace sequences that are converted to a hyphen.
 *
 * `\s` covers common Unicode spaces, including the non-breaking space U+00A0
 * (spelled out here to document the requirement explicitly). The + quantifier
 * collapses space sequences into a single hyphen.
 *
 * @type {RegExp}
 */
const SPACE_SEQUENCE_REGEX = /[\s\u00A0]+/g;

/**
 * Combining diacritical marks (U+0300-U+036F).
 *
 * After canonical decomposition (NFD), accents and marks above letters become
 * separate combining marks that this expression removes to obtain the ASCII
 * equivalent.
 *
 * @type {RegExp}
 */
const DIACRITIC_MARKS_REGEX = /[\u0300-\u036F]/g;

/**
 * Characters that are not safe for a filename.
 *
 * Safe set preserved: unaccented letters (a-z, A-Z), digits, dot, underscore
 * and hyphen. Everything else is removed.
 *
 * @type {RegExp}
 */
const UNSAFE_CHAR_REGEX = /[^a-zA-Z0-9._-]/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalizes a base name into a safe output name.
 *
 * Applies, in order:
 * 1. Replaces spaces (including U+00A0) with a hyphen.
 * 2. Transliterates accented characters to their ASCII equivalent through
 *    Unicode NFD decomposition and removal of combining diacritical marks.
 * 3. Removes every character outside the safe set [a-zA-Z0-9._-] (the dot is
 *    preserved, including the extension dot).
 *
 * Characters without an ASCII canonical decomposition (for example the German
 * eszett) are removed in step 3 because they are outside the safe set.
 *
 * @param {string} baseName - Base name of the source file.
 * @returns {string} Normalized name with safe characters, or an empty string
 *                   when the input is not a string.
 *
 * @example
 * normalizeOutputName('mapa de ideas.mup') // -> 'mapa-de-ideas.mup'
 * normalizeOutputName('plan\u00A0maestro.mup') // -> 'plan-maestro.mup'
 * normalizeOutputName('Mapa de Ángeles') // -> 'Mapa-de-Angeles'
 * normalizeOutputName('España 2026.mup') // -> 'Espana-2026.mup'
 */
export function normalizeOutputName(baseName) {
  if (typeof baseName !== 'string') return '';

  const withHyphens = baseName.replace(SPACE_SEQUENCE_REGEX, '-');
  const transliterated = withHyphens
    .normalize('NFD')
    .replace(DIACRITIC_MARKS_REGEX, '');

  const safeName = transliterated.replace(UNSAFE_CHAR_REGEX, '');
  // Trim leading and trailing hyphens (for example, ' name ' -> 'name').
  const trimmed = safeName.replace(/^-+|-+$/g, '');

  // User-facing fallback filename, intentionally kept in Spanish by contract.
  return trimmed || 'salida';
}
