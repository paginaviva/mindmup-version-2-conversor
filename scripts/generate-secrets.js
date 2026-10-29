#!/usr/bin/env node
/**
 * @module generate-secrets
 * Generates the secrets required by the converter and visualizer Workers.
 *
 * The script writes one `KEY=value` line per secret to stdout, ready to be
 * pasted into a local `.dev.vars` file or fed to `wrangler secret put`.
 * It never writes files: the operator decides where the values live.
 *
 * Flags:
 * - --password <value>   Administrative password. Generated when omitted.
 * - --salt <base64>      PBKDF2 salt in base64. Generated when omitted.
 * - --iterations <n>     PBKDF2 iteration count (default: 100000).
 * - --help               Show help.
 *
 * The derived key uses PBKDF2-HMAC-SHA-256 with a 32-byte output. The
 * iteration count is configurable because the right value depends on the
 * measured cost on the Cloudflare Free plan; the default is a starting
 * point, not a guarantee.
 */

import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Algorithm parameters. These are contract values, not operations config. */
const PARAMETERS = Object.freeze({
  digest: 'sha256',
  iterations: 100000,
  keyLengthBytes: 32,
  saltBytes: 16,
  internalSecretBytes: 32,
  passwordBytes: 24,
});

/** Strict canonical base64: full 4-character groups with optional padding. */
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Prints command-line help in Spanish.
 *
 * @returns {void}
 */
function printHelp() {
  console.log(`Uso:
  node scripts/generate-secrets.js [opciones]

Genera los secretos de configuración de los Workers. Escribe una línea por
clave en la salida estándar, lista para .dev.vars o para wrangler secret put.
No escribe ningún archivo.

Opciones:
  --password <valor>    Contraseña administrativa. Si se omite, se genera una
                        contraseña aleatoria y se imprime una sola vez.
  --salt <base64>       Sal de PBKDF2 en base64. Si se omite, se generan 16
                        bytes aleatorios.
  --iterations <n>      Número de iteraciones de PBKDF2 (por defecto: 100000).
  --help                Muestra esta ayuda.

Salida:
  INTERNAL_SHARED_SECRET=<32 bytes aleatorios en base64url>
  ADMIN_PASSWORD_HASH=<clave derivada en base64>
  ADMIN_PASSWORD_SALT=<sal en base64>
  ADMIN_PASSWORD_ITERATIONS=<número de iteraciones>
  ADMIN_PASSWORD=<contraseña generada, solo si no se pasó --password>

Notas:
  - PBKDF2 con SHA-256 y clave derivada de 32 bytes.
  - El número de iteraciones es configurable; mide el coste real en el plan
    gratuito antes de fijarlo en producción.
  - No confirmes estos valores en el repositorio. .dev.vars ya está ignorado
    por git, pero debe permanecer solo en local.`);
}

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @returns {{help: boolean, password: (string|undefined), salt: (string|undefined), iterations: (number|undefined)}}
 * @throws {Error} On unknown options, missing values or invalid iterations.
 */
export function parseArguments(argv) {
  const options = {
    help: false,
    password: undefined,
    salt: undefined,
    iterations: undefined,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--password') {
      options.password = readFlagValue(argv, index, '--password');
      index += 1;
    } else if (argument === '--salt') {
      options.salt = readFlagValue(argv, index, '--salt');
      index += 1;
    } else if (argument === '--iterations') {
      options.iterations = parseIterations(readFlagValue(argv, index, '--iterations'));
      index += 1;
    } else {
      throw new Error(`Opción desconocida: ${argument}`);
    }
  }

  if (options.password !== undefined && options.password.length === 0) {
    throw new Error('La contraseña no puede estar vacía');
  }

  return options;
}

/**
 * Reads the value that follows a flag.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @param {number} index - Index of the flag.
 * @param {string} flag - Flag name for the error message.
 * @returns {string} The flag value.
 * @throws {Error} When the value is missing.
 */
function readFlagValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined) {
    throw new Error(`Falta el valor de ${flag}`);
  }
  return value;
}

/**
 * Validates and converts the iteration count.
 *
 * @param {string} value - Raw flag value.
 * @returns {number} Positive integer iteration count.
 * @throws {Error} When the value is not a positive integer.
 */
function parseIterations(value) {
  const iterations = Number(value);
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('El número de iteraciones debe ser un entero mayor o igual que 1');
  }
  return iterations;
}

/**
 * Decodes and validates a canonical base64 salt.
 *
 * @param {string} value - Salt in base64.
 * @returns {Buffer} Decoded salt bytes.
 * @throws {Error} When the value is not canonical base64 or is empty.
 */
function decodeSalt(value) {
  if (value.length === 0 || !BASE64_PATTERN.test(value)) {
    throw new Error('La sal debe ser base64 válido');
  }

  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) {
    throw new Error('La sal debe ser base64 canónico');
  }

  return bytes;
}

/**
 * Generates a cryptographically random password (base64url, no padding).
 *
 * base64url is used so the value is safe inside `.dev.vars` and shell
 * arguments: it contains no spaces, quotes, `#` or line breaks.
 *
 * @returns {string} Generated password.
 */
function generatePassword() {
  return randomBytes(PARAMETERS.passwordBytes).toString('base64url');
}

/**
 * Generates the internal shared secret used by the service bindings.
 *
 * @returns {string} 32 random bytes encoded as base64url.
 */
function generateInternalSecret() {
  return randomBytes(PARAMETERS.internalSecretBytes).toString('base64url');
}

/**
 * Derives the administrative password hash with PBKDF2-HMAC-SHA-256.
 *
 * @param {string} password - Administrative password.
 * @param {Buffer} saltBytes - Salt bytes.
 * @param {number} iterations - PBKDF2 iteration count.
 * @returns {string} Derived key in base64.
 */
function derivePasswordHash(password, saltBytes, iterations) {
  return pbkdf2Sync(
    password,
    saltBytes,
    iterations,
    PARAMETERS.keyLengthBytes,
    PARAMETERS.digest,
  ).toString('base64');
}

/**
 * Builds the output lines in the documented order.
 *
 * @param {Object} values - Resolved values.
 * @param {string} values.password - Administrative password.
 * @param {boolean} values.passwordGenerated - Whether the password was generated.
 * @param {string} values.saltBase64 - Salt in base64.
 * @param {Buffer} values.saltBytes - Decoded salt bytes.
 * @param {number} values.iterations - PBKDF2 iteration count.
 * @returns {string[]} Output lines.
 */
export function buildSecretLines(values) {
  const lines = [
    `INTERNAL_SHARED_SECRET=${generateInternalSecret()}`,
    `ADMIN_PASSWORD_HASH=${derivePasswordHash(values.password, values.saltBytes, values.iterations)}`,
    `ADMIN_PASSWORD_SALT=${values.saltBase64}`,
    `ADMIN_PASSWORD_ITERATIONS=${values.iterations}`,
  ];

  if (values.passwordGenerated) {
    lines.push(`ADMIN_PASSWORD=${values.password}`);
  }

  return lines;
}

/**
 * Runs the secret generation.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @returns {void}
 */
export function run(argv) {
  const options = parseArguments(argv);

  if (options.help) {
    printHelp();
    return;
  }

  const passwordGenerated = options.password === undefined;
  const password = passwordGenerated ? generatePassword() : options.password;
  const saltBase64 = options.salt ?? randomBytes(PARAMETERS.saltBytes).toString('base64');
  const saltBytes = decodeSalt(saltBase64);
  const iterations = options.iterations ?? PARAMETERS.iterations;

  console.error(
    'Aviso: no confirmes estos valores en el repositorio. ' +
      'Guarda .dev.vars solo en local; git ya lo ignora.',
  );

  const lines = buildSecretLines({
    password,
    passwordGenerated,
    saltBase64,
    saltBytes,
    iterations,
  });

  console.log(lines.join('\n'));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    run(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
