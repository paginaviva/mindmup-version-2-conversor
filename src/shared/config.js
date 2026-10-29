/**
 * @module config
 * Configuration loader backed by Cloudflare KV.
 *
 * Each KV namespace stores one versioned JSON document:
 * - CONFIG_KV under CONFIG_KEY: operational configuration and limits.
 * - VARIABLES_KV under VARIABLES_KEY: prefixes, API paths, cache durations and
 *   error codes.
 *
 * There are no silent defaults for operational values. Missing bindings, missing
 * documents, invalid JSON and missing or mistyped keys fail with an explicit
 * error that names the offending binding or key.
 */

/** KV key that stores the single application configuration document. */
export const CONFIG_KEY = 'app-config';

/** KV key that stores the single application variables document. */
export const VARIABLES_KEY = 'app-variables';

/**
 * Required configuration keys and their JSON types.
 *
 * These are contract keys, not operational values: the values themselves come
 * from CONFIG_KV.
 *
 * @type {Readonly<Record<string, string>>}
 */
const CONFIG_SCHEMA = Object.freeze({
  schemaVersion: 'number',
  loginEnabled: 'boolean',
  catalogEnabled: 'boolean',
  loginUser: 'string',
  sessionTtlMinutes: 'number',
  anonymousRetentionHours: 'number',
  maxUploadBytes: 'number',
  minUploadBytes: 'number',
  rateLimit: 'object',
  loginMaxAttempts: 'number',
  loginWindowSeconds: 'number',
  allowedOrigins: 'array',
  configCacheSeconds: 'number',
  conversionTimeoutSeconds: 'number',
  htmlCacheSeconds: 'number',
});

/**
 * Required variables sections and their keys, mirroring
 * `config.variables.example.json`.
 *
 * The `string[]` entry is a contract type meaning "array of strings". Key names
 * and types are part of the configuration contract; operational values still
 * come from VARIABLES_KV.
 *
 * @type {Readonly<Record<string, Readonly<Record<string, string>>>>}
 */
const VARIABLES_SCHEMA = Object.freeze({
  converter: Object.freeze({
    API_PATH_CONVERT: 'string',
    API_PATH_STATUS: 'string',
    API_PATH_DOWNLOAD: 'string',
    DO_BINDING_NAME: 'string',
    BINDING_R2: 'string',
    R2_INPUT_PATH_TEMPLATE: 'string',
    R2_OUTPUT_PATH_TEMPLATE: 'string',
    R2_TEMP_INPUT_PATH_TEMPLATE: 'string',
    R2_TEMP_OUTPUT_PATH_TEMPLATE: 'string',
    UPLOAD_TIMEOUT_SECONDS: 'number',
    HTTP_OK: 'number',
    HTTP_ACCEPTED: 'number',
    HTTP_BAD_REQUEST: 'number',
    HTTP_NOT_FOUND: 'number',
    HTTP_PAYLOAD_TOO_LARGE: 'number',
    HTTP_INTERNAL_ERROR: 'number',
    MUP_FORMAT_VERSION: 'number',
    MUP_KEY_IDEAS: 'string',
    DEFAULT_STICKER_CATEGORY: 'string',
    DEFAULT_REF_TYPE: 'string',
    DEFAULT_LINK_RESOLUTION: 'string',
    URL_REGEX_PATTERN: 'string',
    WORKER_URL: 'string',
  }),
  visualizer: Object.freeze({
    allowedOrigins: 'string[]',
    outputPrefix: 'string',
    jsonSuffix: 'string',
    listCacheSeconds: 'number',
    corsMaxAgeSeconds: 'number',
    durableObjectBinding: 'string',
  }),
});

/**
 * Checks whether a value is a non-null, non-array object.
 *
 * @param {*} value - Value to inspect.
 * @returns {boolean} true for plain objects.
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Checks whether a value matches a declared JSON contract type.
 *
 * @param {*} value - Value to inspect.
 * @param {string} expectedType - Declared type name.
 * @returns {boolean} true when the value matches.
 */
function matchesType(value, expectedType) {
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'string[]') {
    return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
  if (expectedType === 'object') return isPlainObject(value);
  return typeof value === expectedType;
}

/**
 * Builds the error text for an unexpected value type.
 *
 * @param {string} expectedType - Declared type name.
 * @returns {string} Spanish type description.
 */
function describeType(expectedType) {
  if (expectedType === 'string[]') return 'un array de cadenas';
  return `de tipo ${expectedType}`;
}

/**
 * Asserts that a configuration key exists and matches the expected type.
 *
 * @param {Object} config - Configuration document.
 * @param {string} key - Required key name.
 * @param {string} expectedType - Expected JSON type name.
 * @returns {void}
 * @throws {Error} When the key is missing or has a different type.
 */
function assertKeyType(config, key, expectedType) {
  if (config[key] === undefined) {
    throw new Error(`Configuración no válida: falta la clave "${key}"`);
  }

  if (!matchesType(config[key], expectedType)) {
    throw new Error(`Configuración no válida: la clave "${key}" debe ser de tipo ${expectedType}`);
  }
}

/**
 * Validates an application configuration document.
 *
 * Checks schemaVersion and every required key from the versioned example
 * configuration. Each failure names the missing or invalid key.
 *
 * @param {Object} config - Parsed configuration document.
 * @returns {Object} The validated configuration document.
 * @throws {Error} When the document is not an object, a key is missing or a
 *         key has the wrong type.
 */
export function validateConfig(config) {
  if (!isPlainObject(config)) {
    throw new Error('Configuración no válida: se esperaba un objeto JSON');
  }

  assertKeyType(config, 'schemaVersion', 'number');
  if (!Number.isInteger(config.schemaVersion) || config.schemaVersion < 1) {
    throw new Error('Configuración no válida: la clave "schemaVersion" debe ser un entero mayor o igual que 1');
  }

  for (const [key, expectedType] of Object.entries(CONFIG_SCHEMA)) {
    if (key === 'schemaVersion') continue;
    assertKeyType(config, key, expectedType);
  }

  // Optional anti-abuse keys: absent means disabled and no site key.
  if (config.turnstileEnabled !== undefined) {
    assertKeyType(config, 'turnstileEnabled', 'boolean');
  }
  if (config.turnstileSiteKey !== undefined) {
    assertKeyType(config, 'turnstileSiteKey', 'string');
  }

  return config;
}

/**
 * Asserts that a variables section exists and is a plain object.
 *
 * @param {string} sectionName - Section name (`converter` or `visualizer`).
 * @param {*} section - Candidate section value.
 * @returns {void}
 * @throws {Error} When the section is missing or not a plain object.
 */
function assertSection(sectionName, section) {
  if (section === undefined) {
    throw new Error(`Variables no válidas: falta la sección "${sectionName}"`);
  }

  if (!isPlainObject(section)) {
    throw new Error(`Variables no válidas: la sección "${sectionName}" debe ser un objeto JSON`);
  }
}

/**
 * Asserts that a section key exists and matches the expected type.
 *
 * Failures name the full path, for example `converter.API_PATH_CONVERT`.
 *
 * @param {Object} section - Section document.
 * @param {string} sectionName - Section name.
 * @param {string} key - Required key name.
 * @param {string} expectedType - Expected JSON type name.
 * @returns {void}
 * @throws {Error} When the key is missing or has a different type.
 */
function assertSectionKeyType(section, sectionName, key, expectedType) {
  const path = `${sectionName}.${key}`;

  if (section[key] === undefined) {
    throw new Error(`Variables no válidas: falta la clave "${path}"`);
  }

  if (!matchesType(section[key], expectedType)) {
    throw new Error(`Variables no válidas: la clave "${path}" debe ser ${describeType(expectedType)}`);
  }
}

/**
 * Validates an application variables document.
 *
 * Enforces the schema published in `config.variables.example.json`:
 * `schemaVersion` must be an integer >= 1, `converter` and `visualizer` must be
 * plain objects, and every key declared in the example must exist with the same
 * JSON type. There are no silent defaults.
 *
 * @param {Object} variables - Parsed variables document.
 * @returns {Object} The validated variables document, unchanged.
 * @throws {Error} When the document shape or a section key is missing or
 *         invalid.
 */
export function validateVariables(variables) {
  if (!isPlainObject(variables)) {
    throw new Error('Variables no válidas: se esperaba un objeto JSON');
  }

  if (variables.schemaVersion === undefined) {
    throw new Error('Variables no válidas: falta la clave "schemaVersion"');
  }

  if (!Number.isInteger(variables.schemaVersion) || variables.schemaVersion < 1) {
    throw new Error('Variables no válidas: la clave "schemaVersion" debe ser un entero mayor o igual que 1');
  }

  for (const [sectionName, sectionSchema] of Object.entries(VARIABLES_SCHEMA)) {
    const section = variables[sectionName];
    assertSection(sectionName, section);

    for (const [key, expectedType] of Object.entries(sectionSchema)) {
      assertSectionKeyType(section, sectionName, key, expectedType);
    }
  }

  return variables;
}

/**
 * Reads and parses one JSON document from a KV binding.
 *
 * @param {Object} env - Worker environment bindings.
 * @param {string} bindingName - Binding name (CONFIG_KV or VARIABLES_KV).
 * @param {string} key - KV key that stores the document.
 * @returns {Promise<Object>} Parsed JSON document.
 * @throws {Error} When the environment, binding, key or JSON document is
 *         missing or invalid.
 */
async function readDocument(env, bindingName, key) {
  if (typeof env !== 'object' || env === null) {
    throw new Error(`Entorno no válido: falta el binding "${bindingName}"`);
  }

  const binding = env[bindingName];
  if (!binding || typeof binding.get !== 'function') {
    throw new Error(`Falta el binding "${bindingName}" en el entorno`);
  }

  const raw = await binding.get(key);
  if (raw === null || raw === undefined) {
    throw new Error(`No se encontró la clave "${key}" en el binding "${bindingName}"`);
  }

  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    throw new Error(`La clave "${key}" del binding "${bindingName}" no contiene JSON válido`);
  }

  if (!isPlainObject(document)) {
    throw new Error(`La clave "${key}" del binding "${bindingName}" debe contener un objeto JSON`);
  }

  return document;
}

/**
 * Loads and validates the application configuration from CONFIG_KV.
 *
 * @param {Object} env - Worker environment bindings.
 * @returns {Promise<Object>} Validated configuration document.
 * @throws {Error} When the binding, key, JSON or a required key is missing or
 *         invalid.
 */
export async function loadConfig(env) {
  const config = await readDocument(env, 'CONFIG_KV', CONFIG_KEY);
  return validateConfig(config);
}

/**
 * Loads, validates and flattens the application variables from VARIABLES_KV.
 *
 * The returned view keeps the existing converter call sites working: converter
 * keys are exposed at the top level, `visualizer` stays nested under its own
 * key, and `schemaVersion` is preserved. For example:
 *
 * `{ schemaVersion, ...document.converter, visualizer: document.visualizer }`
 *
 * @param {Object} env - Worker environment bindings.
 * @returns {Promise<Object>} Flattened variables view.
 * @throws {Error} When the binding, key, JSON or a required section key is
 *         missing or invalid.
 */
export async function loadVariables(env) {
  const variables = await readDocument(env, 'VARIABLES_KV', VARIABLES_KEY);
  const validated = validateVariables(variables);

  return {
    schemaVersion: validated.schemaVersion,
    ...validated.converter,
    visualizer: validated.visualizer,
  };
}
