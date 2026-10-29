#!/usr/bin/env node
/**
 * @module verify-equivalence
 * Compares a conversion produced by the new engine with a reference JSON-CMNJ.
 *
 * Random UUIDs and the conversion timestamp are canonicalized before the
 * comparison. Everything else must match exactly.
 *
 * Usage:
 *   node scripts/verify-equivalence.js --mup <map.mup> --expected <reference.json>
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertMup } from './convert.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv - Arguments without node and script.
 * @returns {{mup?: string, expected?: string, help: boolean}}
 */
export function parseArguments(argv) {
  const options = { mup: undefined, expected: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--mup') {
      options.mup = argv[index + 1];
      index += 1;
    } else if (argument === '--expected') {
      options.expected = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Opción desconocida: ${argument}`);
    }
  }
  return options;
}

/**
 * Canonicalizes random identifiers and timestamps.
 *
 * @param {*} value - JSON value.
 * @param {Map<string, string>} identifiers - UUID mapping.
 * @returns {*} Canonical value.
 */
export function canonicalize(value, identifiers = new Map()) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry, identifiers));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'converted_at') {
        result[key] = '<timestamp>';
      } else if (key === 'source_file' && typeof entry === 'string') {
        result[key] = basename(entry.replace(/\.mup$/i, '')) + '.mup';
      } else {
        result[key] = canonicalize(entry, identifiers);
      }
    }
    return result;
  }

  if (typeof value === 'string' && UUID_PATTERN.test(value)) {
    if (!identifiers.has(value)) {
      identifiers.set(value, `UUID_${identifiers.size + 1}`);
    }
    return identifiers.get(value);
  }

  return value;
}

/**
 * Finds the first structural difference between two values.
 *
 * @param {*} left - First value.
 * @param {*} right - Second value.
 * @param {string} [path='$'] - Current path.
 * @returns {string|null} Description of the first difference, or null.
 */
export function firstDifference(left, right, path = '$') {
  if (Object.is(left, right)) return null;

  if (typeof left !== typeof right) {
    return `${path}: tipo ${typeof left} frente a ${typeof right}`;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return `${path}: array frente a no array`;
    }
    if (left.length !== right.length) {
      return `${path}: longitud ${left.length} frente a ${right.length}`;
    }
    for (let index = 0; index < left.length; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }

  if (left && right && typeof left === 'object' && typeof right === 'object') {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.join('|') !== rightKeys.join('|')) {
      return `${path}: claves ${leftKeys.join(',')} frente a ${rightKeys.join(',')}`;
    }
    for (const key of leftKeys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }

  return `${path}: ${JSON.stringify(left)} frente a ${JSON.stringify(right)}`;
}

/**
 * Runs the comparison.
 *
 * @param {string} mupPath - Source .mup file.
 * @param {string} expectedPath - Reference JSON file.
 * @returns {{equal: boolean, difference: (string|null)}}
 */
export function verify(mupPath, expectedPath) {
  const expected = JSON.parse(readFileSync(resolve(expectedPath), 'utf8'));
  const actual = convertMup(resolve(mupPath));
  const difference = firstDifference(
    canonicalize(expected),
    canonicalize(actual),
  );
  return { equal: difference === null, difference };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help || !options.mup || !options.expected) {
      console.log(`Uso:
  node scripts/verify-equivalence.js --mup <mapa.mup> --expected <referencia.json>

Compara la conversión nueva con un JSON-CMNJ de referencia. Los UUID y la
fecha de conversión se normalizan antes de comparar.`);
      process.exitCode = options.help ? 0 : 1;
    } else {
      const result = verify(options.mup, options.expected);
      if (result.equal) {
        console.log(`✅ Equivalencia correcta: ${basename(options.mup)}`);
      } else {
        console.error(`❌ Diferencia: ${result.difference}`);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
