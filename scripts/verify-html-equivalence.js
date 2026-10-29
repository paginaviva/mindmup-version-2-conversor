#!/usr/bin/env node
/**
 * @module verify-html-equivalence
 * Compares the HTML generated from a new conversion with the HTML generated
 * from a reference JSON-CMNJ. UUIDs and timestamps are masked.
 *
 * Usage:
 *   node scripts/verify-html-equivalence.js --mup <map.mup> --expected <reference.json>
 */

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { convertMup } from './convert.js';
import { buildTree } from '../src/visualizer/layers/layer2-tree-builder.js';
import { attachData } from '../src/visualizer/layers/layer3-attacher.js';
import { applyStyles } from '../src/visualizer/layers/layer4-styler.js';
import { renderTree } from '../src/visualizer/layers/layer5-renderer.js';
import { assembleHTML } from '../src/visualizer/layers/layer6-assembler.js';

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;
const TIMESTAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;
const HUMAN_DATE_PATTERN = /\d{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre) de \d{4} a las \d{2}:\d{2}/g;

/**
 * Generates the self-contained HTML for a JSON-CMJN document.
 *
 * @param {Object} json - JSON-CMJN document.
 * @returns {string} HTML.
 */
export function renderHtml(json) {
  const tree = buildTree(json.nodes);
  attachData(tree, json.notes, json.externalRefs, json.links, json.stickers, json.icons);
  applyStyles(tree, json.attributes);
  const treeHTML = renderTree(tree, json.metadata);
  return assembleHTML(treeHTML, json.metadata, json.links, json.stickers, json.icons, [], {});
}

/**
 * Masks random identifiers and timestamps in HTML.
 *
 * @param {string} html - HTML source.
 * @returns {string} Masked HTML.
 */
export function maskHtml(html) {
  return html
    .replace(UUID_PATTERN, '<uuid>')
    .replace(TIMESTAMP_PATTERN, '<timestamp>')
    .replace(HUMAN_DATE_PATTERN, '<date>');
}

/**
 * Compares the HTML generated from the new conversion and the reference JSON.
 *
 * @param {string} mupPath - Source .mup file.
 * @param {string} expectedPath - Reference JSON file.
 * @returns {{equal: boolean, detail: string}}
 */
export function verify(mupPath, expectedPath) {
  const expected = JSON.parse(readFileSync(resolve(expectedPath), 'utf8'));
  const actual = convertMup(resolve(mupPath));
  const left = maskHtml(renderHtml(expected));
  const right = maskHtml(renderHtml(actual));

  if (left === right) {
    return { equal: true, detail: `${basename(mupPath)}: HTML equivalente` };
  }

  const leftLines = left.split('\n');
  const rightLines = right.split('\n');
  const max = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < max; index += 1) {
    if (leftLines[index] !== rightLines[index]) {
      return {
        equal: false,
        detail: `línea ${index + 1}: ${JSON.stringify(leftLines[index])} frente a ${JSON.stringify(rightLines[index])}`,
      };
    }
  }
  return { equal: false, detail: 'diferencia no localizada' };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const mupIndex = args.indexOf('--mup');
  const expectedIndex = args.indexOf('--expected');
  if (mupIndex === -1 || expectedIndex === -1) {
    console.log('Uso: node scripts/verify-html-equivalence.js --mup <mapa.mup> --expected <referencia.json>');
    process.exitCode = 1;
  } else {
    try {
      const result = verify(args[mupIndex + 1], args[expectedIndex + 1]);
      if (result.equal) {
        console.log(`✅ ${result.detail}`);
      } else {
        console.error(`❌ ${result.detail}`);
        process.exitCode = 1;
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
