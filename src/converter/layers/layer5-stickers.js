/**
 * @module layer5-stickers
 * Layer 5: Extraction of stickers (emojis) from nodes.
 *
 * Responsibilities:
 * 1. Walk the flattened nodes and the original JSON to extract stickers from
 *    `attr.stickers` and `attr.styles.stickers`.
 * 2. Normalize emoji codes to their visual Unicode representation, including
 *    emojis with multiple code points (for example "emoji:1F469 1F3FB").
 * 3. Classify each sticker into its category according to STICKER_CATEGORIES,
 *    normalizing variation selectors (U+FE0F) and skin tones so they match the
 *    catalogue keys.
 * 4. Assign the "unknown" category to undocumented stickers (Incident #6).
 * 5. Support multiple formats: attr.stickers (array of objects, object keyed by
 *    emoji, or array of strings with the "emoji:" prefix — the real MindMup v3
 *    format) and attr.styles.stickers (array of strings).
 *
 * Agnosticism principle: any unrecognized emoji code receives the "unknown"
 * category — an unknown sticker never raises an error.
 *
 * @see ../../shared/uuid.js - Shared UUID v4 generation
 */

import { generateUUID } from '../../shared/uuid.js';

// ---------------------------------------------------------------------------
// Known sticker categories
// ---------------------------------------------------------------------------

/**
 * Map of emoji codes (Unicode characters) to semantic categories.
 *
 * Covers 35 categories and 894 emojis (a single entry per normalized key:
 * no variation selectors or duplicated skin tones). Any emoji that is not in
 * this map receives the default category (by default "unknown", tolerance
 * principle).
 *
 * The absence of duplicated normalized keys is checked at module load: if
 * an entry that collides is added, loading fails with a message that identifies
 * the key instead of depending on map order.
 *
 * The map is updated manually when new Unicode emoji appear.
 *
 * @type {Map<string, string>}
 */
const STICKER_CATEGORIES = new Map([
  // --- smiley: faces and facial expressions ---
  ['😀', 'smiley'], ['😃', 'smiley'], ['😄', 'smiley'],
  ['😁', 'smiley'], ['😆', 'smiley'], ['🙂', 'smiley'],
  ['🙃', 'smiley'], ['😉', 'smiley'], ['😊', 'smiley'],
  ['😇', 'smiley'], ['🥰', 'smiley'], ['😍', 'smiley'],
  ['🤩', 'smiley'], ['😘', 'smiley'], ['😗', 'smiley'],
  ['😚', 'smiley'], ['😋', 'smiley'], ['😛', 'smiley'],
  ['😜', 'smiley'], ['🤪', 'smiley'], ['😝', 'smiley'],
  ['🤑', 'smiley'], ['🤗', 'smiley'], ['🤭', 'smiley'],
  ['🤫', 'smiley'], ['🤔', 'smiley'], ['🤐', 'smiley'],
  ['🤨', 'smiley'], ['😐', 'smiley'], ['😑', 'smiley'],
  ['😶', 'smiley'], ['😏', 'smiley'], ['😒', 'smiley'],
  ['🙄', 'smiley'], ['😬', 'smiley'], ['🤥', 'smiley'],
  ['😌', 'smiley'], ['😔', 'smiley'], ['😪', 'smiley'],
  ['🤤', 'smiley'], ['😴', 'smiley'], ['😷', 'smiley'],
  ['🤒', 'smiley'], ['🤕', 'smiley'], ['🤢', 'smiley'],
  ['🤮', 'smiley'], ['🥴', 'smiley'], ['😵', 'smiley'],
  ['🤯', 'smiley'], ['🤠', 'smiley'],
  ['😎', 'smiley'], ['🤓', 'smiley'], ['🧐', 'smiley'],
  ['😕', 'smiley'], ['😟', 'smiley'], ['🙁', 'smiley'],
  ['😮', 'smiley'], ['😯', 'smiley'], ['😲', 'smiley'],
  ['😳', 'smiley'], ['🥺', 'smiley'], ['😢', 'smiley'],
  ['😭', 'smiley'], ['😤', 'smiley'], ['😠', 'smiley'],
  ['😡', 'smiley'], ['🤬', 'smiley'], ['💀', 'smiley'],
  ['☠️', 'smiley'], ['💩', 'smiley'], ['🤡', 'smiley'],
  ['👻', 'smiley'], ['👽', 'smiley'],
  ['😈', 'smiley'],

  // --- heart: hearts and affection symbols ---
  ['❤️', 'heart'], ['🧡', 'heart'], ['💛', 'heart'],
  ['💚', 'heart'], ['💙', 'heart'], ['💜', 'heart'],
  ['🖤', 'heart'], ['🤍', 'heart'], ['🤎', 'heart'],
  ['💔', 'heart'], ['❣️', 'heart'], ['💕', 'heart'],
  ['💞', 'heart'], ['💓', 'heart'], ['💗', 'heart'],
  ['💖', 'heart'], ['💘', 'heart'], ['💝', 'heart'],
  ['💟', 'heart'],

  // --- gesture: hand and arm gestures ---
  ['👍', 'gesture'], ['👎', 'gesture'], ['👊', 'gesture'],
  ['✊', 'gesture'], ['🤛', 'gesture'], ['🤜', 'gesture'],
  ['👏', 'gesture'], ['🙌', 'gesture'], ['👐', 'gesture'],
  ['🤲', 'gesture'], ['🤝', 'gesture'], ['🙏', 'gesture'],
  ['✌️', 'gesture'], ['🤞', 'gesture'], ['🤟', 'gesture'],
  ['🤘', 'gesture'], ['🤙', 'gesture'], ['👈', 'gesture'],
  ['👉', 'gesture'], ['👆', 'gesture'], ['🖕', 'gesture'],
  ['👇', 'gesture'], ['☝️', 'gesture'], ['✋', 'gesture'],
  ['🤚', 'gesture'], ['🖐️', 'gesture'], ['🖖', 'gesture'],
  ['👌', 'gesture'], ['🤏', 'gesture'], ['💪', 'gesture'],
  ['🦾', 'gesture'], ['🦵', 'gesture'], ['🦶', 'gesture'],
  ['👣', 'gesture'], ['👀', 'gesture'], ['👁️', 'gesture'],
  ['🧠', 'gesture'], ['🫀', 'gesture'], ['🫁', 'gesture'],

  // --- office: office supplies and stationery ---
  ['📌', 'office'], ['📍', 'office'], ['📎', 'office'],
  ['✂️', 'office'], ['✏️', 'office'], ['✒️', 'office'],
  ['🖊️', 'office'], ['🖋️', 'office'], ['🖌️', 'office'],
  ['🖍️', 'office'], ['📏', 'office'], ['📐', 'office'],
  ['📁', 'office'], ['📂', 'office'], ['🗂️', 'office'],
  ['📅', 'office'], ['📆', 'office'], ['📋', 'office'],
  ['📉', 'office'], ['📊', 'office'], ['📈', 'office'],
  ['🗒️', 'office'], ['🗓️', 'office'],
  ['🖇️', 'office'],
  ['🗄', 'office'], ['🗃', 'office'],

  // --- symbol: symbols, signs and indicators ---
  ['✅', 'symbol'], ['❌', 'symbol'], ['❗', 'symbol'],
  ['❓', 'symbol'], ['➖', 'symbol'], ['➕', 'symbol'],
  ['❕', 'symbol'], ['❔', 'symbol'], ['✔️', 'symbol'],
  ['✖️', 'symbol'], ['➗', 'symbol'], ['♻️', 'symbol'],
  ['💡', 'symbol'],
  ['🛡️', 'symbol'], ['🎯', 'symbol'],
  ['🔝', 'symbol'], ['🔜', 'symbol'], ['🔛', 'symbol'],
  ['🔙', 'symbol'], ['🔚', 'symbol'], ['🔃', 'symbol'],
  ['🔄', 'symbol'], ['🔁', 'symbol'], ['🔂', 'symbol'],
  ['🆗', 'symbol'], ['🆕', 'symbol'],
  ['🆙', 'symbol'], ['🆒', 'symbol'], ['🆓', 'symbol'],
  ['🆔', 'symbol'], ['🉐', 'symbol'], ['🈹', 'symbol'],
  ['🈵', 'symbol'], ['🉑', 'symbol'], ['🈶', 'symbol'],
  ['🈚', 'symbol'], ['🈸', 'symbol'], ['🈺', 'symbol'],
  ['🈷️', 'symbol'], ['🈴', 'symbol'], ['🈳', 'symbol'],
  ['🈲', 'symbol'], ['🚫', 'symbol'], ['⛔', 'symbol'],
  ['❇️', 'symbol'], ['✳️', 'symbol'], ['❎', 'symbol'],
  ['🌐', 'symbol'], ['🌀', 'symbol'],
  ['⬅', 'symbol'], ['⬆', 'symbol'], ['⬇', 'symbol'], ['↩', 'symbol'], ['↙', 'symbol'], ['🔗', 'symbol'],
  ['☑', 'symbol'], ['✴', 'symbol'],

  // --- nature: nature, animals and plants ---
  ['🐶', 'nature'], ['🐱', 'nature'], ['🐭', 'nature'], ['🐪', 'nature'],
  ['🐹', 'nature'], ['🐰', 'nature'], ['🦊', 'nature'],
  ['🐻', 'nature'], ['🐼', 'nature'], ['🐨', 'nature'],
  ['🐯', 'nature'], ['🦁', 'nature'], ['🐮', 'nature'],
  ['🐷', 'nature'], ['🐸', 'nature'], ['🐵', 'nature'],
  ['🐔', 'nature'], ['🐧', 'nature'], ['🐦', 'nature'],
  ['🐤', 'nature'], ['🦆', 'nature'], ['🦅', 'nature'],
  ['🦉', 'nature'], ['🦇', 'nature'], ['🐺', 'nature'],
  ['🐗', 'nature'], ['🐴', 'nature'], ['🦄', 'nature'],
  ['🐝', 'nature'], ['🐛', 'nature'], ['🦋', 'nature'],
  ['🐌', 'nature'], ['🐞', 'nature'], ['🐜', 'nature'],
  ['🦟', 'nature'], ['🦗', 'nature'], ['🦂', 'nature'],
  ['🐢', 'nature'], ['🐍', 'nature'], ['🦎', 'nature'],
  ['🦖', 'nature'], ['🦕', 'nature'], ['🐙', 'nature'],
  ['🦑', 'nature'], ['🦐', 'nature'], ['🦀', 'nature'],
  ['🐡', 'nature'], ['🐠', 'nature'], ['🐟', 'nature'],
  ['🐬', 'nature'], ['🐳', 'nature'], ['🐋', 'nature'],
  ['🦈', 'nature'], ['💐', 'nature'],
  ['🌸', 'nature'], ['💮', 'nature'], ['🌹', 'nature'],
  ['🌺', 'nature'], ['🌻', 'nature'], ['🌼', 'nature'],
  ['🌷', 'nature'], ['🌱', 'nature'], ['🌲', 'nature'],
  ['🌳', 'nature'], ['🌴', 'nature'], ['🌵', 'nature'],
  ['🌾', 'nature'], ['🌿', 'nature'], ['☘️', 'nature'],
  ['🍀', 'nature'], ['🍁', 'nature'], ['🍂', 'nature'],
  ['🍃', 'nature'], ['🍄', 'nature'], ['🌰', 'nature'],
  ['🪴', 'nature'], ['🌍', 'nature'], ['🌎', 'nature'],
  ['🌏', 'nature'],
  ['🌝', 'nature'],
  ['🌞', 'nature'],
  ['🌈', 'nature'], ['⚡', 'nature'],

  // --- food: food and drink ---
  ['🍇', 'food'], ['🍈', 'food'], ['🍉', 'food'],
  ['🍊', 'food'], ['🍋', 'food'], ['🍌', 'food'],
  ['🍍', 'food'], ['🥭', 'food'], ['🍎', 'food'],
  ['🍏', 'food'], ['🍐', 'food'], ['🍑', 'food'],
  ['🍒', 'food'], ['🍓', 'food'], ['🥝', 'food'],
  ['🍅', 'food'], ['🥥', 'food'], ['🥑', 'food'],
  ['🍆', 'food'], ['🥔', 'food'], ['🥕', 'food'],
  ['🌽', 'food'], ['🥦', 'food'], ['🧄', 'food'],
  ['🧅', 'food'], ['🍞', 'food'], ['🧀', 'food'],
  ['🍖', 'food'], ['🍗', 'food'], ['🥩', 'food'],
  ['🥓', 'food'], ['🍔', 'food'], ['🍟', 'food'],
  ['🍕', 'food'], ['🌭', 'food'], ['🥪', 'food'],
  ['🌮', 'food'], ['🌯', 'food'], ['🥙', 'food'],
  ['🧆', 'food'], ['🥚', 'food'], ['🍳', 'food'],
  ['🥘', 'food'], ['🍲', 'food'], ['🥣', 'food'],
  ['🥗', 'food'], ['🍿', 'food'], ['🧈', 'food'],
  ['🧂', 'food'], ['🥫', 'food'], ['🍱', 'food'],
  ['🍘', 'food'], ['🍙', 'food'], ['🍚', 'food'],
  ['🍛', 'food'], ['🍜', 'food'], ['🍝', 'food'],
  ['🍠', 'food'], ['🍢', 'food'], ['🍣', 'food'],
  ['🍤', 'food'], ['🍥', 'food'], ['🥮', 'food'],
  ['🍡', 'food'], ['🥟', 'food'], ['🥠', 'food'],
  ['🥡', 'food'], ['🦪', 'food'], ['🍦', 'food'],
  ['🍧', 'food'], ['🍨', 'food'], ['🍩', 'food'],
  ['🍪', 'food'], ['🍰', 'food'],
  ['🧁', 'food'], ['🥧', 'food'], ['🍫', 'food'],
  ['🍬', 'food'], ['🍭', 'food'], ['🍮', 'food'],
  ['🍯', 'food'], ['🍼', 'food'], ['🥛', 'food'],
  ['☕', 'food'], ['🍵', 'food'], ['🍶', 'food'],
  ['🍾', 'food'], ['🍷', 'food'], ['🍸', 'food'],
  ['🍹', 'food'], ['🍺', 'food'], ['🍻', 'food'],
  ['🥂', 'food'], ['🥃', 'food'], ['🥤', 'food'],
  ['🧃', 'food'], ['🧉', 'food'], ['🧊', 'food'],

  // --- travel: travel, transport and places ---
  ['🚗', 'travel'], ['🚕', 'travel'], ['🚙', 'travel'],
  ['🚌', 'travel'], ['🚎', 'travel'], ['🏎️', 'travel'],
  ['🚓', 'travel'], ['🚒', 'travel'],
  ['🚐', 'travel'], ['🚚', 'travel'], ['🚛', 'travel'],
  ['🚜', 'travel'], ['🏍️', 'travel'], ['🛵', 'travel'],
  ['🛴', 'travel'], ['🚲', 'travel'], ['🛹', 'travel'],
  ['🚏', 'travel'], ['🛣️', 'travel'], ['🛤️', 'travel'],
  ['⛽', 'travel'], ['🚥', 'travel'],
  ['🚦', 'travel'], ['🚧', 'travel'], ['⚓', 'travel'],
  ['⛵', 'travel'], ['🚤', 'travel'], ['🛳️', 'travel'],
  ['✈️', 'travel'], ['🚁', 'travel'], ['🚟', 'travel'],
  ['🚠', 'travel'], ['🚡', 'travel'],
  ['🚀', 'travel'], ['🛸', 'travel'], ['🪐', 'travel'],
  ['🗽', 'travel'], ['🗼', 'travel'], ['🏯', 'travel'],
  ['🏰', 'travel'], ['🏗️', 'travel'], ['🧱', 'travel'],
  ['🏠', 'travel'], ['🏡', 'travel'], ['🏢', 'travel'],
  ['🏣', 'travel'], ['🏤', 'travel'],
  ['🏨', 'travel'], ['🏩', 'travel'],
  ['🏪', 'travel'], ['🏫', 'travel'], ['🏬', 'travel'],
  ['🏭', 'travel'], ['🏮', 'travel'], ['🗺️', 'travel'],
  ['🗾', 'travel'], ['🏔️', 'travel'], ['⛰️', 'travel'],
  ['🌋', 'travel'], ['🏜️', 'travel'], ['🏝️', 'travel'],
  ['🏟️', 'travel'], ['🎠', 'travel'], ['🎡', 'travel'],
  ['🎢', 'travel'], ['🎪', 'travel'],
  ['🚪', 'travel'],

  // --- activity: sports, activities and hobbies ---
  ['⚽', 'activity'], ['🏀', 'activity'], ['🏈', 'activity'],
  ['⚾', 'activity'], ['🥎', 'activity'], ['🎾', 'activity'],
  ['🏐', 'activity'], ['🏉', 'activity'], ['🥏', 'activity'],
  ['🎱', 'activity'], ['🪀', 'activity'], ['🏓', 'activity'],
  ['🏸', 'activity'], ['🥊', 'activity'], ['🥋', 'activity'],
  ['⛸️', 'activity'], ['🎿', 'activity'], ['⛷️', 'activity'],
  ['🏂', 'activity'], ['🏋️', 'activity'], ['🤼', 'activity'],
  ['🤸', 'activity'], ['🤺', 'activity'], ['⛹️', 'activity'],
  ['🤾', 'activity'], ['🏌️', 'activity'], ['🏄', 'activity'],
  ['⛳', 'activity'],
  ['🏊', 'activity'], ['🤽', 'activity'], ['🚣', 'activity'],
  ['🧗', 'activity'], ['🚵', 'activity'], ['🚴', 'activity'],
  ['🎳', 'activity'], ['🎭', 'activity'], ['🎨', 'activity'],
  ['🎟️', 'activity'],
  ['🎲', 'activity'], ['♟️', 'activity'],
  ['🎰', 'activity'],
  ['♠️', 'activity'], ['♥️', 'activity'], ['♦️', 'activity'],
  ['♣️', 'activity'], ['🃏', 'activity'], ['🀄', 'activity'],

  // --- object: objects, technology and tools ---
  ['⌚', 'object'],
  ['🖲️', 'object'], ['🗜️', 'object'],
  ['📷', 'object'], ['📸', 'object'],
  ['🧭', 'object'], ['⏰', 'object'],
  ['🕰️', 'object'], ['⏳', 'object'],
  ['🔦', 'object'],
  ['🪔', 'object'], ['🧯', 'object'], ['🛢️', 'object'],
  ['🔭', 'object'],
  ['🖼', 'object'], ['🔎', 'object'],
  ['🧮', 'object'],

  // --- flag: flags and national symbols ---
  ['🏁', 'flag'], ['🎌', 'flag'],
  ['🏴', 'flag'], ['🏳️', 'flag'], ['🏳️‍🌈', 'flag'],
  ['🇺🇳', 'flag'], ['🇪🇺', 'flag'],

  // --- person: people and roles ---
  ['👶', 'person'], ['🧒', 'person'], ['👦', 'person'],
  ['👧', 'person'], ['🧑', 'person'], ['👨', 'person'],
  ['👩', 'person'], ['🧔', 'person'], ['👴', 'person'],
  ['👵', 'person'], ['🙍', 'person'], ['🙎', 'person'],
  ['🙋', 'person'],
  ['🙇', 'person'], ['🤦', 'person'], ['🤷', 'person'],
  ['💁', 'person'], ['🙅', 'person'], ['🙆', 'person'],
  ['💂', 'person'], ['👷', 'person'], ['👸', 'person'],
  ['🤴', 'person'], ['👳', 'person'], ['👲', 'person'],
  ['🧕', 'person'], ['🤵', 'person'], ['👰', 'person'],
  ['🤰', 'person'], ['🤱', 'person'], ['👼', 'person'],
  ['🎅', 'person'], ['🤶', 'person'], ['🦸', 'person'],
  ['🦹', 'person'], ['🧙', 'person'], ['🧚', 'person'],
  ['🧛', 'person'], ['🧜', 'person'], ['🧝', 'person'],
  ['🧞', 'person'], ['🧟', 'person'], ['💆', 'person'],
  ['💇', 'person'], ['🚶', 'person'], ['🏃', 'person'],
  ['💃', 'person'], ['🕺', 'person'],

  // --- clothing: clothing and accessories ---
  ['👔', 'clothing'], ['👕', 'clothing'], ['👖', 'clothing'],
  ['🧣', 'clothing'], ['🧤', 'clothing'], ['🧥', 'clothing'],
  ['🧦', 'clothing'], ['👗', 'clothing'], ['👘', 'clothing'],
  ['🥻', 'clothing'], ['🩱', 'clothing'], ['🩲', 'clothing'],
  ['🩳', 'clothing'], ['👙', 'clothing'], ['👚', 'clothing'],
  ['👛', 'clothing'], ['👜', 'clothing'], ['👝', 'clothing'],
  ['🎒', 'clothing'], ['👞', 'clothing'], ['👟', 'clothing'],
  ['🥾', 'clothing'], ['🥿', 'clothing'], ['👠', 'clothing'],
  ['👡', 'clothing'], ['👢', 'clothing'], ['👑', 'clothing'],
  ['👒', 'clothing'], ['🎩', 'clothing'], ['🎓', 'clothing'],
  ['🧢', 'clothing'], ['⛑️', 'clothing'], ['📿', 'clothing'],
  ['💄', 'clothing'], ['💍', 'clothing'],
  ['👓', 'clothing'],

  // --- music: music and sound ---
  ['🔇', 'music'],
  ['🔔', 'music'], ['🔕', 'music'], ['🎵', 'music'],
  ['🎶', 'music'], ['🎼', 'music'],
  ['🎷', 'music'],
  ['🎸', 'music'], ['🎹', 'music'], ['🎺', 'music'],
  ['🎻', 'music'], ['🥁', 'music'], ['🪘', 'music'],

  // --- clock: hours and clocks ---
  ['🕐', 'clock'], ['🕑', 'clock'], ['🕒', 'clock'],
  ['🕓', 'clock'], ['🕔', 'clock'], ['🕕', 'clock'],
  ['🕖', 'clock'], ['🕗', 'clock'], ['🕘', 'clock'],
  ['🕙', 'clock'], ['🕚', 'clock'], ['🕛', 'clock'],
  ['🕜', 'clock'], ['🕝', 'clock'], ['🕞', 'clock'],
  ['🕟', 'clock'], ['🕠', 'clock'], ['🕡', 'clock'],
  ['🕢', 'clock'], ['🕣', 'clock'], ['🕤', 'clock'],
  ['🕥', 'clock'], ['🕦', 'clock'], ['🕧', 'clock'],
  ['⏱', 'clock'],

  // --- zodiac: zodiac signs ---
  ['♈', 'zodiac'], ['♉', 'zodiac'], ['♊', 'zodiac'],
  ['♋', 'zodiac'], ['♌', 'zodiac'], ['♍', 'zodiac'],
  ['♎', 'zodiac'], ['♏', 'zodiac'], ['♐', 'zodiac'],
  ['♑', 'zodiac'], ['♒', 'zodiac'], ['♓', 'zodiac'],
  ['⛎', 'zodiac'],

  // --- tech: technology and digital ---
  ['💻', 'tech'], ['🖥️', 'tech'], ['⌨️', 'tech'],
  ['🖱️', 'tech'], ['🖨️', 'tech'], ['📱', 'tech'],
  ['📲', 'tech'], ['☎️', 'tech'], ['📞', 'tech'],
  ['📟', 'tech'], ['📠', 'tech'], ['🔋', 'tech'],
  ['🔌', 'tech'], ['💽', 'tech'], ['💾', 'tech'],
  ['🎮', 'tech'],
  ['🕹️', 'tech'], ['🤖', 'tech'], ['🛰️', 'tech'],
  ['📡', 'tech'], ['🔬', 'tech'],

  // --- weather: weather and atmospheric conditions ---
  ['☀️', 'weather'], ['🌤️', 'weather'], ['⛅', 'weather'],
  ['🌥️', 'weather'], ['☁️', 'weather'], ['🌦️', 'weather'],
  ['⛈️', 'weather'], ['🌩️', 'weather'],
  ['🌨️', 'weather'], ['❄️', 'weather'], ['☃️', 'weather'],
  ['⛄', 'weather'], ['🌬️', 'weather'], ['💨', 'weather'],
  ['💦', 'weather'], ['🌧️', 'weather'], ['🌂', 'weather'],
  ['☂️', 'weather'],

  // --- moon: moon phases ---
  ['🌑', 'moon'], ['🌒', 'moon'], ['🌓', 'moon'],
  ['🌔', 'moon'], ['🌕', 'moon'], ['🌖', 'moon'],
  ['🌗', 'moon'], ['🌘', 'moon'], ['🌙', 'moon'],
  ['🌚', 'moon'], ['🌛', 'moon'], ['🌜', 'moon'],

  // --- star: stars and celestial bodies ---
  ['⭐', 'star'],
  ['💫', 'star'], ['🌟', 'star'], ['🌠', 'star'],
  ['☄️', 'star'],

  // --- fire ---
  ['🔥', 'fire'],

  // --- water: water and liquids ---
  ['💧', 'water'], ['🌊', 'water'], ['🚿', 'water'],
  ['🛁', 'water'], ['🫧', 'water'],

  // --- alert: alerts and warnings ---
  ['🚨', 'alert'], ['🚩', 'alert'], ['⚠️', 'alert'],
  ['🚸', 'alert'], ['🔞', 'alert'], ['☢️', 'alert'],
  ['☣️', 'alert'], ['📛', 'alert'],

  // --- money: finance and economy ---
  ['💰', 'money'], ['💴', 'money'], ['💵', 'money'],
  ['💶', 'money'], ['💷', 'money'], ['💸', 'money'],
  ['💳', 'money'], ['🧾', 'money'], ['🏦', 'money'],
  ['💎', 'money'],

  // --- communication: communication ---
  ['💬', 'communication'], ['🗯️', 'communication'],
  ['💭', 'communication'], ['💤', 'communication'],
  ['🗨️', 'communication'], ['🗩', 'communication'],
  ['📧', 'communication'], ['📨', 'communication'],
  ['📩', 'communication'], ['📤', 'communication'],
  ['📥', 'communication'], ['📦', 'communication'],
  ['📫', 'communication'], ['📪', 'communication'],
  ['📬', 'communication'], ['📭', 'communication'],
  ['📮', 'communication'], ['📝', 'communication'],
  ['💌', 'communication'],

  // --- lock: security and locks ---
  ['🔒', 'lock'], ['🔓', 'lock'], ['🔏', 'lock'],
  ['🔐', 'lock'], ['🔑', 'lock'], ['🗝️', 'lock'],

  // --- tool: tools ---
  ['🔨', 'tool'], ['🪓', 'tool'], ['⛏️', 'tool'],
  ['⚒️', 'tool'], ['🛠️', 'tool'], ['🔧', 'tool'],
  ['🔩', 'tool'], ['⚙️', 'tool'], ['🧰', 'tool'],
  ['🧲', 'tool'], ['🪜', 'tool'],

  // --- medical: health and medicine ---
  ['💉', 'medical'], ['🩸', 'medical'], ['💊', 'medical'],
  ['🩹', 'medical'], ['🩺', 'medical'], ['🌡️', 'medical'],
  ['🧬', 'medical'], ['🧪', 'medical'], ['🦠', 'medical'],
  ['🏥', 'medical'], ['🚑', 'medical'],

  // --- celebration: celebrations and parties ---
  ['🎉', 'celebration'], ['🎊', 'celebration'],
  ['🎈', 'celebration'], ['🎂', 'celebration'],
  ['🎁', 'celebration'], ['🎀', 'celebration'],
  ['🎃', 'celebration'], ['🎄', 'celebration'],
  ['🎆', 'celebration'], ['🎇', 'celebration'],
  ['🧨', 'celebration'], ['✨', 'celebration'],
  ['🥳', 'celebration'],

  // --- award: awards and recognitions ---
  ['🥇', 'award'], ['🥈', 'award'],
  ['🥉', 'award'], ['🏅', 'award'], ['🎖️', 'award'],
  ['🏵️', 'award'], ['🎗️', 'award'],
  ['🏆', 'award'],

  // --- book: books and reading ---
  ['📚', 'book'], ['📖', 'book'], ['📕', 'book'],
  ['📗', 'book'], ['📘', 'book'], ['📙', 'book'],
  ['📓', 'book'], ['📔', 'book'], ['📒', 'book'],
  ['📃', 'book'], ['📜', 'book'], ['📄', 'book'],
  ['🗞️', 'book'], ['📑', 'book'], ['🔖', 'book'],
  ['🏷️', 'book'],

  // --- video: video and cinema ---
  ['🎬', 'video'], ['🎥', 'video'], ['📽️', 'video'],
  ['🎞️', 'video'], ['📹', 'video'], ['📺', 'video'],
  ['📼', 'video'], ['📀', 'video'], ['💿', 'video'],

  // --- audio: audio and sound ---
  ['🔊', 'audio'], ['🔉', 'audio'], ['🔈', 'audio'],
  ['🎙️', 'audio'], ['🎚️', 'audio'], ['🎛️', 'audio'],
  ['📻', 'audio'], ['🎤', 'audio'], ['🎧', 'audio'],
  ['📢', 'audio'], ['📣', 'audio'],

  // --- number: numbers ---
  ['0️⃣', 'number'], ['1️⃣', 'number'], ['2️⃣', 'number'],
  ['3️⃣', 'number'], ['4️⃣', 'number'], ['5️⃣', 'number'],
  ['6️⃣', 'number'], ['7️⃣', 'number'], ['8️⃣', 'number'],
  ['9️⃣', 'number'], ['🔟', 'number'],

  // --- shape: geometric shapes ---
  ['🟠', 'shape'], ['🟡', 'shape'],
  ['🟢', 'shape'], ['🔵', 'shape'], ['🟣', 'shape'],
  ['🟤', 'shape'], ['⚫', 'shape'], ['⚪', 'shape'],
  ['🔸', 'shape'],
  ['🔹', 'shape'], ['🔺', 'shape'], ['🔻', 'shape'],
  ['💠', 'shape'], ['🔘', 'shape'], ['🔳', 'shape'],
  ['🔲', 'shape'], ['▪️', 'shape'], ['▫️', 'shape'],
  ['◾', 'shape'], ['◽', 'shape'], ['🔶', 'shape'],
  ['🔷', 'shape'], ['🔴', 'shape'], ['🟥', 'shape'],
  ['🟧', 'shape'], ['🟨', 'shape'], ['🟩', 'shape'],
  ['🟦', 'shape'], ['🟪', 'shape'], ['🟫', 'shape'],
  ['⬛', 'shape'], ['⬜', 'shape'],
]);

// ---------------------------------------------------------------------------
// Emoji code normalization
// ---------------------------------------------------------------------------

/**
 * Prefix for emoji codes in hexadecimal format.
 * Example: "emoji:1F5FA".
 * @type {string}
 */
const EMOJI_CODE_PREFIX = 'emoji:';

/**
 * Separator between code points of the same emoji in hexadecimal format.
 * Example: "emoji:1F469 1F3FB" (woman with light skin tone).
 * @type {string}
 */
const EMOJI_CODE_SEPARATOR = ' ';

/**
 * Unicode variation selectors (U+FE00–U+FE0F), including VS16 (U+FE0F).
 *
 * MindMup produces emojis without VS16 (for example "emoji:2764" -> "❤") while
 * the STICKER_CATEGORIES catalogue documents them with VS16 ("❤️"). They are
 * removed from the lookup key so both match.
 *
 * @type {RegExp}
 */
const VARIATION_SELECTOR_REGEX = /[\uFE00-\uFE0F]/g;

/**
 * Unicode skin tone modifiers (U+1F3FB–U+1F3FF).
 *
 * They are removed from the lookup key so an emoji with a skin tone (for
 * example "👩🏻" = "emoji:1F469 1F3FB") is classified with the category of its
 * base emoji ("👩" -> person).
 *
 * Note: the test version does NOT use the global /g flag because
 * RegExp.test() with /g is stateful (lastIndex advances between calls) and
 * would make the function that uses it impure. The /g version is only used in
 * replace.
 *
 * @type {RegExp}
 */
const SKIN_TONE_MODIFIER_REGEX = /[\u{1F3FB}-\u{1F3FF}]/u;

/**
 * Global-flag version, used exclusively in replacements.
 * @type {RegExp}
 */
const SKIN_TONE_MODIFIER_GLOBAL_REGEX = /[\u{1F3FB}-\u{1F3FF}]/gu;

/**
 * Converts an emoji code in "emoji:XXXXX" format to its Unicode character.
 *
 * The code may contain one or several code points separated by spaces (for
 * example "emoji:1F469 1F3FB"). Each point is parsed as a hexadecimal integer
 * and converted with String.fromCodePoint(); the result is concatenated into a
 * single character sequence.
 *
 * Invalid code points (NaN, negative, outside the Unicode range) or surrogate
 * code points (U+D800–U+DFFF, which only make sense as part of a surrogate pair
 * in UTF-16 and would produce orphan surrogates with String.fromCodePoint) are
 * skipped; if none is valid, an empty string is returned.
 *
 * @param {string} code - Emoji code, for example "emoji:1F5FA" or "emoji:1F469 1F3FB"
 * @returns {string} Unicode character or sequence of the emoji
 *
 * @example
 * emojiCodeToChar('emoji:1F5FA') // -> '🗺'
 * emojiCodeToChar('emoji:0032 20E3') // -> '2️⃣' (keycap 2)
 */
function emojiCodeToChar(code) {
  const hexString = code.slice(EMOJI_CODE_PREFIX.length);

  return hexString
    .split(EMOJI_CODE_SEPARATOR)
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
}

/**
 * Determines whether an emoji code uses the hexadecimal "emoji:XXXXX" format.
 *
 * @param {string} code - Code to check
 * @returns {boolean} true if the code starts with "emoji:"
 */
function isHexCodeFormat(code) {
  return typeof code === 'string' && code.startsWith(EMOJI_CODE_PREFIX);
}

/**
 * Normalizes an emoji code to its visual Unicode representation.
 *
 * If the code uses the "emoji:XXXXX" format, it is converted to a Unicode
 * character (one or more units, depending on the indicated code points). If it
 * is already a Unicode character, it is returned unchanged.
 *
 * @param {string} code - Input emoji code
 * @returns {string} Visual representation of the emoji (Unicode character)
 */
function normalizeEmojiDisplay(code) {
  if (isHexCodeFormat(code)) {
    return emojiCodeToChar(code);
  }
  return code;
}

/**
 * Normalizes an emoji for the category catalogue lookup.
 *
 * Removes variation selectors (U+FE00–U+FE0F) and skin tone modifiers
 * (U+1F3FB–U+1F3FF). It is applied symmetrically to catalogue keys and to the
 * emoji being looked up, so variants with/without VS16 or with a skin tone are
 * classified with the category of their base emoji.
 *
 * @param {string} emojiChar - Unicode character of the emoji
 * @returns {string} Normalized lookup key
 */
function normalizeEmojiLookup(emojiChar) {
  return emojiChar
    .replace(VARIATION_SELECTOR_REGEX, '')
    .replace(SKIN_TONE_MODIFIER_GLOBAL_REGEX, '');
}

/**
 * Detects normalized-key collisions in a sticker catalogue.
 *
 * A collision occurs when two or more entries share the same normalized key
 * (after removing variation selectors and skin tones). The catalogue must have
 * a single entry per key so classification is deterministic and independent of
 * entry order (W8).
 *
 * @param {Iterable<[string, string]>} [catalog=STICKER_CATEGORIES] - Emoji -> category catalogue
 * @returns {Array<{key: string, emojis: string[], categories: string[]}>}
 *   Detected collisions (empty when the catalogue is coherent)
 */
export function findStickerCatalogCollisions(catalog = STICKER_CATEGORIES) {
  /** @type {Map<string, {emojis: string[], categories: string[]}>} */
  const byKey = new Map();

  for (const [emoji, category] of catalog) {
    const key = normalizeEmojiLookup(emoji);
    if (!byKey.has(key)) {
      byKey.set(key, { emojis: [], categories: [] });
    }
    const group = byKey.get(key);
    group.emojis.push(emoji);
    group.categories.push(category);
  }

  return [...byKey.entries()]
    .filter(([, group]) => group.emojis.length > 1)
    .map(([key, group]) => ({
      key,
      emojis: group.emojis,
      categories: group.categories,
    }));
}

/**
 * Verifies that a sticker catalogue has no normalized collisions.
 *
 * @param {Iterable<[string, string]>} catalog - Emoji -> category catalogue
 * @returns {void}
 * @throws {Error} If there are repeated normalized keys
 */
function assertStickerCatalogHasNoCollisions(catalog) {
  const collisions = findStickerCatalogCollisions(catalog);
  if (collisions.length > 0) {
    const detail = collisions
      .map((collision) => `${collision.key} (${collision.categories.join(' / ')})`)
      .join('; ');
    throw new Error(
      `Catálogo STICKER_CATEGORIES con claves normalizadas duplicadas: ${detail}`
    );
  }
}

// Load-time check: the catalogue is loaded without collisions (W8)
assertStickerCatalogHasNoCollisions(STICKER_CATEGORIES);

/**
 * Builds the category index with normalized keys.
 *
 * Each catalogue key is normalized with normalizeEmojiLookup() so the lookup
 * ignores variation selectors and skin tones. The catalogue is collision-free
 * (verified at module load), so each normalized key maps to a single category.
 *
 * @returns {Map<string, string>} Normalized key -> category map
 */
function buildNormalizedCategoryLookup() {
  /** @type {Map<string, string>} */
  const lookup = new Map();

  for (const [emoji, category] of STICKER_CATEGORIES) {
    lookup.set(normalizeEmojiLookup(emoji), category);
  }

  return lookup;
}

/**
 * Category index with normalized keys (variations and skin tones).
 * Built once at module load.
 * @type {Map<string, string>}
 */
const STICKER_CATEGORIES_BY_NORMALIZED = buildNormalizedCategoryLookup();

/**
 * Canonical forms of the catalogue emojis.
 *
 * Map of normalized key -> canonical catalogue representation (which includes
 * the U+FE0F variation selector where appropriate, for example the numeric
 * keycap "2️⃣" = 0x32 0xFE0F 0x20E3). Direct conversion of the file code points
 * produces the variant without the selector (for example "2⃣"), which degrades
 * visually on some platforms. This map restores the canonical form generically.
 *
 * @type {Map<string, string>}
 */
const CANONICAL_BY_NORMALIZED = buildCanonicalLookup();

/**
 * Builds the canonical-form map from the catalogue.
 *
 * For each catalogue entry it stores its emoji as the canonical form of the
 * normalized key. Thus the keycap "2️⃣" (0x32 0xFE0F 0x20E3) defines the
 * canonical form of "2⃣" (0x32 0x20E3), and "❤️" defines that of "❤".
 *
 * @returns {Map<string, string>} Normalized key -> canonical form map
 */
function buildCanonicalLookup() {
  /** @type {Map<string, string>} */
  const lookup = new Map();

  for (const [emoji] of STICKER_CATEGORIES) {
    lookup.set(normalizeEmojiLookup(emoji), emoji);
  }

  return lookup;
}

/**
 * Applies the catalogue canonical form to an emoji when it exists.
 *
 * Restores the U+FE0F variation selector (for example "2⃣" -> "2️⃣",
 * "❤" -> "❤️") using the catalogue as the source. It is not applied when the
 * emoji contains a skin tone modifier, because the catalogue canonical form
 * does not include the tone and information would be lost.
 *
 * It also applies the general numeric-keycap rule (base + U+FE0F + U+20E3) to
 * cover keycaps that are not in the catalogue (for example "#⃣" and "*⃣"): if
 * the sequence ends in U+20E3 without a preceding U+FE0F, the variation
 * selector is inserted.
 *
 * @param {string} emojiChar - Unicode character of the emoji
 * @returns {string} Catalogue canonical form, or the original emoji
 */
function applyCanonicalForm(emojiChar) {
  if (SKIN_TONE_MODIFIER_REGEX.test(emojiChar)) {
    return emojiChar;
  }

  const normalizedKey = normalizeEmojiLookup(emojiChar);
  const canonical = CANONICAL_BY_NORMALIZED.get(normalizedKey);
  if (canonical) {
    return canonical;
  }

  // General numeric-keycap rule (0-9, #, *): base + U+FE0F + U+20E3
  if (emojiChar.endsWith('\u20e3') && !emojiChar.endsWith('\ufe0f\u20e3')) {
    return emojiChar.slice(0, -1) + '\ufe0f\u20e3';
  }

  return emojiChar;
}

/**
 * Classifies an emoji character into a semantic category.
 *
 * Normalizes the emoji (removing variation selectors and skin tones) and
 * looks it up in the normalized index. If it is not catalogued, returns the
 * received default category (VARIABLES.DEFAULT_STICKER_CATEGORY, W5), with an
 * "unknown" fallback (Incident #6: never raise an error for an undocumented
 * sticker).
 *
 * @param {string} emojiChar - Unicode character of the emoji
 * @param {string} [defaultCategory='unknown'] - Category for uncatalogued emojis
 * @returns {string} Emoji category or the default category
 */
function classifyEmoji(emojiChar, defaultCategory = 'unknown') {
  const normalizedKey = normalizeEmojiLookup(emojiChar);
  return (
    STICKER_CATEGORIES_BY_NORMALIZED.get(normalizedKey) ||
    defaultCategory ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// Sticker extraction from attr
// ---------------------------------------------------------------------------

/**
 * Normalizes a raw emoji code and appends it as a Sticker entry to the
 * accumulator.
 *
 * Shares the common logic of every sticker format: skips empty or non-textual
 * codes, normalizes the visual representation, classifies the category and
 * builds the entry with a unique UUID.
 *
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {UUID} nodeId - UUID of the node the stickers belong to
 * @param {string} rawCode - Raw emoji code (hex "emoji:XXXXX" or character)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function pushStickerEntry(accumulator, nodeId, rawCode, defaultCategory) {
  if (typeof rawCode !== 'string' || rawCode.length === 0) return;

  const emojiDisplay = applyCanonicalForm(normalizeEmojiDisplay(rawCode));
  // Discard codes that do not produce any visible representation
  // (for example "emoji:" with no code points, or all-invalid codes)
  if (emojiDisplay.length === 0) return;

  const category = classifyEmoji(emojiDisplay, defaultCategory);

  /** @type {Sticker} */
  const entry = {
    sticker_id: generateUUID(),
    node_id: nodeId,
    emoji_code: rawCode,
    emoji_display: emojiDisplay,
    category: category,
  };

  accumulator.push(entry);
}

/**
 * Extracts stickers from attr.stickers in array-of-objects format.
 *
 * Expected format: [{code: "🚀", category?: "symbol"}]
 *
 * @param {Object[]} stickersArray - Node sticker array
 * @param {UUID} nodeId - UUID of the node the stickers belong to
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function extractFromStickersArray(stickersArray, nodeId, accumulator, defaultCategory) {
  if (!Array.isArray(stickersArray)) return;

  for (const sticker of stickersArray) {
    if (!sticker || typeof sticker !== 'object') continue;
    pushStickerEntry(accumulator, nodeId, sticker.code, defaultCategory);
  }
}

/**
 * Extracts stickers from attr.stickers in object format (keys = emoji codes).
 *
 * Expected format: {"🚀": true, "❤️": true}
 *
 * @param {Object} stickersObj - Object with emoji codes as keys
 * @param {UUID} nodeId - UUID of the node the stickers belong to
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function extractFromStickersObject(stickersObj, nodeId, accumulator, defaultCategory) {
  if (!stickersObj || typeof stickersObj !== 'object' || Array.isArray(stickersObj)) return;

  for (const rawCode of Object.keys(stickersObj)) {
    pushStickerEntry(accumulator, nodeId, rawCode, defaultCategory);
  }
}

/**
 * Extracts stickers from attr.styles.stickers (array of strings).
 *
 * Expected format: ["🚀", "❤️"] or ["emoji:1F680", "emoji:2764"]
 *
 * @param {string[]} stylesStickers - Array of direct emoji codes
 * @param {UUID} nodeId - UUID of the node the stickers belong to
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function extractFromStylesStickers(stylesStickers, nodeId, accumulator, defaultCategory) {
  if (!Array.isArray(stylesStickers)) return;

  for (const rawCode of stylesStickers) {
    pushStickerEntry(accumulator, nodeId, rawCode, defaultCategory);
  }
}

/**
 * Extracts stickers from attr.stickers in array-of-strings format.
 *
 * Real MindMup v3 format: ["emoji:1F4DD", "emoji:1F6A8"].
 * Shares the same logic as attr.styles.stickers (array of strings).
 *
 * @param {string[]} stickersStringArray - Array of emoji codes as strings
 * @param {UUID} nodeId - UUID of the node the stickers belong to
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function extractFromStickersStringArray(stickersStringArray, nodeId, accumulator, defaultCategory) {
  extractFromStylesStickers(stickersStringArray, nodeId, accumulator, defaultCategory);
}

/**
 * Determines whether attr.stickers uses the array-of-objects format
 * (every element has a `code` property).
 *
 * @param {*} stickers - Value of the attr.stickers field
 * @returns {boolean} true if it is an array of objects with a code property
 */
function isStickersArrayFormat(stickers) {
  if (!Array.isArray(stickers)) return false;
  if (stickers.length === 0) return true; // empty array: undetermined but safe format
  return typeof stickers[0] === 'object' && stickers[0] !== null && 'code' in stickers[0];
}

/**
 * Determines whether attr.stickers uses the array-of-strings format
 * (real MindMup v3 format, for example ["emoji:1F4DD", ...]).
 *
 * @param {*} stickers - Value of the attr.stickers field
 * @returns {boolean} true if it is an array of non-empty strings
 */
function isStickersStringArrayFormat(stickers) {
  if (!Array.isArray(stickers)) return false;
  if (stickers.length === 0) return true; // empty array: undetermined but safe format
  return stickers.every((sticker) => typeof sticker === 'string');
}

/**
 * Extracts every sticker present in a node attr.
 *
 * Supports four different sticker formats:
 * 1. attr.stickers as an array of objects: [{code: "🚀", category?: "symbol"}]
 * 2. attr.stickers as an object: {"🚀": true, "❤️": true}
 * 3. attr.stickers as an array of strings with the emoji prefix
 *    (real MindMup v3 format): ["emoji:1F4DD", "emoji:1F6A8"]
 * 4. attr.styles.stickers as an array of strings: ["🚀", "❤️"]
 *
 * attr.stickers and attr.styles.stickers may coexist in the same node.
 *
 * @param {Object} attr - Node attr object in rawJson
 * @param {UUID} nodeId - UUID of the node in the normalized system
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function extractStickersFromAttr(attr, nodeId, accumulator, defaultCategory) {
  if (!attr || typeof attr !== 'object') return;

  // 1. attr.stickers in any of its formats
  if ('stickers' in attr) {
    const stickers = attr.stickers;

    if (isStickersArrayFormat(stickers)) {
      // Format 1: [{code: "🚀", category?: "symbol"}]
      extractFromStickersArray(stickers, nodeId, accumulator, defaultCategory);
    } else if (isStickersStringArrayFormat(stickers)) {
      // Format 3: ["emoji:1F4DD", "emoji:1F6A8"] (MindMup v3)
      extractFromStickersStringArray(stickers, nodeId, accumulator, defaultCategory);
    } else {
      // Format 2: {"🚀": true, "❤️": true} (object keyed by emoji)
      // It also covers empty arrays (produces no stickers but is not an error)
      extractFromStickersObject(stickers, nodeId, accumulator, defaultCategory);
    }
  }

  // 2. attr.styles?.stickers as an array of strings
  if (attr.styles && 'stickers' in attr.styles) {
    extractFromStylesStickers(attr.styles.stickers, nodeId, accumulator, defaultCategory);
  }
}

// ---------------------------------------------------------------------------
// Traversal of the original JSON tree
// ---------------------------------------------------------------------------

/**
 * Recursively traverses the ideas{} tree of rawJson and extracts stickers.
 *
 * For each node in the tree it looks up its attr and processes it through
 * extractStickersFromAttr. The correspondence between rawJson nodes and the
 * flattened nodes is made through original_id (the id field of the .mup).
 *
 * @param {Object} ideasObj - ideas object of the current level
 * @param {Map<string, UUID>} nodeIdByOriginalId - original_id -> node_id index
 * @param {Sticker[]} accumulator - Accumulator array (mutated in place)
 * @param {string} [defaultCategory] - Category for uncatalogued emojis
 * @returns {void}
 */
function traverseAndExtractStickers(ideasObj, nodeIdByOriginalId, accumulator, defaultCategory) {
  if (!ideasObj || typeof ideasObj !== 'object') return;

  for (const key of Object.keys(ideasObj)) {
    const rawNode = ideasObj[key];

    // Defensive safety: skip invalid entries
    if (!rawNode || typeof rawNode !== 'object') continue;

    // Resolve the node_id of the normalized system through original_id
    const originalId = rawNode.id !== undefined ? String(rawNode.id) : '';
    const nodeId = originalId ? nodeIdByOriginalId.get(originalId) : undefined;

    // If there is an attr and we have a nodeId, extract the stickers
    if (nodeId && rawNode.attr) {
      extractStickersFromAttr(rawNode.attr, nodeId, accumulator, defaultCategory);
    }

    // Recurse into children
    if (rawNode.ideas && typeof rawNode.ideas === 'object') {
      traverseAndExtractStickers(rawNode.ideas, nodeIdByOriginalId, accumulator, defaultCategory);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Layer 5: Extracts stickers/emojis from the nodes.
 *
 * Walks the flat node list (generated by Layer 2) and the original .mup JSON
 * to extract stickers from two sources:
 * - `attr.stickers` — as an array of objects {code, category?}, as an object
 *   keyed by emoji codes, or as an array of strings with the "emoji:" prefix
 *   (real MindMup v3 format)
 * - `attr.styles.stickers` — as an array of direct emoji codes
 *
 * Each sticker is normalized to its visual Unicode representation (including
 * emojis with multiple code points), classified according to
 * STICKER_CATEGORIES (with the received default category for uncatalogued
 * emojis, W5), and returned as a Sticker object with a unique UUID.
 *
 * Agnosticism principle: unrecognized stickers receive the default category
 * without raising an error (Incident #6). Multiple stickers per node are
 * represented as multiple entries in the resulting array.
 *
 * @param {Node[]} nodes - Flat node list (generated by Layer 2)
 * @param {Object} rawJson - Complete original .mup JSON (already parsed object)
 * @param {string} [defaultStickerCategory='unknown'] - Category for
 *   uncatalogued emojis (VARIABLES.DEFAULT_STICKER_CATEGORY); 'unknown' fallback
 * @returns {Sticker[]} List of extracted stickers, empty when there are none
 *
 * @example
 * const stickers = extractStickers(nodes, rawJson);
 * // stickers[0] = {
 * //   sticker_id: '550e8400-e29b-41d4-a716-446655440000',
 * //   node_id: '660e8400-e29b-41d4-a716-446655440001',
 * //   emoji_code: 'emoji:1F5FA',
 * //   emoji_display: '🗺',
 * //   category: 'travel'
 * // }
 */
export function extractStickers(nodes, rawJson, defaultStickerCategory = 'unknown') {
  /** @type {Sticker[]} */
  const stickers = [];

  // If there are no nodes or no rawJson, return an empty array
  if (!Array.isArray(nodes) || nodes.length === 0 || !rawJson || typeof rawJson !== 'object') {
    return stickers;
  }

  // 1. Build the index: original_id -> node_id from the flattened nodes.
  //    This resolves each rawJson node to its normalized UUID.
  /** @type {Map<string, UUID>} */
  const nodeIdByOriginalId = new Map();
  for (const node of nodes) {
    if (node.original_id) {
      nodeIdByOriginalId.set(node.original_id, node.node_id);
    }
  }

  // 2. Extract stickers from the rawJson ideas tree
  if (rawJson.ideas && typeof rawJson.ideas === 'object') {
    traverseAndExtractStickers(rawJson.ideas, nodeIdByOriginalId, stickers, defaultStickerCategory);
  }

  return stickers;
}
