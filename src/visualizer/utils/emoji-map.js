/**
 * @module emoji-map
 * Sticker-to-Unicode-emoji conversion utilities.
 *
 * Responsibilities:
 * 1. Equivalence table: hexadecimal code -> Unicode emoji (O(1) lookup).
 * 2. convertEmoji: turns the "emoji:XXXX" format into a Unicode emoji.
 * 3. convertStickers: turns a sticker array into an emoji string.
 * 4. Fallback: when the emoji is not in the table, try a hexadecimal to
 *    Unicode conversion.
 * 5. If the conversion fails, return the original code.
 *
 * Principle: reusable module, independent from the visualizer. It can be shared
 * by other projects that need sticker conversion.
 *
 * The table can grow as new stickers are found in the JSON documents.
 */

// ---------------------------------------------------------------------------
// Equivalence table: hexadecimal code -> Unicode emoji
// ---------------------------------------------------------------------------

/**
 * Equivalence table: hexadecimal code -> Unicode emoji.
 *
 * Each key is an uppercase hexadecimal code (without the "0x" prefix). Each
 * value is the corresponding Unicode character.
 *
 * The table can grow as new stickers are found in the JSON documents. If a
 * sticker is not in the table, the module tries a direct conversion with
 * String.fromCodePoint as a fallback.
 *
 * @type {Object<string, string>}
 */
const EMOJI_MAP = {
  // Maps and location
  '1F5FA': '🗺️', // World map
  '1F4CD': '📍', // Round pin
  '1F6A9': '🚩', // Triangular flag

  // Ideas and creativity
  '1F4A1': '💡', // Light bulb
  '1F9E0': '🧠', // Brain
  '1F3AF': '🎯', // Bullseye

  // Documents and notes
  '1F4CC': '📌', // Pushpin
  '1F4DD': '📝', // Memo
  '1F4C4': '📄', // Page
  '1F4CB': '📋', // Clipboard
  '1F4C1': '📁', // Folder

  // Numbers and symbols
  '2705': '✅', // Check mark
  '274C': '❌', // Red cross
  '26A0': '⚠️', // Warning
  '2757': '❗', // Red exclamation mark
  '2753': '❓', // Red question mark

  // People and gestures
  '1F464': '👤', // Bust silhouette
  '1F465': '👥', // Busts silhouette
  '1F44D': '👍', // Thumbs up
  '1F44E': '👎', // Thumbs down

  // Common objects
  '1F517': '🔗', // Link
  '1F512': '🔒', // Closed lock
  '1F513': '🔓', // Open lock
  '1F511': '🔑', // Key
  '2B50': '⭐', // Star

  // Technology
  '1F4BB': '💻', // Laptop
  '1F4F1': '📱', // Mobile phone
  '1F4E7': '📧', // Email
  '1F310': '🌐', // Globe with meridians

  // Nature
  '1F331': '🌱', // Seedling
  '1F333': '🌳', // Tree
  '1F33A': '🌺', // Flower
  '2600': '☀️', // Sun
  '2601': '☁️', // Cloud

  // Food
  '1F34E': '🍎', // Red apple
  '1F34F': '🍏', // Green apple
  '2615': '☕', // Hot beverage

  // Animals
  '1F436': '🐶', // Dog
  '1F431': '🐱', // Cat

  // Miscellaneous symbols
  '2764': '❤️', // Red heart
  '1F4AF': '💯', // Hundred points
  '1F525': '🔥', // Fire
  '2728': '✨', // Sparkles
  '1F389': '🎉', // Party popper

  // Science and education
  '1F52C': '🔬', // Microscope
  '1F52D': '🔭', // Telescope
  '1F4DA': '📚', // Books
  '1F393': '🎓', // Graduation cap

  // Communication and collaboration (extended)
  '1F680': '🚀', // Rocket
  '1F4AC': '💬', // Speech balloon
  '1F504': '🔄', // Counterclockwise arrows
  '1F4CA': '📊', // Bar chart
  '1F4C5': '📅', // Calendar
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Converts a sticker in "emoji:XXXX" format to its Unicode character.
 *
 * The sticker format is "emoji:" followed by one or more hexadecimal codes
 * separated by spaces (for example "emoji:1F5FA", "emoji:0032 20E3",
 * "emoji:1F469 1F3FB").
 *
 * Resolution order:
 * 1. Look up the full key in the EMOJI_MAP table (O(1) lookup).
 * 2. Look up the key without the variation selector (U+FE0F) so variants with
 *    and without VS16 match the table (for example, "emoji:2764 FE0F" -> '❤️').
 * 3. Convert each code point with String.fromCodePoint and concatenate,
 *    filtering invalid codes (NaN, negative, > 0x10FFFF, or surrogate code
 *    points U+D800-U+DFFF that would produce orphan surrogate pairs).
 *
 * If the conversion fails (no valid code point), return the original sticker.
 * If the sticker does not use the "emoji:" format, return it unchanged. If the
 * parameter is not a string, convert it with String().
 *
 * @param {string} sticker - Sticker in "emoji:XXXX" format or plain text.
 * @returns {string} Unicode emoji character, or the original sticker when it
 *                   cannot be converted.
 *
 * @example
 * convertEmoji('emoji:1F5FA')         // -> '🗺️'
 * convertEmoji('emoji:2764')          // -> '❤️'
 * convertEmoji('emoji:2764 FE0F')     // -> '❤️' (normalized variation selector)
 * convertEmoji('emoji:0032 20E3')     // -> '2️⃣' (keycap, two code points)
 * convertEmoji('emoji:1F469 1F3FB')   // -> '👩🏻' (woman with light skin tone)
 * convertEmoji('emoji:110000')        // -> 'emoji:110000' (out-of-range code, fallback)
 * convertEmoji('plain text')          // -> 'plain text'
 * convertEmoji(123)                   // -> '123'
 */
export function convertEmoji(sticker) {
  if (typeof sticker !== 'string') return String(sticker);

  if (sticker.startsWith('emoji:')) {
    const rawCodes = sticker.replace('emoji:', '').trim().toUpperCase();

    // 1. Exact key in the table.
    if (EMOJI_MAP[rawCodes]) {
      return EMOJI_MAP[rawCodes];
    }

    // 2. Key without the variation selector (U+FE0F): normalizes
    //    "2764 FE0F" -> "2764".
    const withoutVariation = rawCodes.replace(/\s*FE0F\s*/g, '').trim();
    if (EMOJI_MAP[withoutVariation]) {
      return EMOJI_MAP[withoutVariation];
    }

    // 3. Direct conversion by code point (supports multiple codes).
    const emoji = rawCodes
      .split(/\s+/)
      .filter((hex) => hex.length > 0)
      .map((hex) => parseInt(hex, 16))
      .filter((codePoint) =>
        Number.isInteger(codePoint) &&
        codePoint >= 0 &&
        codePoint <= 0x10ffff &&
        !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      )
      .map((codePoint) => String.fromCodePoint(codePoint))
      .join('');

    if (emoji.length > 0) {
      // Normalize keycaps: the canonical form is base + U+FE0F + U+20E3
      // (for example "2️⃣" = 0x32 0xFE0F 0x20E3). If the sequence ends in
      // U+20E3 without a preceding U+FE0F, insert the variation selector.
      if (emoji.endsWith('\u20e3') && !emoji.endsWith('\ufe0f\u20e3')) {
        return emoji.slice(0, -1) + '\ufe0f\u20e3';
      }
      return emoji;
    }

    // No valid code point: return the original sticker as a fallback.
    return sticker;
  }

  // If it does not use the "emoji:" format, return it unchanged.
  return sticker;
}

/**
 * Converts a sticker array into a space-separated emoji string.
 *
 * Applies convertEmoji() to each array element and joins the results with a
 * space. If the array is empty or is not an array, returns an empty string.
 *
 * @param {string[]} stickers - Sticker array in "emoji:XXXX" format.
 * @returns {string} Space-separated Unicode emojis, or an empty string when
 *                   there are no stickers.
 *
 * @example
 * convertStickers(['emoji:1F5FA', 'emoji:2764'])  // -> '🗺️ ❤️'
 * convertStickers(['emoji:1F4A1'])                 // -> '💡'
 * convertStickers([])                              // -> ''
 * convertStickers(null)                            // -> ''
 */
export function convertStickers(stickers) {
  if (!Array.isArray(stickers) || stickers.length === 0) return '';
  return stickers.map(convertEmoji).join(' ');
}
