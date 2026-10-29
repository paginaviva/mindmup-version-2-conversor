#!/usr/bin/env node
/**
 * @module validate-config
 * Validates the local configuration and variables documents before they are
 * deployed or used by the converter.
 *
 * Flags:
 * - --config <file>     Configuration file (default: config.local.json).
 * - --variables <file>  Variables file (default: config.variables.local.json).
 * - --help              Show this help.
 *
 * The script only reads files. Validation failures are reported to stderr and
 * exit with code 1; nothing is swallowed.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateConfig, validateVariables } from '../src/shared/config.js';

/** Default configuration file, resolved from the current working directory. */
const DEFAULT_CONFIG_FILE = 'config.local.json';

/** Default variables file, resolved from the current working directory. */
const DEFAULT_VARIABLES_FILE = 'config.variables.local.json';

/**
 * Prints command-line help.
 *
 * @returns {void}
 */
function printHelp() {
  console.log(`Uso:
  node scripts/validate-config.js [opciones]

Opciones:
  --config <archivo>      Configuración local (por defecto: config.local.json).
  --variables <archivo>   Variables locales (por defecto: config.variables.local.json).
  --help                  Muestra esta ayuda.

Valida ambos archivos y termina con código 1 si alguno no es válido.`);
}

/**
 * Reads the value that follows an option flag.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @param {number} index - Index of the option flag.
 * @param {string} flag - Option flag being parsed.
 * @returns {string} Option value.
 * @throws {Error} When the option has no value.
 */
function readOptionValue(argv, index, flag) {
  const value = argv[index + 1];

  if (value === undefined || value.startsWith('--')) {
    throw new Error(`La opción ${flag} requiere un archivo.`);
  }

  return value;
}

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @returns {{help: boolean, config: string, variables: string}} Parsed options.
 * @throws {Error} When an option is unknown or lacks a value.
 */
export function parseArguments(argv) {
  const options = {
    help: false,
    config: DEFAULT_CONFIG_FILE,
    variables: DEFAULT_VARIABLES_FILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help') {
      options.help = true;
    } else if (argument === '--config') {
      options.config = readOptionValue(argv, index, argument);
      index += 1;
    } else if (argument === '--variables') {
      options.variables = readOptionValue(argv, index, argument);
      index += 1;
    } else {
      throw new Error(`Opción desconocida: ${argument}`);
    }
  }

  return options;
}

/**
 * Reads and parses one JSON file.
 *
 * @param {string} filePath - File path provided by the user.
 * @param {string} label - Spanish document label used in error messages.
 * @returns {*} Parsed JSON document.
 * @throws {Error} When the file is missing, unreadable or not valid JSON.
 */
export function readJsonFile(filePath, label) {
  let raw;

  try {
    raw = readFileSync(resolve(filePath), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`No se encontró el archivo de ${label} "${filePath}".`);
    }
    throw new Error(`No se pudo leer el archivo de ${label} "${filePath}": ${error.message}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`El archivo de ${label} "${filePath}" no contiene JSON válido: ${error.message}`);
  }
}

/**
 * Validates both documents and counts the variables keys that were checked.
 *
 * @param {*} config - Parsed configuration document.
 * @param {*} variables - Parsed variables document.
 * @returns {{converterKeyCount: number, visualizerKeyCount: number}} Counts.
 * @throws {Error} When either document violates its schema.
 */
export function validateDocuments(config, variables) {
  validateConfig(config);
  const validatedVariables = validateVariables(variables);

  return {
    converterKeyCount: Object.keys(validatedVariables.converter).length,
    visualizerKeyCount: Object.keys(validatedVariables.visualizer).length,
  };
}

/**
 * Runs the validation workflow.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @returns {void}
 */
function main(argv) {
  const options = parseArguments(argv);

  if (options.help) {
    printHelp();
    return;
  }

  const config = readJsonFile(options.config, 'configuración');
  const variables = readJsonFile(options.variables, 'variables');
  const { converterKeyCount, visualizerKeyCount } = validateDocuments(config, variables);

  console.log(
    `Configuración válida: ${converterKeyCount} claves del convertidor y ` +
      `${visualizerKeyCount} claves del visualizador.`,
  );
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
