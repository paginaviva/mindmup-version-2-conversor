# Private installation with login and R2 for MindMup 2 Conversor

[Español](instalacion-login-r2-es.md) | [English](instalacion-login-r2-en.md)

This guide describes how to install MindMup 2 Conversor in the variant with login, catalog, and JSON download in your own Cloudflare account. It is a distributable variant: it is not deployed to the public account and does not share resources with other installations. Unlike the public variant, it includes authentication, a catalog, and storage in `output/`; the local converter does not use Cloudflare and writes to the user's disk.

## File compatibility

The converter accepts `.mup` files compatible with `formatVersion: 3`. Compatibility is determined by that internal value, not by the commercial version of MindMup:

- It accepts `.mup` files with `formatVersion: 3` and a non-empty `ideas` object.
- It rejects files with `formatVersion: 2` and any other value other than 3.
- It does not read or validate the commercial version of MindMup (2 or 3).
- It has not been possible to demonstrate that all MindMup 2 files use `formatVersion: 3`; check the value in the file before assuming it will be accepted.
- `v7` is the converter version, not the MindMup version or the `.mup` format version.

The project does not claim universal compatibility with all MindMup 2 maps or universal incompatibility with MindMup 3.

Values between `{{...}}` are placeholders that you must replace with those from your environment. Do not copy secrets or real identifiers into the repository.

## 1. Scope

The variant includes:

- Login with username and password.
- Sessions stored on the server.
- Catalog of results in R2.
- JSON and HTML download.
- Configurable usage limits; the catalog does not apply automatic retention.
- Manual deployment with Wrangler 4.

It does not include users, sessions, credentials, maps, or data from the original installation. The catalog is empty by default.

Requirements:

- Node.js 22 or later.
- A Cloudflare account with Pages, Workers, R2, and key-value storage.
- Wrangler 4, without a global installation: `npx -y wrangler@4`.
- An HTTPS address for the Pages project. The `__Host-` cookie requires HTTPS.
- No continuous integration or GitHub Actions. Every deployment is manual.

## 2. Architecture

```text
Browser
   │
   ▼
Cloudflare Pages: static application + Functions
   │  service binding CONVERTER
   ├──────────────► Conversion Worker ──► R2
   │                    Durable Object MupConverter
   │  service binding VISUALIZER
   └──────────────► Visualization Worker ──► R2
                        Durable Object MupVisualizer

Functions ──► CONFIG_KV (app-config, sessions, and counters)
Functions ──► VARIABLES_KV (app-variables)
```

- Pages serves the interface and the Functions. It is the only public entry point.
- The Functions validate the request, enforce authorization, and call the Workers through service bindings.
- The Workers are internal: `workers_dev: false` and `preview_urls: false`. They have no public URL or custom domain.
- R2 stores the originals, the catalog results, and temporary objects.
- `CONFIG_KV` stores `app-config`, sessions, login attempts, and limit counters.
- `VARIABLES_KV` stores `app-variables`.
- The Durable Objects run conversion and visualization with state isolated by identifier. Both use SQLite storage.
- `/api/list` and `/api/download/{uuid}` read R2 directly. The remaining protected routes use the Functions and service bindings.

### Main routes

| Route | Method | Behavior |
|---|---|---|
| `/api/login` | `POST` | Verifies credentials and creates the session |
| `/api/logout` | `POST` | Deletes the session and the cookie |
| `/api/config` | `GET` | Returns the mode and public limits |
| `/api/session` | `GET` | Indicates whether the session is valid |
| `/api/upload` | `POST` | Requires a session and calls the Conversion Worker |
| `/api/status/{uuid}` | `GET` | Requires a session and queries the status |
| `/api/list` | `GET` | Requires a session and an active catalog |
| `/api/download/{uuid}` | `GET` | Requires a session and downloads the JSON |
| `/html/{uuid}` | `GET` | Requires a session and serves the HTML |
| `/api/download-html/{uuid}` | `GET` | Requires a session and serves the HTML ZIP |

The catalog route is `/api/list`. `/api/lista` is not an API route; a request to that address may return the static page with `200`.

## 3. Resources each installer must create

Each installer creates its own resources. Do not share the bucket, the KV namespaces, the Workers, the Pages project, or the secrets with another installation.

| Resource | Name or binding | Purpose |
|---|---|---|
| R2 bucket | `{{NOMBRE_CUBO_R2}}` | Originals, results, and temporary objects |
| Configuration KV namespace | `CONFIG_KV` | `app-config`, sessions, and counters |
| Variables KV namespace | `VARIABLES_KV` | `app-variables` |
| Conversion Worker | `{{NOMBRE_WORKER_CONVERSOR}}` | Conversion and `MupConverter` Durable Object |
| Visualization Worker | `{{NOMBRE_WORKER_VISUALIZADOR}}` | HTML and `MupVisualizer` Durable Object |
| Pages project | `{{PAGES_PROJECT}}` | Static interface and Functions |
| Service binding | `CONVERTER` | Connects Pages to the Conversion Worker |
| Service binding | `VISUALIZER` | Connects Pages to the Visualization Worker |
| Secret | `INTERNAL_SHARED_SECRET` | Authenticates Pages to the Conversion Worker |
| Secrets | `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_ITERATIONS` | Verify the password |

## 4. Configuration

Copy the templates to local files ignored by Git:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
cp wrangler.converter.example.jsonc wrangler.converter.local.jsonc
cp wrangler.visualizer.example.jsonc wrangler.visualizer.local.jsonc
cp wrangler.pages.example.jsonc wrangler.pages.local.jsonc
```

Replace the placeholders in the `*.local.*` files. Do not commit them to Git.

### 4.1. Mode and limits

In `config.local.json`, catalog mode requires these values:

```json
"loginEnabled": true,
"catalogEnabled": true,
"loginUser": "{{LOGIN_USER}}"
```

`loginEnabled` determines the mode of the routes. `catalogEnabled` only controls `/api/list` and the catalog view: if it is disabled, the other protected routes still work with a session and `/api/list` returns `404`.

Template reference values:

| Key | Value | Effect |
|---|---|---|
| `schemaVersion` | `1` | Schema version |
| `loginEnabled` | `true` | Enables login mode |
| `catalogEnabled` | `true` | Enables `/api/list` |
| `loginUser` | `{{LOGIN_USER}}` | Exact username for the form |
| `sessionTtlMinutes` | `1440` | Session lifetime: 24 hours |
| `anonymousRetentionHours` | `24` | Anonymous mode only; not applied to `output/` in this variant |
| `minUploadBytes` | `1024` | Minimum size: 1 KB |
| `maxUploadBytes` | `16777216` | Maximum size: 16 MB |
| `rateLimit.windowSeconds` | `600` | 10-minute window |
| `rateLimit.maxRequestsPerWindow` | `2` | Uploads per window in anonymous mode |
| `rateLimit.maxRequestsPerDay` | `10` | Uploads per day in anonymous mode |
| `rateLimit.maxConcurrent` | `1` | Not applied; in anonymous mode, concurrency is approximated with an active key |
| `rateLimit.appliesToAuthenticated` | `false` | Catalog mode does not apply `rateLimit` |
| `loginMaxAttempts` | `5` | Login attempts per window |
| `loginWindowSeconds` | `600` | Login attempt window |
| `configCacheSeconds` | `60` | Propagation delay for changes in key-value storage |
| `conversionTimeoutSeconds` | `120` | Does not abort the conversion; used as the lifetime of the active key and as `Retry-After` |
| `htmlCacheSeconds` | `0` | No HTML cache |
| `turnstileEnabled` | `false` | Optional; only affects anonymous mode |

The 24-hour retention corresponds to the anonymous mode of the public variant and is anchored to the temporary output JSON, not to the exact moment of upload. This guide configures catalog mode: `output/` does not expire and is not deleted automatically.

`conversionTimeoutSeconds` does not abort the conversion. `maxConcurrent` is not applied. In anonymous mode, concurrency is approximated with one active key per network address.

`app-variables` must preserve the template paths:

```text
input/{uuid}.mup
output/{uuid}.json
temp/{uuid}.mup
temp/{uuid}/output.json
```

Do not change `outputPrefix` (`output/`) or `jsonSuffix` (`.json`) without adapting the catalog and downloads.

### 4.2. Validation

Before loading the configuration:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

The output must start with `Configuración válida`. If a key is missing or has the wrong type, the script names the key and exits with code 1.

## 5. Authentication

### 5.1. PBKDF2

The password is derived with PBKDF2-HMAC-SHA-256, a 16-byte salt, and a 32-byte derived key. The reference value for this distribution is **5,000 iterations**.

The default value of `generate-secrets.js` is 100000. For this guide, use the explicit flag:

```bash
node scripts/generate-secrets.js --iterations 5000
```

The script prints one line per secret and does not write files:

```text
INTERNAL_SHARED_SECRET=...
ADMIN_PASSWORD_HASH=...
ADMIN_PASSWORD_SALT=...
ADMIN_PASSWORD_ITERATIONS=5000
ADMIN_PASSWORD=...
```

`ADMIN_PASSWORD` only appears if `--password` was not passed; it is shown once and you must store it outside the repository. `ADMIN_PASSWORD` is not stored in Cloudflare.

The three secrets `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, and `ADMIN_PASSWORD_ITERATIONS` must be consistent. If you change the iterations, regenerate all three together and measure the actual cost before setting another value. Do not change only one.

### 5.2. Where secrets are defined

In the Pages project:

```text
ADMIN_PASSWORD_HASH
ADMIN_PASSWORD_SALT
ADMIN_PASSWORD_ITERATIONS
INTERNAL_SHARED_SECRET
```

In the Conversion Worker:

```text
INTERNAL_SHARED_SECRET
```

The value of `INTERNAL_SHARED_SECRET` must be the same in Pages and in the Conversion Worker. Secrets are not declared in `app-config` or `app-variables`.

### 5.3. Cookie and session

The cookie is named `__Host-mmup_session` and is serialized with:

```text
Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<segundos>
```

The `__Host-` prefix requires `Secure`, `Path=/`, and no `Domain` attribute. The cookie contains only an opaque 256-bit identifier encoded in Base64URL.

The session is stored on the server, in `CONFIG_KV`, under the key `session:<identifier>`. The record contains `user`, `createdAt`, and `expiresAt`. Every protected route reads the record again; no client-side marker is trusted.

- `/api/session` returns `authenticated: false` if the cookie is missing, the record does not exist, is invalid, or has expired.
- An expired record is deleted when it is queried.
- `/api/logout` deletes the record and clears the cookie; it returns `200` even if there was no session.
- Disabling `loginEnabled` does not proactively invalidate sessions. They are deleted when `/api/session` is queried or when they expire.

### 5.4. Attempts and messages

- Login limit: 5 attempts per network address every 10 minutes.
- When the limit is exceeded, `/api/login` returns `429` with `Retry-After` equal to `loginWindowSeconds` (600 by default).
- Attempts with incorrect credentials consume the limit. A successful login clears the counter.
- An incorrect username, an incorrect password, and a missing or malformed secret return the same generic message: `Usuario o contraseña incorrectos.`
- A malformed body returns `400` with `Solicitud no válida`.
- If `loginEnabled` is `false`, `/api/login` returns `404` with `El acceso no está disponible`.

## 6. R2 and catalog

| Object | Content | Lifecycle |
|---|---|---|
| `input/{uuid}.mup` | Uploaded original | Deleted when conversion finishes, whether it succeeds or fails |
| `output/{uuid}.json` | Published JSON-CMJN | Not deleted automatically |

The `temp/` paths and 24-hour retention belong to anonymous mode; the public variant uses them with that policy. This guide configures `loginEnabled: true` and `catalogEnabled: true`; it does not apply that retention to `output/` or to the local converter.

- The original is deleted during conversion. What is not deleted automatically is `output/`.
- HTML is not stored: it is generated on demand.
- The catalog reads the objects in `output/` and shows the title, source file, conversion date, node count, group, and version.
- New uploads have no group metadata. The catalog shows `Sin grupo` and an empty `group_path` until metadata is assigned to the object.
- The converter version is `v7`; it is not the MindMup version or the `.mup` format version.
- The catalog is empty by default in a new installation.
- Search, group filtering, and sorting are resolved on the client.
- JSON download through the web interface requires a session and exists only in this variant; the local converter writes JSON to the user's disk.

The catalog is not populated with sample data. If you need retention for `output/`, manage it explicitly; there is no automatic deletion.

## 7. Installation and deployment

### 7.1. Prepare the environment

Check Wrangler authentication:

```bash
npx -y wrangler@4 whoami
```

Store credentials and real values outside the repository. The intended location is:

```text
desa-temp/.env
desa-temp/credenciales.tsv
```

You can create the local working files from the templates:

`desa-temp/` is a local working folder; it is not distributed in the clone. You can use another name if it is excluded from Git.

```bash
mkdir -p desa-temp
cp .env.example desa-temp/.env
cp credenciales.example.tsv desa-temp/credenciales.tsv
```

Fill in `desa-temp/.env` and `desa-temp/credenciales.tsv` with the values for your installation. `desa-temp/` is excluded from Git. `.dev.vars` may only contain non-sensitive test values or may not exist; never store real secrets in `.dev.vars`.

### 7.2. Create R2 and the two KV namespaces

```bash
npx -y wrangler@4 r2 bucket create {{NOMBRE_CUBO_R2}}

npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_CONFIG}}
npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_VARIABLES}}
```

Note the identifiers returned by each command and replace them in:

```text
{{KV_CONFIG_ID}}
{{KV_VARIABLES_ID}}
```

### 7.3. Configure the Workers

In `wrangler.converter.local.jsonc`, replace:

```text
{{NOMBRE_WORKER_CONVERSOR}}
{{NOMBRE_CUBO_R2}}
{{KV_CONFIG_ID}}
{{KV_VARIABLES_ID}}
```

In `wrangler.visualizer.local.jsonc`, replace:

```text
{{NOMBRE_WORKER_VISUALIZADOR}}
{{NOMBRE_CUBO_R2}}
{{KV_VARIABLES_ID}}
```

In `wrangler.pages.local.jsonc`, replace:

```text
{{PAGES_PROJECT}}
{{NOMBRE_CUBO_R2}}
{{KV_CONFIG_ID}}
{{KV_VARIABLES_ID}}
{{NOMBRE_WORKER_CONVERSOR}}
{{NOMBRE_WORKER_VISUALIZADOR}}
```

The two Workers share the R2 bucket and the variables namespace. The Conversion Worker also uses the configuration namespace.

### 7.4. Durable Objects migration

Each Worker declares its own Durable Object and a migration with a literal tag. Replace `{{MIGRATION_TAG}}` with a fixed value, for example `init`, before the first deployment:

```jsonc
"migrations": [
  {
    "tag": "init",
    "new_sqlite_classes": ["MupConverter"]
  }
]
```

In the Visualization Worker, the class is `MupVisualizer`:

```jsonc
"migrations": [
  {
    "tag": "init",
    "new_sqlite_classes": ["MupVisualizer"]
  }
]
```

The migration is applied once, on the Worker's first deployment. Do not reuse a tag already applied to another project: the history is cumulative and cannot be applied again. If the Worker already exists with a migration, do not copy the tag; review its history and add a new operation only if appropriate.

### 7.5. Deploy the Workers

```bash
npx -y wrangler@4 deploy --config wrangler.converter.local.jsonc --keep-vars
npx -y wrangler@4 deploy --config wrangler.visualizer.local.jsonc --keep-vars
```

`--keep-vars` preserves the variables defined in the dashboard on later deployments. Secrets are not removed by deployment. The first deployment applies each Durable Object's migration.

Verify that the Workers have no public URL. The templates already include `workers_dev: false` and `preview_urls: false`.

### 7.6. Create the Pages project

```bash
npx -y wrangler@4 pages project create {{PAGES_PROJECT}} --production-branch main
```

### 7.7. Load the configuration into key-value storage

Each namespace stores a single JSON document. `--remote` writes to the real namespace; without that flag, Wrangler uses local development storage.

```bash
npx -y wrangler@4 kv key put app-config "$(cat config.local.json)" \
  --namespace-id {{KV_CONFIG_ID}} --remote

npx -y wrangler@4 kv key put app-variables "$(cat config.variables.local.json)" \
  --namespace-id {{KV_VARIABLES_ID}} --remote
```

A change in key-value storage may take `configCacheSeconds` to propagate.

### 7.8. Define the secrets

Wrangler prompts for the value interactively. Do not pass secrets as command arguments.

Conversion Worker:

```bash
npx -y wrangler@4 secret put INTERNAL_SHARED_SECRET \
  --config wrangler.converter.local.jsonc
```

Pages Functions:

```bash
npx -y wrangler@4 pages secret put INTERNAL_SHARED_SECRET --project-name {{PAGES_PROJECT}}
npx -y wrangler@4 pages secret put ADMIN_PASSWORD_HASH --project-name {{PAGES_PROJECT}}
npx -y wrangler@4 pages secret put ADMIN_PASSWORD_SALT --project-name {{PAGES_PROJECT}}
npx -y wrangler@4 pages secret put ADMIN_PASSWORD_ITERATIONS --project-name {{PAGES_PROJECT}}
```

The `INTERNAL_SHARED_SECRET` in Pages and in the Conversion Worker must be identical. If you enable Turnstile, add `TURNSTILE_SECRET_KEY` to the Pages project; it is not required for this variant.

### 7.9. Deploy Pages

For Wrangler to apply the Pages configuration, the file must be named `wrangler.jsonc`, `wrangler.json`, or `wrangler.toml`. Copy the local configuration to `wrangler.jsonc`, which is ignored by Git:

```bash
cp wrangler.pages.local.jsonc wrangler.jsonc
npx -y wrangler@4 pages deploy --branch main
```

The Pages configuration includes:

- `pages_build_output_dir` set to `./app`.
- The `CONFIG_KV` and `VARIABLES_KV` namespaces.
- The `MMUP_BUCKET` bucket.
- The `CONVERTER` and `VISUALIZER` service bindings.

Do not use `wrangler.jsonc` to deploy the Workers; their configurations are `wrangler.converter.local.jsonc` and `wrangler.visualizer.local.jsonc`.

## 8. Verification

Replace `{{URL_PAGES}}` with the HTTPS address of the Pages project and `{{UUID}}` with an existing catalog identifier. The checks must run against the real deployment.

### 8.1. Public configuration

```bash
curl -i "{{URL_PAGES}}/api/config"
```

It must return `200` with:

```json
{
  "mode": "catalogue",
  "loginEnabled": true,
  "catalogEnabled": true,
  "rateLimit": null
}
```

In catalog mode, `rateLimit` is `null`; per-network-address limits are not exposed in this response.

### 8.2. Login and cookie

```bash
mkdir -p .tmp
read -r -s -p "Contraseña: " ADMIN_PASSWORD; echo
printf '{"user":"%s","password":"%s"}' "{{LOGIN_USER}}" "$ADMIN_PASSWORD" > .tmp/login.json
unset ADMIN_PASSWORD

curl -i -c .tmp/cookies.txt \
  -H 'Content-Type: application/json' \
  --data-binary @.tmp/login.json \
  "{{URL_PAGES}}/api/login"

rm -f .tmp/login.json
```

The password generated by `generate-secrets.js` is Base64URL and does not need escaping for this example. If you use your own password with quotes or backslashes, you must escape it in the JSON.

It must return `200` with `authenticated: true` and a `Set-Cookie` header with:

```text
__Host-mmup_session=<identificador>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<segundos>
```

The cookie must not have `Domain`. Verify that the browser or the cookie jar keeps it:

```bash
grep '__Host-mmup_session' .tmp/cookies.txt
```

### 8.3. Session

```bash
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/session"
```

It must return `200` with `authenticated: true` and the configured user. Without a cookie, the same route returns `200` with `authenticated: false`.

### 8.4. Catalog without a session and with a session

Without a cookie, with `loginEnabled: true` and `catalogEnabled: true`:

```bash
curl -i "{{URL_PAGES}}/api/list"
```

It must return `401` with `No autorizado`.

If you change `catalogEnabled` to `false`, wait `configCacheSeconds`, and repeat the request, it must return `404` with `Catálogo no disponible`, even without a session.

With the cookie from a valid session:

```bash
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/list"
```

It must return `200` with `success: true`, `count`, and `items`. A new result without metadata must show `group: "Sin grupo"`.

### 8.5. JSON download

```bash
curl -sS -b .tmp/cookies.txt -D .tmp/download.headers \
  -o .tmp/resultado.json -w '%{http_code}\n' \
  "{{URL_PAGES}}/api/download/{{UUID}}"
```

It must return `200`, with `Content-Type: application/json` and a JSON-CMJN file. Without a session, the same route returns `401`. If the object does not exist, it returns `404` with `Resultado no encontrado`.

### 8.6. HTML download

```bash
curl -sS -b .tmp/cookies.txt -o .tmp/mapa.html -w '%{http_code}\n' \
  "{{URL_PAGES}}/html/{{UUID}}"

curl -sS -b .tmp/cookies.txt -o .tmp/mapa.zip -w '%{http_code}\n' \
  "{{URL_PAGES}}/api/download-html/{{UUID}}"

unzip -l .tmp/mapa.zip
```

The HTML must return `200` and the ZIP must contain the HTML and its resources. HTML is generated on demand; it is not served from a stored object.

### 8.7. Logout

```bash
curl -i -b .tmp/cookies.txt -X POST "{{URL_PAGES}}/api/logout"
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/session"
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/list"
```

Logout must return `200` and clear the cookie. The session must become `authenticated: false` and `/api/list` must return `401` with the previous cookie.

### 8.8. PBKDF2 with 5,000 iterations

The generation must have been run with:

```bash
node scripts/generate-secrets.js --iterations 5000
```

The output must include:

```text
ADMIN_PASSWORD_ITERATIONS=5000
```

Verify that the secrets are defined, without showing their values:

```bash
npx -y wrangler@4 pages secret list --project-name {{PAGES_PROJECT}}
```

`ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_ITERATIONS`, and `INTERNAL_SHARED_SECRET` must appear. A successful login with the generated password confirms that the deployed hash, salt, and iterations are consistent.

## 9. Security

- Login limit: 5 attempts per network address every 10 minutes. Attempts with incorrect credentials consume quota.
- Invalid attempts consume quota: in anonymous mode, upload counters are incremented before validating the file, Turnstile, or the content type.
- Login messages are generic. They do not reveal whether the failure was the username, the password, or a secret.
- Secrets live only in Cloudflare and in approved local storage locations. `.env` and `credenciales.tsv` are stored in `desa-temp/`, outside Git.
- `.dev.vars` contains only non-sensitive test values or does not exist. It is never used for real secrets.
- `ADMIN_PASSWORD` is used only to generate the hash and is not stored in Cloudflare. The generated password is shown once.
- The `__Host-` cookie requires HTTPS, `Secure`, `Path=/`, and no `Domain`. Do not use it over HTTP.
- The Workers have no public URL. The Functions are the only entry point.
- GitHub Actions and continuous integration are not used. Deployment is manual with Wrangler 4.
- `conversionTimeoutSeconds` does not abort the conversion. `maxConcurrent` is not applied; in anonymous mode, concurrency is approximated with an active key.
- Disabling login does not proactively invalidate sessions. They are deleted when `/api/session` is queried or when they expire.
- The 24-hour retention belongs to the anonymous mode of the public variant. In this variant, `output/` is not deleted automatically.
- Do not share R2, key-value storage, Workers, Pages, or secrets between installations.

## 10. Troubleshooting

| Symptom | Probable cause | Action |
|---|---|---|
| `/api/config` returns `500` with `Configuración no disponible` | `CONFIG_KV` is missing, `app-config` is missing, or the document is invalid | Check the binding, run `validate-config.js`, and upload again with `--remote` |
| `/api/login` returns `401` with `Usuario o contraseña incorrectos.` | Username differs from `loginUser`, password is incorrect, or secrets are inconsistent | Check `loginUser`; regenerate all three `ADMIN_*` secrets together and define them again in Pages |
| `/api/login` returns `404` with `El acceso no está disponible` | `loginEnabled` is `false` | Enable `loginEnabled` and wait `configCacheSeconds` |
| `/api/login` returns `429` with `Demasiados intentos. Inténtalo de nuevo más tarde.` | 5 failed attempts were reached in 10 minutes | Wait for the `loginWindowSeconds` window |
| `/api/list` returns `401` with `No autorizado` | There is no valid cookie or the session expired | Log in; verify that the `__Host-` cookie is stored over HTTPS |
| `/api/list` returns `404` with `Catálogo no disponible` | `catalogEnabled` is `false` or `loginEnabled` is `false` | Enable both values and wait `configCacheSeconds` |
| `/api/list` returns `500` | A binding is missing, `app-variables` is invalid, or R2 is not responding | Check `CONFIG_KV`, `VARIABLES_KV`, `MMUP_BUCKET`, and the documents |
| `/api/upload` returns `500` with `Servicio de conversión no disponible` or `Configuración no disponible` | `CONVERTER` or `INTERNAL_SHARED_SECRET` is missing in Pages | Check the binding and define the secret in Pages |
| `/api/upload` returns `502` with `No se pudo iniciar la conversión` | The Conversion Worker rejects the call or does not respond; it usually indicates a different `INTERNAL_SHARED_SECRET` | Define the same secret in Pages and in the Conversion Worker |
| `/html/{uuid}` returns `500` with `Visualizador no disponible` or `Configuración no disponible` | `VISUALIZER`, `app-config`, or `app-variables` is missing | Check the binding and the configuration documents |
| `/html/{uuid}` returns `502` with `No se pudo generar la visualización` | Failure when invoking the Visualization Worker | Check the deployment and the `VISUALIZER` binding |
| `/api/download/{uuid}` returns `404` with `Resultado no encontrado` | `output/{uuid}.json` does not exist or `loginEnabled` is `false` | Check the object in R2 and the configuration mode |
| The cookie does not appear in the browser | HTTP is being used or an attribute is incompatible with `__Host-` | Use HTTPS; check `Secure`, `Path=/`, and the absence of `Domain` |
| Worker deployment fails because of the migration | The tag was already applied or reused from another project | Do not reapply the migration; use a new tag only for a new operation |
| The catalog shows `Sin grupo` | The upload has no `group` or `group_path` metadata | This is the expected behavior; assign metadata to the object if you need to classify it |
| `output/` grows without limit | There is no automatic deletion of the catalog | Define explicit retention or a lifecycle policy in R2 |
| Sessions remain active after disabling login | The configuration change does not delete existing sessions | They are deleted when `/api/session` is queried or when they expire; do not expect immediate invalidation |
| Pages does not apply the bindings | Only `app` was deployed without Pages configuration | Use `wrangler.jsonc` with `pages_build_output_dir` or configure the bindings in the dashboard |

## 11. Checklist

- [ ] Node.js 22 or later and Wrangler 4 available.
- [ ] R2 bucket and two KV namespaces created.
- [ ] `{{KV_CONFIG_ID}}` and `{{KV_VARIABLES_ID}}` identifiers replaced in the configuration files that use them.
- [ ] Literal migration tags unique to each Worker.
- [ ] `config.local.json` with `loginEnabled: true`, `catalogEnabled: true`, and `loginUser` defined.
- [ ] `validate-config.js` returns `Configuración válida`.
- [ ] `app-config` and `app-variables` loaded with `--remote`.
- [ ] `INTERNAL_SHARED_SECRET` identical in Pages and in the Conversion Worker.
- [ ] `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, and `ADMIN_PASSWORD_ITERATIONS` defined in Pages with 5,000 iterations.
- [ ] Workers deployed without a public URL.
- [ ] Pages deployed with the bindings and the Functions.
- [ ] Login, cookie, session, and logout verified.
- [ ] `/api/list` returns `401` without a session, `200` with a session, and `404` with the catalog disabled.
- [ ] JSON download and HTML download verified.
- [ ] `pages secret list` shows the four secrets.
- [ ] No `.env`, `credenciales.tsv`, `.dev.vars`, `*.local.*`, or `wrangler.jsonc` file is in Git.
- [ ] There are no GitHub Actions workflows or continuous integration.
