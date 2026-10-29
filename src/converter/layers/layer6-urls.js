/**
 * @module layer6-urls
 * Layer 6: Extraction of URLs detected in node titles.
 *
 * Responsibilities:
 * 1. Detect URLs in each node title using a regular expression.
 * 2. Classify each URL through classifyUrl() from url-classifier.js following
 *    the three-level process.
 * 3. Extract the visible text of the title (label) as the residue left after
 *    removing the URL.
 * 4. Create one ExternalRef record per URL found, with a unique ref_id UUID.
 * 5. Handle URLs glued to the text without a separating space.
 * 6. Handle multiple URLs in the same title.
 *
 * Three-level classification (with the injected classifier or, by default,
 * delegated to classifyUrl()):
 *   Level 1 — Known domain in the classifier -> specific ref_type (social, video, code, etc.)
 *   Level 2 — Unknown domain but http/https protocol, or a www. address without
 *             a scheme -> defaultRefType.
 *             mailto: protocol -> 'email', tel: -> 'phone'.
 *   Level 3 — Anything else -> 'other'.
 *
 * @see ../url-classifier.js - classifyUrl() and URL_CLASSIFIER
 * @see ../../shared/uuid.js - Shared UUID v4 generation
 */
import { generateUUID } from '../../shared/uuid.js';

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { classifyUrl, DEFAULT_REF_TYPE } from '../url-classifier.js';

// ---------------------------------------------------------------------------
// Regular expression for URL detection
// ---------------------------------------------------------------------------

/**
 * Fallback regular expression pattern for detecting URLs in text.
 *
 * Captures URLs that start with http:// or https:// and scheme-less addresses
 * that start with www. (for example "www.example.com") up to the next
 * whitespace character or the end of the string. It does not require a space
 * before the URL, which allows detecting URLs glued to the preceding text
 * without separation.
 *
 * Reproduces the default value of VARIABLES.URL_REGEX_PATTERN (config.js), so
 * the fallback for an invalid or absent pattern does not lose the www.
 * addresses that the configured pattern does detect.
 *
 * @type {RegExp}
 */
const URL_REGEX = /https?:\/\/[^\s]+|www\.[^\s]+/g;

// ---------------------------------------------------------------------------
// Regex construction and classification with injected dependencies
// ---------------------------------------------------------------------------

/**
 * Builds the URL detection regular expression from the received pattern, with
 * a fallback to the default pattern when it is missing or invalid.
 *
 * The pattern comes from configuration (VARIABLES.URL_REGEX_PATTERN) and may be
 * invalid; in that case URL_REGEX is used so the conversion is not aborted
 * (W7). A new instance is always returned, so the default regex is not shared
 * between calls and does not carry lastIndex.
 *
 * Administration assumption: the pattern comes from VARIABLES_KV and is assumed
 * to be defined by a trusted administrator. Here we only protect against
 * syntactically invalid patterns; their complexity is not analyzed, so a
 * pathological expression (excessive backtracking) may degrade the layer
 * performance. Full pattern validation remains an administration
 * responsibility (W7).
 *
 * @param {string} [urlRegexPattern] - Regex pattern received from configuration
 * @returns {RegExp} Global regular expression for URL detection
 */
function buildUrlRegex(urlRegexPattern) {
  if (typeof urlRegexPattern === 'string' && urlRegexPattern.length > 0) {
    try {
      return new RegExp(urlRegexPattern, 'g');
    } catch {
      // Invalid pattern: ignore it and use the default pattern
    }
  }

  return new RegExp(URL_REGEX.source, URL_REGEX.flags);
}

/**
 * Looks up the reference type of a URL in a domain -> type classifier.
 *
 * Applies the same matching as classifyUrl(): exact domain or suffix
 * ('.domain'), choosing the most specific match (the longest domain). It is
 * isolated here so the caller can use its injected classifier without
 * depending on the internal map of url-classifier.js (W5).
 *
 * @param {string} url - URL to classify
 * @param {Object} urlClassifier - Domain -> ref_type map
 * @returns {string|null} Reference type, or null when no domain matches
 */
function findRefTypeByDomain(url, urlClassifier) {
  let hostname;

  try {
    hostname = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // URL without a scheme (for example "www.example.com/path"): retry with
    // https:// in front so it can be classified by domain (W5/W7)
    try {
      hostname = new URL('https://' + url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  let bestMatch = null;
  for (const [domain, refType] of Object.entries(urlClassifier)) {
    if (hostname === domain || hostname.endsWith('.' + domain)) {
      if (!bestMatch || domain.length > bestMatch.domain.length) {
        bestMatch = { domain, refType };
      }
    }
  }

  return bestMatch ? bestMatch.refType : null;
}

/**
 * Classifies a URL using the received classifier and default type.
 *
 * Injected values (urlClassifier and defaultRefType) take precedence; when no
 * classifier is received, it delegates to classifyUrl() from
 * url-classifier.js as a fallback. Protocol levels (http/https, mailto, tel,
 * others) are resolved with defaultRefType and the fixed types.
 *
 * @param {string} url - URL to classify
 * @param {Object} [urlClassifier] - Injected domain -> ref_type map
 * @param {string} [defaultRefType] - Injected default type
 * @returns {string} URL ref_type
 */
function classifyUrlWith(url, urlClassifier, defaultRefType) {
  const fallbackType = defaultRefType || DEFAULT_REF_TYPE;

  if (urlClassifier && typeof urlClassifier === 'object') {
    const domainType = findRefTypeByDomain(url, urlClassifier);
    if (domainType !== null) {
      return domainType;
    }
  } else {
    // No injected classifier: fall back to the module classifier
    const moduleType = classifyUrl(url);
    if (moduleType !== DEFAULT_REF_TYPE) {
      return moduleType;
    }
  }

  // Scheme-less www. addresses count as the http(s) case and use the default
  // type (restores the behavior prior to injected classification: previously
  // classifyUrl() resolved them to DEFAULT_REF_TYPE)
  if (url.startsWith('https:') || url.startsWith('http:') || url.startsWith('www.')) {
    return fallbackType;
  }
  if (url.startsWith('mailto:')) return 'email';
  if (url.startsWith('tel:')) return 'phone';
  return 'other';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Layer 6: Extracts URLs detected in node titles.
 *
 * Walks the flat node list (generated by Layer 2) and detects URLs in the
 * `title` field of each node using the URL_REGEX regular expression.
 *
 * Each detected URL is classified with the injected classifier (urlClassifier)
 * and the received default type (defaultRefType); when no classifier is
 * injected it delegates to classifyUrl() from url-classifier.js. Classification
 * follows the three levels (known domain -> specific ref_type, http(s)
 * protocol or www. address -> generic type, or default -> 'other').
 *
 * For each URL found an ExternalRef record is created with:
 * - ref_id: unique UUID v4
 * - node_id: reference to the containing node
 * - url: the complete extracted URL
 * - ref_type: type classified according to the three levels
 * - label: visible text before the URL (optional, only when it exists)
 *
 * Handled cases:
 * - URLs glued to the text without a space: the regex captures them correctly
 *   because it does not require a space before the protocol
 * - Multiple URLs in the same title: the /g flag iterates over every occurrence
 * - Nodes without a title: skipped silently without generating entries
 * - Scheme-less www. addresses: classified as the http(s) case with the default
 *   type (W5/W7); their hostname is probed with https:// in front to resolve
 *   the domain classifier
 * - URLs with any protocol other than http/https: classified as 'email',
 *   'phone' or 'other' as appropriate
 * - Invalid or absent regex pattern: the default pattern is used (W7)
 * - Pattern that matches an empty string: the loop advances lastIndex and
 *   terminates (W7)
 *
 * @param {Node[]}   nodes          - Flat node list (from Layer 2)
 * @param {Object}   rawJson        - Original .mup JSON (already parsed object,
 *                                    not used directly, available for
 *                                    consistency with other layers)
 * @param {Object}   urlClassifier  - Domain -> ref_type map used in level 1
 *                                    classification (for example
 *                                    URL_CLASSIFIER from url-classifier.js)
 * @param {string}   defaultRefType - Default type for http/https without a
 *                                    known domain (level 2); DEFAULT_REF_TYPE
 *                                    fallback when missing
 * @param {string}   [urlRegexPattern] - Regex pattern for detecting URLs
 *                                    (optional, validated with try/catch;
 *                                    fallback to the default expression)
 * @returns {ExternalRef[]} List of detected external references.
 *                          Empty when no node contains URLs.
 *
 * @example
 * import { URL_CLASSIFIER, DEFAULT_REF_TYPE } from '../url-classifier.js';
 * const refs = extractUrls(nodes, rawJson, URL_CLASSIFIER, DEFAULT_REF_TYPE, VARIABLES.URL_REGEX_PATTERN);
 * // refs[0] = {
 * //   ref_id: '550e8400-e29b-41d4-a716-446655440000',
 * //   node_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
 * //   url: 'https://github.com/example/repo',
 * //   ref_type: 'code',
 * //   label: 'See repository at'
 * // }
 *
 * @example
 * // Multiple URLs in the same title
 * // title = "Repo: https://github.com/a and Docs: https://docs.example.com"
 * // -> Two ExternalRef records:
 * //   1. { url: 'https://github.com/a', ref_type: 'code', label: 'Repo:' }
 * //   2. { url: 'https://docs.example.com', ref_type: 'web_page', label: 'Repo: https://github.com/a and Docs:' }
 *
 * @example
 * // URL glued to the text without a space
 * // title = "Enlace al mapa: https://app.mindmup.com/map/v2/abc"
 * // -> { url: 'https://app.mindmup.com/map/v2/abc', label: 'Enlace al mapa:' }
 */
export function extractUrls(nodes, rawJson, urlClassifier, defaultRefType, urlRegexPattern) {
  /** @type {ExternalRef[]} */
  const externalRefs = [];

  // If there are no nodes, return an empty array (consistent with other layers)
  if (!Array.isArray(nodes) || nodes.length === 0) {
    return externalRefs;
  }

  // Build the regex from the received pattern with validation and fallback (W7)
  const regex = buildUrlRegex(urlRegexPattern);

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Skip nodes without a title: there is no text to search for URLs
    // (Incident #5: nodes with an empty or undefined title are skipped silently)
    if (!node.title) {
      continue;
    }

    const title = node.title;
    let match;

    // Find every URL in the title with the global regex.
    // The while loop with exec() iterates over each occurrence thanks to /g.
    while ((match = regex.exec(title)) !== null) {
      // A pattern that matches an empty string would leave lastIndex fixed and
      // the loop would never end; advancing one character makes it progress (W7)
      if (match[0].length === 0) {
        regex.lastIndex += 1;
        continue;
      }

      const url = match[0];

      // The label is the text before the URL, trimmed at both ends.
      // If the URL is at the beginning of the title, label is an empty string.
      const label = title.slice(0, match.index).trim();

      // Classify the URL with the received classifier and default type (W5),
      // falling back to the module classifier when none is injected:
      //   Level 1: known domain -> specific ref_type
      //   Level 2: http/https protocol -> defaultRefType, mailto -> 'email', tel -> 'phone'
      //   Level 3: anything else -> 'other'
      const refType = classifyUrlWith(url, urlClassifier, defaultRefType);

      /** @type {ExternalRef} */
      const ref = {
        ref_id: generateUUID(),
        node_id: node.node_id,
        url: url,
        ref_type: refType,
      };

      // The label field is optional according to the ExternalRef typedef.
      // It is only included when there is visible text before the URL.
      // If label is empty (URL at the beginning of the title), it is omitted.
      if (label) {
        ref.label = label;
      }

      externalRefs.push(ref);
    }
  }

  return externalRefs;
}
