#!/usr/bin/env node
/**
 * @module convertir-local
 * Local conversion utility kept for compatibility with the previous project.
 *
 * Scope: root of the input directory, no recursion and no HTML generation.
 * Paths come from config.local.json and can be overridden with MUP_INPUT_DIR,
 * MUP_OUTPUT_DIR and MUP_CONFIG_FILE. Existing outputs are skipped.
 */

import { run } from './convert.js';

const options = {
  input: process.env.MUP_INPUT_DIR,
  output: process.env.MUP_OUTPUT_DIR,
  recursive: false,
  html: false,
  config: process.env.MUP_CONFIG_FILE || 'config.local.json',
  help: false,
};

try {
  const summary = run(options);
  console.log(`\nResumen: ${summary.converted} convertidos, ${summary.skipped} omitidos, ${summary.failed} fallidos.`);
  if (summary.failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
