/**
 * @module html-toolbar
 * Injects a download toolbar into the self-contained HTML view.
 *
 * The toolbar is only added by the `/html/{uuid}` Pages Function, never by the
 * rendering flow or the ZIP endpoint, so the downloaded HTML stays clean. The
 * helper is intentionally dependency-free: it only builds an HTML fragment and
 * an optional inline script protected by the viewer CSP nonce.
 */

/** Accepted characters for a CSP nonce inserted into an HTML attribute. */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]{1,128}$/;

/** Matches the first CSP nonce source expression. */
const CSP_NONCE_PATTERN = /'nonce-([^']+)'/i;

/** Base styles for the inline toolbar container. */
const TOOLBAR_STYLE = 'display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;';

/** Shared button styles. */
const BUTTON_STYLE = 'display:inline-block;padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#ffffff;color:#1f2937;text-decoration:none;font-weight:600;white-space:nowrap;';

/** Primary button styles for the HTML download. */
const PRIMARY_BUTTON_STYLE = `${BUTTON_STYLE}border-color:#2563eb;background:#2563eb;color:#ffffff;`;

/** Secondary button styles; pushes the JSON download to the right edge. */
const JSON_BUTTON_STYLE = `${BUTTON_STYLE}margin-left:auto;`;

/** Styles for the missing-resources notice, wrapped below the buttons. */
const NOTICE_STYLE = 'display:none;flex-basis:100%;max-width:320px;padding:8px 12px;border-radius:8px;background:#fef3c7;color:#92400e;font-size:12px;line-height:1.4;';

/**
 * Reads the Content-Security-Policy header from a Headers instance or a plain
 * object, so the helper also works with test doubles.
 *
 * @param {Headers|Object|null|undefined} headers - Response headers.
 * @returns {string} CSP header value, or an empty string.
 */
function readCsp(headers) {
  if (!headers) return '';

  if (typeof headers.get === 'function') {
    return headers.get('Content-Security-Policy')
      || headers.get('content-security-policy')
      || '';
  }

  if (typeof headers === 'object') {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-security-policy') {
        return String(headers[key] ?? '');
      }
    }
  }

  return '';
}

/**
 * Extracts and validates the CSP nonce from the response headers.
 *
 * Only a nonce that is safe to place inside a double-quoted HTML attribute is
 * returned. A missing, malformed or unsafe nonce yields an empty string so the
 * caller can fall back to plain links without an inline script.
 *
 * @param {Headers|Object|null|undefined} headers - Response headers.
 * @returns {string} Valid nonce, or an empty string.
 */
export function extractNonce(headers) {
  const csp = readCsp(headers);
  if (!csp) return '';

  const match = CSP_NONCE_PATTERN.exec(csp);
  if (!match) return '';

  const nonce = match[1].trim();
  return NONCE_PATTERN.test(nonce) ? nonce : '';
}

/**
 * Builds the inline script that turns the HTML link into an interceptable
 * download, reports missing resources and hides the toolbar inside iframes.
 *
 * The script is written with ES5-compatible syntax and string concatenation so
 * it can be embedded safely without additional escaping.
 *
 * @returns {string} Inline script body.
 */
function buildToolbarScript() {
  return String.raw`(function () {
  'use strict';

  var toolbar = document.getElementById('mmup-download-toolbar');
  if (!toolbar) return;

  // The result panel already provides its own buttons, so avoid duplicates.
  if (window.self !== window.top) {
    toolbar.style.display = 'none';
    return;
  }

  var link = document.getElementById('mmup-download-html');
  var notice = document.getElementById('mmup-download-notice');
  if (!link) return;

  var originalText = link.textContent;

  function filenameFromDisposition(value) {
    if (typeof value !== 'string') return '';

    var extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
    if (extended) {
      var raw = extended[1].trim();
      try {
        return decodeURIComponent(raw);
      } catch (error) {
        return raw;
      }
    }

    var simple = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
    return simple ? simple[1].trim() : '';
  }

  function decodeMissingSample(value) {
    if (typeof value !== 'string' || value.length === 0) return [];

    return value
      .split(/%0A|\r?\n/i)
      .map(function (part) { return part.trim(); })
      .filter(function (part) { return part.length > 0; })
      .map(function (part) {
        try {
          return decodeURIComponent(part);
        } catch (error) {
          return part;
        }
      });
  }

  function missingWarning(count, sample) {
    var noun = count === 1 ? 'recurso' : 'recursos';
    var preview = sample.length > 0 ? ' Muestra: ' + sample.join(', ') + '.' : '';
    return 'El HTML se ha descargado, pero faltan ' + count + ' ' + noun + '.' + preview + ' Revisa faltantes.txt dentro del ZIP.';
  }

  link.addEventListener('click', function (event) {
    event.preventDefault();
    if (link.getAttribute('aria-busy') === 'true') return;

    link.setAttribute('aria-busy', 'true');
    link.setAttribute('aria-disabled', 'true');
    link.style.opacity = '0.65';
    link.style.pointerEvents = 'none';
    link.textContent = 'Preparando…';

    if (notice) {
      notice.style.display = 'none';
      notice.textContent = '';
    }

    fetch(link.href, { credentials: 'include', cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('No se pudo preparar el HTML (' + response.status + ').');
        }

        var missingCount = Number.parseInt(response.headers.get('X-MMUP-Missing-Count') || '0', 10);
        var missingSample = response.headers.get('X-MMUP-Missing-Sample') || '';
        var disposition = response.headers.get('Content-Disposition') || '';

        return response.blob().then(function (blob) {
          var filename = filenameFromDisposition(disposition) || 'mapa.zip';
          var objectUrl = URL.createObjectURL(blob);
          var anchor = document.createElement('a');

          anchor.href = objectUrl;
          anchor.download = filename;
          anchor.rel = 'noopener';
          anchor.style.display = 'none';
          document.body.appendChild(anchor);

          try {
            anchor.click();
          } finally {
            anchor.remove();
          }

          setTimeout(function () { URL.revokeObjectURL(objectUrl); }, 60000);

          if (missingCount > 0 && notice) {
            notice.textContent = missingWarning(missingCount, decodeMissingSample(missingSample));
            notice.style.display = 'block';
          }
        });
      })
      .catch(function (error) {
        if (!notice) return;
        notice.textContent = error && error.message
          ? error.message
          : 'No se pudo descargar el HTML.';
        notice.style.display = 'block';
      })
      .finally(function () {
        link.removeAttribute('aria-busy');
        link.removeAttribute('aria-disabled');
        link.style.opacity = '';
        link.style.pointerEvents = '';
        link.textContent = originalText;
      });
  });
})();`;
}

/**
 * Builds the toolbar fragment and, when a nonce is available, the script that
 * adds the download behavior.
 *
 * @param {string} uuid - Conversion identifier.
 * @param {'catalogue'|'anonymous'|string} mode - Rendering mode.
 * @param {string} nonce - Validated CSP nonce, or an empty string.
 * @returns {string} HTML fragment to insert inside the viewer header.
 */
function buildToolbar(uuid, mode, nonce) {
  const encodedUuid = encodeURIComponent(String(uuid ?? ''));
  const htmlHref = `/api/download-html/${encodedUuid}`;
  const jsonHref = `/api/download/${encodedUuid}`;

  const jsonLink = mode === 'catalogue'
    ? `<a id="mmup-download-json" href="${jsonHref}" style="${JSON_BUTTON_STYLE}">Descargar JSON</a>`
    : '';

  const script = nonce
    ? `<script nonce="${nonce}">${buildToolbarScript()}</script>`
    : '';

  return `<div id="mmup-download-toolbar" role="toolbar" aria-label="Descargas" style="${TOOLBAR_STYLE}">`
    + `<a id="mmup-download-html" href="${htmlHref}" style="${PRIMARY_BUTTON_STYLE}">Descargar HTML</a>`
    + jsonLink
    + `<div id="mmup-download-notice" role="status" aria-live="polite" style="${NOTICE_STYLE}"></div>`
    + '</div>'
    + script;
}

/**
 * Finds the offset of the last match for a closing tag.
 *
 * @param {string} html - Rendered HTML document.
 * @param {RegExp} pattern - Global regular expression for the closing tag.
 * @returns {number} Offset of the last match, or -1 when there is none.
 */
function lastClosingTagIndex(html, pattern) {
  let lastIndex = -1;
  let match;

  while ((match = pattern.exec(html)) !== null) {
    lastIndex = match.index;
  }

  return lastIndex;
}

/**
 * Injects the download toolbar inside the viewer header, immediately before
 * the last closing header tag.
 *
 * The toolbar therefore renders on the line after the `.controls` row. When
 * the document has no closing header tag, the toolbar falls back to the last
 * closing body tag. Documents with neither tag are returned unchanged. The
 * toolbar is never injected by the renderer or the ZIP endpoint, so only the
 * standalone HTML page receives it.
 *
 * @param {string} html - Rendered HTML document.
 * @param {Object} options - Toolbar options.
 * @param {string} options.uuid - Conversion identifier.
 * @param {'catalogue'|'anonymous'|string} options.mode - Rendering mode.
 * @param {string} [options.nonce=''] - CSP nonce for the inline script.
 * @returns {string} HTML with the toolbar injected, or the original HTML.
 */
export function injectDownloadToolbar(html, { uuid, mode, nonce = '' } = {}) {
  if (typeof html !== 'string' || html.length === 0) return html;

  const safeNonce = typeof nonce === 'string' && NONCE_PATTERN.test(nonce) ? nonce : '';
  const toolbar = buildToolbar(uuid, mode, safeNonce);

  let insertIndex = lastClosingTagIndex(html, /<\/header\s*>/gi);
  if (insertIndex === -1) {
    insertIndex = lastClosingTagIndex(html, /<\/body\s*>/gi);
  }

  if (insertIndex === -1) return html;

  return html.slice(0, insertIndex) + toolbar + html.slice(insertIndex);
}
