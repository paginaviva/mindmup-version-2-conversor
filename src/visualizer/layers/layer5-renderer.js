/**
 * @module layer5-renderer
 * Layer 5: render the tree HTML with expandable/collapsible bullets.
 *
 * Responsibilities:
 * 1. Generate the HTML of the whole tree from the hierarchical structure
 *    (Layer 4).
 * 2. Recursive renderNode(): every node with a toggle, stickers, title, notes,
 *    refs and links.
 * 3. Main container with role='tree' and an aria-label for accessibility.
 * 4. Every node with role='treeitem' and aria-expanded for screen readers.
 * 5. Toggle ▶/▼ for nodes with children and a placeholder for leaves.
 * 6. Stickers converted to Unicode emojis with String.fromCodePoint and escaped
 *    with escapeHtml() (anti-XSS: emoji_display/raw_attributes are untrusted).
 * 7. Title escaped with escapeHtml() (anti-XSS).
 * 8. Background color as an inline style (background-color).
 * 9. Notes <=100 chars: inline div.note.short; >100 chars: details/summary
 *    accordion.
 * 10. External links as <a> with target='_blank' rel='noopener noreferrer',
 *     only for safe schemes http:, https: and mailto: (safeExternalHref);
 *     any other scheme (for example javascript:) degrades to a non-clickable
 *     <span class="ext-ref">🔗</span>.
 * 11. Links between nodes marked with data-links for the SVG overlay (Layer 6).
 * 12. Recursive children in div.children with indentation by depth (class
 *     depth-N).
 *
 * Principle: this function is PURE; it does not mutate the input tree. It
 * generates an HTML string consumed by Layer 6 (Assembler).
 *
 * Complexity: O(n), where n is the number of tree nodes (single traversal).
 */

import { convertEmoji } from '../utils/emoji-map.js';

// Re-export convertEmoji for consumers that import it from this layer (for
// example the visualizer test suite).
export { convertEmoji };

/**
 * Renders the complete HTML of the node tree.
 *
 * Receives the tree with styles, notes, refs and links (from Layer 4) plus the
 * map metadata. It produces an HTML string with a main role='tree' container
 * and recursive role='treeitem' nodes with toggles, emojis, notes and links.
 *
 * @param {Array<Object>} tree - Tree with styles and attached data (Layer 4).
 *   Every node must have: node_id, title, children[], style{}, stickers[],
 *   icons[], notes[], externalRefs[] and links[].
 * @param {Object} metadata - Map metadata (title, node_count, ...).
 *   Used for the main container aria-label.
 * @returns {string} Complete tree HTML ready to be assembled by Layer 6.
 *
 * @example
 * const tree = [{ node_id: 'a', title: 'Raíz', children: [], style: {}, stickers: [], icons: [], notes: [], externalRefs: [], links: [] }];
 * const html = renderTree(tree, { title: 'Mi mapa' });
 * // html contains <div id="tree-container" role="tree" ...>...</div>
 */
export function renderTree(tree, metadata) {
  const html = [];

  html.push('<div id="tree-container" role="tree" aria-label="Árbol de nodos">');

  for (const root of tree) {
    html.push(renderNode(root, 0));
  }

  html.push('</div>');

  return html.join('\n');
}

/**
 * Renders one node and its children recursively.
 *
 * Each node is rendered with:
 * - div.node.depth-N container with data-id, role='treeitem' and aria-expanded.
 * - Header with toggle (▶/▼), stickers (emojis), icons (<img>), attachment
 *   (📎 link when the node has attachment metadata: .attachment-link for text
 *   that opens the modal, .attachment-download for binary files that download
 *   directly) and the escaped title, followed by external links.
 * - Inline notes (<=100 chars) or a details/summary accordion (>100 chars).
 * - A data-links marker for the SVG overlay when the node has links.
 * - Recursive children in div.children (only when it has children).
 *
 * @param {Object} node - Tree node with all its properties. It must have:
 *   node_id, title, children[], style{}, stickers[], icons[], attachment
 *   (Object|null, with isBinary true for binary attachments), notes[],
 *   externalRefs[] and links[].
 * @param {number} depth - Node depth (0 = root). Used for the depth-N CSS class
 *   that controls indentation.
 * @returns {string} HTML of the node and its descendants.
 *
 * @example
 * const node = { node_id: 'a', title: 'Nodo', children: [], style: { backgroundColor: '#FF0000' },
 *   stickers: ['emoji:1F5FA'], icons: [], notes: [], externalRefs: [], links: [] };
 * const html = renderNode(node, 0);
 * // html contains <div class="node depth-0" data-id="a" ...>...</div>
 */
function renderNode(node, depth) {
  const html = [];
  const hasChildren = node.children.length > 0;
  const bgStyle = (node.style.backgroundColor && isValidHexColor(node.style.backgroundColor))
    ? `style="background-color: ${node.style.backgroundColor}"`
    : '';

  // Node container with ARIA attributes.
  html.push(`<div class="node depth-${depth}" data-id="${escapeHtml(node.node_id)}" role="treeitem" aria-expanded="true" ${bgStyle}>`);
  html.push('  <div class="node-header">');

  // Toggle: ▼/▶ triangle for nodes with children, placeholder for leaves.
  if (hasChildren) {
    html.push('    <span class="toggle" role="button" tabindex="0" aria-label="Expandir/colapsar">▼</span>');
  } else {
    html.push('    <span class="toggle-placeholder"></span>');
  }

  // Stickers converted to Unicode emojis. Each sticker may be:
  // - a string in "emoji:XXXX" format (Layer 4 / raw_attributes fallback).
  // - an object from the JSON stickers collection (attached by Layer 3) with
  //   emoji_display already resolved and emoji_code as a fallback.
  // The output of stickerToEmoji() is always escaped: the input data is
  // untrusted (emoji_display/raw_attributes may contain HTML).
  if (Array.isArray(node.stickers) && node.stickers.length > 0) {
    const emojis = node.stickers
      .map((s) => escapeHtml(stickerToEmoji(s)))
      .filter((e) => e !== '')
      .join(' ');
    html.push(`    <span class="stickers">${emojis}</span>`);
  }

  // Icons (images): every icon with a url produces an <img> tag with an escaped
  // src (URLs may be base64 data URIs or remote URLs), width and height when
  // present, and a descriptive alt (anti-XSS: escapeHtml on every dynamic
  // attribute).
  if (Array.isArray(node.icons) && node.icons.length > 0) {
    html.push('    <span class="icons">');
    for (const icon of node.icons) {
      if (!icon || typeof icon !== 'object' || !icon.url) continue;
      const widthAttr = icon.width ? ` width="${escapeHtml(icon.width)}"` : '';
      const heightAttr = icon.height ? ` height="${escapeHtml(icon.height)}"` : '';
      html.push(`      <img class="node-icon" src="${escapeHtml(icon.url)}"${widthAttr}${heightAttr} alt="Icono del nodo" />`);
    }
    html.push('    </span>');
  }

  // Escaped title (anti-XSS).
  html.push(`    <span class="title">${escapeHtml(node.title)}</span>`);

  // Attachment: when the node has file attachment metadata (name), render a
  // link according to the classification computed by Layer 4
  // (node.attachment.isBinary):
  // - Text (isBinary false/missing): 📎 link that opens the internal modal
  //   (Layer 6). The content is NOT decoded here: Layer 6 reads it from the
  //   node data (MMUP_DATA.attachments) when the user clicks.
  // - Binary (isBinary true): direct download link 📎 with class
  //   .attachment-download, href="#" as a placeholder and a download attribute
  //   with the file name. Layer 6 assigns the real href (data URI of the
  //   content from MMUP_DATA.attachments) so the binary content is not
  //   duplicated in the tree HTML. It never opens the modal.
  if (node.attachment && node.attachment.name) {
    const attachmentName = escapeHtml(node.attachment.name);
    const nodeId = escapeHtml(node.node_id);
    if (node.attachment.isBinary === true) {
      html.push(
        `    <a href="#" class="attachment-download" data-node-id="${nodeId}" ` +
        `download="${attachmentName}" ` +
        `title="Descargar adjunto: ${attachmentName}" aria-label="Descargar adjunto ${attachmentName}">📎</a>`
      );
    } else {
      html.push(
        `    <a href="#" class="attachment-link" data-node-id="${nodeId}" ` +
        `title="Ver adjunto: ${attachmentName}" aria-label="Ver adjunto ${attachmentName}">📎</a>`
      );
    }
  }

  // External links with target="_blank" and rel="noopener noreferrer".
  // An <a> is emitted only when the scheme is safe (http:, https:, mailto:); a
  // dangerous scheme (javascript:, data:, vbscript:...) degrades to a
  // non-clickable span: the input data is untrusted.
  if (node.externalRefs.length > 0) {
    html.push('    <span class="ext-refs">');
    for (const ref of node.externalRefs) {
      const label = ref.label || ref.url;
      const href = safeExternalHref(ref.url);
      if (href) {
        html.push(`      <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(label)}">🔗</a>`);
      } else {
        html.push('      <span class="ext-ref">🔗</span>');
      }
    }
    html.push('    </span>');
  }
  html.push('  </div>');

  // Notes: inline when <=100 chars, details/summary accordion when >100 chars.
  if (node.notes.length > 0) {
    html.push('  <div class="node-notes">');
    for (const note of node.notes) {
      if (note.char_count <= 100) {
        html.push(`    <div class="note short">${escapeHtml(note.text)}</div>`);
      } else {
        html.push(`    <details class="note long">`);
        html.push(`      <summary>Nota (${escapeHtml(note.char_count)} caracteres)</summary>`);
        html.push(`      <div class="note-body">${escapeHtml(note.text)}</div>`);
        html.push(`    </details>`);
      }
    }
    html.push('  </div>');
  }

  // Links between nodes: hidden marker for the SVG overlay (Layer 6).
  if (node.links.length > 0) {
    html.push(`  <div class="node-links" data-links="${node.links.length}"></div>`);
  }

  // Recursive children in div.children.
  if (hasChildren) {
    html.push('  <div class="children">');
    for (const child of node.children) {
      html.push(renderNode(child, depth + 1));
    }
    html.push('  </div>');
  }

  html.push('</div>');
  return html.join('\n');
}

/**
 * Schemes allowed in external links.
 *
 * @private
 * @type {Set<string>}
 */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * Validates the URL of an external link and returns a safe href.
 *
 * Allow list of schemes: http:, https: and mailto:. Any other scheme
 * (javascript:, data:, vbscript:, file:...) or a URL that cannot be parsed
 * returns null, so rendering degrades it to a non-clickable span. This prevents
 * script execution when clicking links from untrusted maps.
 *
 * Pure function: it does not mutate its input and has no side effects.
 *
 * @param {*} url - URL to validate (a string is expected).
 * @returns {string|null} Sanitized URL (without surrounding whitespace) or null
 *   when the scheme is not allowed or the URL is invalid.
 *
 * @example
 * safeExternalHref('https://example.com')  // -> 'https://example.com'
 * safeExternalHref('mailto:a@b.c')         // -> 'mailto:a@b.c'
 * safeExternalHref('javascript:alert(1)')  // -> null
 * safeExternalHref('/ruta-relativa')       // -> null
 */
export function safeExternalHref(url) {
  if (typeof url !== 'string') return null;

  const trimmed = url.trim();
  if (trimmed === '') return null;

  try {
    const parsed = new URL(trimmed);
    return SAFE_EXTERNAL_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
  } catch {
    // Unparseable URL (relative, malformed, ...) -> not a safe link.
    return null;
  }
}

/**
 * Checks whether a string is a valid six-digit hexadecimal color.
 *
 * Used to sanitize backgroundColor values before inserting them into style=""
 * attributes. Only six-digit hexadecimal colors with a # prefix are accepted,
 * which prevents CSS injection or XSS through malicious values such as
 * '#FF0000" onclick="alert(1)'.
 *
 * Short formats (#RGB), rgb(), rgba() and color names are not accepted because
 * the system only generates six-digit hexadecimal colors.
 *
 * @private
 * @param {string} color - Color to validate.
 * @returns {boolean} true when the color is a valid #RRGGBB value.
 *
 * @example
 * isValidHexColor('#FF0000')  // -> true
 * isValidHexColor('#ff0000')  // -> true
 * isValidHexColor('#FFF')     // -> false (short format not accepted)
 * isValidHexColor('red')      // -> false
 * isValidHexColor('#FF0000" onclick="xss')  // -> false
 */
function isValidHexColor(color) {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Converts a sticker (string or object) to its Unicode character.
 *
 * Handles both formats in which node.stickers may arrive:
 * - A string with the "emoji:XXXX" prefix: converted with convertEmoji() (which
 *   supports multiple code points and variation selectors).
 * - An object from the JSON stickers collection (attached by Layer 3) with
 *   emoji_code and emoji_display fields: emoji_display is used directly, with
 *   convertEmoji(emoji_code) as a fallback when the display value is missing.
 *
 * @param {string|Object} sticker - Sticker to convert.
 * @returns {string} Unicode emoji of the sticker, or an empty string when it is
 *   invalid.
 */
function stickerToEmoji(sticker) {
  if (typeof sticker === 'string') {
    return convertEmoji(sticker);
  }
  if (sticker && typeof sticker === 'object') {
    // Prefer emoji_display when it is a non-empty string (avoids injecting the
    // literal "undefined" from malformed third-party objects).
    if (typeof sticker.emoji_display === 'string' && sticker.emoji_display.length > 0) {
      return sticker.emoji_display;
    }
    if (typeof sticker.emoji_code === 'string' && sticker.emoji_code.length > 0) {
      return convertEmoji(sticker.emoji_code);
    }
  }
  return '';
}

/**
 * Escapes the special characters of a text for safe HTML insertion.
 *
 * Replaces the five dangerous HTML characters with their entities:
 * - & -> &amp;
 * - < -> &lt;
 * - > -> &gt;
 * - " -> &quot;
 * - ' -> &#039;
 *
 * This function is critical to prevent XSS. It is applied to every dynamic
 * value inserted into the HTML (titles, notes, URLs and labels).
 *
 * @param {string} text - Text to escape. Non-string values are converted.
 * @returns {string} Escaped text, safe to insert into HTML.
 *
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // -> '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
