# Public installation of MindMup 2 Conversor

[Español](instalacion-publica-es.md) | [English](instalacion-publica-en.md)


Guide for deploying the public variant of MindMup 2 Conversor in your own Cloudflare account. The public variant has no login or catalog: it accepts a `.mup` file, generates a self-contained HTML file, and offers it for preview and ZIP download. The JSON is generated internally to build the HTML but is not exposed to the user.

This variant differs from the installation with login and R2 and from the local converter: it does not include authentication or a catalog, exposes only HTML and ZIP, and applies 24-hour retention. The local converter does not use Cloudflare and saves files to the user's disk.

## File compatibility

The converter accepts `.mup` files compatible with `formatVersion: 3`. Compatibility is determined by that internal value, not by the commercial version of MindMup:

- It accepts `.mup` files with `formatVersion: 3` and a non-empty `ideas` object.
- It rejects files with `formatVersion: 2` and any other value other than 3.
- It does not read or validate the commercial version of MindMup (2 or 3).
- It has not been possible to demonstrate that all MindMup 2 files use `formatVersion: 3`; check the value in the file before assuming it will be accepted.
- `v7` is the converter version, not the MindMup version or the `.mup` format version.

The [official MindMup documentation](https://www.mindmup.com/) does not document this internal value. The project does not claim universal compatibility with all MindMup 2 maps or universal incompatibility with MindMup 3.

Deployment is manual, with Wrangler 4. GitHub Actions and continuous integration are not used.

## 1. Requirements

- Node.js 22 or later.
- A Cloudflare account with Pages, Workers, R2, key-value storage, and Durable Objects.
- Wrangler 4, without a global installation:

  ```bash
  npx -y wrangler@4 --version
  ```

- Signed in to the correct account:

  ```bash
  npx -y wrangler@4 whoami
  ```

- There are no npm dependencies to install. The project commands run directly with Node.js.

## 2. Architecture

```text
Browser
   │
   ▼
Cloudflare Pages: app/ + functions/
   │
   ├── service binding CONVERTER ──► Conversion Worker ──► R2
   │                                      Durable Object
   │
   └── service binding VISUALIZER ─► Visualization Worker ─► R2
                                          Durable Object
```

| Component | Role |
|---|---|
| Pages | Serves the static interface and the Functions that validate requests. |
| Functions | Enforce limits, check retention, and call the Workers. |
| Conversion Worker | Converts the `.mup` into JSON-CMJN and stores it in R2. |
| Visualization Worker | Generates the self-contained HTML from the temporary JSON. |
| R2 | Stores the temporary original and the temporary output JSON. |
| Key-value storage | Stores `app-config`, `app-variables`, and the limit counters. |
| Durable Objects | Run conversion and visualization with state isolated by identifier. |

Both Workers are internal: they have no public URL or custom domain. Pages is the only entry point. The application includes the login and catalog code, but the public configuration keeps both disabled.

## 3. Resources to create

| Resource | Name | Notes |
|---|---|---|
| Pages project | `pg-mindmup-v2-public` | Fixed name for this variant. |
| Conversion Worker | `{{NOMBRE_WORKER_CONVERSOR}}` | Choose a name and also use it in the `CONVERTER` service binding. |
| Visualization Worker | `{{NOMBRE_WORKER_VISUALIZADOR}}` | Choose a name and also use it in the `VISUALIZER` service binding. |
| R2 bucket | `{{NOMBRE_CUBO_R2}}` | Stores the temporary objects. |
| Configuration KV namespace | `{{NOMBRE_ESPACIO_CONFIG}}` | Contains the `app-config` key; its identifier is `{{KV_CONFIG_ID}}`. |
| Variables KV namespace | `{{NOMBRE_ESPACIO_VARIABLES}}` | Contains the `app-variables` key; its identifier is `{{KV_VARIABLES_ID}}`. |
| Conversion Durable Object | `MupConverter` | Created by the first deployment of the Conversion Worker. |
| Visualization Durable Object | `MupVisualizer` | Created by the first deployment of the Visualization Worker. |

You do not need to create the Durable Objects separately: they are declared in the Workers' configuration files and are created when the first deployment's migration is applied. The Conversion Worker also includes an hourly scheduled task to delete expired temporary objects.

Create new resources for this installation. Do not reuse the R2 bucket, the key-value namespaces, or the Workers from another installation.

## 4. Templates and placeholders

Copy the versioned templates to local files ignored by Git:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
cp wrangler.converter.example.jsonc wrangler.converter.local.jsonc
cp wrangler.visualizer.example.jsonc wrangler.visualizer.local.jsonc
cp wrangler.pages.example.jsonc wrangler.jsonc
```

`wrangler.jsonc` is the local Pages configuration and is ignored by Git. If the file already exists, check that it does not belong to another project before replacing it. Replace the placeholders in the local files:

| Placeholder | Where it is used | Value |
|---|---|---|
| `{{NOMBRE_WORKER_CONVERSOR}}` | Conversion Worker configuration and the Pages `CONVERTER` service binding. | Name chosen by the installer. |
| `{{NOMBRE_WORKER_VISUALIZADOR}}` | Visualization Worker configuration and the Pages `VISUALIZER` service binding. | Name chosen by the installer. |
| `{{NOMBRE_CUBO_R2}}` | Configuration of both Workers and Pages. | Name of the bucket created in the account. |
| `{{KV_CONFIG_ID}}` | Pages (Functions) and Conversion Worker configuration. | Identifier of the configuration KV namespace. |
| `{{KV_VARIABLES_ID}}` | Pages (Functions), Conversion Worker, and Visualization Worker configuration. | Identifier of the variables KV namespace. |
| `{{MIGRATION_TAG}}` | Migration of each Worker. | New literal tag, for example `init_conversor_publico` and `init_visualizador_publico`. |
| `{{NOMBRE_ESPACIO_CONFIG}}` | Only in the configuration KV creation command. | Name chosen by the installer. |
| `{{NOMBRE_ESPACIO_VARIABLES}}` | Only in the variables KV creation command. | Name chosen by the installer. |
| `{{PAGES_PROJECT}}` | Pages template. | In this variant, `pg-mindmup-v2-public`. |

The migration tag is applied only once on the first deployment. Do not reuse a tag already applied in that Worker: the history is cumulative and its operations cannot be applied again.

## 5. Configuration

Operational configuration lives in two KV JSON documents:

| Binding | Key | Template |
|---|---|---|
| `CONFIG_KV` | `app-config` | `config.example.json` |
| `VARIABLES_KV` | `app-variables` | `config.variables.example.json` |

In `config.local.json`, keep both flags disabled:

```json
{
  "loginEnabled": false,
  "catalogEnabled": false
}
```

The previous snippet does not replace the full file: keep all the keys from `config.example.json`. Also:

- Replace `{{LOGIN_USER}}` with an empty string; it is not used when login is disabled.
- Leave `turnstileEnabled` set to `false` and `turnstileSiteKey` as an empty string if you do not enable Turnstile.
- Review the limits in section 9 before loading the document.

`config.variables.example.json` can be used as is. It contains no secrets or account identifiers; `WORKER_URL` is left empty and the paths are internal to the Worker itself.

Validate both documents before loading them:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

The expected output starts with `Configuración válida`. If a key is missing or has the wrong type, the command names the key and exits with code 1.

## 6. Secrets

The only required secret in this variant is `INTERNAL_SHARED_SECRET`. It must have the same value in the Conversion Worker and in the Pages project. Do not write it in `config.local.json`, in `wrangler.*.local.jsonc`, or in any versioned file.

Generate a random 32-byte value in base64url:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"
```

Store the value outside the repository and define it in both destinations. Wrangler prompts for it interactively; do not pass the value as an argument. Run these commands after creating the Pages project and deploying the Workers (sections 7.2 and 7.4):

```bash
npx -y wrangler@4 secret put INTERNAL_SHARED_SECRET \
  --config wrangler.converter.local.jsonc

npx -y wrangler@4 pages secret put INTERNAL_SHARED_SECRET \
  --project-name pg-mindmup-v2-public
```

The `ADMIN_PASSWORD_*` secrets belong to the variant with login and are not needed here.

### Optional Turnstile

Turnstile adds anti-abuse verification to the public form. To enable it:

1. Create a Turnstile widget in the Cloudflare dashboard.
2. In `config.local.json`, set `turnstileEnabled` to `true` and `turnstileSiteKey` to the widget's public key.
3. Define `TURNSTILE_SECRET_KEY` only in Pages:

   ```bash
   npx -y wrangler@4 pages secret put TURNSTILE_SECRET_KEY \
     --project-name pg-mindmup-v2-public
   ```

Do not include the secret key or the public key in the documentation or in the repository. If Turnstile is enabled, a request without a valid token returns `403` but still consumes quota because the counters are incremented before the token is verified.

## 7. Deployment

Run all commands from the repository root.

### 7.1. Create the R2 bucket and key-value namespaces

```bash
npx -y wrangler@4 r2 bucket create {{NOMBRE_CUBO_R2}}

npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_CONFIG}}
npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_VARIABLES}}
```

Each `kv namespace create` prints an identifier. Note it and use it as `{{KV_CONFIG_ID}}` or `{{KV_VARIABLES_ID}}`. You can list the existing namespaces with:

```bash
npx -y wrangler@4 kv namespace list
```

### 7.2. Create the Pages project

```bash
npx -y wrangler@4 pages project create pg-mindmup-v2-public \
  --production-branch main
```

Do not connect the project to a Git branch. Deployment is done with Wrangler, not through automatic integration.

### 7.3. Prepare and validate the local files

Copy the templates from section 4 and replace the placeholders. Before deploying, check that the configuration is valid:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

You can also run the repository tests:

```bash
npm test
```

### 7.4. Deploy both Workers

The first deployment creates each Worker and applies its Durable Object migration. Use `--keep-vars` to preserve the variables and secrets that already exist in the dashboard.

```bash
npx -y wrangler@4 deploy --config wrangler.converter.local.jsonc --keep-vars
npx -y wrangler@4 deploy --config wrangler.visualizer.local.jsonc --keep-vars
```

Do not use `wrangler.jsonc` to deploy the Workers: that file is the Pages configuration. The Workers always use their own `wrangler.converter.local.jsonc` and `wrangler.visualizer.local.jsonc` files.

Verify that both Workers have `workers_dev` and `preview_urls` disabled. Do not enable them: Pages must be the only entry point.

### 7.5. Load `app-config` and `app-variables`

Each document is stored as a single JSON value under its key. `--remote` writes to the real namespace; without that flag, Wrangler uses local development storage.

```bash
npx -y wrangler@4 kv key put app-config "$(cat config.local.json)" \
  --namespace-id {{KV_CONFIG_ID}} --remote

npx -y wrangler@4 kv key put app-variables "$(cat config.variables.local.json)" \
  --namespace-id {{KV_VARIABLES_ID}} --remote
```

After changing KV, query `/api/config` again; its response may be cached for up to 60 seconds.

### 7.6. Define the internal secret

If you did not do so in section 6, define `INTERNAL_SHARED_SECRET` now in the Conversion Worker and in Pages. It must be exactly the same value in both:

```bash
npx -y wrangler@4 secret put INTERNAL_SHARED_SECRET \
  --config wrangler.converter.local.jsonc

npx -y wrangler@4 pages secret put INTERNAL_SHARED_SECRET \
  --project-name pg-mindmup-v2-public
```

### 7.7. Configure the Pages bindings

The `wrangler.jsonc` file copied from `wrangler.pages.example.jsonc` declares the Pages bindings. `wrangler pages deploy` discovers it in the current directory and applies the bindings on deployment. Do not use `--config`: Pages does not support a custom path for the configuration file.

Verify that `wrangler.jsonc` contains these bindings:

| Type | Binding | Destination |
|---|---|---|
| KV namespace | `CONFIG_KV` | Configuration namespace (`{{KV_CONFIG_ID}}`). |
| KV namespace | `VARIABLES_KV` | Variables namespace (`{{KV_VARIABLES_ID}}`). |
| R2 bucket | `MMUP_BUCKET` | Bucket `{{NOMBRE_CUBO_R2}}`. |
| Service binding | `CONVERTER` | Worker `{{NOMBRE_WORKER_CONVERSOR}}`. |
| Service binding | `VISUALIZER` | Worker `{{NOMBRE_WORKER_VISUALIZADOR}}`. |

Both Workers must exist before creating the service bindings. The `INTERNAL_SHARED_SECRET` secret is configured separately as a Pages secret; it is not a plaintext binding.

While `wrangler.jsonc` exists, it is the source of truth for the Pages configuration and the same fields cannot be edited in the dashboard. If you prefer to configure the bindings in the dashboard, do not create `wrangler.jsonc` (or delete it before deploying), use `wrangler.pages.example.jsonc` only as a reference, and add the five bindings in the Functions section. Do not mix both methods.

### 7.8. Deploy the application

With `wrangler.jsonc`, `pages_build_output_dir` points to `./app`:

```bash
npx -y wrangler@4 pages deploy \
  --project-name pg-mindmup-v2-public --branch main
```

The command publishes `app/` and the Functions from `functions/`. Do not use `--config` with `pages deploy`: Wrangler does not support it for Pages.

If you do not use `wrangler.jsonc` and configure the bindings in the dashboard, deploy the directory explicitly:

```bash
npx -y wrangler@4 pages deploy app \
  --project-name pg-mindmup-v2-public --branch main
```

## 8. Verification

Set `BASE_URL` to the URL shown in the project dashboard:

```bash
BASE_URL="https://<PROYECTO>.pages.dev"
```

### 8.1. Configuration and session

```bash
curl -sS "$BASE_URL/api/config"
curl -sS "$BASE_URL/api/session"
```

Expected results:

- `/api/config` returns `mode: "anonymous"`, `loginEnabled: false`, `catalogEnabled: false`, the upload sizes, the retention, and the `rateLimit` object.
- `/api/session` returns `{"authenticated":false}`.

### 8.2. Full conversion

Upload a synthetic file of at least 1 KB:

```bash
curl -sS -X POST "$BASE_URL/api/upload" \
  -F "file=@examples/entrada/mapa-minimo.mup"
```

The response is `202` and includes `uuid`, `mode: "anonymous"`, `statusUrl`, `htmlUrl`, `htmlDownloadUrl`, `expiresAt`, and `downloadUrl: null`. Copy the `uuid` and query the status until it is `completed`:

```bash
UUID="<uuid>"
curl -sS "$BASE_URL/api/status/$UUID"
```

Then check the preview and the download:

```bash
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" "$BASE_URL/html/$UUID"
curl -sS -o mapa.zip -w "%{http_code} %{content_type}\n" "$BASE_URL/api/download-html/$UUID"
```

Expected results: `200` with `text/html` for the preview and `200` with `application/zip` for the download. The ZIP contains the clean HTML, the resources folder, and, only if remote resources are missing, `faltantes.txt`.

### 8.3. Verify that the catalog and JSON are not exposed

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/list"
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/download/$UUID"
```

Both routes must return `404`. The first because `catalogEnabled` is `false`; the second because the public variant does not offer JSON. Additional checks:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":"prueba","password":"prueba"}'

curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/list"
```

`/api/login` must return `404` with a valid body. `/api/list` must return `404` because the catalog is disabled. `/api/lista` is not an API route: a request to that address may return the static page with `200`; do not use it as a check.

## 9. Actual limits

| Limit | Value | Check |
|---|---|---|
| Minimum size | 1 KB (1024 bytes) | A smaller file returns `400`. |
| Maximum size | 16 MB (16777216 bytes) | A larger file returns `413`. |
| Retention in this variant | 24 hours | Checked against the date of the temporary output JSON. |
| Uploads per window | 2 every 10 minutes | The third upload within the window returns `429`. |
| Uploads per day | 10 | Exceeding the limit returns `429` with `Retry-After`. |
| Active conversion | 1 per network address | Approximated with one active key per address. |

Nuances to know before operating:

- Retention is anchored to the temporary output JSON object (`temp/{uuid}/output.json`), not to the exact moment of upload. The JSON is written when conversion finishes, so effective availability may be somewhat longer than 24 hours from the request.
- The `/api/upload` response includes `expiresAt` calculated when the upload is accepted; the actual server check uses the date of the temporary object.
- `conversionTimeoutSeconds` (120 seconds in the template) does not abort the conversion. It is used as the lifetime of the active conversion key and as the `Retry-After` value.
- `maxConcurrent` appears in `app-config`, but the code does not read it. Concurrency is approximated with one active key per network address.
- Limit counters are incremented before validating the file, the content type, or Turnstile. Invalid attempts consume quota.
- If a conversion fails after it starts, the active key may take up to `conversionTimeoutSeconds` to be released.
- `loginEnabled` determines the mode; `catalogEnabled` only controls `/api/list` and the catalog view. In this variant, both are disabled.
- `/api/config` returns `rateLimit` in anonymous mode. In catalog mode it would return `null`, but that mode is not used here.

## 10. Errors and troubleshooting

| Symptom | Probable cause | Action |
|---|---|---|
| `500 Configuración no disponible` in `/api/config` or when uploading | A KV binding is missing, `app-config` or `app-variables` is missing, the JSON does not conform to the schema, or `INTERNAL_SHARED_SECRET` is missing in Pages when uploading. | Check the bindings and keys, compare the secret, and run `validate-config.js`. |
| `500 Servicio de conversión no disponible` when uploading | The `CONVERTER` service binding is missing. | Configure the binding in Pages. |
| `502 No se pudo iniciar la conversión` | The service binding points to a different Worker, the secret does not match, or the Conversion Worker fails. | Check the service name, compare the secret in both destinations, and check the Worker logs. |
| `500 Visualizador no disponible` | The `VISUALIZER` service binding is missing. | Configure the binding in Pages. |
| `500 Almacenamiento no disponible` or `500 El binding de R2 no está disponible` | The `MMUP_BUCKET` binding is missing in Pages, in the Visualization Worker, or in the Conversion Worker. | Configure the R2 bucket in all three destinations. |
| `404 Mapa no encontrado` | The temporary object expired, does not exist, or the key template does not match. | Check `temp/{uuid}/output.json` in R2. If it expired, this is the expected behavior. |
| `429 Ya hay una conversión en curso` | An active key exists for the network address. | Wait for the indicated `Retry-After`, at most `conversionTimeoutSeconds`. |
| `429 Demasiadas conversiones. Inténtalo más tarde.` | The limit of 2 uploads per 10 minutes was exceeded. | Wait for the window to expire. |
| `429 Límite diario de conversiones alcanzado.` | The limit of 10 uploads per 24 hours was exceeded. | Wait for the daily counter to expire. |
| `400 El archivo debe tener extensión .mup` | The file does not have the correct extension. | Use a file with the `.mup` extension; also check that its `formatVersion` is 3. |
| `400 El archivo está vacío o es demasiado pequeño (mínimo 1 KB)` | The file is smaller than 1024 bytes. | Use a map with enough content. |
| `400 El archivo no contiene un JSON válido` | The `.mup` is not JSON or is damaged. | Export it again from MindMup. |
| `403 Verificación antiabuso fallida` | Turnstile is enabled and the token is missing or invalid. | Check the public and secret keys; the attempt has already consumed quota. |
| `404 Catálogo no disponible` in `/api/list` | `catalogEnabled` is `false`. | This is the expected behavior in the public variant. |
| `404 Resultado no encontrado` in `/api/download/{uuid}` | The public variant does not expose JSON. | This is the expected behavior; use `/api/download-html/{uuid}`. |
| `200` with HTML at `/api/lista` | `/api/lista` is not an API route; the server returns the static page. | The catalog route is `/api/list`; in this variant it is disabled and returns `404`. |
| `Pages does not support custom paths for the Wrangler configuration file` | `--config` was passed to `pages deploy`. | Remove `--config`; let Wrangler discover `wrangler.jsonc` or configure the bindings in the dashboard. |
| Migration error on the first deployment | The `{{MIGRATION_TAG}}` tag was already applied in that Worker. | Use a new tag; do not edit an applied migration. |

Technical details are recorded in the structured logs of the Worker or the Function. User-facing responses do not include traces, secrets, or internal paths.

## 11. Security and operational notes

- Keep both Workers without a public URL. Pages is the only entry point, and the Functions enforce the limits.
- `INTERNAL_SHARED_SECRET` must match in the Conversion Worker and in Pages. When rotating it, update both destinations in the same maintenance window; while both exist but do not match, uploads will return `502`.
- Do not store secrets, account identifiers, or `.local` files in Git. `.gitignore` already excludes `*.local.*`, `config.local.json`, `config.variables.local.json`, `.dev.vars`, and `wrangler.jsonc`.
- Do not connect the Pages project to a Git branch or add GitHub Actions workflows. Deployment is manual.
- The original `.mup` is deleted when conversion finishes. The temporary JSON is kept until it expires; the hourly scheduled task deletes expired objects, and the Function also deletes them when it detects expiration.
- The 24-hour retention and URL expiration correspond to this public variant. They do not apply to the installation with login and R2 or to the local converter.
- HTML is not stored: it is generated on demand. The ZIP is built on each download.
- There is no catalog, campaign, or `staging/` in this variant. Do not look for published data in `output/`: anonymous conversions use `temp/`.
- Limits apply per network address. Multiple users behind the same network may share quota; this is the expected behavior.
- Turnstile is optional and complements the limits; it does not replace them.
- Keep `LICENSE` and `THIRD_PARTY_LICENSES.md` in the distribution.

## Checklist

- [ ] `npm test` finishes without failures.
- [ ] `validate-config.js` returns `Configuración válida`.
- [ ] The R2 bucket and both key-value namespaces exist.
- [ ] The `pg-mindmup-v2-public` project exists and is not connected to Git.
- [ ] Both Workers are deployed with `workers_dev: false`.
- [ ] Each Worker applied its migration only once.
- [ ] `INTERNAL_SHARED_SECRET` matches in the Conversion Worker and in Pages.
- [ ] `app-config` and `app-variables` are loaded with `--remote`.
- [ ] Pages has the `CONFIG_KV`, `VARIABLES_KV`, `MMUP_BUCKET`, `CONVERTER`, and `VISUALIZER` bindings.
- [ ] `/api/config` responds in anonymous mode and `/api/session` returns `authenticated: false`.
- [ ] A full upload ends in `completed`, the HTML returns `200`, and the ZIP returns `200`.
- [ ] `/api/list` and `/api/download/{uuid}` return `404`.
- [ ] There are no `.local` files, `.dev.vars`, `wrangler.jsonc`, or secrets in `git status`.
