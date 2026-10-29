# Seguridad de MindMup 2 Conversor

[Español](seguridad-es.md) | [English](seguridad-en.md)


Esta guía reúne las medidas que protegen los secretos, las sesiones, los límites de uso, la retención y el HTML generado. Está pensada para las dos variantes web de MindMup 2 Conversor. El conversor local no usa Cloudflare ni secretos de ejecución.

El conversor solo lee archivos `.mup` compatibles con `formatVersion: 3` y no edita mapas en MindMup. La versión comercial de la aplicación no interviene en la validación.

Los valores entre `{{...}}` son marcadores que debes sustituir por los de tu entorno. No copies secretos, identificadores de cuenta, nombres reales ni direcciones del despliegue privado en este repositorio.

## 1. Secretos y contenedores autorizados

Los únicos contenedores locales autorizados para valores sensibles reales son:

| Contenedor | Uso | Se versiona |
|---|---|---|
| `desa-temp/.env` | Credenciales de despliegue y valores de generación | No |
| `desa-temp/credenciales.tsv` | Tabla de servicios, cuentas y secretos | No |

`desa-temp/` está excluida de Git. Los archivos `.env` y `credenciales.tsv` tampoco se versionan aunque estén fuera de esa carpeta. No copies sus valores en respuestas, comandos, archivos generados, registros, capturas, incidencias ni resultados de pruebas. En un clon limpio, `desa-temp/` no existe: es una carpeta local de trabajo. Créala con `mkdir -p desa-temp` o usa otro directorio excluido de Git.

`.dev.vars` solo puede contener valores de prueba no sensibles o no existir. Nunca guardes secretos reales en `.dev.vars`. El archivo de ejemplo usa valores como `test-only`.

Las plantillas versionadas no contienen valores reales:

- `.env.example`
- `credenciales.example.tsv`
- `.dev.vars.example`

Usan marcadores con la sintaxis `{{NOMBRE_VALOR}}`. Los valores públicos seguros también se admiten si no identifican una cuenta ni un recurso privado.

En ejecución, los secretos viven en Cloudflare:

| Secreto | Destino | Uso |
|---|---|---|
| `INTERNAL_SHARED_SECRET` | Pages y Worker de conversión | Autentica las llamadas de las Functions al Worker de conversión |
| `ADMIN_PASSWORD_HASH` | Pages | Hash PBKDF2 de la contraseña administrativa |
| `ADMIN_PASSWORD_SALT` | Pages | Sal PBKDF2 en base64 |
| `ADMIN_PASSWORD_ITERATIONS` | Pages | Número de iteraciones PBKDF2 |
| `TURNSTILE_SECRET_KEY` | Pages | Opcional; verifica el token de Turnstile |

`ADMIN_PASSWORD` solo se usa para generar el hash. No se guarda en Cloudflare y se muestra una sola vez. El usuario del formulario se configura en `loginUser`, dentro de `app-config`; no es un secreto.

Las credenciales de despliegue (`CLOUDFLARE_API_TOKEN` y `CLOUDFLARE_ACCOUNT_ID`) viven en `desa-temp/.env` o en el entorno de la persona que despliega. Usa un token de mínimo privilegio y no lo pases como argumento de un comando.

Tampoco se versionan `*.local.*`, `config.local.json`, `config.variables.local.json` ni `wrangler.jsonc`.

## 2. Sesiones

La cookie de sesión se llama `__Host-mmup_session` y se serializa así:

```text
__Host-mmup_session=<identificador>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<segundos>
```

El prefijo `__Host-` exige `Secure`, `Path=/` y ningún atributo `Domain`. La cookie solo contiene un identificador opaco de 256 bits codificado en Base64URL. No contiene el usuario ni ningún otro dato de la sesión.

La sesión se guarda en el servidor, en `CONFIG_KV`, con la clave `session:<identificador>`. El registro contiene `user`, `createdAt` y `expiresAt`. El tiempo de vida sale de `sessionTtlMinutes`.

Cada ruta protegida vuelve a leer el registro en el servidor. No se confía en ninguna marca del cliente.

- `/api/session` responde `200` con `authenticated: false` si falta la cookie, el registro no existe, es inválido o ha caducado. Un registro caducado se elimina al consultarlo.
- `/api/logout` borra el registro y la cookie. Responde `200` aunque no hubiera sesión; también en modo anónimo.
- `/api/login` devuelve el mismo mensaje genérico cuando falla el usuario, la contraseña o un secreto. Un fallo de configuración no se presenta como un inicio de sesión correcto.
- El límite de acceso es de 5 intentos por dirección de red cada 10 minutos. Los intentos con credenciales incorrectas consumen cuota. Un acceso correcto borra el contador.
- Desactivar `loginEnabled` no invalida proactivamente las sesiones existentes. Se borran cuando se consulta `/api/session` o cuando caducan.

Ejemplo de comprobación de la cookie en una respuesta de acceso:

```bash
curl -i -c .tmp/cookies.txt \
  -H 'Content-Type: application/json' \
  --data '{"user":"{{LOGIN_USER}}","password":"{{ADMIN_PASSWORD}}"}' \
  "{{URL_PAGES}}/api/login"
```

No uses HTTP para probar la cookie `__Host-`: el navegador no la conserva sin HTTPS.

## 3. PBKDF2

La contraseña se deriva con PBKDF2-HMAC-SHA-256, una sal de 16 bytes y una clave derivada de 32 bytes. El valor de referencia de esta distribución es **5.000 iteraciones**.

Genera los secretos con el indicador explícito:

```bash
node scripts/generate-secrets.js --iterations 5000
```

El script no escribe archivos. Imprime una línea por secreto:

```text
INTERNAL_SHARED_SECRET=...
ADMIN_PASSWORD_HASH=...
ADMIN_PASSWORD_SALT=...
ADMIN_PASSWORD_ITERATIONS=5000
ADMIN_PASSWORD=...
```

`ADMIN_PASSWORD` solo aparece si no se pasó `--password`. Guárdala fuera del repositorio y muéstrala una sola vez.

El valor por defecto del script es 100000. La referencia de esta distribución es 5000; usa el indicador explícito para que el valor desplegado sea coherente con la documentación.

`ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT` y `ADMIN_PASSWORD_ITERATIONS` deben generarse juntos y permanecer coherentes. Si cambias las iteraciones, regenera los tres valores. No cambies solo uno: el inicio de sesión fallará o usará un coste distinto del esperado. Mide el coste real antes de fijar otro valor y no modifiques una instalación existente por este cambio.

## 4. Límites por dirección de red y consumo de cuota

Los valores de referencia de la plantilla son:

| Límite | Valor | Ámbito |
|---|---|---|
| Subidas por ventana | 2 cada 10 minutos | Modo anónimo |
| Subidas por día | 10 | Modo anónimo |
| Conversión activa | 1 por dirección de red | Modo anónimo |
| Intentos de acceso | 5 cada 10 minutos | Modo con inicio de sesión |
| Tamaño mínimo | 1 KB | Ambas variantes web |
| Tamaño máximo | 16 MB | Ambas variantes web |
| Retención anónima | 24 horas | Modo anónimo |
| Tiempo máximo de conversión | 120 segundos | Clave activa y `Retry-After` |

La dirección de red se obtiene de `CF-Connecting-IP`. Si no está disponible, se usa el primer valor de `X-Forwarded-For`; si tampoco existe, se usa `unknown`. Varios usuarios detrás de la misma red pueden compartir cuota; es el comportamiento esperado.

Los contadores se incrementan antes de validar el archivo, el tipo de contenido o Turnstile. Por tanto, los intentos inválidos consumen cuota. La clave activa también se crea antes de esas validaciones; si una validación falla, se borra la clave activa, pero los contadores de ventana y día no se devuelven.

`conversionTimeoutSeconds` no aborta la conversión. Se usa como tiempo de vida de la clave activa y como valor de `Retry-After`. Si una conversión falla después de iniciarse, la clave activa puede tardar hasta ese tiempo en liberarse.

`maxConcurrent` aparece en la configuración, pero el código no lo lee. La concurrencia se aproxima con una clave activa por dirección de red.

El objeto `rateLimit` solo se aplica al modo anónimo. En modo catálogo, `/api/config` devuelve `rateLimit: null` y no se aplican estos límites de subida por dirección de red; el límite de intentos de acceso sigue activo.

Las respuestas de límite usan `429` y `Retry-After`:

```text
Ya hay una conversión en curso
Demasiadas conversiones. Inténtalo más tarde.
Límite diario de conversiones alcanzado.
```

## 5. Retención de 24 horas y comprobación

En modo anónimo, la retención se ancla al JSON temporal de salida: `temp/{uuid}/output.json`. No se ancla al instante exacto de la subida.

### 5.1. Caducidad de acceso y eliminación física

| Concepto | Cuándo ocurre | Efecto |
|---|---|---|
| Caducidad de acceso | Cuando `Date.now()` alcanza `uploaded + anonymousRetentionHours`. | Las rutas que sirven la vista HTML responden `404` con `Mapa no encontrado`. La Function intenta borrar el objeto en ese momento. |
| Eliminación física | En la tarea programada del Worker de conversión, cada hora, o cuando la Function borra un objeto caducado. | El objeto temporal se intenta eliminar de R2. Puede ocurrir después de la caducidad de acceso. |

La caducidad de acceso no depende de que la eliminación física ya se haya ejecutado. Entre ambos momentos, el objeto puede seguir existiendo en R2, pero las rutas de la aplicación ya no lo sirven. La tarea programada del Worker de conversión se ejecuta cada hora y elimina los objetos temporales caducados; una política de ciclo de vida de R2 puede actuar como red de seguridad, pero no sustituye la comprobación de la Function.

Antes de servir `/html/{uuid}` y `/api/download-html/{uuid}`, la Function consulta la fecha del objeto temporal. Si ha caducado, lo elimina y responde `404` con `Mapa no encontrado`, aunque la limpieza física todavía no se haya ejecutado.

El campo `expiresAt` de la respuesta de subida se calcula al responder a la subida y es una estimación. La comprobación real del servidor usa la fecha del objeto temporal de salida.

El original `.mup` se elimina al terminar la conversión. El HTML no se almacena: se genera a demanda. El ZIP se construye en cada descarga. En modo catálogo, `output/` no se borra automáticamente.

## 6. CSP, nonce, cabeceras de seguridad y barra en el iframe

La aplicación estática envía esta política y estas cabeceras desde `app/_headers`:

```text
Content-Security-Policy: default-src 'none'; script-src 'self' https://challenges.cloudflare.com; style-src 'self'; img-src 'self' data: https:; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Cache-Control: no-cache
```

El visor genera una política distinta para cada HTML:

```text
default-src 'none'; script-src 'nonce-<nonce>'; style-src 'unsafe-inline'; img-src data: https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; object-src 'none'
```

Además, añade estas cabeceras:

```text
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: SAMEORIGIN
```

El `nonce` se genera con 16 bytes aleatorios en base64 por cada petición. Viaja al Durable Object por la cabecera interna `X-MMUP-Nonce` y se valida antes de insertarlo en los elementos `script`. El HTML se sirve con `Cache-Control: private, no-store` porque el `nonce` cambia en cada petición.

La Function `/html/{uuid}` inyecta la barra de descarga solo en la vista previa. Añade `connect-src 'self'` a la política para que el botón pueda solicitar el ZIP. La barra se oculta cuando el HTML se abre dentro de un iframe:

```js
if (window.self !== window.top) {
  toolbar.style.display = 'none';
}
```

La ruta `/api/download-html/{uuid}` no inyecta la barra: el ZIP contiene el HTML limpio, sin la barra de la aplicación. El aviso MIT y la interactividad del visor permanecen en ese HTML.

`frame-ancestors 'self'` y `X-Frame-Options: SAMEORIGIN` permiten la vista previa en el iframe de la misma aplicación y bloquean la inclusión desde terceros. La aplicación principal usa `frame-ancestors 'none'` y `X-Frame-Options: DENY`.

La política del visor permite `data:` y `https:` en `img-src` para los iconos incrustados y remotos. `style-src 'unsafe-inline'` cubre el CSS del visor. No se permiten scripts externos: solo los que llevan el `nonce` de la petición.

## 7. Turnstile opcional

Turnstile está desactivado por defecto. Solo afecta al modo anónimo.

Para activarlo:

1. Crea un widget de Turnstile en Cloudflare.
2. Pon `turnstileEnabled: true` y `turnstileSiteKey` en `app-config`. La clave pública no es un secreto.
3. Define `TURNSTILE_SECRET_KEY` solo en el proyecto de Pages.

Con Turnstile activo, el navegador carga el widget desde `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`. La Function envía el token y la dirección de red a `https://challenges.cloudflare.com/turnstile/v0/siteverify`. Si el token falta o no es válido, la subida responde `403` con `Verificación antiabuso fallida`.

Los contadores de cuota se incrementan antes de verificar Turnstile. Un intento rechazado consume cuota.

Turnstile es un servicio externo. El navegador contacta con Cloudflare y la verificación envía el token y la dirección de red al servicio. Su uso se rige por los términos de Cloudflare; no se redistribuye. Si no puedes aceptar esa dependencia, deja `turnstileEnabled` en `false`: la aplicación no carga el widget ni llama a la verificación. El servicio está documentado en [THIRD_PARTY_LICENSES-es.md](../THIRD_PARTY_LICENSES-es.md).

## 8. Contenido de usuario

Los iconos, adjuntos y enlaces de los mapas pertenecen a sus autores. Este proyecto no los relicencia ni reclama su titularidad.

- El HTML puede incluir iconos y adjuntos como `data:` y reproducir recursos enlazados.
- El ZIP puede descargar recursos remotos y guardarlos en `<mapa>_archivos/`.
- Los derechos de esos recursos siguen siendo de sus autores.
- La licencia MIT se aplica al código del proyecto, no al contenido de usuario.

No publiques mapas con contenido de terceros sin permiso. Los ejemplos y las pruebas usan datos sintéticos. Si un recurso remoto falla, el ZIP se genera igualmente y `faltantes.txt` enumera la dirección y el motivo.

## 9. Aviso MIT

El código se distribuye bajo licencia MIT. El texto está en [LICENSE](../LICENSE) y en [app/LICENSE](../app/LICENSE). `app/LICENSE` se publica con la aplicación estática.

El HTML generado incluye este aviso:

```html
<!-- Copyright (c) 2026 PáginaVIVA. MIT License. -->
```

El ZIP contiene ese HTML, así que el aviso también viaja en la descarga. No elimines `LICENSE`, `app/LICENSE` ni el comentario del HTML al redistribuir el proyecto.

Los materiales de terceros y el contenido de usuario se documentan en [THIRD_PARTY_LICENSES-es.md](../THIRD_PARTY_LICENSES-es.md). La licencia MIT no se aplica a material que no sea titularidad de PáginaVIVA.

## 10. Respuesta ante exposición de credenciales

Si una credencial queda expuesta:

1. No reproduzcas su valor en la respuesta, la incidencia, una captura, un registro ni un commit.
2. Identifica el recurso afectado y su alcance: token de despliegue, secreto interno, secreto administrativo, Turnstile o sesión.
3. Revoca o rota la credencial en su origen.
4. Si es `INTERNAL_SHARED_SECRET`, actualiza Pages y el Worker de conversión. Mientras los valores no coincidan, las subidas responderán `502`.
5. Si son `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT` y `ADMIN_PASSWORD_ITERATIONS`, regenera los tres juntos y vuelve a definirlos en Pages.
6. Si es `TURNSTILE_SECRET_KEY`, rótalo en Cloudflare y en Pages.
7. Si es un token de Cloudflare, revócalo y crea uno nuevo de mínimo privilegio.
8. Si se expuso una cookie o un registro de sesión, borra `session:<identificador>` de `CONFIG_KV`. La cookie anterior dejará de ser válida.
9. Corrige el origen de la exposición. Si el valor estuvo en Git, considéralo comprometido y elimina el valor del historial antes de publicar.
10. Revisa los accesos y los registros sin copiar secretos.
11. Verifica que la credencial anterior ya no funciona y documenta el incidente sin incluir su valor.

No cierres el incidente hasta haber rotado la credencial y comprobado el flujo afectado.

## 11. Lista de comprobación antes de publicar

- [ ] `git status` no muestra `.env`, `credenciales.tsv`, `.dev.vars`, `*.local.*`, `config.local.json`, `config.variables.local.json` ni `wrangler.jsonc`.
- [ ] `desa-temp/` está excluida y no se ha colado ningún archivo suyo.
- [ ] El historial completo se ha analizado y no contiene secretos, datos privados, rutas absolutas ni direcciones del despliegue privado.
- [ ] Las plantillas solo contienen marcadores `{{...}}` o valores públicos seguros.
- [ ] No hay nombres reales de mapas, clientes, grupos, cuentas ni rutas internas.
- [ ] `npm test` termina sin fallos y `node scripts/validate-config.js --config config.local.json --variables config.variables.local.json` devuelve `Configuración válida`.
- [ ] Los dos Workers tienen `workers_dev: false` y `preview_urls: false`.
- [ ] El proyecto de Pages no está conectado a una rama de Git y el despliegue es manual con Wrangler 4.
- [ ] `INTERNAL_SHARED_SECRET` coincide en Pages y en el Worker de conversión.
- [ ] Los tres secretos `ADMIN_PASSWORD_*` son coherentes y usan 5.000 iteraciones, o el valor medido que se haya decidido.
- [ ] Los secretos están definidos en Cloudflare y no en el repositorio, en `app-config` ni en `app-variables`.
- [ ] La cookie `__Host-mmup_session` se ha observado sobre HTTPS con `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` y sin `Domain`.
- [ ] `/api/logout` responde `200` en modo anónimo y borra la cookie.
- [ ] `/api/config` en modo catálogo devuelve `rateLimit: null`; en modo anónimo devuelve el objeto `rateLimit`.
- [ ] La ruta del catálogo es `/api/list`; `/api/lista` no es una ruta de API y puede devolver la página estática.
- [ ] La retención se ha probado con una prueba controlada: un objeto caducado responde `404` y se elimina, sin esperar 24 horas reales.
- [ ] Las cabeceras CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` y `X-Frame-Options` se han comprobado en la aplicación y en el visor.
- [ ] La barra de descarga se oculta en el iframe y el ZIP no la contiene.
- [ ] Turnstile está desactivado o, si está activo, se acepta el servicio externo y el secreto solo está en Pages.
- [ ] `LICENSE`, `app/LICENSE`, el aviso MIT del HTML generado y `THIRD_PARTY_LICENSES-es.md` están presentes.
- [ ] El cubo R2 no contiene datos de la instalación privada ni de usuarios reales.
- [ ] No se incluye código de campaña ni `staging/` en la distribución pública.
- [ ] No hay direcciones del despliegue privado en el README, la documentación, la página de presentación ni los ejemplos.

## Documentación relacionada

- [Arquitectura](arquitectura-es.md)
- [Instalación pública](instalacion-publica-es.md)
- [Instalación con inicio de sesión y R2](instalacion-login-r2-es.md)
- [Licencia MIT](../LICENSE)
- [Licencias de terceros](../THIRD_PARTY_LICENSES-es.md)
