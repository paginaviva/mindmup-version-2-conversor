/**
 * @module html-bundle
 * Builds a self-contained ZIP bundle from a rendered HTML document.
 *
 * Responsibilities:
 * 1. Find remote render resources in the HTML (images, sources, video posters,
 *    relevant <link> targets, SVG <image> targets, srcset candidates and CSS
 *    url(...) references).
 * 2. Reject unsafe remote targets before any network request (http/https only,
 *    no localhost, .local, cloud metadata hosts or private IP ranges).
 * 3. Download the safe resources with explicit per-resource and total limits.
 * 4. Rewrite the HTML so every downloaded resource points to a relative path
 *    inside a "<baseName>_archivos/" directory.
 * 5. Assemble the ZIP with the rewritten HTML, the downloaded assets and an
 *    optional "faltantes.txt" report.
 *
 * The module is deliberately dependency-free and uses only web platform APIs
 * (URL, fetch, AbortController, Uint8Array). It does not import Node modules.
 */

import { createZip } from './zip.js';

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Maximum number of resources considered for one bundle. */
const MAX_ASSETS = 50;

/** Maximum size of a single downloaded resource (5 MB). */
const MAX_ASSET_BYTES = 5 * 1024 * 1024;

/** Maximum combined size of all downloaded resources (20 MB). */
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

/** Maximum accepted HTML document size (30 MB). */
const MAX_HTML_BYTES = 30 * 1024 * 1024;

/** Maximum number of unique resource URLs extracted from one document. */
const MAX_EXTRACTED_URLS = 1000;

/** Maximum accepted length of a resource URL, in characters. */
const MAX_URL_LENGTH = 2048;

/** Hard deadline for the whole bundle download phase, in milliseconds. */
const GLOBAL_TIMEOUT_MS = 60_000;

/** Network timeout for the whole resource download, in milliseconds. */
const FETCH_TIMEOUT_MS = 15_000;

/** Maximum number of redirects followed for one resource. */
const MAX_REDIRECTS = 5;

/** HTTP status codes that are treated as redirects. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * Link rel values whose href points to a render resource that should travel
 * with the HTML. Navigation/relation links (canonical, alternate, next, ...)
 * are intentionally excluded.
 */
const RELEVANT_LINK_RELS = new Set([
  'stylesheet',
  'icon',
  'apple-touch-icon',
  'apple-touch-icon-precomposed',
  'mask-icon',
  'manifest',
  'preload',
  'apple-touch-startup-image',
]);

// ---------------------------------------------------------------------------
// HTML scanning patterns
// ---------------------------------------------------------------------------

/**
 * Opening HTML/SVG tag. Quoted attribute values may contain ">".
 *
 * @type {RegExp}
 */
const TAG_PATTERN = /<([a-zA-Z][a-zA-Z0-9:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;

/**
 * CSS url(...) reference with optional single or double quotes.
 *
 * @type {RegExp}
 */
const CSS_URL_PATTERN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/gi;

/** HTML comment. */
const COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

// ---------------------------------------------------------------------------
// Public API: extraction and rewriting
// ---------------------------------------------------------------------------

/**
 * Extracts the remote render resource URLs referenced by an HTML document.
 *
 * Supported sources:
 * - <img src> and <img srcset>
 * - <source src> and <source srcset>
 * - <video poster>
 * - relevant <link href> (stylesheet, icon, manifest, preload, ...)
 * - SVG <image href> and <image xlink:href>
 * - srcset attributes on any element
 * - CSS url(...) in <style> blocks and style attributes
 *
 * Only absolute http/https URLs are returned. data:, blob:, fragment-only,
 * relative, mailto: and javascript: values are ignored. Results are unique and
 * keep their first document order. Navigation links (<a href>) are never
 * included.
 *
 * @param {string} html - HTML document.
 * @returns {string[]} Unique remote resource URLs.
 */
export function extractAssetUrls(html) {
  if (typeof html !== 'string' || html.length === 0) return [];

  const commentRanges = getCommentRanges(html);
  const found = [];
  let order = 0;

  TAG_PATTERN.lastIndex = 0;
  let tagMatch;
  while ((tagMatch = TAG_PATTERN.exec(html)) !== null) {
    if (isInsideComment(tagMatch.index, commentRanges)) continue;

    const tagName = tagMatch[1].toLowerCase();
    const attributes = tagMatch[2];
    const tagUrls = [];
    collectTagUrls(tagName, attributes, (url) => tagUrls.push(url));

    for (const url of tagUrls) {
      found.push({ index: tagMatch.index, order: order++, url });
    }
  }

  CSS_URL_PATTERN.lastIndex = 0;
  let cssMatch;
  while ((cssMatch = CSS_URL_PATTERN.exec(html)) !== null) {
    if (isInsideComment(cssMatch.index, commentRanges)) continue;

    const raw = cssMatch[1] ?? cssMatch[2] ?? cssMatch[3] ?? '';
    const url = normalizeCandidate(raw);
    if (isRemoteHttpUrl(url)) {
      found.push({ index: cssMatch.index, order: order++, url });
    }
  }

  found.sort((a, b) => a.index - b.index || a.order - b.order);

  const urls = [];
  const seen = new Set();
  for (const item of found) {
    if (urls.length >= MAX_EXTRACTED_URLS) break;
    if (
      item.url.length > MAX_URL_LENGTH ||
      !isRemoteHttpUrl(item.url) ||
      seen.has(item.url)
    ) {
      continue;
    }
    seen.add(item.url);
    urls.push(item.url);
  }
  return urls;
}

/**
 * Rewrites every resource reference present in a mapping inside the HTML.
 *
 * The mapping is keyed by the original absolute URL (the same values returned
 * by extractAssetUrls) and its values are the new relative paths. Only the
 * same locations scanned by extractAssetUrls are rewritten; <a href> is left
 * untouched because it represents navigation, not a render resource.
 *
 * @param {string} html - HTML document.
 * @param {Map<string, string>} mapping - Original URL to relative path.
 * @returns {string} HTML with mapped URLs replaced.
 */
export function rewriteAssetUrls(html, mapping) {
  if (
    typeof html !== 'string' ||
    !(mapping instanceof Map) ||
    mapping.size === 0
  ) {
    return html;
  }

  const lookup = (rawValue) => {
    const original = normalizeCandidate(rawValue);
    if (!mapping.has(original)) return rawValue;

    const replacement = mapping.get(original);
    return typeof replacement === 'string' && replacement.length > 0
      ? replacement
      : rawValue;
  };

  const commentRanges = getCommentRanges(html);

  TAG_PATTERN.lastIndex = 0;
  let rewritten = html.replace(
    TAG_PATTERN,
    (match, tagName, attributes, offset) => {
      if (isInsideComment(offset, commentRanges)) return match;

      const nextAttributes = rewriteTagAttributes(
        tagName.toLowerCase(),
        attributes,
        lookup
      );
      return nextAttributes === attributes
        ? match
        : `<${tagName}${nextAttributes}>`;
    }
  );

  // Tag rewrites may change string length, so recompute comment offsets
  // before the CSS pass.
  const updatedCommentRanges = getCommentRanges(rewritten);

  CSS_URL_PATTERN.lastIndex = 0;
  rewritten = rewritten.replace(
    CSS_URL_PATTERN,
    (match, doubleQuoted, singleQuoted, unquoted, offset) => {
      if (isInsideComment(offset, updatedCommentRanges)) return match;

      const raw = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
      const next = lookup(raw);
      if (next === raw) return match;

      if (doubleQuoted !== undefined) {
        return `url("${escapeCssString(next, '"')}")`;
      }
      if (singleQuoted !== undefined) {
        return `url('${escapeCssString(next, "'")}')`;
      }
      if (/^[^\s"'()]+$/.test(next)) {
        return `url(${next})`;
      }
      return `url("${escapeCssString(next, '"')}")`;
    }
  );

  return rewritten;
}

// ---------------------------------------------------------------------------
// Public API: remote URL safety
// ---------------------------------------------------------------------------

/**
 * Checks whether a URL may be fetched as a remote resource.
 *
 * Only absolute http/https URLs are accepted and the port must be empty, 80
 * or 443. The following targets are rejected:
 * - localhost and *.localhost
 * - *.local mDNS names
 * - wildcard DNS providers (nip.io, sslip.io, xip.io, localtest.me, lvh.me)
 * - internal-only domains (*.internal, *.lan, *.home.arpa)
 * - cloud metadata hosts (metadata.google.internal, instance-data, ...)
 * - private, loopback, link-local, CGNAT, multicast and reserved IPv4 ranges
 * - IPv6 loopback, unspecified, unique-local, link-local, multicast,
 *   documentation, IPv4-mapped private and NAT64 private addresses
 *
 * Host names are not resolved: a public name that resolves to a private
 * address cannot be detected here.
 *
 * @param {string} url - Candidate URL.
 * @returns {boolean} true when the URL is safe to fetch.
 */
export function isSafeRemoteUrl(url) {
  if (typeof url !== 'string') return false;

  const candidate = url.trim();
  if (candidate.length === 0) return false;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const port = parsed.port;
  if (port !== '' && port !== '80' && port !== '443') {
    return false;
  }

  const hostname = parsed.hostname;
  if (!hostname) return false;

  const bare = hostname
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .toLowerCase();

  if (bare.includes(':')) return isSafeIpv6(bare);
  if (isIpv4Literal(bare)) return isSafeIpv4(bare);
  return isSafeHostname(bare);
}

// ---------------------------------------------------------------------------
// Public API: bundle assembly
// ---------------------------------------------------------------------------

/**
 * Builds a self-contained ZIP bundle from an HTML document.
 *
 * The ZIP contains:
 * - "<baseName>.html" with relative asset paths
 * - "<baseName>_archivos/asset-001.<ext>", ...
 * - "faltantes.txt" only when at least one resource could not be included
 *
 * Downloads are sequential. Each resource is subject to a 15 second timeout
 * (including redirects and body read), a 5 MB size limit and the global
 * 20 MB limit. At most 50 resources are considered; URLs beyond that limit
 * are reported as missing. The whole download phase is bounded by a 60 second
 * global deadline.
 *
 * @param {string} html - HTML document to bundle.
 * @param {{ baseName: string, fetchImpl?: typeof fetch }} options - Bundle
 *   options. baseName is the published identifier used for the HTML file and
 *   asset directory.
 * @returns {Promise<{
 *   zip: Uint8Array,
 *   baseName: string,
 *   missing: Array<{ url: string, reason: string }>,
 *   assetCount: number
 * }>} Bundle result.
 * @throws {RangeError} When the HTML document exceeds MAX_HTML_BYTES.
 */
export async function buildHtmlBundle(html, options = {}) {
  if (typeof html !== 'string') {
    throw new TypeError('html must be a string');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('options must be an object');
  }
  if (html.length > MAX_HTML_BYTES) {
    throw new RangeError('El HTML supera el tamaño máximo para empaquetar');
  }

  const baseName = normalizeBaseName(options.baseName);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new TypeError(
      'options.fetchImpl must be a function or global fetch must be available'
    );
  }

  const urls = extractAssetUrls(html);
  const deadline = Date.now() + GLOBAL_TIMEOUT_MS;
  const mapping = new Map();
  const missing = [];
  const assetEntries = [];
  const assetDirectory = `${baseName}_archivos`;
  const encodedAssetDirectory = encodePath(assetDirectory);

  let considered = 0;
  let assetCount = 0;
  let totalBytes = 0;

  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];

    if (Date.now() >= deadline) {
      for (const remainingUrl of urls.slice(index)) {
        missing.push({
          url: remainingUrl,
          reason: 'tiempo global de empaquetado agotado',
        });
      }
      break;
    }

    if (considered >= MAX_ASSETS) {
      missing.push({ url, reason: 'límite de 50 recursos alcanzado' });
      continue;
    }
    considered += 1;

    if (!isSafeRemoteUrl(url)) {
      missing.push({ url, reason: 'URL remota no segura' });
      continue;
    }

    const remainingTotal = MAX_TOTAL_BYTES - totalBytes;
    if (remainingTotal <= 0) {
      missing.push({ url, reason: 'límite total de 20 MB alcanzado' });
      continue;
    }

    const maxBytes = Math.min(MAX_ASSET_BYTES, remainingTotal);
    const outcome = await downloadAsset(url, fetchImpl, maxBytes);

    if (!outcome.ok) {
      let reason = outcome.reason;
      if (outcome.tooLarge) {
        reason =
          remainingTotal < MAX_ASSET_BYTES
            ? 'límite total de 20 MB alcanzado'
            : 'límite de 5 MB por recurso alcanzado';
      }
      missing.push({ url, reason });
      continue;
    }

    const extension = chooseExtension(url, outcome.contentType);
    const fileName = `asset-${String(assetCount + 1).padStart(3, '0')}.${extension}`;
    const entryName = `${assetDirectory}/${fileName}`;
    const relativePath = `${encodedAssetDirectory}/${encodePath(fileName)}`;

    mapping.set(url, relativePath);
    assetEntries.push({ name: entryName, data: outcome.bytes });
    totalBytes += outcome.bytes.byteLength;
    assetCount += 1;
  }

  const rewrittenHtml = rewriteAssetUrls(html, mapping);
  const entries = [
    { name: `${baseName}.html`, data: rewrittenHtml },
    ...assetEntries,
  ];

  if (missing.length > 0) {
    entries.push({ name: 'faltantes.txt', data: buildMissingReport(missing) });
  }

  const zip = createZip(entries);

  return { zip, baseName, missing, assetCount };
}

// ---------------------------------------------------------------------------
// Tag and attribute helpers
// ---------------------------------------------------------------------------

/**
 * Collects the remote URLs referenced by one tag.
 *
 * @param {string} tagName - Lowercase tag name.
 * @param {string} attributes - Raw attribute text of the tag.
 * @param {(url: string) => void} push - Collector callback.
 * @returns {void}
 */
function collectTagUrls(tagName, attributes, push) {
  const addAttribute = (name) => {
    const raw = readAttribute(attributes, name);
    if (raw === null) return;

    const url = normalizeCandidate(raw);
    if (isRemoteHttpUrl(url)) push(url);
  };

  const addSrcset = () => {
    const raw = readAttribute(attributes, 'srcset');
    if (raw === null) return;

    for (const candidate of scanSrcset(raw)) {
      const url = normalizeCandidate(candidate.url);
      if (isRemoteHttpUrl(url)) push(url);
    }
  };

  if (tagName === 'img') addAttribute('src');
  if (tagName === 'source') addAttribute('src');
  if (tagName === 'video') addAttribute('poster');

  const isImageTag = tagName === 'image' || tagName.endsWith(':image');
  if (isImageTag) {
    addAttribute('href');
    addAttribute('xlink:href');
  }

  if (tagName === 'link') {
    const rel = readAttribute(attributes, 'rel');
    if (isRelevantLinkRel(rel)) addAttribute('href');
  }

  addSrcset();
}

/**
 * Rewrites the resource attributes of one tag.
 *
 * @param {string} tagName - Lowercase tag name.
 * @param {string} attributes - Raw attribute text of the tag.
 * @param {(rawValue: string) => string} lookup - Mapping lookup.
 * @returns {string} Updated attribute text.
 */
function rewriteTagAttributes(tagName, attributes, lookup) {
  let result = rewriteAttribute(attributes, 'srcset', (raw) =>
    transformSrcset(raw, lookup)
  );

  if (tagName === 'img' || tagName === 'source') {
    result = rewriteAttribute(result, 'src', lookup);
  } else if (tagName === 'video') {
    result = rewriteAttribute(result, 'poster', lookup);
  } else if (tagName === 'image' || tagName.endsWith(':image')) {
    result = rewriteAttribute(result, 'href', lookup);
    result = rewriteAttribute(result, 'xlink:href', lookup);
  } else if (tagName === 'link') {
    const rel = readAttribute(attributes, 'rel');
    if (isRelevantLinkRel(rel)) {
      result = rewriteAttribute(result, 'href', lookup);
    }
  }

  return result;
}

/**
 * Reads the raw value of an attribute, if present.
 *
 * @param {string} attributes - Raw attribute text.
 * @param {string} name - Attribute name.
 * @returns {string|null} Raw value or null when the attribute is absent.
 */
function readAttribute(attributes, name) {
  const pattern = attributePattern(name);
  const match = pattern.exec(attributes);
  if (match === null) return null;
  return match[3] ?? match[4] ?? match[5] ?? '';
}

/**
 * Replaces the value of an attribute using a lookup callback.
 *
 * The original quoting style is preserved when possible. Unquoted values that
 * become unsafe for an unquoted attribute are quoted with double quotes.
 *
 * @param {string} attributes - Raw attribute text.
 * @param {string} name - Attribute name.
 * @param {(rawValue: string) => string} lookup - Mapping lookup.
 * @returns {string} Updated attribute text.
 */
function rewriteAttribute(attributes, name, lookup) {
  const pattern = attributePattern(name);

  return attributes.replace(
    pattern,
    (match, leading, assignment, doubleQuoted, singleQuoted, unquoted) => {
      const raw = doubleQuoted ?? singleQuoted ?? unquoted ?? '';
      const next = lookup(raw);
      if (typeof next !== 'string' || next === raw) return match;

      if (doubleQuoted !== undefined) {
        return `${leading}${assignment}"${escapeAttribute(next, '"')}"`;
      }
      if (singleQuoted !== undefined) {
        return `${leading}${assignment}'${escapeAttribute(next, "'")}'`;
      }
      if (/^[^\s"'=<>]+$/.test(next)) {
        return `${leading}${assignment}${next}`;
      }
      return `${leading}${assignment}"${escapeAttribute(next, '"')}"`;
    }
  );
}

/**
 * Builds a case-insensitive attribute matcher.
 *
 * @param {string} name - Attribute name.
 * @returns {RegExp} Matcher with leading whitespace and assignment captures.
 */
function attributePattern(name) {
  return new RegExp(
    `(^|\\s)(${escapeRegExp(name)}\\s*=\\s*)(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    'i'
  );
}

/**
 * Checks whether a link rel value points to a render resource.
 *
 * @param {string|null} rel - Raw rel attribute.
 * @returns {boolean} true when any rel token is relevant.
 */
function isRelevantLinkRel(rel) {
  if (typeof rel !== 'string') return false;

  const tokens = decodeHtmlEntities(rel).toLowerCase().split(/\s+/);
  return tokens.some((token) => token !== '' && RELEVANT_LINK_RELS.has(token));
}

// ---------------------------------------------------------------------------
// srcset helpers
// ---------------------------------------------------------------------------

/**
 * Scans a srcset value and returns the URL spans without their descriptors.
 *
 * This is a small state machine rather than a comma split, so commas inside a
 * URL (for example in a data URI) do not break the candidate.
 *
 * @param {string} value - Raw srcset value.
 * @returns {Array<{ url: string, urlStart: number, urlEnd: number }>} Candidates.
 */
function scanSrcset(value) {
  const candidates = [];
  let index = 0;

  while (index < value.length) {
    while (
      index < value.length &&
      (isWhitespace(value[index]) || value[index] === ',')
    ) {
      index += 1;
    }
    if (index >= value.length) break;

    const urlStart = index;
    while (index < value.length && !isWhitespace(value[index])) {
      index += 1;
    }

    let urlEnd = index;
    let hasTrailingComma = false;
    while (urlEnd > urlStart && value[urlEnd - 1] === ',') {
      urlEnd -= 1;
      hasTrailingComma = true;
    }

    if (urlEnd === urlStart) continue;

    candidates.push({
      url: value.slice(urlStart, urlEnd),
      urlStart,
      urlEnd,
    });

    if (hasTrailingComma) continue;

    while (index < value.length && value[index] !== ',') {
      index += 1;
    }
  }

  return candidates;
}

/**
 * Replaces srcset URLs through a lookup callback while preserving descriptors
 * and the original separators.
 *
 * @param {string} value - Raw srcset value.
 * @param {(rawValue: string) => string} lookup - Mapping lookup.
 * @returns {string} Updated srcset value.
 */
function transformSrcset(value, lookup) {
  const candidates = scanSrcset(value);
  let result = '';
  let lastIndex = 0;
  let changed = false;

  for (const candidate of candidates) {
    const next = lookup(candidate.url);
    if (typeof next !== 'string' || next === candidate.url) continue;

    result += value.slice(lastIndex, candidate.urlStart) + next;
    lastIndex = candidate.urlEnd;
    changed = true;
  }

  return changed ? result + value.slice(lastIndex) : value;
}

// ---------------------------------------------------------------------------
// URL and HTML text helpers
// ---------------------------------------------------------------------------

/**
 * Decodes the small set of HTML entities that may appear in URL attributes.
 *
 * @param {string} value - Raw attribute value.
 * @returns {string} Decoded value.
 */
function decodeHtmlEntities(value) {
  if (typeof value !== 'string') return '';

  return value.replace(
    /&(?:#x([0-9a-f]+)|#([0-9]+)|([a-z][a-z0-9]+));/gi,
    (match, hex, decimal, named) => {
      if (hex !== undefined) return codePointToString(parseInt(hex, 16));
      if (decimal !== undefined) return codePointToString(parseInt(decimal, 10));

      /** @type {Record<string, string>} */
      const entities = {
        amp: '&',
        apos: "'",
        gt: '>',
        lt: '<',
        nbsp: '\u00A0',
        quot: '"',
      };
      return entities[String(named).toLowerCase()] ?? match;
    }
  );
}

/**
 * Converts a numeric character reference to a string when it is a valid code
 * point.
 *
 * @param {number} codePoint - Numeric code point.
 * @returns {string} Decoded character, or an empty string when invalid.
 */
function codePointToString(codePoint) {
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
    return '';
  }
  try {
    return String.fromCodePoint(codePoint);
  } catch {
    return '';
  }
}

/**
 * Decodes entities and trims a URL candidate.
 *
 * @param {string} raw - Raw value.
 * @returns {string} Normalized candidate.
 */
function normalizeCandidate(raw) {
  return decodeHtmlEntities(raw).trim();
}

/**
 * Returns true for absolute http/https URLs.
 *
 * @param {string} value - URL candidate.
 * @returns {boolean} true when the value starts with http:// or https://.
 */
function isRemoteHttpUrl(value) {
  return /^https?:\/\//i.test(value);
}

/**
 * Escapes a value for use inside an HTML attribute.
 *
 * @param {string} value - Attribute value.
 * @param {'"'|"'" } quote - Quote character used by the attribute.
 * @returns {string} Escaped value.
 */
function escapeAttribute(value, quote) {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return quote === '"'
    ? escaped.replace(/"/g, '&quot;')
    : escaped.replace(/'/g, '&#39;');
}

/**
 * Escapes a value for use inside a CSS string.
 *
 * @param {string} value - CSS string value.
 * @param {'"'|"'" } quote - Quote character used by the string.
 * @returns {string} Escaped value.
 */
function escapeCssString(value, quote) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(new RegExp(escapeRegExp(quote), 'g'), `\\${quote}`)
    .replace(/[\r\n\f]/g, '');
}

/**
 * Encodes a ZIP path for use as a relative URL without encoding separators.
 *
 * @param {string} path - Relative path.
 * @returns {string} Encoded relative path.
 */
function encodePath(path) {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

/**
 * Returns the HTML comment ranges in the document.
 *
 * @param {string} html - HTML document.
 * @returns {Array<[number, number]>} Start/end offsets.
 */
function getCommentRanges(html) {
  const ranges = [];
  COMMENT_PATTERN.lastIndex = 0;

  let match;
  while ((match = COMMENT_PATTERN.exec(html)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

/**
 * Checks whether an offset falls inside an HTML comment.
 *
 * @param {number} index - Offset to check.
 * @param {Array<[number, number]>} ranges - Comment ranges.
 * @returns {boolean} true when the offset is inside a comment.
 */
function isInsideComment(index, ranges) {
  let low = 0;
  let high = ranges.length - 1;

  while (low <= high) {
    const middle = (low + high) >>> 1;
    const [start, end] = ranges[middle];

    if (index < start) {
      high = middle - 1;
    } else if (index >= end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}

/**
 * Escapes a string for use inside a regular expression.
 *
 * @param {string} value - Literal value.
 * @returns {string} Escaped value.
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks whether a character is whitespace.
 *
 * @param {string} character - Single character.
 * @returns {boolean} true for whitespace.
 */
function isWhitespace(character) {
  return /\s/.test(character);
}

// ---------------------------------------------------------------------------
// URL safety helpers
// ---------------------------------------------------------------------------

/**
 * IPv4 ranges rejected as non-public.
 *
 * Includes loopback, RFC 1918 private, CGNAT, link-local/metadata, multicast,
 * reserved and documentation networks.
 *
 * @type {Array<[string, number]>}
 */
const BLOCKED_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['192.175.48.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/**
 * Host suffixes rejected as wildcard DNS providers or internal-only domains.
 *
 * @type {string[]}
 */
const BLOCKED_HOST_SUFFIXES = [
  'nip.io',
  'sslip.io',
  'xip.io',
  'localtest.me',
  'lvh.me',
  'internal',
  'lan',
  'home.arpa',
];

/** Host names used by cloud instance metadata services. */
const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'metadata.azure.internal',
  'metadata.tencentyun.com',
  'metadata.alibabacloud.com',
  'instance-data',
  'instance-data.ec2.internal',
]);

/**
 * Checks whether a hostname is a public DNS name.
 *
 * @param {string} host - Lowercase hostname.
 * @returns {boolean} true when the name is not local or metadata-related.
 */
function isSafeHostname(host) {
  const name = host.replace(/\.+$/, '');
  if (name.length === 0) return false;

  if (
    name === 'localhost' ||
    name === 'localhost.localdomain' ||
    name.endsWith('.localhost')
  ) {
    return false;
  }

  if (name === 'local' || name.endsWith('.local')) return false;
  if (METADATA_HOSTS.has(name)) return false;

  for (const suffix of BLOCKED_HOST_SUFFIXES) {
    if (name === suffix || name.endsWith(`.${suffix}`)) return false;
  }

  return true;
}

/**
 * Checks whether a hostname is a dotted IPv4 literal.
 *
 * @param {string} host - Hostname.
 * @returns {boolean} true for four decimal octets.
 */
function isIpv4Literal(host) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * Parses a dotted IPv4 literal into its four octets.
 *
 * @param {string} host - IPv4 literal.
 * @returns {number[]|null} Octets or null when invalid.
 */
function parseIpv4(host) {
  const parts = host.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !Number.isInteger(part) || part < 0 || part > 255
    )
  ) {
    return null;
  }
  return parts;
}

/**
 * Checks whether a dotted IPv4 literal is safe to fetch.
 *
 * @param {string} host - IPv4 literal.
 * @returns {boolean} true when the address is public.
 */
function isSafeIpv4(host) {
  const parts = parseIpv4(host);
  if (parts === null) return false;

  return isSafeIpv4Parts(parts);
}

/**
 * Checks whether four IPv4 octets are public.
 *
 * @param {number[]} parts - Four octets.
 * @returns {boolean} true when the address is public.
 */
function isSafeIpv4Parts(parts) {
  const value = ipv4Number(parts);

  for (const [base, prefix] of BLOCKED_IPV4_RANGES) {
    const baseParts = parseIpv4(base);
    if (baseParts === null) continue;

    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((value & mask) === (ipv4Number(baseParts) & mask)) return false;
  }

  return true;
}

/**
 * Converts four IPv4 octets to an unsigned 32-bit number.
 *
 * @param {number[]} parts - Four octets.
 * @returns {number} Unsigned 32-bit number.
 */
function ipv4Number(parts) {
  return (
    ((parts[0] << 24) |
      (parts[1] << 16) |
      (parts[2] << 8) |
      parts[3]) >>>
    0
  );
}

/**
 * Checks whether an IPv6 hostname is safe to fetch.
 *
 * @param {string} host - IPv6 literal without brackets.
 * @returns {boolean} true when the address is public.
 */
function isSafeIpv6(host) {
  const parts = parseIpv6(host);
  if (parts === null) return false;

  // Unspecified (::) and loopback (::1).
  if (parts.every((part) => part === 0)) return false;
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7] === 1) {
    return false;
  }

  // Unique-local fc00::/7, link-local fe80::/10 and multicast ff00::/8.
  if ((parts[0] & 0xfe00) === 0xfc00) return false;
  if ((parts[0] & 0xffc0) === 0xfe80) return false;
  if ((parts[0] & 0xff00) === 0xff00) return false;

  // Documentation network 2001:db8::/32 and Teredo 2001:0000::/32.
  if (parts[0] === 0x2001 && (parts[1] === 0x0db8 || parts[1] === 0x0000)) {
    return false;
  }

  // IPv4-mapped (::ffff:a.b.c.d).
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return isSafeEmbeddedIpv4(parts[6], parts[7]);
  }

  // Deprecated IPv4-compatible (::a.b.c.d).
  if (parts.slice(0, 6).every((part) => part === 0)) {
    return isSafeEmbeddedIpv4(parts[6], parts[7]);
  }

  // NAT64 well-known prefix 64:ff9b::/96.
  if (
    parts[0] === 0x0064 &&
    parts[1] === 0xff9b &&
    parts.slice(2, 6).every((part) => part === 0)
  ) {
    return isSafeEmbeddedIpv4(parts[6], parts[7]);
  }

  // 6to4 2002::/16 embeds the IPv4 address in the next two hextets.
  if (parts[0] === 0x2002) {
    return isSafeEmbeddedIpv4(parts[1], parts[2]);
  }

  return true;
}

/**
 * Parses an IPv6 literal into eight 16-bit hextets.
 *
 * Supports "::" compression and an embedded dotted IPv4 tail.
 *
 * @param {string} host - IPv6 literal without brackets.
 * @returns {number[]|null} Eight hextets or null when invalid.
 */
function parseIpv6(host) {
  const clean = host.split('%')[0];
  if (!clean.includes(':')) return null;

  const halves = clean.split('::');
  if (halves.length > 2) return null;

  const left = expandIpv4Tail(halves[0] ? halves[0].split(':') : []);
  const right = expandIpv4Tail(
    halves.length === 2 && halves[1] ? halves[1].split(':') : []
  );

  let parts;
  if (halves.length === 2) {
    const missing = 8 - left.length - right.length;
    if (missing < 0) return null;
    parts = [...left, ...Array(missing).fill('0'), ...right];
  } else {
    parts = left;
  }

  if (parts.length !== 8) return null;

  const values = parts.map((part) => parseInt(part, 16));
  if (
    values.some(
      (value) => !Number.isInteger(value) || value < 0 || value > 0xffff
    )
  ) {
    return null;
  }
  return values;
}

/**
 * Expands a dotted IPv4 tail inside an IPv6 hextet list to two hextets.
 *
 * @param {string[]} parts - Hextet list.
 * @returns {string[]} Expanded list.
 */
function expandIpv4Tail(parts) {
  if (parts.length === 0) return parts;

  const last = parts[parts.length - 1];
  if (!last.includes('.')) return parts;

  const octets = last.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255
    )
  ) {
    return parts;
  }

  return [
    ...parts.slice(0, -1),
    ((octets[0] << 8) | octets[1]).toString(16),
    ((octets[2] << 8) | octets[3]).toString(16),
  ];
}

/**
 * Checks an IPv4 address embedded in two IPv6 hextets.
 *
 * @param {number} high - High 16 bits.
 * @param {number} low - Low 16 bits.
 * @returns {boolean} true when the embedded IPv4 address is public.
 */
function isSafeEmbeddedIpv4(high, low) {
  const value = (((high << 16) | low) >>> 0);

  return isSafeIpv4Parts([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

// ---------------------------------------------------------------------------
// Download helpers
// ---------------------------------------------------------------------------

/** Sentinel rejected by the timeout promise. */
const TIMEOUT_SENTINEL = Object.freeze({ timeout: true });

/**
 * Downloads one remote asset with redirect and size validation.
 *
 * Redirects are followed manually so every hop can be checked by
 * isSafeRemoteUrl before it is requested.
 *
 * @param {string} url - Initial safe remote URL.
 * @param {typeof fetch} fetchImpl - Fetch implementation.
 * @param {number} maxBytes - Maximum body size for this resource.
 * @returns {Promise<
 *   | { ok: true, bytes: Uint8Array, contentType: string|null }
 *   | { ok: false, reason: string, tooLarge?: boolean }
 * >} Download outcome.
 */
async function downloadAsset(url, fetchImpl, maxBytes) {
  const controller = new AbortController();
  const timeout = createTimeout(controller);

  try {
    let currentUrl = url;
    let response;
    let redirectCount = 0;

    while (true) {
      if (!isSafeRemoteUrl(currentUrl)) {
        return { ok: false, reason: 'URL remota no segura' };
      }

      response = await Promise.race([
        fetchImpl(currentUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
        }),
        timeout.promise,
      ]);

      if (!response || typeof response !== 'object') {
        return { ok: false, reason: 'respuesta vacía' };
      }

      if (!isRedirectStatus(response.status)) break;

      const location = getHeader(response, 'location');
      if (!location) {
        return {
          ok: false,
          reason: `HTTP ${response.status} sin cabecera Location`,
        };
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return { ok: false, reason: 'demasiadas redirecciones' };
      }

      let nextUrl;
      try {
        nextUrl = new URL(location, currentUrl).href;
      } catch {
        return { ok: false, reason: 'redirección no válida' };
      }

      await cancelBody(response);
      currentUrl = nextUrl;
      redirectCount += 1;
    }

    if (
      response.ok === false ||
      (typeof response.status === 'number' && response.status >= 300)
    ) {
      await cancelBody(response);
      const statusLabel =
        typeof response.status === 'number'
          ? `HTTP ${response.status}`
          : 'HTTP error';
      return { ok: false, reason: statusLabel };
    }

    const contentLengthHeader = getHeader(response, 'content-length');
    const contentLength =
      contentLengthHeader === null ? NaN : Number(contentLengthHeader);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      await cancelBody(response);
      return { ok: false, reason: 'límite de tamaño excedido', tooLarge: true };
    }

    const body = await Promise.race([
      readResponseBytes(response, maxBytes),
      timeout.promise,
    ]);

    if (!body.ok) {
      return {
        ok: false,
        reason: body.tooLarge
          ? 'límite de tamaño excedido'
          : 'respuesta sin cuerpo legible',
        tooLarge: body.tooLarge === true,
      };
    }

    return {
      ok: true,
      bytes: body.bytes,
      contentType: getHeader(response, 'content-type'),
    };
  } catch (error) {
    if (error === TIMEOUT_SENTINEL || error?.name === 'AbortError') {
      return { ok: false, reason: 'tiempo de espera agotado (15 s)' };
    }
    return {
      ok: false,
      reason: `error de red: ${truncateMessage(error?.message)}`,
    };
  } finally {
    timeout.clear();
  }
}

/**
 * Creates a timeout promise tied to an AbortController.
 *
 * @param {AbortController} controller - Controller aborted on timeout.
 * @returns {{ promise: Promise<never>, clear: () => void }} Timeout handle.
 */
function createTimeout(controller) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(TIMEOUT_SENTINEL);
    }, FETCH_TIMEOUT_MS);
  });

  return {
    promise,
    clear: () => clearTimeout(timer),
  };
}

/**
 * Reads a response body while enforcing a byte limit.
 *
 * @param {Response} response - Fetch response.
 * @param {number} maxBytes - Maximum body size.
 * @returns {Promise<
 *   | { ok: true, bytes: Uint8Array }
 *   | { ok: false, tooLarge?: boolean }
 * >} Body outcome.
 */
async function readResponseBytes(response, maxBytes) {
  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk =
          value instanceof Uint8Array ? value : new Uint8Array(value);
        total += chunk.byteLength;

        if (total > maxBytes) {
          try {
            await reader.cancel();
          } catch {
            // The stream may already be closed; the size result is enough.
          }
          return { ok: false, tooLarge: true };
        }
        chunks.push(chunk);
      }
    } finally {
      if (typeof reader.releaseLock === 'function') reader.releaseLock();
    }

    return { ok: true, bytes: concatChunks(chunks, total) };
  }

  if (typeof response.arrayBuffer === 'function') {
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.byteLength > maxBytes) return { ok: false, tooLarge: true };
    return { ok: true, bytes };
  }

  return { ok: false };
}

/**
 * Concatenates streamed chunks into a single Uint8Array.
 *
 * @param {Uint8Array[]} chunks - Body chunks.
 * @param {number} total - Total byte length.
 * @returns {Uint8Array} Combined bytes.
 */
function concatChunks(chunks, total) {
  const bytes = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Cancels a response body when possible.
 *
 * @param {Response} response - Response whose body should be released.
 * @returns {Promise<void>}
 */
async function cancelBody(response) {
  if (!response || !response.body || typeof response.body.cancel !== 'function') {
    return;
  }
  try {
    await response.body.cancel();
  } catch {
    // Ignore body cancellation errors: the redirect target is what matters.
  }
}

/**
 * Checks whether a status code is an HTTP redirect.
 *
 * @param {number} status - HTTP status code.
 * @returns {boolean} true for redirect statuses.
 */
function isRedirectStatus(status) {
  return REDIRECT_STATUSES.has(status);
}

/**
 * Reads a response header, supporting Headers and plain objects.
 *
 * @param {Response} response - Fetch response.
 * @param {string} name - Header name.
 * @returns {string|null} Header value or null.
 */
function getHeader(response, name) {
  const headers = response?.headers;
  if (!headers) return null;

  const target = name.toLowerCase();

  if (headers instanceof Map) {
    for (const [key, value] of headers) {
      if (String(key).toLowerCase() === target) return String(value);
    }
    return null;
  }

  if (typeof headers.get === 'function') {
    const value = headers.get(name);
    return value === undefined ? null : value;
  }

  if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) return String(value);
    }
  }
  return null;
}

/**
 * Truncates an error message for a missing-resource reason.
 *
 * @param {unknown} message - Error message.
 * @returns {string} Safe, short message.
 */
function truncateMessage(message) {
  const text = typeof message === 'string' ? message : String(message ?? '');
  if (text.length === 0) return 'desconocido';
  return text.replace(/[\r\n\t]+/g, ' ').slice(0, 200);
}

// ---------------------------------------------------------------------------
// File name and report helpers
// ---------------------------------------------------------------------------

/**
 * Content-type to file extension fallback used when the URL has no extension.
 *
 * @type {Record<string, string>}
 */
const CONTENT_TYPE_EXTENSIONS = {
  'application/font-woff': 'woff',
  'application/font-woff2': 'woff2',
  'application/javascript': 'js',
  'application/json': 'json',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'font/otf': 'otf',
  'font/ttf': 'ttf',
  'font/woff': 'woff',
  'font/woff2': 'woff2',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/vnd.microsoft.icon': 'ico',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
  'text/css': 'css',
  'text/javascript': 'js',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/**
 * Chooses a safe file extension for a downloaded resource.
 *
 * The URL path extension takes precedence; the content type is only a fallback
 * when the URL has no usable extension.
 *
 * @param {string} url - Resource URL.
 * @param {string|null} contentType - Response content type.
 * @returns {string} File extension without the dot.
 */
function chooseExtension(url, contentType) {
  const fromUrl = extensionFromUrl(url);
  if (fromUrl) return fromUrl;

  const type = String(contentType ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();

  return CONTENT_TYPE_EXTENSIONS[type] ?? 'bin';
}

/**
 * Extracts a short, safe extension from a URL pathname.
 *
 * @param {string} url - Resource URL.
 * @returns {string} Extension without the dot, or an empty string.
 */
function extensionFromUrl(url) {
  try {
    let pathname = new URL(url).pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the original pathname when it is not valid percent-encoding.
    }

    const lastSegment = pathname.slice(pathname.lastIndexOf('/') + 1);
    const dot = lastSegment.lastIndexOf('.');
    if (dot <= 0 || dot === lastSegment.length - 1) return '';

    const extension = lastSegment.slice(dot + 1).toLowerCase();
    return /^[a-z0-9]{1,10}$/.test(extension) ? extension : '';
  } catch {
    return '';
  }
}

/**
 * Validates and normalizes the bundle base name.
 *
 * The base name becomes part of ZIP entry names, so anything outside the
 * strict [A-Za-z0-9._-] allowlist is replaced with a hyphen. The result is
 * capped at 120 characters and stripped of leading/trailing dots and hyphens
 * to keep it safe for the ZIP writer.
 *
 * @param {string} value - Requested base name.
 * @returns {string} Safe base name.
 * @throws {TypeError} When the value is not a non-empty string or nothing
 *   remains after normalization.
 */
function normalizeBaseName(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('options.baseName must be a non-empty string');
  }

  const name = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 120)
    .replace(/^[.-]+/, '')
    .replace(/[.-]+$/, '');

  if (name.length === 0) {
    throw new TypeError('options.baseName is not a valid file name');
  }
  return name;
}

/**
 * Builds the optional "faltantes.txt" report.
 *
 * @param {Array<{ url: string, reason: string }>} missing - Missing resources.
 * @returns {string} Plain-text report.
 */
function buildMissingReport(missing) {
  const lines = [
    `Recursos no incluidos en el ZIP (${missing.length}):`,
    '',
  ];

  for (const item of missing) {
    lines.push(`- ${singleLine(item.url)}`);
    lines.push(`  Motivo: ${singleLine(item.reason)}`);
  }

  return `${lines.join('\n')}\n`;
}

/**
 * Collapses line breaks and tabs into single spaces.
 *
 * @param {unknown} value - Value to clean.
 * @returns {string} Single-line text.
 */
function singleLine(value) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ');
}
