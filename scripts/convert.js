#!/usr/bin/env node
/**
 * @module convert
 * Command-line converter for MindMup v3 .mup files.
 *
 * Flags:
 * - --input <dir>      Input directory.
 * - --output <dir>     Output directory.
 * - --recursive        Walk subdirectories.
 * - --html             Also write a self-contained HTML file.
 * - --config <file>    JSON configuration file (default: config.local.json).
 * - --help             Show this help.
 *
 * Existing JSON or HTML outputs are never overwritten; they are skipped.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMup } from '../src/converter/layers/layer1-parse.js';
import { flattenNodes } from '../src/converter/layers/layer2-flatten.js';
import { extractNotes } from '../src/converter/layers/layer3-notes.js';
import { extractAttributes } from '../src/converter/layers/layer4-attributes.js';
import { extractStickers } from '../src/converter/layers/layer5-stickers.js';
import { extractUrls } from '../src/converter/layers/layer6-urls.js';
import { assembleResult } from '../src/converter/layers/layer7-assemble.js';
import { URL_CLASSIFIER } from '../src/converter/url-classifier.js';
import { normalizeOutputName } from '../src/shared/output-name.js';
import { buildTree } from '../src/visualizer/layers/layer2-tree-builder.js';
import { attachData } from '../src/visualizer/layers/layer3-attacher.js';
import { applyStyles } from '../src/visualizer/layers/layer4-styler.js';
import { renderTree } from '../src/visualizer/layers/layer5-renderer.js';
import { assembleHTML } from '../src/visualizer/layers/layer6-assembler.js';

const VARIABLES = Object.freeze({
  MUP_FORMAT_VERSION: 3,
  MUP_KEY_IDEAS: 'ideas',
  DEFAULT_LINK_RESOLUTION: 'unresolved',
  DEFAULT_STICKER_CATEGORY: 'unknown',
  DEFAULT_REF_TYPE: 'web_page',
  URL_REGEX_PATTERN: '(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)',
});

const DEFAULT_CONFIG_FILE = 'config.local.json';

/**
 * Prints command-line help.
 */
function printHelp() {
  console.log(`Uso:
  node scripts/convert.js --input <carpeta> --output <carpeta> [opciones]

Opciones:
  --input <carpeta>     Carpeta de entrada.
  --output <carpeta>    Carpeta de salida.
  --recursive           Recorre subcarpetas.
  --html                Genera también el HTML autocontenido.
  --config <archivo>    Configuración local (por defecto: config.local.json).
  --help                Muestra esta ayuda.

Los archivos de salida existentes no se sobrescriben.`);
}

/**
 * Parses command-line arguments.
 *
 * @param {string[]} argv - Arguments without the node and script entries.
 * @returns {{help: boolean, input: (string|undefined), output: (string|undefined), recursive: boolean, html: boolean, config: string}}
 */
export function parseArguments(argv) {
  const options = {
    help: false,
    input: undefined,
    output: undefined,
    recursive: false,
    html: false,
    config: DEFAULT_CONFIG_FILE,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
    } else if (argument === '--recursive') {
      options.recursive = true;
    } else if (argument === '--html') {
      options.html = true;
    } else if (argument === '--input') {
      options.input = argv[index + 1];
      index += 1;
    } else if (argument === '--output') {
      options.output = argv[index + 1];
      index += 1;
    } else if (argument === '--config') {
      options.config = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Opción desconocida: ${argument}`);
    }
  }

  return options;
}

/**
 * Reads the local configuration file if it exists.
 *
 * @param {string} configPath - Configuration path.
 * @returns {{inputDir?: string, outputDir?: string}}
 */
function readLocalConfig(configPath) {
  const absolutePath = resolve(configPath);
  if (!existsSync(absolutePath)) return {};

  let document;
  try {
    document = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`No se pudo leer la configuración "${configPath}": ${error.message}`);
  }

  return document.local || {};
}

/**
 * Resolves the input and output directories from flags, environment and config.
 *
 * @param {Object} options - Parsed options.
 * @returns {{inputDir: string, outputDir: string}}
 */
function resolveDirectories(options) {
  const config = readLocalConfig(options.config);
  const inputDir = options.input
    || process.env.MUP_INPUT_DIR
    || config.inputDir;
  const outputDir = options.output
    || process.env.MUP_OUTPUT_DIR
    || config.outputDir;

  if (!inputDir || !outputDir) {
    throw new Error(
      'Faltan las carpetas de entrada o salida. Usa --input/--output, ' +
        'MUP_INPUT_DIR/MUP_OUTPUT_DIR o config.local.json.',
    );
  }

  return { inputDir: resolve(inputDir), outputDir: resolve(outputDir) };
}

/**
 * Lists .mup files in a directory, optionally recursively.
 *
 * @param {string} directory - Directory to scan.
 * @param {boolean} recursive - Whether to walk subdirectories.
 * @returns {string[]} Absolute file paths.
 */
function listMupFiles(directory, recursive) {
  const files = [];
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry);
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) {
      if (recursive) files.push(...listMupFiles(absolutePath, recursive));
    } else if (stats.isFile() && extname(entry).toLowerCase() === '.mup') {
      files.push(absolutePath);
    }
  }
  return files.sort();
}

/**
 * Converts one .mup file and returns the JSON-CMJN result without writing it.
 *
 * @param {string} inputPath - Source .mup file.
 * @returns {Object} JSON-CMJN result.
 */
export function convertMup(inputPath) {
  const rawJson = JSON.parse(readFileSync(inputPath, 'utf8'));
  const { metadata } = parseMup(rawJson, VARIABLES);
  const nodes = flattenNodes(rawJson, metadata, VARIABLES.MUP_KEY_IDEAS);
  const notes = extractNotes(nodes, rawJson);
  const attributes = extractAttributes(nodes, rawJson);
  const stickers = extractStickers(nodes, rawJson, VARIABLES.DEFAULT_STICKER_CATEGORY);
  const externalRefs = extractUrls(
    nodes,
    rawJson,
    URL_CLASSIFIER,
    VARIABLES.DEFAULT_REF_TYPE,
    VARIABLES.URL_REGEX_PATTERN,
  );

  metadata.source_file = basename(inputPath);
  metadata.converted_at = new Date().toISOString();
  metadata.node_count = nodes.length;

  return assembleResult(
    { metadata, rawJson },
    nodes,
    notes,
    attributes,
    stickers,
    externalRefs,
    VARIABLES,
  );
}

/**
 * Converts one .mup file.
 *
 * @param {string} inputPath - Source .mup file.
 * @param {string} outputDir - Output directory.
 * @param {{html: boolean}} options - Conversion options.
 * @returns {{jsonPath: string, htmlPath: (string|null), skipped: boolean}}
 */
export function convertFile(inputPath, outputDir, options = { html: false }) {
  const baseName = normalizeOutputName(basename(inputPath, extname(inputPath)));
  const jsonPath = join(outputDir, `${baseName}.json`);
  const htmlPath = options.html ? join(outputDir, `${baseName}.html`) : null;

  if (existsSync(jsonPath) || (htmlPath && existsSync(htmlPath))) {
    return { jsonPath, htmlPath, skipped: true };
  }

  const result = convertMup(inputPath);
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

  if (htmlPath) {
    const tree = buildTree(result.nodes);
    attachData(tree, result.notes, result.externalRefs, result.links, result.stickers, result.icons);
    applyStyles(tree, result.attributes);
    const treeHTML = renderTree(tree, result.metadata);
    const html = assembleHTML(treeHTML, result.metadata, result.links, result.stickers, result.icons, [], {});
    writeFileSync(htmlPath, html, 'utf8');
  }

  return { jsonPath, htmlPath, skipped: false };
}

/**
 * Runs the conversion over a directory.
 *
 * @param {Object} options - Parsed options.
 * @returns {{converted: number, skipped: number, failed: number}}
 */
export function run(options) {
  const { inputDir, outputDir } = resolveDirectories(options);
  mkdirSync(outputDir, { recursive: true });

  const files = listMupFiles(inputDir, options.recursive);
  const summary = { converted: 0, skipped: 0, failed: 0 };

  for (const file of files) {
    try {
      const result = convertFile(file, outputDir, { html: options.html });
      if (result.skipped) {
        summary.skipped += 1;
        console.log(`⏭️  Omitido (ya existe): ${basename(file)}`);
      } else {
        summary.converted += 1;
        console.log(`✅ Convertido: ${basename(file)} -> ${basename(result.jsonPath)}`);
      }
    } catch (error) {
      summary.failed += 1;
      console.error(`❌ Error en ${basename(file)}: ${error.message}`);
    }
  }

  return summary;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const summary = run(options);
      console.log(`\nResumen: ${summary.converted} convertidos, ${summary.skipped} omitidos, ${summary.failed} fallidos.`);
      if (summary.failed > 0) process.exitCode = 1;
    }
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
