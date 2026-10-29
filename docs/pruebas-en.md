# Tests for MindMup 2 Conversor

[Español](pruebas-es.md) | [English](pruebas-en.md)


The tests for MindMup 2 Conversor are run manually from the repository root. There is no continuous integration or GitHub Actions. The suites use synthetic data, do not require network access, and do not create Cloudflare resources.

The compatibility verified by the suite is limited to `.mup` files with `formatVersion: 3` and to rejecting `formatVersion: 2`. The tests do not demonstrate universal compatibility with all MindMup 2 files or with all MindMup 3 files.

This document describes what each suite checks, how to run it, and how to keep verifiable evidence. It does not declare execution results: each person must run the commands and keep their output and exit code.

## 1. Requirements

- Node.js 22 or later. The requirement is declared in `package.json`.
- No npm dependencies to install. Do not run `npm install` to test the project.
- No secrets, Cloudflare account, or deployed resources. The suites use mock objects and in-memory storage.
- Write permission on the output folder and on `.tmp/`, which is excluded by `.gitignore`.
- Commands are run from the repository root. The test files import modules from `src/`, so do not copy only `test/` or `scripts/`.
- `config.local.json` and `config.variables.local.json` are only needed for configuration validation. They are created from the templates and are not versioned.

## 2. Commands

### 2.1. Suites

```bash
npm test
npm run test:shared
npm run test:converter
npm run test:visualizer
npm run test:functions
npm run test:ui
```

`npm test` runs the five suites in this order: shared, converter, visualizer, functions, and ui. Each step is chained with `&&`: if a suite fails, the following ones are not run. To locate a failure, run the affected suite separately.

A suite is considered successful when it ends with exit code 0 and does not print `FAIL` or `❌` lines. Exit code 1 indicates a failure. Skipped visualizer checks do not count as passed; they are explained in section 8.

### 2.2. Configuration validation

Copy the templates to the local names expected by the command:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
```

Then validate both documents:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

If both documents are valid, the command prints a line that starts with `Configuración válida:` and includes the number of converter and visualizer keys. If a file is missing, does not contain valid JSON, or does not comply with the schema, it prints `Error:` and exits with code 1.

The command is not part of `npm test` and does not deploy anything. `config.local.json` and `config.variables.local.json` are excluded by `.gitignore`.

### 2.3. Local conversion with `examples/entrada` and `examples/salida`

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

With the `examples/salida` folder empty, the command must generate three JSON files and three HTML files:

```text
examples/salida/mapa-minimo.json
examples/salida/mapa-minimo.html
examples/salida/mapa-completo.json
examples/salida/mapa-completo.html
examples/salida/mapa-con-adjunto.json
examples/salida/mapa-con-adjunto.html
```

If you run the same command again, the six files are skipped and the exit code remains 0. For a JSON-only conversion, use another output folder:

```bash
node scripts/convert.js --input examples/entrada --output .tmp/pruebas/salida-json
```

`convertir-local.js` processes only the root of the input and never generates HTML:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=.tmp/pruebas/salida-json node scripts/convertir-local.js
```

The data in `examples/entrada` is synthetic. See [examples/README.md](../examples/README.md).

## 3. Suite matrix

| Suite | Command | Coverage |
|---|---|---|
| Shared | `npm run test:shared` | Configuration and variables, session and cookies, PBKDF2, ZIP, HTML packaging, and size limits. |
| Converter | `npm run test:converter` | Layers 1 to 4, layers 5 to 8, Worker units, authentication, validation, and temporary cleanup. |
| Visualizer | `npm run test:visualizer` | Layers 1 to 6, utilities, HTML security, and inline synthetic data. |
| Functions | `npm run test:functions` | Login, session, configuration, session protection, `/api/list`, upload, status, HTML, download bar, and ZIP. |
| Interface | `npm run test:ui` | Static structure of `app/index.html`, `app/app.js`, `app/_headers`, and `app/_routes.json`. |
| Configuration | `node scripts/validate-config.js ...` | Schema of `config.local.json` and `config.variables.local.json`. |
| Local | `node scripts/convert.js ...` and `node scripts/convertir-local.js` | Conversion, recursion, HTML, skipping outputs, and exit code. |

File details:

- Shared: `test/shared/test-config.js`, `test-session.js`, `test-zip.js`, and `test-html-bundle.js`.
- Converter: `test-layers-1-4.js`, `test-layers-5-8.js`, `test-worker-units.js`, and `test-cleanup.js`.
- Visualizer: `test-layers.js`.
- Functions: `test-login.js`, `test-session.js`, `test-config.js`, `test-session-guard.js`, `test-list.js`, `test-upload.js`, `test-result-endpoints.js`, `test-html-toolbar.js`, and `test-download-html.js`.
- Interface: `test-static-shell.js`.

Functions suites do not start real Pages, Workers, Durable Objects, or R2. They use standard requests and responses, in-memory storage, and mock buckets.

## 4. Synthetic data

All names, titles, identifiers, dates, notes, attachments, and addresses are invented. There are no real maps, clients, groups, absolute paths, or private deployment addresses.

### 4.1. `test/fixtures/mup/`

Contains eight synthetic files:

| File | Case |
|---|---|
| `valido-minimo.mup` | Minimal tree of 10 nodes, without optional attributes. |
| `valido-completo.mup` | Notes, styles, stickers, icon, internal link, and external references. |
| `valido-adjunto.mup` | Text attachment and a small icon on different nodes. |
| `invalido-extension.txt` | Extension other than `.mup`. |
| `invalido-pequeno.mup` | Valid JSON under 1 KB. |
| `invalido-json.mup` | Over 1 KB, truncated so that the JSON is not valid. |
| `invalido-sin-format-version.mup` | Valid JSON with `ideas`, without `formatVersion`. |
| `invalido-sin-ideas.mup` | Valid JSON with `formatVersion: 3`, without `ideas`. |

The five invalid files are built so that the first error reached is the one indicated in `test/fixtures/README.md`. That README focuses on the invalid set; the three valid files are documented on this page.

Functions tests build their own inputs in memory and do not load these files automatically. The set serves as a reference corpus and for manual checks of upload validation. Do not edit a fixture to make a test pass: fix the test or the code.

### 4.2. `test/fixtures/esperado/`

Contains three reference contracts:

- `valido-minimo.contrato.json`
- `valido-completo.contrato.json`
- `valido-adjunto.contrato.json`

Contracts are not byte-for-byte copies. They normalize dynamic values, such as UUID, `path`, `converted_at`, and other dates, so that the comparison does not depend on the clock or on generation order. Current suites do not load them directly; they serve to compare a specific output and for future contract tests.

### 4.3. Other synthetic data

- `examples/entrada/` contains three synthetic maps for local conversion.
- `test/converter/fixtures/` contains `synthetic-empty.mup` and `synthetic-v2.mup`, used by the layer tests.
- `test/visualizer/test-layers.js` defines synthetic maps inline; it does not read reference data.
- Example domains use `example.com`, `example.org`, or `example.test`. Test network addresses use documentation ranges.

Do not add personal data, client names, real identifiers, absolute paths, or private addresses to tests, fixtures, or examples.

### 4.4. `synthetic-v2.mup` and the limit of the check

`test/converter/fixtures/synthetic-v2.mup` is a synthetic fixture with `formatVersion: 2` and a minimal `ideas` tree. It does not reproduce a real MindMup 2 map or represent all files from that commercial version.

Its purpose is to check rejection of `formatVersion: 2`. Test 1.2 in `test/converter/test-layers-1-4.js` calls `parseMup` with `MUP_FORMAT_VERSION: 3` and expects the error `Formato .mup no soportado`. A passing test certifies that layer 1 rejects a value other than 3 in that fixture. It does not certify that the converter reads all MindMup 2 maps, nor that all MindMup 2 maps are incompatible with MindMup 3.

The suite does not demonstrate universal compatibility with all MindMup 2 files. Nor does it demonstrate that all MindMup 2 files use `formatVersion: 2`. It only covers the code's behavior with value 2 and value 3 in the test data.

## 5. Public variant without login

| Area | What is checked | Where |
|---|---|---|
| Configuration | `loginEnabled: false` produces `mode: "anonymous"`, disables the catalog, and exposes the anonymous limits. `loginUser`, the session lifetime, and the access limits are not published. | `test/functions/test-config.js` |
| Configuration | Sensitive fields do not appear in `/api/config`; a configuration failure responds `500` with a generic message. | `test/functions/test-config.js` |
| Upload | An anonymous upload responds `202`, uses `anonymous` mode, and returns `downloadUrl: null`, `htmlUrl`, and `htmlDownloadUrl`. | `test/functions/test-upload.js` |
| Upload | An upload without a session in catalog mode responds `401`. | `test/functions/test-upload.js` |
| Limits | An exhausted window and an active conversion respond `429`. A converter failure responds `502` and releases the active key. | `test/functions/test-upload.js` |
| Limits | Minimum and maximum size validation is tested with injected limits. | `test/shared/test-config.js` |
| Turnstile | Without a token, with a rejected token, and with an accepted token: `403`, `403`, and `202`. | `test/functions/test-upload.js` |
| Status | An invalid identifier responds `400`; anonymous mode responds `200` without a session. | `test/functions/test-result-endpoints.js` |
| HTML | A nonexistent result responds `404`; an expired result is deleted and responds `404`. | `test/functions/test-result-endpoints.js` |
| HTML | The anonymous view injects the download bar, does not offer JSON, uses the temporary template, and is served with `Cache-Control: private, no-store`. | `test/functions/test-result-endpoints.js` |
| ZIP | The download returns `application/zip`, the name `<uuid>.zip`, the file signature, and clean HTML without the application bar. | `test/functions/test-download-html.js` |
| ZIP | A disallowed remote resource is counted in `X-MMUP-Missing-Count` and `faltantes.txt` is added; a `data:` resource does not generate missing entries. | `test/functions/test-download-html.js` |
| Retention | The check is anchored to `temp/{uuid}/output.json`. An object aged 25 hours responds `404` and that same key is deleted. | `test/functions/test-result-endpoints.js` |
| No JSON | `/api/download/{uuid}` responds `404` in anonymous mode. The anonymous HTML bar only shows «Descargar HTML». | `test/functions/test-result-endpoints.js` and `test/functions/test-html-toolbar.js` |

Details that the tests must respect:

- Anonymous retention is anchored to the temporary output JSON, not to the exact upload time. `expiresAt` is an estimate.
- `maxConcurrent` is not enforced. Concurrency is approximated with one active key per network address.
- Counters are incremented before validating the file, the content type, or Turnstile. Invalid attempts consume quota.
- `conversionTimeoutSeconds` does not abort the conversion. It is used as the lifetime of the active key and as `Retry-After`.
- The public variant does not offer JSON download. JSON is generated to build the HTML, but it is not exposed.

## 6. Variant with login and R2

| Area | What is checked | Where |
|---|---|---|
| Login | A successful login returns the user and a `__Host-mmup_session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`. | `test/functions/test-login.js` |
| Login | The session record stores the user and the configured lifetime; a successful login clears the attempt counter. | `test/functions/test-login.js` |
| Login | An incorrect user or password returns the same generic `401` and does not create a session. | `test/functions/test-login.js` |
| Login | With login disabled, `/api/login` responds `404` and does not touch the counter. If secrets are missing, it fails closed with `401`. | `test/functions/test-login.js` |
| Login | A malformed body responds `400`; the attempt limit responds `429` with `Retry-After`; without `CF-Connecting-IP`, the `unknown` counter is used. | `test/functions/test-login.js` |
| Session | A valid session returns the user; a missing, empty, unknown, expired, or malformed cookie does not authenticate. Expired and malformed ones are deleted. | `test/functions/test-session.js` |
| Session | Logout deletes the record and the cookie, including when there is no cookie or no storage. The cookie preserves the `__Host-` invariants. | `test/functions/test-session.js` |
| Protection | Without a session, protected routes respond `401`; with the catalog disabled or login disabled, `/api/list` responds `404`; a configuration failure responds `500`. | `test/functions/test-session-guard.js` |
| Catalog | `/api/list` responds `401` without a session, `404` with login or the catalog disabled, and `200` with a session. It returns items sorted by date, with group and version `v7`. | `test/functions/test-list.js` |
| Catalog | Pagination follows the cursor and a missing bucket responds `500`. | `test/functions/test-list.js` |
| JSON download | `/api/download/{uuid}` responds `401` without a session and `200` with a session, with the file name normalized from `metadata.source_file`. | `test/functions/test-result-endpoints.js` |
| HTML download | The session view offers «Descargar HTML» and «Descargar JSON»; the ZIP is generated with a session and does not include the application bar. | `test/functions/test-result-endpoints.js` and `test/functions/test-download-html.js` |
| PBKDF2 | Hash, verification, salt, key length, and rejection of invalid parameters are checked. | `test/shared/test-session.js` and `test/functions/test-login.js` |

Details that the tests must respect:

- The catalog route is `/api/list`. `/api/lista` is not an API route; it may return the static page with `200`.
- `loginEnabled` decides the general mode. `catalogEnabled` only controls the catalog and `/api/list`; it does not enable login.
- In catalog mode, `/api/config` returns `rateLimit: null`.
- Disabling `loginEnabled` does not proactively invalidate sessions. They are deleted when `/api/session` is queried or when they expire.
- The tests use a mock R2 bucket. They do not read from or write to a real bucket.

### 6.1. PBKDF2 and the reference value of 5.000 iterations

Session and login suites use 1.000 iterations to keep execution fast. They check the PBKDF2 mechanism, not a specific number of iterations.

The reference value for this distribution is **5.000 iterations**. It is set when generating the secrets and reviewed at deployment:

```bash
node scripts/generate-secrets.js --iterations 5000
```

`ADMIN_PASSWORD_ITERATIONS` must match the value used to generate `ADMIN_PASSWORD_HASH` and `ADMIN_PASSWORD_SALT`. If you change the iterations, regenerate all three values together. Do not change only one.

## 7. Local variant

Name normalization is covered by `test/converter/test-layers-5-8.js`. Recursion, HTML generation, skipping outputs, and the exit code do not have a suite that invokes the local scripts; they are checked manually with the commands in this section.

### 7.1. Recursion and HTML

Prepare an input with a subfolder:

```bash
mkdir -p .tmp/pruebas/recursivo/entrada/subcarpeta .tmp/pruebas/recursivo/salida
cp examples/entrada/mapa-minimo.mup .tmp/pruebas/recursivo/entrada/subcarpeta/
```

Without `--recursive`, the file in the subfolder is not processed:

```bash
node scripts/convert.js --input .tmp/pruebas/recursivo/entrada --output .tmp/pruebas/recursivo/salida
```

With `--recursive`, it is processed and the flat output is written to the indicated folder:

```bash
node scripts/convert.js --input .tmp/pruebas/recursivo/entrada --output .tmp/pruebas/recursivo/salida --recursive --html
```

Check that the second run generates the JSON and HTML of the map. The output is flat: `subcarpeta/` is not reproduced inside `salida`.

For the main check with the examples:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

### 7.2. Skipping existing outputs

Run the previous command again:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

The six existing files must be counted as skipped. None is overwritten. If the JSON exists but the HTML is missing, the map is skipped entirely. To regenerate an output, use another folder or delete the files you want to replace.

### 7.3. Name normalization

The automated suite checks, among other cases, that the base `Mapa de Ángeles` produces `Mapa-de-Angeles` and that `España 2026.mup` produces `Espana-2026.mup`.

Manual check:

```bash
mkdir -p .tmp/pruebas/nombres/entrada .tmp/pruebas/nombres/salida
cp examples/entrada/mapa-minimo.mup ".tmp/pruebas/nombres/entrada/Mapa de Ángeles.mup"
node scripts/convert.js --input .tmp/pruebas/nombres/entrada --output .tmp/pruebas/nombres/salida
```

`.tmp/pruebas/nombres/salida/Mapa-de-Angeles.json` must appear. Dots in the name are preserved; accents are removed; uppercase and lowercase are not changed.

### 7.4. Exit code

A successful batch ends with code 0, even if all files were skipped:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
echo $?
```

An invalid file is counted as failed and produces code 1, without stopping the rest of the batch:

```bash
mkdir -p .tmp/pruebas/fallo/entrada .tmp/pruebas/fallo/salida
cp test/fixtures/mup/invalido-json.mup .tmp/pruebas/fallo/entrada/
node scripts/convert.js --input .tmp/pruebas/fallo/entrada --output .tmp/pruebas/fallo/salida
echo $?
```

A fatal error, such as a nonexistent input folder, ends before the summary and returns code 1:

```bash
node scripts/convert.js --input .tmp/pruebas/no-existe --output .tmp/pruebas/salida
echo $?
```

`convertir-local.js` shares the engine and the exit code, but it does not interpret `--input`, `--output`, or `--help`. Use environment variables or `config.local.json`:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=.tmp/pruebas/salida-json node scripts/convertir-local.js
```

## 8. Tests skipped in a controlled manner

`test/visualizer/test-layers.js` contains nine page checks that have not yet been migrated to the server-side session model. The `PAGE_AVAILABLE` constant is `false`; therefore `testPage` does not run the check, increments the `skippedTests` counter, and prints:

```text
⏭️  <nombre> — omitido (página aún no migrada)
```

The nine checks are:

- `6.25 _headers de la página estática: CSP coherente con app.js (S-2 de la revisión 2d)`
- `U3.4 Página estática: encodeURIComponent y node_count numérico (VIS-C3)`
- `U3.5 Página estática: escapeHtml local escapa comillas (VIS-C3)`
- `U3.8 Página estática: script externalizado para la CSP (W2)`
- `U3.9 Login: index.html incluye formulario accesible y cierre de sesión`
- `U3.10 Login: app.js verifica SHA-256 contra credenciales.json y gestiona la sesión`
- `U3.11 Login: credenciales.json solo guarda usuario y hash SHA-256 (sin contraseña)`
- `U3.12 Página estática: listado en tabla ordenable y título (VIS-C3)`
- `U3.13 Página estática: ordenación, fecha UTC y nombre desde source_file`

These checks describe the old page with client-side login and `credentials.json`. They are not valid for the current model, which uses server-side sessions. Do not present them as passed: they are skipped and do not add to the total number of executed tests. `npm run test:visualizer` prints the number of skipped tests and exits with code 0 if the other tests pass.

The current static structure is covered by `npm run test:ui`. Server-side login is covered by `npm run test:functions`. When the page tests are rewritten, they must be migrated to the current model and `PAGE_AVAILABLE` must be removed; changing the constant's value is not enough if the old assumptions remain in the code.

## 9. Evidence

Store evidence in `.tmp/evidencias/`, which is not versioned. Useful evidence includes the date, the Node.js version, the commit, and the exit code of each command.

```bash
mkdir -p .tmp/evidencias
node --version > .tmp/evidencias/node-version.txt
git rev-parse HEAD > .tmp/evidencias/commit.txt
date -u +%Y-%m-%dT%H:%M:%SZ > .tmp/evidencias/fecha.txt

npm test > .tmp/evidencias/npm-test.log 2>&1
echo "npm test: $?" >> .tmp/evidencias/exit-codes.txt
```

If `npm test` fails, run the suites separately to isolate the problem and keep each log:

```bash
for suite in shared converter visualizer functions ui; do
  npm run "test:$suite" > ".tmp/evidencias/test-$suite.log" 2>&1
  printf '%s: %s\n' "$suite" "$?" >> .tmp/evidencias/exit-codes.txt
done
```

Also keep the configuration validation and the local conversion:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json > .tmp/evidencias/validate-config.log 2>&1
echo "validate-config: $?" >> .tmp/evidencias/exit-codes.txt

node scripts/convert.js --input examples/entrada --output .tmp/evidencias/salida --html > .tmp/evidencias/convert-local.log 2>&1
echo "convert-local: $?" >> .tmp/evidencias/exit-codes.txt
```

To record the skipped tests:

```bash
grep -n "omitidos de forma controlada" .tmp/evidencias/test-visualizer.log
```

### 9.1. Secret and private data check

Check that no sensitive containers are versioned:

```bash
git ls-files | grep -E '(^|/)(\.env|\.dev\.vars|credenciales\.tsv|config\.local\.json|config\.variables\.local\.json|wrangler\.jsonc|.*\.local\..*)$' \
  || echo "Sin contenedores sensibles versionados."
```

Look for values that look like secrets in versioned files:

```bash
git grep -nE 'BEGIN [A-Z ]*PRIVATE KEY|CLOUDFLARE_API_TOKEN[=][A-Za-z0-9]|ADMIN_PASSWORD[=][^<{ ]|INTERNAL_SHARED_SECRET[=][A-Za-z0-9_-]{20,}' \
  -- . ':(exclude)docs/pruebas-en.md' \
  || echo "Sin valores con forma de secreto."
```

Look for absolute paths and deployment addresses:

```bash
git grep -nE '/[[:alnum:]_.-]+/[[:alnum:]_.-]+/|[A-Za-z]:[/\\][^ ]+|https?://[^ )]*(pages\.dev|workers\.dev)' \
  -- . ':(exclude)docs/pruebas-en.md' \
  || true
```

This page contains the search patterns themselves; that is why the two commands exclude `docs/pruebas-en.md`. Review this page by hand. Markers such as `https://<PROYECTO>.pages.dev` are templates; a specific subdomain requires review. Do not copy addresses from the private deployment.

Also review the evidence logs:

```bash
grep -RInE '(/[[:alnum:]_.-]+/[[:alnum:]_.-]+/|[A-Za-z]:[/\\][^ ]+|BEGIN [A-Z ]*PRIVATE KEY|CLOUDFLARE_API_TOKEN[=][A-Za-z0-9]|ADMIN_PASSWORD[=][^<{ ])' \
  .tmp/evidencias || true
```

The suites use test values such as `secret` or synthetic passwords. Those values may appear in a log and are not real secrets. Do not run the suites with real secrets exported and do not attach logs with data from a real installation to a public issue.

## 10. Troubleshooting common issues

| Symptom | Probable cause | Solution |
|---|---|---|
| `node: command not found` or a version lower than 22 | Node.js is not installed or is outdated. | Install Node.js 22 or later and check `node --version`. |
| `npm test` stops after a suite | The chain uses `&&` and the previous suite failed. | Run `npm run test:<suite>` to locate the failure and fix that suite first. |
| `ERR_MODULE_NOT_FOUND` or `Cannot find module` | The command was run outside the root or only one folder was copied. | Run from the repository root and keep `src/`, `test/`, and `scripts/`. |
| `No se encontró el archivo de configuración` | `config.local.json` or `config.variables.local.json` does not exist. | Copy the templates with the commands in section 2.2. |
| `No se pudo leer la configuración` | The configuration file does not contain valid JSON. | Fix the JSON or use another copy of the template. |
| `Faltan las carpetas de entrada o salida` | The paths were not specified. | Use `--input` and `--output`, `MUP_INPUT_DIR` and `MUP_OUTPUT_DIR`, or `config.local.json`. |
| `Opción desconocida` | `convert.js` does not recognize the argument. | See `node scripts/convert.js --help`. `convertir-local.js` does not accept options. |
| All maps are skipped | The outputs already exist. | Use another output folder or delete only the outputs you want to regenerate. |
| Subfolders are not processed | `--recursive` is missing. | Add `--recursive` to `convert.js`. |
| No HTML is generated | `--html` is missing or `convertir-local.js` was used. | Use `convert.js` with `--html`; `convertir-local.js` never generates HTML. |
| `Formato .mup no soportado. Se esperaba versión 3, se recibió <versión>.` | The file declares a `formatVersion` other than 3. | Check the internal field of the `.mup`. The converter does not read the commercial version of MindMup and does not accept other values. |
| The visualizer prints skipped tests | These are the nine page checks pending migration. | This is not a failure. See section 8 and do not count them as passed. |
| Login fails after changing PBKDF2 | The hash, salt, and iterations are not consistent. | Regenerate all three values together with `--iterations 5000` and update `ADMIN_PASSWORD_ITERATIONS`. |
| `EACCES` when writing | The output folder does not have write permission. | Use a writable folder or fix the permissions. |

## 11. Limitations

- There is no continuous integration or GitHub Actions. Tests are run manually before publishing and after every relevant change.
- There is no automatic deployment. The suites do not publish Pages, do not deploy Workers, and do not create Cloudflare resources.
- Functions tests use mocks and in-memory storage. They do not demonstrate the behavior of a real R2, Durable Object, or Cloudflare account.
- The nine visualizer page checks are skipped in a controlled manner. They do not count as passed coverage.
- Recursion, HTML generation, skipping outputs, and the exit code of the local scripts are checked manually. Name normalization does have automated coverage.
- PBKDF2 suites use 1.000 iterations to shorten execution. The reference value for the distribution is 5.000, but there is no automated assertion of that number.
- Retention is tested with a simulated 25-hour-old object. A real day is not waited for, and an R2 lifecycle policy is not checked.
- Loads, conversion times, real platform limits, and security attacks are not tested. The HTML tests cover escape and resource cases, not a complete audit.
- The 30 MB ZIP limit and all error states of all routes are not tested.
- `conversionTimeoutSeconds` does not abort the conversion. It is used as the lifetime of the active key and as `Retry-After`.
- `maxConcurrent` is not enforced. Concurrency is approximated with one active key per network address.
- Invalid attempts consume quota. Counters are incremented before validating the file, the content type, or Turnstile.
- The `site/` presentation page is not tested. The interface suite covers the `app/` shell.
- Compatibility with MindMup 2 has not been verified universally. The suite uses data with `formatVersion: 3` and a fixture with `formatVersion: 2`; it does not include a representative sample of real MindMup 2 or MindMup 3 files.

## Related documentation

- [Local converter](conversor-local-en.md)
- [Architecture](arquitectura-en.md)
- [Security](seguridad-en.md)
- [Configuration](configuracion-en.md)
- [Project README](../README.md)
- [Examples](../examples/README.md)
