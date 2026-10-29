# Architecture of MindMup 2 Conversor

[Español](arquitectura-es.md) | [English](arquitectura-en.md)


MindMup 2 Conversor converts `.mup` files compatible with `formatVersion: 3` into normalized JSON-CMJN with 10 collections and into self-contained HTML. Compatibility is determined by the internal `formatVersion` value, not by the commercial version of MindMup. The converter only reads the file and generates a JSON and HTML copy; it does not open, edit, or save maps in MindMup.

The same codebase is used in three forms: the public variant without login, the variant with login and R2, and the local converter. This page describes the components, flows, routes, and decisions that explain the observable behavior. Protection measures are detailed in [Security](seguridad-en.md).

## Compatibility and versions

Technical compatibility does not depend on the commercial name of the application. It depends on the internal `formatVersion` field of the `.mup` file:

| Concept | What it is | Value or use |
|---|---|---|
| Commercial version of MindMup | MindMup 2 or MindMup 3 | The converter does not read or validate it. |
| `formatVersion` of the `.mup` | Internal version of the file format. | The converter accepts 3 and rejects 2. Any other value is not accepted either. |
| `CONVERTER_VERSION` | Version of the project's conversion process. | `v7`. |
| Package version | Repository version. | `1.0.0`. |

A file exported from MindMup 2 is processed only if it declares `formatVersion: 3`. The converter does not infer the commercial version or convert it: it inspects the internal value and, if it is not 3, stops the conversion with an error. The same applies to a file exported from MindMup 3.

The official MindMup documentation does not document the internal `formatVersion` value. Therefore, it cannot be stated that all MindMup 2 files use `formatVersion: 3`, nor that all MindMup 3 files use another value. The layer 1 check and the `synthetic-v2.mup` fixture demonstrate the rejection of 2, not universal compatibility with all MindMup 2 files. See [Tests](pruebas-en.md) for the exact scope of the suite.

`v7` is the version of the conversion process, not the MindMup version or the `.mup` format version. The package version (`1.0.0`) identifies the repository and is not the format version either.

## 1. Components

```text
Browser
   │
   ▼
Cloudflare Pages: app/ + functions/
   │  service binding CONVERTER; internal secret
   ├──────────────► Conversion Worker ──► R2
   │                    Durable Object MupConverter
   │  service binding VISUALIZER
   └──────────────► Visualization Worker ──► R2
                        Durable Object MupVisualizer

Functions ──► CONFIG_KV (app-config, sessions, and counters)
Functions ──► VARIABLES_KV (app-variables)
```

| Component | Role |
|---|---|
| Cloudflare Pages | Serves the static interface of `app/` and the Functions in `functions/`. It is the only public entry point. |
| Functions | Validate requests, enforce authorization and limits, check retention, and call the Workers through service bindings. |
| Conversion Worker | Receives the `.mup`, stores it in R2, runs the eight conversion layers in a Durable Object, and writes the JSON-CMJN. |
| Visualization Worker | Loads the JSON-CMJN from R2, runs the six visualization layers in a Durable Object, and returns the self-contained HTML. |
| R2 | Stores temporary originals, temporary JSON files, and published results. The binding is `MMUP_BUCKET`. |
| Key-value storage | `CONFIG_KV` stores `app-config`, sessions, and counters. `VARIABLES_KV` stores `app-variables`. |
| Durable Objects | `MupConverter` and `MupVisualizer` provide state isolated by identifier and use SQLite storage. |
| Service bindings | `CONVERTER` connects Pages to the Conversion Worker. `VISUALIZER` connects Pages to the Visualization Worker. |
| Internal secret | `INTERNAL_SHARED_SECRET` authenticates calls from Pages to the Conversion Worker. |

Both Workers are internal: they are configured with `workers_dev: false` and `preview_urls: false`. They have no public address or domain of their own. Pages is the only entry point, and the Functions are the ones that enforce limits and authorization.

The static interface declares its routes in `app/_routes.json`: requests to `/api/*` and `/html/*` go through Functions; the rest is served as static content. The application's security headers are in `app/_headers`.

Each installation creates its own resources. The R2 bucket, key-value storage namespaces, Workers, Pages project, and secrets are not shared between installations.

## 2. Operating modes

`loginEnabled` determines the general mode. `catalogEnabled` only controls the catalog and the `/api/list` route; it does not enable or disable login, uploads, status, the HTML view, or downloads.

| `loginEnabled` | `catalogEnabled` | Mode | Catalog | Public output |
|---|---|---|---|---|
| `false` | `false` | Anonymous | No | Temporary HTML only |
| `false` | `true` | Anonymous | No; the catalog is disabled | Temporary HTML only |
| `true` | `true` | Catalog | Yes, with a session | JSON, HTML, and ZIP with a session |
| `true` | `false` | Catalog without catalog | No; `/api/list` responds `404` | JSON, HTML, and ZIP with a session |

With `loginEnabled: false`, `/api/config` returns `mode: "anonymous"`, `loginEnabled: false`, and `catalogEnabled: false`, even if `app-config` has `catalogEnabled: true`. The application does not show the login form or the catalog view.

With `loginEnabled: true`, `/api/config` returns `mode: "catalogue"` and `rateLimit: null`. The per-network-address limits for anonymous uploads are not exposed in that response. The login attempt limit still applies at `/api/login`.

If `catalogEnabled` is `false` with `loginEnabled: true`, the upload, status, HTML, and download routes continue to work with a valid session. Only `/api/list` responds `404`, and the interface hides the catalog view.

Disabling `loginEnabled` does not proactively invalidate existing sessions. They are deleted when `/api/session` is queried or when they expire.

New uploads do not automatically receive a group in this distribution. The catalog shows `Sin grupo` and an empty `group_path` until metadata is assigned to the object.

## 3. Flow of a public conversion

1. The browser loads the application. The interface queries `GET /api/config` and receives `mode: "anonymous"`. If `GET /api/session` is queried, it responds `authenticated: false`; the interface does not show login or catalog.
2. The person selects a `.mup` file and sends it to `POST /api/upload` as `multipart/form-data`.
3. The Function loads `app-config` and applies the anonymous limits: active key, upload window, and daily counter. Counters are incremented before the file is validated.
4. The Function validates the content type, the declared size, the form, Turnstile if active, the extension, the actual size, and the JSON of the `.mup`.
5. The Function sends the file to the Conversion Worker through the `CONVERTER` service binding, with `Authorization: Bearer <INTERNAL_SHARED_SECRET>` and `X-MMUP-Mode: anonymous`. The Worker validates the request again.
6. The Worker generates an identifier, stores the original in `temp/{uuid}.mup`, wakes the Durable Object with `idFromName(uuid)`, and responds `202`.
7. The Durable Object runs the eight layers, writes `temp/{uuid}/output.json`, and deletes the original in the `finally` block. The state is stored in the Durable Object's SQLite storage.
8. The interface queries `GET /api/status/{uuid}`. The Function calls the Conversion Worker, which queries the state from the Durable Object.
9. `GET /html/{uuid}` checks retention against `temp/{uuid}/output.json`. If the object does not exist or has expired, it responds `404` with `Mapa no encontrado`; if it has expired, it deletes it. If it is valid, it calls the Visualization Worker and returns the HTML with the download toolbar injected.
10. `GET /api/download-html/{uuid}` regenerates the HTML and builds a ZIP with the clean HTML, the available resources, and, if applicable, `faltantes.txt`. `GET /api/download/{uuid}` responds `404`: the public variant does not expose JSON.

The response of `POST /api/upload` includes `uuid`, `mode: "anonymous"`, `statusUrl`, `htmlUrl`, `htmlDownloadUrl`, `expiresAt`, and `downloadUrl: null`. The `expiresAt` field is an estimate calculated when responding to the upload; the actual check uses the date of the temporary output object.

## 4. Flow of a catalog conversion

1. The person sends a username and password to `POST /api/login`. The Function verifies the configured user and the PBKDF2 hash, creates a session in `CONFIG_KV`, and returns the `__Host-mmup_session` cookie.
2. The interface queries `GET /api/config` and `GET /api/session`. The mode is `catalogue`, and the session indicates whether it is valid.
3. `POST /api/upload` requires a valid session. The Function calls the Conversion Worker with `X-MMUP-Mode: catalogue`.
4. The Worker stores the original in `input/{uuid}.mup` and wakes the Durable Object. The Durable Object writes `output/{uuid}.json` and deletes the original. The output object stores `version: v7` in the custom R2 metadata.
5. The interface queries the status with `GET /api/status/{uuid}`. The HTML view and downloads require a session.
6. `GET /api/list` requires `loginEnabled: true` and `catalogEnabled: true`, in addition to a valid session. It reads R2 directly, paginates 1000 at a time, reads each JSON, and builds the listing with title, source file, date, node count, group, and version. It sorts by conversion date in descending order.
7. `GET /api/download/{uuid}` also reads R2 directly. It retrieves `output/{uuid}.json` and uses `metadata.source_file` for the download name. It does not require `catalogEnabled`.
8. `GET /api/download-html/{uuid}` generates the HTML and the ZIP with a session. The HTML is not stored as an object.
9. If `catalogEnabled` is `false`, `/api/list` responds `404`, and the catalog view is hidden. The other protected routes continue to work with a session. `output/` is not deleted automatically.

New objects show `group: "Sin grupo"` and `group_path: ""` until custom metadata is assigned. The public distribution does not include automatic group assignment.

## 5. Routes and responsibilities

### Public routes

| Route | Method | Responsibility | Main responses |
|---|---|---|---|
| `/api/config` | `GET` | Mode, sizes, retention, anonymous limits, and public Turnstile | `200`; `500` if the configuration is invalid |
| `/api/session` | `GET` | Server-side session status | `200` with `authenticated: true` or `false` |
| `/api/login` | `POST` | Verifies credentials and creates the session | `200` with cookie; `400`; generic `401`; `404` if login is disabled; `429`; `500` |
| `/api/logout` | `POST` | Deletes the session and the cookie | `200`, also in anonymous mode |
| `/api/upload` | `POST` | Validates the `.mup` and calls the Conversion Worker | `202`; `400`; `401` in catalog mode without a session; `403` for Turnstile; `413`; `429`; `500`; `502` |
| `/api/status/{uuid}` | `GET` | Queries the conversion status | `200`; `400`; `401` in catalog mode without a session; `500`; `502` |
| `/api/list` | `GET` | Lists the catalog | `200` with a session; `401` without a session; `404` in anonymous mode or with the catalog disabled; `500` |
| `/api/download/{uuid}` | `GET` | Downloads the catalog JSON | `200`; `400`; `401` without a session; `404` in anonymous mode or if it does not exist; `500` |
| `/html/{uuid}` | `GET` | Generates and serves the HTML view | `200`; `400`; `401` in catalog mode without a session; `404` if missing or expired; `500`; `502` |
| `/api/download-html/{uuid}` | `GET` | Generates the HTML ZIP | `200`; `400`; `401`; `404`; `413` if the HTML exceeds 30 MB; `500`; `502` |

The catalog route is `/api/list`. `/api/lista` is not an API route; a request to that address may return the static page with `200`.

`/api/config` is sent with `Cache-Control: public, max-age=60`. A change in `app-config` may take up to that interval to appear in the interface. In catalog mode, `rateLimit` is `null`.

Route identifiers accept 1 to 200 characters from `[A-Za-z0-9._-]` and reject values made up only of dots. They do not require UUID version 4. The identifiers generated by the converter are UUID version 4, but the routes accept other valid identifiers to preserve compatibility.

`/api/list` and `/api/download/{uuid}` read R2 directly. The conversion, status, and HTML routes use the Functions and service bindings. `/api/download/{uuid}` does not require `catalogEnabled`; it only requires catalog mode and a session.

### Internal routes

| Component | Route | Use |
|---|---|---|
| Conversion Worker | `POST /convertir` | Receives the `.mup`, stores it, and wakes the Durable Object. Requires `Authorization: Bearer <INTERNAL_SHARED_SECRET>` |
| Conversion Worker | `GET /status/{uuid}` | Queries the status from the Durable Object |
| Conversion Worker | `GET /download/{uuid}` | Downloads the JSON from `output/`; not used in anonymous mode |
| `MupConverter` Durable Object | `POST /convertir` | Starts the conversion in the background |
| `MupConverter` Durable Object | `GET /status` | Returns the stored status |
| Visualization Worker | `GET /visor/api/lista` | Internal list of the visualizer; it is not the public catalog route |
| Visualization Worker | `GET /visor/mmup-output/{uuid}` | Generates the HTML for an identifier |
| `MupVisualizer` Durable Object | `GET /convert/{uuid}` | Runs the six layers and returns the HTML |

The Conversion Worker also declares a scheduled task with the expression `0 * * * *` to clean up expired temporary objects.

## 6. Structure of the JSON-CMJN

The result has 10 collections. `metadata` is an object; the other nine are arrays.

| Collection | Type | Main fields |
|---|---|---|
| `metadata` | Object | `map_id`, `title`, `format_version`, `source_file`, `converted_at`, `node_count`; optional `author`, `created_at`, `updated_at`, `theme`, `themeOverrides` |
| `nodes` | Array | `node_id`, `map_id`, `parent_id`, `sort_key`, `title`, `depth`, `sibling_order`, `path`, `original_id`, `is_leaf` |
| `notes` | Array | `note_id`, `node_id`, `index`, `text`, `char_count`, `truncated` |
| `attributes` | Array | `attr_id`, `node_id`, `attr_type`, `value`; optional `raw_attributes` |
| `stickers` | Array | `sticker_id`, `node_id`, `emoji_code`, `emoji_display`, `category` |
| `icons` | Array | `icon_id`, `node_id`, `url`, `width`, `height`, `position`, `mime_type`, `base64_length`; optional `metaData` |
| `links` | Array | `link_id`, `map_id`, `from_node_id`, `to_node_id`; optional `color`, `line_style`, `arrow`, `width`, `label`, `resolution` |
| `externalRefs` | Array | `ref_id`, `node_id`, `url`, `ref_type`; optional `label` |
| `enums` | Array | `enum_id`, `category`, `code`, `label` |
| `indexes` | Array | `index_id`, `name`, `type`, `query`, `description` |

Document skeleton:

```json
{
  "metadata": {
    "map_id": "{{MAP_ID}}",
    "title": "{{TITLE}}",
    "format_version": 3,
    "source_file": "{{SOURCE_FILE}}",
    "converted_at": "{{CONVERTED_AT}}",
    "node_count": 0
  },
  "nodes": [],
  "notes": [],
  "attributes": [],
  "stickers": [],
  "icons": [],
  "links": [],
  "externalRefs": [],
  "enums": [],
  "indexes": []
}
```

The placeholders are not real values. `format_version` is 3. `source_file`, `converted_at`, and `node_count` are filled in during conversion. `node_count` matches the number of elements in `nodes`.

- `nodes` is flattened in depth-first pre-order. `parent_id` is `null` at the root; `path` contains the identifiers from the root to the node.
- `notes` and `attributes` are related to `nodes` through `node_id`. `attributes.raw_attributes` may contain the original attachment.
- `icons` supports `data:` and remote addresses. `mime_type` and `base64_length` describe the content when it is a `data:` address.
- `links` resolves the internal links of the `.mup`. If an endpoint does not exist, the corresponding field is `null`, and `resolution` is added.
- `externalRefs` contains the classified external addresses. `ref_type` comes from the address classifier.
- `enums` generates the controlled vocabulary for `sticker_categories`, `attr_types`, and `ref_types`.
- `indexes` contains four base queries: all nodes, root nodes, leaf nodes, and parent nodes.

The conversion process version is `v7` (`CONVERTER_VERSION`). It is stored in the custom metadata of the R2 object, not as an additional key in the JSON. The catalog displays it with the value `v7` when the object has no other value. It is not the MindMup version or the `.mup` format version.

## 7. Converter and visualizer layers

### Converter: eight layers

| Layer | What it does |
|---|---|
| 1. Reading | Parses the `.mup`, requires that `formatVersion` matches `MUP_FORMAT_VERSION` (3) and that `ideas` is a non-empty object, and extracts the map metadata. |
| 2. Flattening | Traverses the tree in depth-first pre-order and creates one node per idea with `parent_id`, `depth`, `path`, `sibling_order`, `original_id`, and `is_leaf`. |
| 3. Notes | Extracts the notes and their associated data. |
| 4. Attributes | Separates styles, positions, and node attributes. |
| 5. Stickers | Converts emoji codes into `stickers` entries. |
| 6. References | Locates and classifies external addresses. |
| 7. Assembly | Gathers the 10 collections, resolves links, extracts icons, generates enums and indexes, and validates references and duplicates with warnings. |
| 8. Storage | Serializes the JSON with two-space indentation, writes it to R2 with `Content-Type: application/json`, and stores `version: v7` in the custom metadata. |

Layer 7 does not block the conversion for orphan references or duplicate identifiers: it records warnings and returns the complete result.

The Durable Object stores these states in its SQLite storage: `parsing`, `flattening`, `extracting_notes`, `extracting_attributes`, `extracting_stickers`, `extracting_urls`, `assembling`, `storing`, `completed`, and `error`. If it fails, it stores `conversionError`, and the state changes to `error`.

### Visualizer: six layers

| Layer | What it does |
|---|---|
| 1. Loading | Retrieves the JSON from R2 using the received key template. |
| 2. Tree | Builds the hierarchy from `nodes`. |
| 3. Attachments | Adds notes, external references, links, stickers, and icons to each node. |
| 4. Styles | Applies the styles and visual attributes. |
| 5. Rendering | Generates the HTML for the tree. |
| 6. Assembly | Builds the complete document with inline CSS and JavaScript, `MMUP_DATA`, attachments, and the request `nonce`. |

The HTML is self-contained: it does not load external stylesheets or scripts. Icons may travel as `data:` or as remote addresses; attachments travel as `data:` inside `MMUP_DATA`.

The visualizer distinguishes these errors: `NOT_FOUND` responds `404`; `INVALID_JSON` and `INVALID_STRUCTURE` respond `400`; any other failure responds `500` with a generic message. Details remain in the structured logs.

## 8. Storage, retention, and deletion

| Mode | Input | Output | Retention |
|---|---|---|---|
| Anonymous | `temp/{uuid}.mup` | `temp/{uuid}/output.json` | 24 hours from the writing of the output JSON |
| Catalog | `input/{uuid}.mup` | `output/{uuid}.json` | No automatic deletion |

The key templates live in `app-variables`: `R2_TEMP_INPUT_PATH_TEMPLATE`, `R2_TEMP_OUTPUT_PATH_TEMPLATE`, `R2_INPUT_PATH_TEMPLATE`, and `R2_OUTPUT_PATH_TEMPLATE`. The catalog also uses `outputPrefix` (`output/`) and `jsonSuffix` (`.json`). If they are changed, the catalog and downloads must be adapted.

- The original is deleted during conversion, in both anonymous and catalog modes, whether it succeeds or fails. If the Worker cannot wake the Durable Object, it also deletes the original it had just stored.
- The HTML is not stored. It is generated on demand for each view and each ZIP download.
- Anonymous retention is checked with `head` on the temporary output JSON. If the object has expired, the Function deletes it and responds `404`. `/api/status` only queries the status; the retention check is performed in `/html` and in `/api/download-html`. Access expiration and physical deletion are not simultaneous: the scheduled task deletes expired objects every hour, and the object may still exist until that run.
- The Conversion Worker's scheduled task walks the temporary prefix and deletes objects older than the retention period. An R2 lifecycle policy can be added as a safety net, but it does not replace the Function's check.
- `output/` is not deleted automatically. In an installation with a catalog, its growth must be managed with explicit retention or a lifecycle policy.
- `/api/list` reads R2 directly, paginates 1000 at a time, and reads each JSON to build the listing. A corrupted object is skipped without stopping the rest.
- `/api/download/{uuid}` reads R2 directly and uses `metadata.source_file` for the file name. If the object does not exist, it responds `404`.
- New uploads have no `group` or `group_path`. The catalog shows `Sin grupo` until custom metadata is assigned to the object.

## 9. Relationship between the three variants

| Aspect | Public without login | With login and R2 | Local converter |
|---|---|---|---|
| Infrastructure | Pages, Functions, and two Workers | Pages, Functions, and two Workers in an account of your own | Node.js, without Cloudflare |
| Access | No account | Username and password | Command line |
| Catalog | No | Yes, with a session and `catalogEnabled` | No |
| Output | HTML preview and HTML ZIP | JSON, HTML preview, and HTML ZIP | JSON and optional HTML |
| JSON download | No | Yes | Yes, as a file |
| Storage | Temporary R2, 24 hours | R2 in `output/`, without automatic deletion | Local folder |
| Configuration | `loginEnabled: false`, `catalogEnabled: false` | `loginEnabled: true`; `catalogEnabled` controls the catalog | Options and environment variables |

The two web variants share the same code. Configuration determines the mode; the public variant keeps login and catalog disabled, but the login and catalog code is included in the application.

The local converter reuses the conversion and visualization layers; it replaces R2 storage with local files. It does not use Pages, Workers, R2, key-value storage, or Durable Objects. `scripts/convertir-local.js` processes only the root of the input folder, does not traverse subfolders, and does not generate HTML. `scripts/convert.js` allows traversing subfolders with `--recursive` and generating HTML with `--html`. Both skip existing outputs and write JSON with two-space indentation.

The public distribution does not include campaign code or `staging/`. Only anonymous and catalog modes exist.

## 10. Design decisions and consequences

| Decision | Consequence |
|---|---|
| Two internal Workers with service bindings and no public URL | Pages is the only entry point. The internal secret must match in Pages and in the Conversion Worker; if it does not match, uploads respond `502`. |
| The Functions enforce limits and authorization; the Conversion Worker requires the internal secret | The Workers are not exposed directly. The Functions need the configuration, R2, and service bindings. |
| Configuration lives in two key-value storage documents, with no silent default values | A missing key or an incorrect type produces an explicit `500`. The `/api/config` response is cached for 60 seconds. |
| `loginEnabled` determines the mode, and `catalogEnabled` only controls the catalog | Enabling `catalogEnabled` does not enable access. With `loginEnabled: false`, the catalog does not exist even if `catalogEnabled` is `true`. |
| Disabling login does not delete sessions proactively | Existing sessions are deleted when `/api/session` is queried or when they expire. There is no immediate invalidation. |
| Route identifiers accept 1 to 200 characters from `[A-Za-z0-9._-]` | UUID version 4 is not required. The identifiers generated by the converter are UUID version 4, but the routes remain compatible with other valid identifiers. |
| Anonymous retention is anchored to the temporary output JSON | Effective availability may be somewhat longer than 24 hours from upload. `expiresAt` is an estimate; the actual check uses the object date. |
| The original is deleted during conversion, and `output/` is not deleted automatically | The normal flow does not keep originals in R2, but the catalog can grow without limit. Retention of `output/` must be managed explicitly. |
| The HTML is generated on demand, and the ZIP is built on each download | There is no stored HTML that can become outdated. Each view consumes CPU, and each download repackages the resources. |
| `conversionTimeoutSeconds` does not abort the conversion | It is used as the lifetime of the active key and as `Retry-After`. A failed conversion may keep the active key until it expires. |
| `maxConcurrent` is not applied | Concurrency is approximated with one active key per network address. There is no exact counter of simultaneous conversions. |
| Counters are incremented before validating the file, the content type, or Turnstile | Invalid attempts consume quota. A user can exhaust their window with rejected requests. |
| `/api/list` and `/api/download/{uuid}` read R2 directly | An additional call to the Worker is avoided, but the Functions need the `MMUP_BUCKET` binding, and the listing reads every JSON in the catalog. |
| New uploads do not receive a group automatically | The catalog shows `Sin grupo` until `group` and `group_path` are assigned in the object's custom metadata. |
| The Durable Objects use SQLite and migrations with a literal tag | The migration is applied only once. An already applied tag cannot be reused; the history is cumulative. |
| Deployment is manual with Wrangler 4, without GitHub Actions | There is no automatic deployment or continuous integration. Each installation controls when it publishes. |
| Turnstile is optional and only affects anonymous mode | If enabled, the application depends on an external service. An invalid token responds `403` and consumes quota. |
| The public distribution does not include campaign code or `staging/` | Only anonymous and catalog modes exist. There is no batch publishing or campaign objects. |

## Related documentation

- [Configuration](configuracion-en.md)
- [Security](seguridad-en.md)
- [Tests](pruebas-en.md)
- [Public installation](instalacion-publica-en.md)
- [Installation with login and R2](instalacion-login-r2-en.md)
- [Local converter](conversor-local-en.md)
- [Project README](../README.md)
- [Third-party licenses](../THIRD_PARTY_LICENSES.md)
