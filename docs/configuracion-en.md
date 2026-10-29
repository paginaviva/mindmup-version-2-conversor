# Configuration for MindMup 2 Conversor

[Español](configuracion-es.md) | [English](configuracion-en.md)


MindMup 2 Conversor stores the operational configuration in two JSON documents inside Cloudflare key-value storage. Loading does not replace missing keys with default values: if a binding is missing, a key is missing, or the type does not match, an explicit error names the failing element.

Validation and loading are manual. The repository does not include continuous integration or GitHub Actions.

For the full deployment, see [instalacion-publica-en.md](instalacion-publica-en.md) and [instalacion-login-r2-en.md](instalacion-login-r2-en.md).

## Compatibility and versions

The compatibility of `.mup` files is determined by the internal `formatVersion` field, not by the commercial version of MindMup. The template accepts 3 and rejects 2. `CONVERTER_VERSION` is the version of the conversion process (`v7`) and the package version is `1.0.0`; neither is the `.mup` format version.

`MUP_FORMAT_VERSION` is the internal format version that layer 1 compares with `formatVersion`. It is not the commercial version of MindMup, nor a selector for reading any MindMup 2 file based on the application name. The reference value, and the only one used by the template, is 3.

## 1. The two documents

| Binding | Key | Template | Content |
|---|---|---|---|
| `CONFIG_KV` | `app-config` | [config.example.json](../config.example.json) | Mode, limits, retention, session, and anti-abuse protection. |
| `VARIABLES_KV` | `app-variables` | [config.variables.example.json](../config.variables.example.json) | Internal paths, HTTP status codes, R2 templates, catalog cache, and visualizer CORS. |

- Each document is stored as a single JSON value under its key. The document is not split across several keys.
- The names `CONFIG_KV` and `VARIABLES_KV` are the bindings expected by `src/shared/config.js`.
- The keys `app-config` and `app-variables` are fixed. Changing them requires changing the code.
- In the variant with login, `CONFIG_KV` also stores sessions and counters. `VARIABLES_KV` stores only `app-variables`.
- Both documents are required. Each route loads the one it needs and fails if its document is not available.

Copy the templates to local files ignored by Git:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
```

`config.local.json` and `config.variables.local.json` are excluded by `.gitignore`. Do not commit them to Git.

## 2. `app-config` schema

### 2.1. Required keys

| Key | Type | Reference value | Use |
|---|---|---|---|
| `schemaVersion` | number | `1` | Integer greater than or equal to 1. |
| `loginEnabled` | boolean | `false` | Determines the mode. With `true`, access is enabled; with `false`, anonymous mode is used. |
| `catalogEnabled` | boolean | `false` | Only controls `/api/list` and the catalog view. Requires `loginEnabled: true`. It does not enable access on its own. |
| `loginUser` | string | `{{LOGIN_USER}}` | Exact username for the form. It may be empty when access is disabled; with access enabled, it must be a non-empty string. |
| `sessionTtlMinutes` | number | `1440` | Session lifetime in minutes. |
| `anonymousRetentionHours` | number | `24` | Anonymous retention in hours. It is anchored to the temporary output JSON `temp/{uuid}/output.json`, not to the exact moment of upload. |
| `maxUploadBytes` | number | `16777216` | Maximum upload size: 16 MB. |
| `minUploadBytes` | number | `1024` | Minimum upload size: 1 KB. |
| `rateLimit` | object | See the following table | Per-network-address limits in anonymous mode. |
| `loginMaxAttempts` | number | `5` | Login attempts allowed per window. |
| `loginWindowSeconds` | number | `600` | Login attempt window in seconds. |
| `allowedOrigins` | array | `[]` | Unused in the current code. Visualizer origins are configured in `app-variables.visualizer.allowedOrigins`. |
| `configCacheSeconds` | number | `60` | Present in the schema. The current code does not read it. |
| `conversionTimeoutSeconds` | number | `120` | Lifetime of the active conversion key and value of `Retry-After`. It does not abort the conversion. |
| `htmlCacheSeconds` | number | `0` | Present in the schema. The current code does not read it; HTML is served with `Cache-Control: private, no-store`. |

### 2.2. Optional keys

| Key | Type | Reference value | Use |
|---|---|---|---|
| `turnstileEnabled` | boolean | `false` | Enables anti-abuse verification. If missing, it is considered disabled. |
| `turnstileSiteKey` | string | `{{TURNSTILE_SITE_KEY}}` | Public key of the Turnstile widget. It is not a secret. It is sent to the client only if `turnstileEnabled` is `true`. |

### 2.3. `rateLimit`

| Key | Reference value | Effect |
|---|---|---|
| `windowSeconds` | `600` | 10-minute window for the upload counter. |
| `maxRequestsPerWindow` | `2` | Uploads allowed per window in anonymous mode. |
| `maxRequestsPerDay` | `10` | Uploads allowed per day in anonymous mode. |
| `maxConcurrent` | `1` | Not applied. Concurrency is approximated with one active key per network address. |
| `appliesToAuthenticated` | `false` | Not read. Limits apply only in anonymous mode. |

Behavior nuances:

- Counters are incremented before validating the file, the content type, or Turnstile. Invalid attempts consume quota.
- `/api/config` returns `rateLimit: null` in catalog mode. Per-network-address limits are not exposed in that response.
- `maxConcurrent` is not applied. Concurrency is approximated with one active key per network address.
- `conversionTimeoutSeconds` does not abort the conversion. It is used as the lifetime of the active key and as the `Retry-After` value.
- The catalog route is `/api/list`. `/api/lista` is not an API route; it may return the static page.

### 2.4. Modes

| `loginEnabled` | `catalogEnabled` | Mode | `/api/list` |
|---|---|---|---|
| `false` | `false` | Anonymous, without catalog. | `404` |
| `true` | `false` | With login, without catalog. | `404` |
| `true` | `true` | With login and catalog. | `401` without a session and `200` with a session. |
| `false` | `true` | Anonymous. `catalogEnabled` does not enable access. | `404` |

`loginEnabled` determines the general mode. `catalogEnabled` only controls the catalog and `/api/list`; it does not enable or disable login, uploads, status, the HTML view, or downloads.

The catalog requires `loginEnabled: true` and `catalogEnabled: true`. With the catalog enabled, `/api/list` responds `401` without a valid session; with the catalog disabled, it responds `404`.

### 2.5. Validator checks

`validateConfig` checks that the document is a JSON object, that `schemaVersion` is an integer greater than or equal to 1, and that the 15 required keys exist with the declared type. The `turnstileEnabled` and `turnstileSiteKey` keys are optional, but if present they must have the correct type.

The validator does not check numeric ranges, except for the `schemaVersion` integer, or the internal keys of `rateLimit`. At runtime, `loginMaxAttempts` and `loginWindowSeconds` must be positive integers, and `sessionTtlMinutes` must produce a duration of at least one second; otherwise, `/api/login` responds `500 Configuración no disponible`.

The `allowedOrigins`, `configCacheSeconds`, and `htmlCacheSeconds` keys are required even though the current code does not read them. Do not remove them: the validator requires them.

## 3. `app-variables` schema

The document has `schemaVersion` at the root and two required sections: `converter` and `visualizer`. `schemaVersion` must be an integer greater than or equal to 1. Both sections must be JSON objects.

```json
{
  "schemaVersion": 1,
  "converter": {},
  "visualizer": {}
}
```

### 3.1. `converter` section

| Key | Type | Reference value | Use |
|---|---|---|---|
| `API_PATH_CONVERT` | string | `/convertir` | Internal conversion path of the Worker. |
| `API_PATH_STATUS` | string | `/status` | Internal status path. |
| `API_PATH_DOWNLOAD` | string | `/download` | Internal JSON download path. |
| `DO_BINDING_NAME` | string | `MMUP_CONVERT_DO` | Binding of the conversion Durable Object. |
| `BINDING_R2` | string | `MMUP_BUCKET` | Binding of the R2 bucket. |
| `R2_INPUT_PATH_TEMPLATE` | string | `input/{uuid}.mup` | Original in catalog mode. |
| `R2_OUTPUT_PATH_TEMPLATE` | string | `output/{uuid}.json` | Result published in the catalog. |
| `R2_TEMP_INPUT_PATH_TEMPLATE` | string | `temp/{uuid}.mup` | Original in anonymous mode. |
| `R2_TEMP_OUTPUT_PATH_TEMPLATE` | string | `temp/{uuid}/output.json` | Temporary anonymous output. |
| `UPLOAD_TIMEOUT_SECONDS` | number | `30` | Maximum upload time to the Worker. |
| `HTTP_OK` | number | `200` | Successful response code. |
| `HTTP_ACCEPTED` | number | `202` | Accepted conversion code. |
| `HTTP_BAD_REQUEST` | number | `400` | Invalid request code. |
| `HTTP_NOT_FOUND` | number | `404` | Resource not found code. |
| `HTTP_PAYLOAD_TOO_LARGE` | number | `413` | File too large code. |
| `HTTP_INTERNAL_ERROR` | number | `500` | Internal error code. |
| `MUP_FORMAT_VERSION` | number | `3` | Internal `.mup` format version accepted by layer 1. It is not the commercial version of MindMup. |
| `MUP_KEY_IDEAS` | string | `ideas` | Key of the node tree. |
| `DEFAULT_STICKER_CATEGORY` | string | `unknown` | Default category of stickers. |
| `DEFAULT_REF_TYPE` | string | `web_page` | Default type of external references. |
| `DEFAULT_LINK_RESOLUTION` | string | `unresolved` | Default state of internal links. |
| `URL_REGEX_PATTERN` | string | Template pattern | Regular expression to detect external addresses. |
| `WORKER_URL` | string | `""` | Origin used to build the download URL. Empty uses the request origin. |

`MUP_FORMAT_VERSION` does not identify the MindMup 2 or MindMup 3 application. If a file declares `formatVersion: 2`, layer 1 rejects it with `Formato .mup no soportado. Se esperaba versión 3, se recibió 2.` The message refers to the internal format, not to the commercial version.

Reference value of `URL_REGEX_PATTERN`:

```json
{
  "URL_REGEX_PATTERN": "(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)"
}
```

### 3.2. `visualizer` section

| Key | Type | Reference value | Use |
|---|---|---|---|
| `allowedOrigins` | array of strings | `[]` | Origins allowed for the visualizer CORS. |
| `outputPrefix` | string | `output/` | Prefix of the catalog objects in R2. |
| `jsonSuffix` | string | `.json` | Suffix of the catalog objects. |
| `listCacheSeconds` | number | `60` | `Cache-Control: private, max-age=...` of `/api/list`. |
| `corsMaxAgeSeconds` | number | `86400` | `Access-Control-Max-Age` of the CORS responses. |
| `durableObjectBinding` | string | `MMUP_VISOR_DO` | Binding of the visualization Durable Object. |

Do not change `outputPrefix` or `jsonSuffix` without adapting the catalog and downloads. `BINDING_R2` and `durableObjectBinding` must match the environment bindings; `DO_BINDING_NAME` accepts the legacy value `MMUP_CONVERT_DO` as a fallback.

At runtime, `loadVariables` returns `{ schemaVersion, ...converter, visualizer }`. The converter code reads the converter keys at the top level and the visualizer reads `variables.visualizer`.

## 4. Templates

- [config.example.json](../config.example.json) is a complete `app-config` document.
- [config.variables.example.json](../config.variables.example.json) is a complete `app-variables` document.
- `config.variables.example.json` contains no placeholders. Its values are internal paths, codes, and binding names.
- `config.example.json` contains two placeholders that you must replace before loading the document.

| Placeholder | Document | Use |
|---|---|---|
| `{{LOGIN_USER}}` | `app-config` | Username for the login form. |
| `{{TURNSTILE_SITE_KEY}}` | `app-config` | Public key of the Turnstile widget. |

The validator accepts the placeholders because they are strings and does not detect them. Replace them before using the document in a real deployment.

### 4.1. Secrets outside these documents

`app-config` and `app-variables` contain no secrets. Secrets are defined in the Worker or in the Pages project:

| Secret | Destination | Use |
|---|---|---|
| `INTERNAL_SHARED_SECRET` | Conversion Worker and Pages | Authenticates the calls from Pages to the Worker. |
| `ADMIN_PASSWORD_HASH` | Pages | Hash of the login password. |
| `ADMIN_PASSWORD_SALT` | Pages | Salt for the hash. |
| `ADMIN_PASSWORD_ITERATIONS` | Pages | Number of PBKDF2 iterations. |
| `TURNSTILE_SECRET_KEY` | Pages | Turnstile verification. Optional. |

The distribution uses PBKDF2 with **5,000 iterations** as the reference value. Generate the secrets with the explicit flag:

```bash
node scripts/generate-secrets.js --iterations 5000
```

`turnstileSiteKey` is a public key and does belong to `app-config`. `TURNSTILE_SECRET_KEY` is a secret and is not stored in either document.

## 5. Validation with `node scripts/validate-config.js`

Validate both documents before loading them:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

If you omit the options, the script uses `config.local.json` and `config.variables.local.json`:

```bash
node scripts/validate-config.js
```

Help is available with:

```bash
node scripts/validate-config.js --help
```

With the templates, the output is:

```text
Configuración válida: 23 claves del convertidor y 6 claves del visualizador.
```

- The exit code is 0 if both documents are valid.
- The exit code is 1 if a file is missing, cannot be read, does not contain valid JSON, or does not conform to the schema.
- The script only reads files. It does not write, load, or modify key-value storage.

Validation is manual.

## 6. Loading into key-value storage with `--remote`

Each document is stored as a single JSON value under its key. `--remote` writes to the real namespace; without that flag, Wrangler uses local development storage.

```bash
npx -y wrangler@4 kv key put app-config "$(cat config.local.json)" \
  --namespace-id {{KV_CONFIG_ID}} --remote

npx -y wrangler@4 kv key put app-variables "$(cat config.variables.local.json)" \
  --namespace-id {{KV_VARIABLES_ID}} --remote
```

- `{{KV_CONFIG_ID}}` and `{{KV_VARIABLES_ID}}` are the identifiers returned by `kv namespace create`, not the namespace names.
- The keys must be exactly `app-config` and `app-variables`.
- Load both documents. The routes that use each document fail if their document is missing.
- Validate the files before loading them. Loading does not validate the document: the check is performed by `validate-config.js` or, at runtime, by `loadConfig` and `loadVariables`.
- If you change a document, load it again with `--remote`.

## 7. Configuration cache and propagation

There is no in-memory cache for `app-config` or `app-variables`. `loadConfig` and `loadVariables` read the key-value namespace on every request that needs them.

| Response | Header | Source |
|---|---|---|
| `/api/config` | `public, max-age=60` | Set in the code. It does not use `configCacheSeconds`. |
| `/api/list` | `private, max-age=<listCacheSeconds>` | `app-variables.visualizer.listCacheSeconds`. |
| `/api/session`, `/api/upload`, `/api/status/{uuid}`, `/html/{uuid}`, `/api/download/{uuid}`, `/api/download-html/{uuid}` | `no-store` or `private, no-store` | Session data or results. |

- `/api/config` reads the document on every request, but the response may be served from the browser or an intermediary cache for 60 seconds. A change in `app-config` is not necessarily reflected immediately.
- `/api/list` may be served from the browser's private cache for `listCacheSeconds`.
- Key-value storage does not guarantee an immediate read in all locations. Changes propagate over time; repeat the check after an interval.
- `configCacheSeconds` is present in the schema, but the current code does not read it. Do not use it to calculate the actual delay.
- `htmlCacheSeconds` is present in the schema, but the current code does not read it. HTML responses are served with `Cache-Control: private, no-store`.
- The application does not provide a route to invalidate the configuration cache. To check a change, wait and query again.

## 8. Explicit errors when a binding or key is missing

Loading fails with a message that names the binding or the key. These are the messages from `src/shared/config.js`:

```text
Entorno no válido: falta el binding "CONFIG_KV"
Falta el binding "CONFIG_KV" en el entorno
No se encontró la clave "app-config" en el binding "CONFIG_KV"
La clave "app-config" del binding "CONFIG_KV" no contiene JSON válido
La clave "app-config" del binding "CONFIG_KV" debe contener un objeto JSON
Configuración no válida: falta la clave "loginEnabled"
Configuración no válida: la clave "loginEnabled" debe ser de tipo boolean
Configuración no válida: la clave "schemaVersion" debe ser un entero mayor o igual que 1
Variables no válidas: falta la sección "converter"
Variables no válidas: falta la clave "converter.API_PATH_CONVERT"
Variables no válidas: la clave "converter.API_PATH_CONVERT" debe ser de tipo string
Variables no válidas: la clave "visualizer.allowedOrigins" debe ser un array de cadenas
```

- `CONFIG_KV` and `VARIABLES_KV` are the binding names expected by the loader. A binding with another name is considered missing.
- `app-config` and `app-variables` are the keys expected by the loader. A key with another name is considered missing.
- There are no silent default values for required keys. A missing key is not replaced with an internal value.
- The Functions catch these errors and respond `500 Configuración no disponible` without revealing internal details. The specific message is not sent to the client.
- `/api/session` responds `authenticated: false` if it cannot load the configuration, instead of returning `500`.

The validation script uses equivalent messages for the local files:

```text
No se encontró el archivo de configuración "config.local.json".
El archivo de configuración "config.local.json" no contiene JSON válido: ...
No se encontró el archivo de variables "config.variables.local.json".
```

## 9. Campaign variables: they do not exist in this distribution

This distribution does not include campaign mode:

- There are no campaign keys in `app-config` or `app-variables`.
- There are no `/api/campaign/*` routes, `campaign.js` module, `staging/` prefix, or `X-MMUP-Mode: campaign` header.
- The only modes are `anonymous` and `catalogue`.
- Do not add campaign keys to the documents: the validator does not require them and the code does not read them.

If a document or a configuration mentions `staging/` or a campaign route, it belongs to another distribution and must not be carried over to this one.

## 10. Checklist

- [ ] `config.local.json` and `config.variables.local.json` exist and are outside Git.
- [ ] The `{{LOGIN_USER}}` and `{{TURNSTILE_SITE_KEY}}` placeholders are replaced.
- [ ] `node scripts/validate-config.js` returns `Configuración válida`.
- [ ] The `CONFIG_KV` and `VARIABLES_KV` bindings exist with those names.
- [ ] `app-config` and `app-variables` are loaded with `--remote`.
- [ ] `loginEnabled` and `catalogEnabled` match the mode in which you want to operate.
- [ ] There are no secrets in `app-config` or `app-variables`.
- [ ] `/api/config` reflects the mode after the 60-second cache window.
