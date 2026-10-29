/**
 * @module html-templates
 * Reusable HTML templates for visualizer error pages.
 *
 * Responsibilities:
 * 1. Generate a complete, self-contained error document (inline CSS).
 * 2. renderErrorHTML: generic error template.
 * 3. render404HTML: 404 error (identifier not found).
 * 4. render400HTML: 400 error (invalid request).
 * 5. render500HTML: 500 error (internal failure; the message is always generic
 *    so internal details only reach the structured logs).
 * 6. escapeHtml: escape text before inserting it into HTML (anti-XSS).
 *
 * Principle: every generated document is self-contained (inline CSS, no
 * external dependencies). Dynamic values are escaped with escapeHtml() to
 * prevent cross-site scripting.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds a complete error HTML document with inline CSS.
 *
 * Produces a self-contained HTML document (no external dependencies) with a
 * clean layout. It includes an error box with a title, a descriptive message
 * and a link back to the map list.
 *
 * Every dynamic value is escaped with escapeHtml() to prevent XSS.
 *
 * @param {string} title - Error title (rendered as the <h1> heading).
 * @param {string} message - Human-readable error message.
 * @param {string|null} [uuid=null] - Identifier related to the error (optional).
 *   When provided, it is rendered inside a <code> block.
 * @returns {string} Complete HTML document ready to be served.
 *
 * @example
 * renderErrorHTML('Error 404', 'Recurso no encontrado', 'abc-123-def');
 * // -> '<!DOCTYPE html><html lang="es">...Error 404...abc-123-def...</html>'
 *
 * @example
 * renderErrorHTML('Error 500', 'Error interno del servidor');
 * // -> '<!DOCTYPE html><html lang="es">...Error 500...</html>'
 */
export function renderErrorHTML(title, message, uuid = null) {
  const uuidSection = uuid
    ? `<p>UUID: <code>${escapeHtml(uuid)}</code></p>`
    : '';

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — ${escapeHtml(title)}</title>
  <style>
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 100px auto;
      padding: 20px;
      text-align: center;
      color: #333;
      background: #f9f9f9;
      line-height: 1.6;
    }
    h1 {
      color: #dc3545;
      margin-bottom: 15px;
      font-size: 1.8em;
    }
    .error-box {
      background: #f8d7da;
      padding: 30px;
      border-radius: 8px;
      border: 1px solid #f5c6cb;
    }
    .error-box p {
      margin-bottom: 10px;
    }
    a {
      color: #007bff;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
    code {
      background: #f1f1f1;
      padding: 2px 6px;
      border-radius: 3px;
      font-size: 0.9em;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="error-box">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${uuidSection}
    <p><a href="/">Volver a la lista de mapas</a></p>
  </div>
</body>
</html>`;
}

/**
 * Builds a 404 error page (identifier not found in R2).
 *
 * Used when the identifier in the URL does not exist in the R2 bucket. The
 * identifier is shown so the user can verify it.
 *
 * @param {string} uuid - Identifier that was not found.
 * @returns {string} Complete 404 HTML document.
 *
 * @example
 * render404HTML('abc-123-def-456');
 * // -> '<!DOCTYPE html>...Error 404 — Mapa no encontrado...abc-123-def-456...</html>'
 */
export function render404HTML(uuid) {
  return renderErrorHTML(
    'Error 404 — Mapa no encontrado',
    'El UUID especificado no existe en el sistema.',
    uuid
  );
}

/**
 * Builds a 400 error page (invalid request).
 *
 * Used when the client request is invalid (for example malformed JSON, missing
 * parameters or a malformed identifier).
 *
 * @param {string} message - Human-readable validation error message.
 * @returns {string} Complete 400 HTML document.
 *
 * @example
 * render400HTML('El UUID proporcionado no tiene un formato válido.');
 * // -> '<!DOCTYPE html>...Error 400 — Solicitud inválida...</html>'
 */
export function render400HTML(message) {
  return renderErrorHTML(
    'Error 400 — Solicitud inválida',
    message
  );
}

/**
 * Builds a 500 error page (internal server error).
 *
 * Used when an unexpected failure occurs in the Worker (R2 failure, processing
 * error, unhandled exception).
 *
 * The message is ALWAYS generic and takes no parameter: internal details
 * (error.message, paths, resource identifiers) stay in the structured logs, so
 * no caller can leak them to the user.
 *
 * @returns {string} Complete 500 HTML document with the generic message.
 *
 * @example
 * render500HTML();
 * // -> '<!DOCTYPE html>...Error 500 — Error interno...Error interno del servidor...</html>'
 */
export function render500HTML() {
  return renderErrorHTML(
    'Error 500 — Error interno',
    'Error interno del servidor'
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

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
 * value inserted into the error HTML (titles, messages and identifiers).
 *
 * @param {string} text - Text to escape. Non-string values are converted.
 * @returns {string} Escaped text, safe to insert into HTML.
 *
 * @example
 * escapeHtml('<script>alert("xss")</script>')
 * // -> '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
 */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
