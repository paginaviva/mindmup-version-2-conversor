/**
 * @module app
 * Browser entry point for the converter interface.
 *
 * Handles configuration bootstrap, optional server-side session, uploads,
 * result preview, downloads and the catalogue.
 */

const state = {
  config: null,
  session: null,
  turnstileToken: null,
  result: null,
};

const element = (id) => document.getElementById(id);

/**
 * Fetches JSON and returns the parsed body.
 *
 * @param {string} url - Request URL.
 * @param {RequestInit} [options] - Fetch options.
 * @returns {Promise<Object>} Parsed JSON.
 * @throws {Error} When the response is not successful.
 */
async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.headers || {}),
    },
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok) {
    const message = body && typeof body.error === 'string'
      ? body.error
      : `Error del servidor (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return body || {};
}

function showLoginView() {
  element('login-view').hidden = false;
  element('content-view').hidden = true;
  element('login-user').focus();
}

function showContentView(catalogueEnabled) {
  element('login-view').hidden = true;
  element('content-view').hidden = false;
  element('logout-btn').hidden = !catalogueEnabled;
  element('catalogue-view').hidden = !catalogueEnabled;

  const hint = element('upload-hint');
  if (catalogueEnabled) {
    hint.textContent = 'Selecciona un archivo .mup y conviértelo. El resultado se guardará en el catálogo.';
  } else {
    hint.textContent = 'Selecciona un archivo .mup. El resultado estará disponible solo durante el periodo de retención.';
  }
}

function setLoginError(message) {
  const box = element('login-error');
  box.textContent = message;
  box.hidden = message.length === 0;
}

/**
 * Loads the Turnstile widget when the public configuration enables it.
 */
function setupTurnstile() {
  const container = element('turnstile-container');
  if (!state.config || state.config.turnstileEnabled !== true) {
    container.hidden = true;
    return;
  }

  const siteKey = state.config.turnstileSiteKey;
  if (typeof siteKey !== 'string' || siteKey.length === 0) {
    container.hidden = true;
    return;
  }

  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.defer = true;
  script.addEventListener('load', () => {
    if (!window.turnstile || typeof window.turnstile.render !== 'function') return;
    window.turnstile.render(container, {
      sitekey: siteKey,
      callback: (token) => {
        state.turnstileToken = token;
      },
      'expired-callback': () => {
        state.turnstileToken = null;
      },
      'error-callback': () => {
        state.turnstileToken = null;
      },
    });
  });
  document.head.append(script);
}

async function handleLogin(event) {
  event.preventDefault();
  setLoginError('');

  const user = element('login-user').value.trim();
  const password = element('login-password').value;

  if (!user || !password) {
    setLoginError('Introduce usuario y contraseña.');
    return;
  }

  const button = event.submitter;
  if (button) button.disabled = true;

  try {
    await fetchJson('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, password }),
    });
    state.session = { authenticated: true, user };
    element('login-form').reset();
    showContentView(true);
    await loadCatalogue();
  } catch (error) {
    setLoginError(error.status === 429
      ? 'Demasiados intentos. Espera unos minutos.'
      : 'Usuario o contraseña incorrectos.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function handleLogout() {
  try {
    await fetchJson('/api/logout', { method: 'POST' });
  } finally {
    state.session = { authenticated: false };
    showLoginView();
  }
}

async function bootstrap() {
  try {
    state.config = await fetchJson('/api/config');
  } catch {
    element('login-view').hidden = false;
    setLoginError('No se pudo cargar la configuración. Recarga la página.');
    return;
  }

  if (state.config.loginEnabled === true) {
    try {
      state.session = await fetchJson('/api/session');
    } catch {
      state.session = { authenticated: false };
    }

    if (state.session.authenticated === true) {
      showContentView(state.config.catalogEnabled === true);
      if (state.config.catalogEnabled === true) await loadCatalogue();
    } else {
      showLoginView();
    }
  } else {
    state.session = { authenticated: false };
    showContentView(false);
  }

  setupTurnstile();
}

element('login-form').addEventListener('submit', handleLogin);
element('logout-btn').addEventListener('click', handleLogout);
bootstrap();

/**
 * Updates the upload status line.
 *
 * @param {string} message - Spanish message.
 * @param {'info'|'error'|'success'} [tone='info'] - Visual tone.
 */
function setUploadStatus(message, tone = 'info') {
  const status = element('upload-status');
  status.textContent = message;
  status.dataset.tone = tone;
}

/**
 * Updates the upload progress bar.
 *
 * @param {number|null} percent - Progress from 0 to 100, or null to reset.
 */
function setUploadProgress(percent) {
  const progress = element('upload-progress');
  if (percent === null) {
    progress.hidden = true;
    progress.value = 0;
    progress.textContent = '0 %';
    return;
  }
  progress.hidden = false;
  progress.value = percent;
  progress.textContent = `${Math.round(percent)} %`;
}

/**
 * Uploads a file with progress reporting.
 *
 * @param {FormData} formData - Multipart body.
 * @param {(percent: number) => void} onProgress - Progress callback.
 * @returns {Promise<{status: number, body: Object}>} Upload result.
 */
function uploadWithProgress(formData, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/upload');
    request.responseType = 'json';
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress((event.loaded / event.total) * 100);
    });
    request.addEventListener('load', () => {
      resolve({ status: request.status, body: request.response || {} });
    });
    request.addEventListener('error', () => reject(new Error('No se pudo enviar el archivo.')));
    request.send(formData);
  });
}

/**
 * Waits until the conversion reaches a terminal state.
 *
 * @param {string} uuid - Conversion identifier.
 * @returns {Promise<string>} Final status.
 */
async function waitForCompletion(uuid) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = await fetchJson(`/api/status/${uuid}`);
    if (result.status === 'completed') return result.status;
    if (result.status === 'error') throw new Error('La conversión ha fallado.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('La conversión está tardando más de lo esperado.');
}

/**
 * Shows the result panel for a completed upload.
 *
 * @param {Object} result - Upload response.
 */
function showResult(result) {
  state.result = result;

  element('result-title').textContent = result.mode === 'catalogue'
    ? 'Mapa convertido y guardado'
    : 'Mapa convertido';
  element('result-frame').src = result.htmlUrl;
  element('result-view').hidden = false;

  const htmlDownload = element('result-download-html');
  htmlDownload.hidden = false;
  htmlDownload.disabled = false;
  htmlDownload.textContent = 'Descargar HTML';

  const warning = element('result-warning');
  warning.hidden = true;
  warning.textContent = '';
  warning.removeAttribute('data-tone');

  const download = element('result-download');
  if (result.downloadUrl) {
    download.href = result.downloadUrl;
    download.hidden = false;
  } else {
    download.hidden = true;
  }

  element('result-expiry').textContent = result.expiresAt
    ? `Disponible hasta ${new Date(result.expiresAt).toLocaleString('es-ES')}.`
    : 'Guardado en el catálogo.';

  element('result-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/**
 * Resolves the HTML ZIP download URL for a result payload.
 *
 * @param {Object} result - Upload response.
 * @returns {string} Absolute or root-relative download URL.
 */
function htmlDownloadUrl(result) {
  if (result && typeof result.htmlDownloadUrl === 'string' && result.htmlDownloadUrl.length > 0) {
    return result.htmlDownloadUrl;
  }
  if (result && typeof result.uuid === 'string' && result.uuid.length > 0) {
    return `/api/download-html/${encodeURIComponent(result.uuid)}`;
  }
  return '';
}

/**
 * Extracts the file name from a Content-Disposition header.
 *
 * Supports both the plain `filename` parameter and the RFC 5987
 * `filename*=UTF-8''...` form.
 *
 * @param {string|null} value - Header value.
 * @returns {string} Download file name, or an empty string.
 */
function filenameFromDisposition(value) {
  if (typeof value !== 'string') return '';

  const extended = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(value);
  if (extended) {
    const raw = extended[1].trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }

  const simple = /filename\s*=\s*"?([^";]+)"?/i.exec(value);
  return simple ? simple[1].trim() : '';
}

/**
 * Decodes the missing-resource sample header.
 *
 * The endpoint percent-encodes each URL and joins them with "%0A" because HTTP
 * headers cannot contain a literal newline. Literal newlines are also accepted
 * so the parser stays tolerant.
 *
 * @param {string|null} value - Header value.
 * @returns {string[]} Decoded URLs.
 */
function decodeMissingSample(value) {
  if (typeof value !== 'string' || value.length === 0) return [];

  return value
    .split(/%0A|\r?\n/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    });
}

/**
 * Builds the user-facing warning for missing resources.
 *
 * @param {number} count - Number of resources that could not be included.
 * @param {string[]} sample - Sample of missing URLs.
 * @returns {string} Spanish warning text.
 */
function missingWarning(count, sample) {
  const noun = count === 1 ? 'recurso' : 'recursos';
  const preview = sample.length > 0 ? ` Muestra: ${sample.join(', ')}.` : '';
  return `El HTML se ha descargado, pero faltan ${count} ${noun}.${preview} Revisa faltantes.txt dentro del ZIP.`;
}

/**
 * Downloads the rendered HTML for the current result as a ZIP bundle.
 */
async function handleDownloadHtml() {
  const button = element('result-download-html');
  const warning = element('result-warning');
  // Snapshot the result so an awaited call cannot observe a newer state.
  const result = state.result;
  const url = htmlDownloadUrl(result);
  const originalText = button.textContent || 'Descargar HTML';

  if (url.length === 0) {
    warning.textContent = 'No se pudo preparar la descarga del HTML.';
    warning.dataset.tone = 'error';
    warning.hidden = false;
    return;
  }

  button.disabled = true;
  button.textContent = 'Preparando…';
  warning.hidden = true;
  warning.textContent = '';
  warning.removeAttribute('data-tone');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120_000);
  let objectUrl = null;

  try {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`No se pudo preparar el HTML (${response.status}).`);
    }

    const blob = await response.blob();
    const missingCount = Number.parseInt(response.headers.get('X-MMUP-Missing-Count') || '0', 10);
    const sample = decodeMissingSample(response.headers.get('X-MMUP-Missing-Sample'));
    const filename = filenameFromDisposition(response.headers.get('Content-Disposition'))
      || (result && result.uuid ? `${result.uuid}.zip` : 'mapa.zip');

    objectUrl = URL.createObjectURL(blob);
    const downloadUrl = objectUrl;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    link.rel = 'noopener';
    document.body.append(link);
    try {
      link.click();
    } catch (error) {
      URL.revokeObjectURL(downloadUrl);
      objectUrl = null;
      throw error;
    } finally {
      link.remove();
    }
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 60_000);
    objectUrl = null;

    if (Number.isFinite(missingCount) && missingCount > 0) {
      warning.textContent = missingWarning(missingCount, sample);
      warning.dataset.tone = 'warning';
      warning.hidden = false;
    }
  } catch (error) {
    if (objectUrl !== null) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    warning.textContent = error.message || 'No se pudo descargar el HTML.';
    warning.dataset.tone = 'error';
    warning.hidden = false;
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    button.textContent = originalText;
  }
}

async function handleUpload(event) {
  event.preventDefault();
  setUploadStatus('');

  const file = element('upload-file').files[0];
  if (!file) {
    setUploadStatus('Selecciona un archivo .mup.', 'error');
    return;
  }

  if (state.config && state.config.turnstileEnabled === true && !state.turnstileToken) {
    setUploadStatus('Completa la verificación antiabuso antes de continuar.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file, file.name);
  if (state.turnstileToken) formData.append('turnstileToken', state.turnstileToken);

  const submit = element('upload-submit');
  submit.disabled = true;
  setUploadProgress(0);
  setUploadStatus('Subiendo archivo…');

  try {
    const response = await uploadWithProgress(formData, setUploadProgress);
    if (response.status !== 202) {
      throw new Error(response.body && response.body.error
        ? response.body.error
        : 'No se pudo iniciar la conversión.');
    }

    setUploadProgress(100);
    setUploadStatus('Convirtiendo mapa…');
    await waitForCompletion(response.body.uuid);
    setUploadStatus('Conversión completada.', 'success');
    showResult(response.body);
    element('upload-form').reset();
    state.turnstileToken = null;
    if (response.body.mode === 'catalogue') await loadCatalogue();
  } catch (error) {
    setUploadStatus(error.message || 'No se pudo convertir el archivo.', 'error');
  } finally {
    submit.disabled = false;
    setUploadProgress(null);
  }
}

element('upload-form').addEventListener('submit', handleUpload);
element('result-download-html').addEventListener('click', handleDownloadHtml);
element('result-new').addEventListener('click', () => {
  element('result-view').hidden = true;
  element('result-frame').src = 'about:blank';
  element('result-warning').hidden = true;
  element('result-warning').textContent = '';
  state.result = null;
  element('upload-file').focus();
  element('upload-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

const catalogueState = {
  items: [],
  query: '',
  group: '',
  sortKey: 'date',
  sortDirection: 'desc',
};

/**
 * Normalizes text for accent-insensitive search.
 *
 * @param {string} value - Raw text.
 * @returns {string} Normalized text.
 */
function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036F]/g, '')
    .toLowerCase()
    .replace(/[-_.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Returns the visible map name without the .mup extension.
 *
 * @param {Object} item - Catalogue item.
 * @returns {string} Map name.
 */
function mapName(item) {
  const source = typeof item.source_file === 'string' ? item.source_file : '';
  return source.replace(/\.mup$/i, '').trim() || 'No disponible';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function selectValue(value) {
  return value === null || value === undefined || String(value).trim() === '' ? '—' : String(value);
}

function filteredItems() {
  const query = normalizeSearch(catalogueState.query);
  return catalogueState.items.filter((item) => {
    if (catalogueState.group && item.group !== catalogueState.group) return false;
    if (!query) return true;
    return normalizeSearch(mapName(item)).includes(query);
  });
}

function sortedItems(items) {
  const direction = catalogueState.sortDirection === 'asc' ? 1 : -1;
  const factor = (left, right) => direction * left.localeCompare(right, 'es', { numeric: true, sensitivity: 'base' });

  return [...items].sort((left, right) => {
    let result = 0;
    if (catalogueState.sortKey === 'name') result = factor(mapName(left), mapName(right));
    else if (catalogueState.sortKey === 'group') result = factor(left.group || '', right.group || '');
    else if (catalogueState.sortKey === 'date') result = direction * (Date.parse(left.converted_at || 0) - Date.parse(right.converted_at || 0));
    else if (catalogueState.sortKey === 'nodes') result = direction * ((left.node_count || 0) - (right.node_count || 0));
    else if (catalogueState.sortKey === 'version') result = factor(left.version || '—', right.version || '—');
    return result || factor(mapName(left), mapName(right));
  });
}

function updateSortHeaders() {
  for (const button of element('catalogue-table').querySelectorAll('[data-sort-key]')) {
    const active = button.dataset.sortKey === catalogueState.sortKey;
    const header = button.closest('th');
    header.setAttribute('aria-sort', active
      ? (catalogueState.sortDirection === 'asc' ? 'ascending' : 'descending')
      : 'none');
    button.dataset.active = active ? 'true' : 'false';
    button.dataset.direction = active ? catalogueState.sortDirection : '';
  }
}

function renderCatalogue() {
  const items = sortedItems(filteredItems());
  const body = element('catalogue-body');
  body.replaceChildren();

  for (const item of items) {
    const row = document.createElement('tr');
    const nameCell = document.createElement('td');
    nameCell.className = 'col-name';
    nameCell.textContent = mapName(item);
    const groupCell = document.createElement('td');
    groupCell.className = 'col-group';
    groupCell.textContent = selectValue(item.group);
    const dateCell = document.createElement('td');
    dateCell.className = 'col-date';
    dateCell.textContent = formatDate(item.converted_at);
    const nodesCell = document.createElement('td');
    nodesCell.className = 'col-nodes';
    nodesCell.textContent = String(item.node_count || 0);
    const versionCell = document.createElement('td');
    versionCell.className = 'col-version';
    versionCell.textContent = selectValue(item.version);
    const actionCell = document.createElement('td');
    actionCell.className = 'col-action';
    const action = document.createElement('a');
    action.className = 'button button--small';
    action.textContent = 'Visualizar';
    action.href = `/html/${encodeURIComponent(item.uuid)}`;
    action.target = '_blank';
    action.rel = 'noopener noreferrer';
    actionCell.append(action);
    row.append(nameCell, groupCell, dateCell, nodesCell, versionCell, actionCell);
    body.append(row);
  }

  element('catalogue-count').textContent = `${items.length} de ${catalogueState.items.length} mapas`;
  element('catalogue-empty').hidden = items.length !== 0;
  updateSortHeaders();
}

function renderGroups() {
  const select = element('group-filter');
  const current = catalogueState.group;
  const groups = [...new Set(catalogueState.items.map((item) => item.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  select.replaceChildren(new Option('Todos', ''));
  for (const group of groups) select.append(new Option(group, group));
  if (current && groups.includes(current)) select.value = current;
}

async function loadCatalogue() {
  try {
    const data = await fetchJson('/api/list');
    catalogueState.items = Array.isArray(data.items) ? data.items : [];
    renderGroups();
    renderCatalogue();
  } catch {
    element('catalogue-count').textContent = 'No se pudo cargar el catálogo.';
  }
}

element('search-input').addEventListener('input', (event) => {
  catalogueState.query = event.target.value;
  renderCatalogue();
});

element('group-filter').addEventListener('change', (event) => {
  catalogueState.group = event.target.value;
  renderCatalogue();
});

element('catalogue-table').addEventListener('click', (event) => {
  const sortButton = event.target.closest('[data-sort-key]');
  if (sortButton) {
    const key = sortButton.dataset.sortKey;
    if (catalogueState.sortKey === key) {
      catalogueState.sortDirection = catalogueState.sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      catalogueState.sortKey = key;
      catalogueState.sortDirection = 'asc';
    }
    renderCatalogue();
    return;
  }
});
