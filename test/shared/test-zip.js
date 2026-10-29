/**
 * @module test-zip
 * Unit tests for the dependency-free ZIP32 writer.
 *
 * Covers the CRC-32 checksum, the three ZIP signatures, UTF-8 entry names with
 * the language-encoding flag, the store method, unsafe entry names and the
 * validity of an empty archive.
 *
 * Run from the project root with:
 *   node test/shared/test-zip.js
 */

import assert from 'node:assert/strict';

import { crc32, createZip } from '../../src/shared/zip.js';

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const UTF8_NAME_FLAG = 0x0800;
const STORE_METHOD = 0;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const tests = [];

/**
 * Registers a test case.
 *
 * @param {string} name - Test name.
 * @param {() => void} fn - Test body.
 * @returns {void}
 */
function test(name, fn) {
  tests.push({ name, fn });
}

/**
 * Reads the end-of-central-directory record of an archive.
 *
 * The EOCD record is always the last 22 bytes when there is no archive comment,
 * which is what the writer always emits.
 *
 * @param {Uint8Array} bytes - ZIP archive.
 * @returns {{ view: DataView, eocdOffset: number }} Data view and EOCD offset.
 */
function readEocd(bytes) {
  const eocdOffset = bytes.length - 22;
  return {
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    eocdOffset,
  };
}

/**
 * Returns the offset of the central directory start from the EOCD record.
 *
 * @param {Uint8Array} bytes - ZIP archive.
 * @returns {number} Central directory byte offset.
 */
function centralDirectoryOffset(bytes) {
  const { view, eocdOffset } = readEocd(bytes);
  return view.getUint32(eocdOffset + 16, true);
}

// ---------------------------------------------------------------------------
// 1. CRC-32
// ---------------------------------------------------------------------------
test('crc32 matches the reference vector "123456789" = 0xcbf43926', () => {
  // Arrange
  const input = textEncoder.encode('123456789');

  // Act
  const checksum = crc32(input);

  // Assert
  assert.equal(checksum, 0xcbf43926);
  assert.equal(checksum >>> 0, checksum, 'el resultado debe ser un entero sin signo');
});

test('crc32 returns 0 for an empty byte sequence', () => {
  assert.equal(crc32(new Uint8Array(0)), 0);
});

test('crc32 accepts a Buffer because it is a Uint8Array subclass (positivo)', () => {
  assert.equal(crc32(Buffer.from('123456789', 'ascii')), 0xcbf43926);
});

test('crc32 rejects values that are not Uint8Array (negativo)', () => {
  assert.throws(() => crc32('123456789'), /Uint8Array/);
  assert.throws(() => crc32(null), /Uint8Array/);
  assert.throws(() => crc32([49, 50]), /Uint8Array/);
});

// ---------------------------------------------------------------------------
// 2. Estructura del ZIP
// ---------------------------------------------------------------------------
test('createZip emits the local, central and EOCD signatures', () => {
  // Arrange
  const zip = createZip([{ name: 'a.txt', data: 'hola' }]);

  // Act
  const { view, eocdOffset } = readEocd(zip);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  // Assert
  assert.equal(view.getUint32(0, true), LOCAL_FILE_HEADER_SIGNATURE, 'falta la firma local PK\\x03\\x04');
  assert.equal(
    view.getUint32(centralOffset, true),
    CENTRAL_DIRECTORY_SIGNATURE,
    'falta la firma del directorio central PK\\x01\\x02',
  );
  assert.equal(
    view.getUint32(eocdOffset, true),
    END_OF_CENTRAL_DIRECTORY_SIGNATURE,
    'falta la firma EOCD PK\\x05\\x06',
  );
});

test('createZip writes raw PK signatures as the first bytes of the archive', () => {
  const zip = createZip([{ name: 'a.txt', data: 'x' }]);

  assert.deepEqual([...zip.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04]);
});

test('createZip stores UTF-8 names with the 0x0800 language-encoding flag', () => {
  // Arrange
  const name = 'ñandú/área.txt';

  // Act
  const zip = createZip([{ name, data: 'contenido' }], {
    date: new Date('2026-10-24T12:00:00'),
  });
  const { view } = readEocd(zip);
  const centralOffset = centralDirectoryOffset(zip);

  const localFlags = view.getUint16(6, true);
  const localMethod = view.getUint16(8, true);
  const localNameLength = view.getUint16(26, true);
  const localName = textDecoder.decode(zip.subarray(30, 30 + localNameLength));

  const centralFlags = view.getUint16(centralOffset + 8, true);
  const centralMethod = view.getUint16(centralOffset + 10, true);
  const centralNameLength = view.getUint16(centralOffset + 28, true);
  const centralName = textDecoder.decode(
    zip.subarray(centralOffset + 46, centralOffset + 46 + centralNameLength),
  );

  // Assert
  assert.equal(localName, name);
  assert.equal(centralName, name);
  assert.equal(localFlags, UTF8_NAME_FLAG);
  assert.equal(centralFlags, UTF8_NAME_FLAG);
  assert.equal(localMethod, STORE_METHOD);
  assert.equal(centralMethod, STORE_METHOD);
});

test('createZip keeps entry order and stores the exact bytes', () => {
  // Arrange
  const first = textEncoder.encode('primero');
  const second = textEncoder.encode('segundo');

  // Act
  const zip = createZip([
    { name: 'one.bin', data: first },
    { name: 'dir/two.bin', data: second },
  ], { date: new Date('2026-10-24T12:00:00') });
  const { view } = readEocd(zip);
  const nameLength = view.getUint16(26, true);
  const dataOffset = 30 + nameLength;

  // Assert
  assert.equal(
    textDecoder.decode(zip.subarray(30, 30 + nameLength)),
    'one.bin',
    'la primera entrada debe escribirse primero',
  );
  assert.deepEqual(
    [...zip.subarray(dataOffset, dataOffset + first.length)],
    [...first],
    'los bytes almacenados deben coincidir con la entrada',
  );
});

test('createZip produces a valid empty archive (positivo)', () => {
  // Arrange & Act
  const zip = createZip([]);

  // Assert
  assert.equal(zip.length, 22, 'un ZIP vacío debe medir solo el EOCD');
  const { view, eocdOffset } = readEocd(zip);
  assert.equal(view.getUint32(eocdOffset, true), END_OF_CENTRAL_DIRECTORY_SIGNATURE);
  assert.equal(view.getUint16(eocdOffset + 8, true), 0, 'entradas en disco');
  assert.equal(view.getUint16(eocdOffset + 10, true), 0, 'entradas totales');
  assert.equal(view.getUint32(eocdOffset + 12, true), 0, 'tamaño del directorio central');
  assert.equal(view.getUint32(eocdOffset + 16, true), 0, 'offset del directorio central');
});

test('createZip accepts dotted names that are not traversal (positivo)', () => {
  assert.doesNotThrow(() => createZip([{ name: 'mapa.v1_final-2026.json', data: 'x' }]));
});

// ---------------------------------------------------------------------------
// 3. Nombres inseguros
// ---------------------------------------------------------------------------
test('createZip rejects names containing ".." (negativo)', () => {
  assert.throws(
    () => createZip([{ name: '../escape.txt', data: 'x' }]),
    /\.\./,
  );
  assert.throws(
    () => createZip([{ name: 'assets/../../etc/passwd', data: 'x' }]),
    /\.\./,
  );
});

test('createZip rejects names starting with "/" (negativo)', () => {
  assert.throws(
    () => createZip([{ name: '/absolute.txt', data: 'x' }]),
    /start with/,
  );
});

test('createZip rejects names containing a backslash (negativo)', () => {
  assert.throws(
    () => createZip([{ name: 'dir\\file.txt', data: 'x' }]),
    (error) => error instanceof Error && error.message.includes('\\'),
  );
});

// ---------------------------------------------------------------------------
// 4. Entradas y opciones inválidas
// ---------------------------------------------------------------------------
test('createZip rejects a non-array entries argument (negativo)', () => {
  assert.throws(() => createZip(null), /array of entries/);
  assert.throws(() => createZip('nope'), /array of entries/);
});

test('createZip rejects entries without a usable name or data (negativo)', () => {
  assert.throws(() => createZip([null]), /must be an object/);
  assert.throws(() => createZip([{ data: 'x' }]), /non-empty string "name"/);
  assert.throws(() => createZip([{ name: '', data: 'x' }]), /non-empty string "name"/);
  assert.throws(() => createZip([{ name: 'a.txt', data: 42 }]), /Uint8Array or a string/);
});

test('createZip rejects an invalid options.date (negativo)', () => {
  assert.throws(
    () => createZip([{ name: 'a.txt', data: 'x' }], { date: new Date('invalid') }),
    /valid Date/,
  );
  assert.throws(
    () => createZip([{ name: 'a.txt', data: 'x' }], { date: '2026-10-24' }),
    /valid Date/,
  );
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`shared zip tests OK (${passed}/${tests.length})`);
