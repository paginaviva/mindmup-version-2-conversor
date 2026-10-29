# Security of MindMup 2 Conversor

[Español](seguridad-es.md) | [English](seguridad-en.md)


This guide brings together the measures that protect secrets, sessions, usage limits, retention, and generated HTML. It is intended for the two web variants of MindMup 2 Conversor. The local converter does not use Cloudflare or runtime secrets.

The converter only reads `.mup` files compatible with `formatVersion: 3` and does not edit maps in MindMup. The commercial version of the application is not involved in validation.

Values between `{{...}}` are placeholders that you must replace with those from your environment. Do not copy secrets, account identifiers, real names, or addresses from the private deployment into this repository.

## 1. Secrets and authorized containers

The only local containers authorized for real sensitive values are:

| Container | Use | Versioned |
|---|---|---|
| `desa-temp/.env` | Deployment credentials and generation values | No |
| `desa-temp/credenciales.tsv` | Table of services, accounts, and secrets | No |

`desa-temp/` is excluded from Git. The `.env` and `credenciales.tsv` files are also not versioned even if they are outside that folder. Do not copy their values into responses, commands, generated files, logs, screenshots, issues, or test results. In a clean clone, `desa-temp/` does not exist: it is a local working folder. Create it with `mkdir -p desa-temp` or use another directory excluded from Git.

`.dev.vars` may contain only non-sensitive test values or may not exist. Never store real secrets in `.dev.vars`. The example file uses values such as `test-only`.

Versioned templates do not contain real values:

- `.env.example`
- `credenciales.example.tsv`
- `.dev.vars.example`

They use placeholders with the `{{NOMBRE_VALOR}}` syntax. Safe public values are also accepted if they do not identify an account or a private resource.

At runtime, secrets live in Cloudflare:

| Secret | Destination | Use |
|---|---|---|
| `INTERNAL_SHARED_SECRET` | Pages and Conversion Worker | Authenticates Functions calls to the Conversion Worker |
| `ADMIN_PASSWORD_HASH` | Pages | PBKDF2 hash of the administrative password |
| `ADMIN_PASSWORD_SALT` | Pages | PBKDF2 salt in base64 |
| `ADMIN_PASSWORD_ITERATIONS` | Pages | Number of PBKDF2 iterations |
| `TURNSTILE_SECRET_KEY` | Pages | Optional; verifies the Turnstile token |

`ADMIN_PASSWORD` is only used to generate the hash. It is not stored in Cloudflare and is shown only once. The form user is configured in `loginUser`, inside `app-config`; it is not a secret.

Deployment credentials (`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`) live in `desa-temp/.env` or in the environment of the person performing the deployment. Use a least-privilege token and do not pass it as a command argument.

`*.local.*`, `config.local.json`, `config.variables.local.json`, and `wrangler.jsonc` are not versioned either.

## 2. Sessions

The session cookie is called `__Host-mmup_session` and is serialized as follows:

```text
__Host-mmup_session=<identificador>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<segundos>
```

The `__Host-` prefix requires `Secure`, `Path=/`, and no `Domain` attribute. The cookie contains only an opaque 256-bit identifier encoded in Base64URL. It does not contain the user or any other session data.

The session is stored on the server, in `CONFIG_KV`, under the key `session:<identificador>`. The record contains `user`, `createdAt`, and `expiresAt`. The lifetime comes from `sessionTtlMinutes`.

Every protected route reads the record again on the server. No client-side marker is trusted.

- `/api/session` responds `200` with `authenticated: false` if the cookie is missing, the record does not exist, is invalid, or has expired. An expired record is deleted when it is queried.
- `/api/logout` deletes the record and the cookie. It responds `200` even if there was no session, including in anonymous mode.
- `/api/login` returns the same generic message when the user, the password, or a secret fails. A configuration failure is not presented as a successful login.
- The login limit is 5 attempts per network address every 10 minutes. Attempts with incorrect credentials consume quota. A successful login clears the counter.
- Disabling `loginEnabled` does not proactively invalidate existing sessions. They are deleted when `/api/session` is queried or when they expire.

Example of checking the cookie in a login response:

```bash
curl -i -c .tmp/cookies.txt \
  -H 'Content-Type: application/json' \
  --data '{"user":"{{LOGIN_USER}}","password":"{{ADMIN_PASSWORD}}"}' \
  "{{URL_PAGES}}/api/login"
```

Do not use HTTP to test the `__Host-` cookie: the browser does not retain it without HTTPS.

## 3. PBKDF2

The password is derived with PBKDF2-HMAC-SHA-256, a 16-byte salt, and a 32-byte derived key. The reference value for this distribution is **5,000 iterations**.

Generate the secrets with the explicit flag:

```bash
node scripts/generate-secrets.js --iterations 5000
```

The script does not write files. It prints one line per secret:

```text
INTERNAL_SHARED_SECRET=...
ADMIN_PASSWORD_HASH=...
ADMIN_PASSWORD_SALT=...
ADMIN_PASSWORD_ITERATIONS=5000
ADMIN_PASSWORD=...
```

`ADMIN_PASSWORD` only appears if `--password` was not passed. Store it outside the repository and show it only once.

The script's default value is 100,000. The reference for this distribution is 5,000; use the explicit flag so that the deployed value is consistent with the documentation.

`ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, and `ADMIN_PASSWORD_ITERATIONS` must be generated together and remain consistent. If you change the iterations, regenerate all three values. Do not change only one: login will fail or use a different cost than expected. Measure the actual cost before setting another value, and do not modify an existing installation because of this change.

## 4. Limits per network address and quota consumption

The template's reference values are:

| Limit | Value | Scope |
|---|---|---|
| Uploads per window | 2 every 10 minutes | Anonymous mode |
| Uploads per day | 10 | Anonymous mode |
| Active conversion | 1 per network address | Anonymous mode |
| Login attempts | 5 every 10 minutes | Mode with login |
| Minimum size | 1 KB | Both web variants |
| Maximum size | 16 MB | Both web variants |
| Anonymous retention | 24 hours | Anonymous mode |
| Maximum conversion time | 120 seconds | Active key and `Retry-After` |

The network address is obtained from `CF-Connecting-IP`. If it is not available, the first value of `X-Forwarded-For` is used; if that is not present either, `unknown` is used. Multiple users behind the same network may share quota; this is the expected behavior.

Counters are incremented before validating the file, the content type, or Turnstile. Therefore, invalid attempts consume quota. The active key is also created before those validations; if a validation fails, the active key is deleted, but the window and daily counters are not refunded.

`conversionTimeoutSeconds` does not abort the conversion. It is used as the lifetime of the active key and as the `Retry-After` value. If a conversion fails after it starts, the active key may take up to that time to be released.

`maxConcurrent` appears in the configuration, but the code does not read it. Concurrency is approximated with one active key per network address.

The `rateLimit` object applies only to anonymous mode. In catalog mode, `/api/config` returns `rateLimit: null` and these upload limits per network address are not applied; the login attempt limit remains active.

Limit responses use `429` and `Retry-After`:

```text
Ya hay una conversión en curso
Demasiadas conversiones. Inténtalo más tarde.
Límite diario de conversiones alcanzado.
```

## 5. 24-hour retention and verification

In anonymous mode, retention is anchored to the temporary output JSON: `temp/{uuid}/output.json`. It is not anchored to the exact instant of the upload.

### 5.1. Access expiration and physical deletion

| Concept | When it occurs | Effect |
|---|---|---|
| Access expiration | When `Date.now()` reaches `uploaded + anonymousRetentionHours`. | The routes that serve the HTML view respond `404` with `Mapa no encontrado`. The Function attempts to delete the object at that moment. |
| Physical deletion | In the Conversion Worker's scheduled task, every hour, or when the Function deletes an expired object. | An attempt is made to delete the temporary object from R2. This may occur after access expiration. |

Access expiration does not depend on physical deletion having already run. Between both moments, the object may still exist in R2, but the application routes no longer serve it. The Conversion Worker's scheduled task runs every hour and deletes expired temporary objects; an R2 lifecycle policy can act as a safety net, but it does not replace the Function's check.

Before serving `/html/{uuid}` and `/api/download-html/{uuid}`, the Function checks the date of the temporary object. If it has expired, it deletes it and responds `404` with `Mapa no encontrado`, even if physical cleanup has not yet run.

The `expiresAt` field in the upload response is calculated when responding to the upload and is an estimate. The actual server check uses the date of the temporary output object.

The original `.mup` is deleted when conversion finishes. The HTML is not stored: it is generated on demand. The ZIP is built on each download. In catalog mode, `output/` is not deleted automatically.

## 6. CSP, nonce, security headers, and the iframe toolbar

The static application sends this policy and these headers from `app/_headers`:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cache-Control: no-cache
```

The viewer generates a different policy for each HTML:

```text
default-src 'none'; script-src 'nonce-<nonce>'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; object-src 'none'
```

In addition, it adds these headers:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: SAMEORIGIN
```

The `nonce` is generated with 16 random bytes in base64 for each request. It travels to the Durable Object through the internal `X-MMUP-Nonce` header and is validated before it is inserted into the `script` elements. The HTML is served with `Cache-Control: private, no-store` because the `nonce` changes on each request.

The `/html/{uuid}` Function injects the download toolbar only in the preview. It adds `connect-src 'self'` to the policy so that the button can request the ZIP. The toolbar is hidden when the HTML is opened inside an iframe:

```js
if (window.self !== window.top) {
  toolbar.style.display = 'none';
}
```

The `/api/download-html/{uuid}` route does not inject the toolbar: the ZIP contains the clean HTML, without the application toolbar. The MIT notice and the viewer's interactivity remain in that HTML.

`frame-ancestors 'self'` and `X-Frame-Options: SAMEORIGIN` allow the preview in the iframe of the same application and block inclusion from third parties. The main application uses `frame-ancestors 'none'` and `X-Frame-Options: DENY`.

The viewer's policy allows `data:` and `https:` in `img-src` for embedded and remote icons. `style-src 'unsafe-inline'` covers the viewer's CSS. External scripts are not allowed: only those with the request's `nonce`.

## 7. Optional Turnstile

Turnstile is disabled by default. It only affects anonymous mode.

To enable it:

1. Create a Turnstile widget in Cloudflare.
2. Set `turnstileEnabled: true` and `turnstileSiteKey` in `app-config`. The public key is not a secret.
3. Define `TURNSTILE_SECRET_KEY` only in the Pages project.

With Turnstile active, the browser loads the widget from `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`. The Function sends the token and the network address to `https://challenges.cloudflare.com/turnstile/v0/siteverify`. If the token is missing or invalid, the upload responds `403` with `Verificación antiabuso fallida`.

Quota counters are incremented before verifying Turnstile. A rejected attempt consumes quota.

Turnstile is an external service. The browser contacts Cloudflare, and the verification sends the token and the network address to the service. Its use is governed by Cloudflare's terms; it is not redistributed. If you cannot accept that dependency, leave `turnstileEnabled` set to `false`: the application does not load the widget or call the verification. The service is documented in [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md).

## 8. User content

Icons, attachments, and links in maps belong to their authors. This project does not relicense them or claim ownership of them.

- The HTML may include icons and attachments as `data:` and reproduce linked resources.
- The ZIP may download remote resources and save them in `<mapa>_archivos/`.
- The rights to those resources remain with their authors.
- The MIT license applies to the project's code, not to user content.

Do not publish maps with third-party content without permission. The examples and tests use synthetic data. If a remote resource fails, the ZIP is still generated and `faltantes.txt` lists the address and the reason.

## 9. MIT notice

The code is distributed under the MIT license. The text is in [LICENSE](../LICENSE) and in [app/LICENSE](../app/LICENSE). `app/LICENSE` is published with the static application.

The generated HTML includes this notice:

```html
<!-- Copyright (c) 2026 PáginaVIVA. MIT License. -->
```

The ZIP contains that HTML, so the notice also travels with the download. Do not remove `LICENSE`, `app/LICENSE`, or the HTML comment when redistributing the project.

Third-party materials and user content are documented in [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md). The MIT license does not apply to material that is not owned by PáginaVIVA.

## 10. Response to credential exposure

If a credential is exposed:

1. Do not reproduce its value in the response, the issue, a screenshot, a log, or a commit.
2. Identify the affected resource and its scope: deployment token, internal secret, administrative secret, Turnstile, or session.
3. Revoke or rotate the credential at its source.
4. If it is `INTERNAL_SHARED_SECRET`, update Pages and the Conversion Worker. While the values do not match, uploads will respond `502`.
5. If they are `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, and `ADMIN_PASSWORD_ITERATIONS`, regenerate all three together and set them again in Pages.
6. If it is `TURNSTILE_SECRET_KEY`, rotate it in Cloudflare and in Pages.
7. If it is a Cloudflare token, revoke it and create a new least-privilege one.
8. If a cookie or a session record was exposed, delete `session:<identificador>` from `CONFIG_KV`. The previous cookie will no longer be valid.
9. Fix the source of the exposure. If the value was in Git, consider it compromised and remove the value from history before publishing.
10. Review access events and logs without copying secrets.
11. Verify that the previous credential no longer works and document the incident without including its value.

Do not close the incident until you have rotated the credential and checked the affected flow.

## 11. Checklist before publishing

- [ ] `git status` does not show `.env`, `credenciales.tsv`, `.dev.vars`, `*.local.*`, `config.local.json`, `config.variables.local.json`, or `wrangler.jsonc`.
- [ ] `desa-temp/` is excluded and no file from it has slipped in.
- [ ] The full history has been analyzed and does not contain secrets, private data, absolute paths, or addresses from the private deployment.
- [ ] The templates only contain `{{...}}` placeholders or safe public values.
- [ ] There are no real names of maps, clients, groups, accounts, or internal paths.
- [ ] `npm test` finishes without failures and `node scripts/validate-config.js --config config.local.json --variables config.variables.local.json` returns `Configuración válida`.
- [ ] Both Workers have `workers_dev: false` and `preview_urls: false`.
- [ ] The Pages project is not connected to a Git branch and deployment is manual with Wrangler 4.
- [ ] `INTERNAL_SHARED_SECRET` matches in Pages and in the Conversion Worker.
- [ ] The three `ADMIN_PASSWORD_*` secrets are consistent and use 5,000 iterations, or the measured value that has been decided.
- [ ] The secrets are defined in Cloudflare and not in the repository, in `app-config`, or in `app-variables`.
- [ ] The `__Host-mmup_session` cookie has been observed over HTTPS with `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, and no `Domain`.
- [ ] `/api/logout` responds `200` in anonymous mode and deletes the cookie.
- [ ] `/api/config` in catalog mode returns `rateLimit: null`; in anonymous mode it returns the `rateLimit` object.
- [ ] The catalog route is `/api/list`; `/api/lista` is not an API route and may return the static page.
- [ ] Retention has been tested with a controlled test: an expired object responds `404` and is deleted, without waiting 24 real hours.
- [ ] The CSP headers, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `X-Frame-Options` have been checked in the application and in the viewer.
- [ ] The download toolbar is hidden in the iframe and the ZIP does not contain it.
- [ ] Turnstile is disabled or, if active, the external service is accepted and the secret is only in Pages.
- [ ] `LICENSE`, `app/LICENSE`, the MIT notice in the generated HTML, and `THIRD_PARTY_LICENSES.md` are present.
- [ ] The R2 bucket does not contain data from the private installation or from real users.
- [ ] No campaign code or `staging/` is included in the public distribution.
- [ ] There are no addresses from the private deployment in the README, the documentation, the presentation page, or the examples.

## Related documentation

- [Architecture](arquitectura-en.md)
- [Public installation](instalacion-publica-en.md)
- [Installation with login and R2](instalacion-login-r2-en.md)
- [MIT License](../LICENSE)
- [Third-party licenses](../THIRD_PARTY_LICENSES.md)
