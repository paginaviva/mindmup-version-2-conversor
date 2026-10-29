/**
 * @module zip
 * Minimal dependency-free ZIP32 writer using the "store" method.
 *
 * Responsibilities:
 * 1. Compute CRC-32 checksums for byte sequences.
 * 2. Build a valid ZIP archive with local file headers, a central directory
 *    and an end-of-central-directory record.
 * 3. Keep the implementation runtime agnostic: only Web APIs available in
 *    modern browsers, Cloudflare Workers and Node.js are used (TextEncoder,
 *    Uint8Array, DataView, Date).
 *
 * Design notes:
 * - No compression is applied. Storing entries avoids CPU and memory spikes,
 *   which matters when bundled assets are already compressed images.
 * - Entry names are encoded as UTF-8 and the general purpose bit 11 is set,
 *   so readers interpret non-ASCII names correctly.
 * - ZIP64 is intentionally not supported. Archives that would exceed the
 *   ZIP32 limits throw a RangeError with an explicit message.
 */

// ---------------------------------------------------------------------------
// CRC-32
// ---------------------------------------------------------------------------

/**
 * Lookup table for the reflected CRC-32 polynomial (0xEDB88320).
 *
 * The table is built once at module load. Each entry is the remainder of the
 * polynomial division for a single input byte.
 *
 * @type {Uint32Array}
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);

  for (let index = 0; index < 256; index += 1) {
    let value = index;

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }

    table[index] = value >>> 0;
  }

  return table;
})();

/**
 * Computes the CRC-32 checksum of a byte sequence.
 *
 * Uses the reflected polynomial 0xEDB88320, which is the variant required by
 * the ZIP specification. The result is an unsigned 32-bit integer.
 *
 * @param {Uint8Array} bytes - Bytes to checksum. A Node.js Buffer is accepted
 *   because it is a Uint8Array subclass.
 * @returns {number} Unsigned 32-bit CRC-32 value.
 * @throws {TypeError} When `bytes` is not a Uint8Array.
 *
 * @example
 * crc32(new TextEncoder().encode('123456789')) // -> 0xcbf43926
 */
export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('crc32 expects a Uint8Array');
  }

  let checksum = 0xffffffff;

  for (let index = 0; index < bytes.length; index += 1) {
    checksum = CRC32_TABLE[(checksum ^ bytes[index]) & 0xff] ^ (checksum >>> 8);
  }

  return (checksum ^ 0xffffffff) >>> 0;
}

// ---------------------------------------------------------------------------
// ZIP32 constants
// ---------------------------------------------------------------------------

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

const LOCAL_FILE_HEADER_SIZE = 30;
const CENTRAL_DIRECTORY_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

const ZIP_VERSION = 20; // ZIP 2.0: required for the UTF-8 name flag.
const UTF8_NAME_FLAG = 0x0800;
const STORE_METHOD = 0;

const UINT16_MAX = 0xffff;
const UINT32_MAX = 0xffffffff;

const MIN_DOS_YEAR = 1980;
const MAX_DOS_YEAR = 2107;

const textEncoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Validates and normalizes a single archive entry.
 *
 * Entry names must be relative paths. Parent-directory segments, a leading
 * slash and backslashes are rejected so a generated archive cannot escape the
 * extraction directory (path traversal) or produce platform-specific paths.
 *
 * @param {{ name: string, data: Uint8Array|string }} entry - Entry to validate.
 * @param {number} index - Position in the entries array, used in messages.
 * @returns {{ nameBytes: Uint8Array, dataBytes: Uint8Array, crc: number }} Prepared entry.
 * @throws {TypeError} When the entry or its fields have an invalid type.
 * @throws {Error} When the entry name is unsafe.
 */
function prepareEntry(entry, index) {
  if (entry === null || typeof entry !== 'object') {
    throw new TypeError(`ZIP entry at index ${index} must be an object`);
  }

  const { name, data } = entry;

  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(`ZIP entry at index ${index} must have a non-empty string "name"`);
  }

  if (name.startsWith('/')) {
    throw new Error(`ZIP entry name "${name}" must not start with "/"`);
  }

  if (name.includes('\\')) {
    throw new Error(`ZIP entry name "${name}" must not contain "\\"`);
  }

  if (name.includes('..')) {
    throw new Error(`ZIP entry name "${name}" must not contain ".."`);
  }

  const nameBytes = textEncoder.encode(name);

  if (nameBytes.length > UINT16_MAX) {
    throw new RangeError(`ZIP entry name "${name}" is too long (${nameBytes.length} bytes, maximum ${UINT16_MAX})`);
  }

  let dataBytes;

  if (typeof data === 'string') {
    dataBytes = textEncoder.encode(data);
  } else if (data instanceof Uint8Array) {
    dataBytes = data;
  } else {
    throw new TypeError(`ZIP entry "${name}" data must be a Uint8Array or a string`);
  }

  if (dataBytes.length > UINT32_MAX) {
    throw new RangeError(`ZIP entry "${name}" is too large (${dataBytes.length} bytes, maximum ${UINT32_MAX})`);
  }

  return { nameBytes, dataBytes, crc: crc32(dataBytes) };
}

/**
 * Converts a JavaScript Date to the MS-DOS date and time fields used by ZIP.
 *
 * ZIP stores local wall-clock time without timezone information. Years outside
 * the representable MS-DOS range are clamped to 1980-2107, and seconds are
 * rounded down to the nearest even value as required by the format.
 *
 * @param {Date} date - Date to convert.
 * @returns {{ time: number, date: number }} Encoded 16-bit time and date fields.
 * @throws {TypeError} When `date` is not a valid Date instance.
 */
function toDosDateTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError('options.date must be a valid Date instance');
  }

  const year = Math.min(Math.max(date.getFullYear(), MIN_DOS_YEAR), MAX_DOS_YEAR);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  return {
    time: (hours << 11) | (minutes << 5) | seconds,
    date: ((year - MIN_DOS_YEAR) << 9) | (month << 5) | day,
  };
}

/**
 * Writes a 16-bit unsigned integer in little-endian order.
 *
 * @param {DataView} view - Destination view.
 * @param {number} offset - Byte offset to write at.
 * @param {number} value - Value to write.
 * @returns {void}
 */
function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

/**
 * Writes a 32-bit unsigned integer in little-endian order.
 *
 * @param {DataView} view - Destination view.
 * @param {number} offset - Byte offset to write at.
 * @param {number} value - Value to write.
 * @returns {void}
 */
function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates a ZIP32 archive with stored (uncompressed) entries.
 *
 * The archive contains, in order:
 * 1. One local file header plus its raw data per entry.
 * 2. The central directory with one record per entry.
 * 3. The end-of-central-directory record.
 *
 * Names are UTF-8 encoded and entry data may be raw bytes or UTF-8 text.
 * Entries are written in the order provided.
 *
 * @param {Array<{ name: string, data: Uint8Array|string }>} entries - Files to add.
 *   `name` is a relative path such as "index.html" or "assets/photo.png".
 *   `data` is stored as-is when it is a Uint8Array, or UTF-8 encoded when it
 *   is a string.
 * @param {{ date?: Date }} [options] - Optional archive settings.
 *   `date` sets the modification timestamp for every entry; defaults to the
 *   current date and time.
 * @returns {Uint8Array} Complete ZIP archive bytes.
 * @throws {TypeError} On invalid entries, data types or options.
 * @throws {Error} When an entry name is unsafe.
 * @throws {RangeError} When ZIP32 limits (65535 entries or 4 GiB) are exceeded.
 *
 * @example
 * const zip = createZip([
 *   { name: 'index.html', data: '<!doctype html><title>Map</title>' },
 *   { name: 'assets/logo.png', data: pngBytes },
 * ], { date: new Date('2026-10-24T12:00:00Z') });
 */
export function createZip(entries, options = {}) {
  if (!Array.isArray(entries)) {
    throw new TypeError('createZip expects an array of entries');
  }

  const settings = options ?? {};
  const date = settings.date ?? new Date();
  const { time: dosTime, date: dosDate } = toDosDateTime(date);

  const preparedEntries = entries.map((entry, index) => prepareEntry(entry, index));

  if (preparedEntries.length > UINT16_MAX) {
    throw new RangeError(`ZIP32 supports at most ${UINT16_MAX} entries (received ${preparedEntries.length})`);
  }

  let localSectionSize = 0;
  let centralDirectorySize = 0;

  for (const entry of preparedEntries) {
    localSectionSize += LOCAL_FILE_HEADER_SIZE + entry.nameBytes.length + entry.dataBytes.length;
    centralDirectorySize += CENTRAL_DIRECTORY_HEADER_SIZE + entry.nameBytes.length;
  }

  const centralDirectoryOffset = localSectionSize;
  const totalSize = localSectionSize + centralDirectorySize + END_OF_CENTRAL_DIRECTORY_SIZE;

  if (centralDirectoryOffset > UINT32_MAX || totalSize > UINT32_MAX) {
    throw new RangeError('ZIP32 archive would exceed the 4 GiB limit');
  }

  const output = new Uint8Array(totalSize);
  const view = new DataView(output.buffer);
  let offset = 0;

  // Local file headers and file data.
  for (const entry of preparedEntries) {
    const { nameBytes, dataBytes, crc } = entry;

    entry.localHeaderOffset = offset;

    writeUint32(view, offset, LOCAL_FILE_HEADER_SIGNATURE);
    offset += 4;
    writeUint16(view, offset, ZIP_VERSION);
    offset += 2;
    writeUint16(view, offset, UTF8_NAME_FLAG);
    offset += 2;
    writeUint16(view, offset, STORE_METHOD);
    offset += 2;
    writeUint16(view, offset, dosTime);
    offset += 2;
    writeUint16(view, offset, dosDate);
    offset += 2;
    writeUint32(view, offset, crc);
    offset += 4;
    writeUint32(view, offset, dataBytes.length);
    offset += 4;
    writeUint32(view, offset, dataBytes.length);
    offset += 4;
    writeUint16(view, offset, nameBytes.length);
    offset += 2;
    writeUint16(view, offset, 0); // Extra field length.
    offset += 2;

    output.set(nameBytes, offset);
    offset += nameBytes.length;

    output.set(dataBytes, offset);
    offset += dataBytes.length;
  }

  // Central directory headers.
  const centralDirectoryStart = offset;

  for (const entry of preparedEntries) {
    const { nameBytes, dataBytes, crc, localHeaderOffset } = entry;

    writeUint32(view, offset, CENTRAL_DIRECTORY_SIGNATURE);
    offset += 4;
    writeUint16(view, offset, ZIP_VERSION); // Version made by (MS-DOS, ZIP 2.0).
    offset += 2;
    writeUint16(view, offset, ZIP_VERSION); // Version needed to extract.
    offset += 2;
    writeUint16(view, offset, UTF8_NAME_FLAG);
    offset += 2;
    writeUint16(view, offset, STORE_METHOD);
    offset += 2;
    writeUint16(view, offset, dosTime);
    offset += 2;
    writeUint16(view, offset, dosDate);
    offset += 2;
    writeUint32(view, offset, crc);
    offset += 4;
    writeUint32(view, offset, dataBytes.length);
    offset += 4;
    writeUint32(view, offset, dataBytes.length);
    offset += 4;
    writeUint16(view, offset, nameBytes.length);
    offset += 2;
    writeUint16(view, offset, 0); // Extra field length.
    offset += 2;
    writeUint16(view, offset, 0); // File comment length.
    offset += 2;
    writeUint16(view, offset, 0); // Disk number start.
    offset += 2;
    writeUint16(view, offset, 0); // Internal file attributes.
    offset += 2;
    writeUint32(view, offset, 0); // External file attributes.
    offset += 4;
    writeUint32(view, offset, localHeaderOffset);
    offset += 4;

    output.set(nameBytes, offset);
    offset += nameBytes.length;
  }

  const centralDirectoryLength = offset - centralDirectoryStart;

  // End of central directory record.
  writeUint32(view, offset, END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  offset += 4;
  writeUint16(view, offset, 0); // Number of this disk.
  offset += 2;
  writeUint16(view, offset, 0); // Disk where the central directory starts.
  offset += 2;
  writeUint16(view, offset, preparedEntries.length);
  offset += 2;
  writeUint16(view, offset, preparedEntries.length);
  offset += 2;
  writeUint32(view, offset, centralDirectoryLength);
  offset += 4;
  writeUint32(view, offset, centralDirectoryStart);
  offset += 4;
  writeUint16(view, offset, 0); // ZIP comment length.
  offset += 2;

  return output;
}
