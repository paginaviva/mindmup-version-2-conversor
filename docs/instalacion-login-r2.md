# Instalación de la variante con inicio de sesión y R2

Esta guía describe cómo instalar la variante con inicio de sesión, catálogo y descarga de JSON en una cuenta propia de Cloudflare. Es una variante distribuible: no se despliega en la cuenta pública y no comparte recursos con otras instalaciones.

Los valores entre `{{...}}` son marcadores que debes sustituir por los de tu entorno. No copies secretos ni identificadores reales en el repositorio.

## 1. Alcance

La variante incluye:

- Inicio de sesión con usuario y contraseña.
- Sesiones almacenadas en el servidor.
- Catálogo de resultados en R2.
- Descarga de JSON y de HTML.
- Límites de uso y retención configurables.
- Despliegue manual con Wrangler 4.

No incluye usuarios, sesiones, credenciales, mapas ni datos de la instalación original. El catálogo queda vacío por defecto.

Requisitos:

- Node.js 22 o superior.
- Una cuenta de Cloudflare con Pages, Workers, R2 y almacenamiento clave-valor.
- Wrangler 4, sin instalación global: `npx -y wrangler@4`.
- Una dirección HTTPS para el proyecto de Pages. La cookie `__Host-` exige HTTPS.
- Ninguna integración continua ni GitHub Actions. Cada despliegue es manual.

## 2. Arquitectura

```text
Navegador
   │
   ▼
Cloudflare Pages: aplicación estática + Functions
   │  service binding CONVERTER
   ├──────────────► Worker de conversión ──► R2
   │                    Durable Object MupConverter
   │  service binding VISUALIZER
   └──────────────► Worker de visualización ──► R2
                        Durable Object MupVisualizer

Functions ──► CONFIG_KV (app-config, sesiones y contadores)
Functions ──► VARIABLES_KV (app-variables)
```

- Pages sirve la interfaz y las Functions. Es el único punto de entrada público.
- Las Functions validan la petición, aplican la autorización y llaman a los Workers mediante service bindings.
- Los Workers son internos: `workers_dev: false` y `preview_urls: false`. No tienen URL pública ni dominio propio.
- R2 guarda los originales, los resultados del catálogo y los objetos temporales.
- `CONFIG_KV` guarda `app-config`, las sesiones, los intentos de acceso y los contadores de límites.
- `VARIABLES_KV` guarda `app-variables`.
- Los Durable Objects ejecutan la conversión y la visualización con estado aislado por identificador. Ambos usan almacenamiento SQLite.
- `/api/list` y `/api/download/{uuid}` leen R2 directamente. El resto de rutas protegidas usan las Functions y los service bindings.

### Rutas principales

| Ruta | Método | Comportamiento |
|---|---|---|
| `/api/login` | `POST` | Verifica las credenciales y crea la sesión |
| `/api/logout` | `POST` | Borra la sesión y la cookie |
| `/api/config` | `GET` | Devuelve el modo y los límites públicos |
| `/api/session` | `GET` | Indica si la sesión es válida |
| `/api/upload` | `POST` | Exige sesión y llama al Worker de conversión |
| `/api/status/{uuid}` | `GET` | Exige sesión y consulta el estado |
| `/api/list` | `GET` | Exige sesión y catálogo activo |
| `/api/download/{uuid}` | `GET` | Exige sesión y descarga el JSON |
| `/html/{uuid}` | `GET` | Exige sesión y sirve el HTML |
| `/api/download-html/{uuid}` | `GET` | Exige sesión y sirve el ZIP del HTML |

La ruta del catálogo es `/api/list`. `/api/lista` no es una ruta de API; una petición a esa dirección puede devolver la página estática con `200`.

## 3. Recursos que debe crear cada instalador

Cada instalador crea sus propios recursos. No compartas el cubo, los espacios de almacenamiento, los Workers, el proyecto de Pages ni los secretos con otra instalación.

| Recurso | Nombre o binding | Uso |
|---|---|---|
| Cubo R2 | `{{NOMBRE_CUBO_R2}}` | Originales, resultados y objetos temporales |
| Almacenamiento de configuración | `CONFIG_KV` | `app-config`, sesiones y contadores |
| Almacenamiento de variables | `VARIABLES_KV` | `app-variables` |
| Worker de conversión | `{{NOMBRE_WORKER_CONVERSOR}}` | Conversión y Durable Object `MupConverter` |
| Worker de visualización | `{{NOMBRE_WORKER_VISUALIZADOR}}` | HTML y Durable Object `MupVisualizer` |
| Proyecto de Pages | `{{PAGES_PROJECT}}` | Interfaz estática y Functions |
| Service binding | `CONVERTER` | Une Pages con el Worker de conversión |
| Service binding | `VISUALIZER` | Une Pages con el Worker de visualización |
| Secreto | `INTERNAL_SHARED_SECRET` | Autentica Pages ante el Worker de conversión |
| Secretos | `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_ITERATIONS` | Verifican la contraseña |

## 4. Configuración

Copia las plantillas a archivos locales ignorados por Git:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
cp wrangler.converter.example.jsonc wrangler.converter.local.jsonc
cp wrangler.visualizer.example.jsonc wrangler.visualizer.local.jsonc
cp wrangler.pages.example.jsonc wrangler.pages.local.jsonc
```

Sustituye los marcadores de los archivos `*.local.*`. No los confirmes en Git.

### 4.1. Modo y límites

En `config.local.json`, el modo catálogo requiere estos valores:

```json
"loginEnabled": true,
"catalogEnabled": true,
"loginUser": "{{LOGIN_USER}}"
```

`loginEnabled` decide el modo de las rutas. `catalogEnabled` solo controla `/api/list` y la vista de catálogo: si está desactivado, las demás rutas protegidas siguen funcionando con sesión y `/api/list` responde `404`.

Valores de referencia de la plantilla:

| Clave | Valor | Efecto |
|---|---|---|
| `schemaVersion` | `1` | Versión del esquema |
| `loginEnabled` | `true` | Activa el modo con inicio de sesión |
| `catalogEnabled` | `true` | Activa `/api/list` |
| `loginUser` | `{{LOGIN_USER}}` | Usuario exacto del formulario |
| `sessionTtlMinutes` | `1440` | Vigencia de la sesión: 24 horas |
| `anonymousRetentionHours` | `24` | Retención de los objetos temporales |
| `minUploadBytes` | `1024` | Tamaño mínimo: 1 KB |
| `maxUploadBytes` | `16777216` | Tamaño máximo: 16 MB |
| `rateLimit.windowSeconds` | `600` | Ventana de 10 minutos |
| `rateLimit.maxRequestsPerWindow` | `2` | Subidas por ventana en modo anónimo |
| `rateLimit.maxRequestsPerDay` | `10` | Subidas por día en modo anónimo |
| `rateLimit.maxConcurrent` | `1` | No se aplica; en modo anónimo, la concurrencia se aproxima con una clave activa |
| `rateLimit.appliesToAuthenticated` | `false` | El modo catálogo no aplica `rateLimit` |
| `loginMaxAttempts` | `5` | Intentos de acceso por ventana |
| `loginWindowSeconds` | `600` | Ventana de intentos de acceso |
| `configCacheSeconds` | `60` | Retardo de propagación de cambios en el almacenamiento clave-valor |
| `conversionTimeoutSeconds` | `120` | No aborta la conversión; se usa como vigencia de la clave activa y como `Retry-After` |
| `htmlCacheSeconds` | `0` | Sin caché de HTML |
| `turnstileEnabled` | `false` | Opcional; solo afecta al modo anónimo |

La retención anónima se ancla al JSON temporal de salida, no al instante exacto de la subida. En modo catálogo, `output/` no caduca ni se borra automáticamente.

`conversionTimeoutSeconds` no aborta la conversión. `maxConcurrent` no se aplica. En el modo anónimo, la concurrencia se aproxima con una clave activa por dirección de red.

`app-variables` debe conservar las rutas de la plantilla:

```text
input/{uuid}.mup
output/{uuid}.json
temp/{uuid}.mup
temp/{uuid}/output.json
```

No cambies `outputPrefix` (`output/`) ni `jsonSuffix` (`.json`) sin adaptar el catálogo y las descargas.

### 4.2. Validación

Antes de cargar la configuración:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

La salida debe empezar por `Configuración válida`. Si falta una clave o tiene un tipo incorrecto, el script indica cuál y termina con código 1.

## 5. Autenticación

### 5.1. PBKDF2

La contraseña se deriva con PBKDF2-HMAC-SHA-256, una sal de 16 bytes y una clave derivada de 32 bytes. El valor de referencia de esta distribución es **5.000 iteraciones**.

El valor por defecto de `generate-secrets.js` es 100000. Para esta guía, usa el indicador explícito:

```bash
node scripts/generate-secrets.js --iterations 5000
```

El script imprime una línea por secreto y no escribe archivos:

```text
INTERNAL_SHARED_SECRET=...
ADMIN_PASSWORD_HASH=...
ADMIN_PASSWORD_SALT=...
ADMIN_PASSWORD_ITERATIONS=5000
ADMIN_PASSWORD=...
```

`ADMIN_PASSWORD` solo aparece si no se pasó `--password`; se muestra una vez y debes guardarla fuera del repositorio. `ADMIN_PASSWORD` no se guarda en Cloudflare.

Los tres secretos `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT` y `ADMIN_PASSWORD_ITERATIONS` deben ser coherentes. Si cambias las iteraciones, regenera los tres juntos y mide el coste real antes de fijar otro valor. No cambies solo uno.

### 5.2. Dónde se definen los secretos

En el proyecto de Pages:

```text
ADMIN_PASSWORD_HASH
ADMIN_PASSWORD_SALT
ADMIN_PASSWORD_ITERATIONS
INTERNAL_SHARED_SECRET
```

En el Worker de conversión:

```text
INTERNAL_SHARED_SECRET
```

El valor de `INTERNAL_SHARED_SECRET` debe ser el mismo en Pages y en el Worker de conversión. Los secretos no se declaran en `app-config` ni en `app-variables`.

### 5.3. Cookie y sesión

La cookie se llama `__Host-mmup_session` y se serializa con:

```text
Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<segundos>
```

El prefijo `__Host-` exige `Secure`, `Path=/` y ningún atributo `Domain`. La cookie solo contiene un identificador opaco de 256 bits codificado en Base64URL.

La sesión se guarda en el servidor, en `CONFIG_KV`, con la clave `session:<identificador>`. El registro contiene `user`, `createdAt` y `expiresAt`. Cada ruta protegida vuelve a leer el registro; no se confía en ninguna marca del cliente.

- `/api/session` responde `authenticated: false` si falta la cookie, el registro no existe, es inválido o ha caducado.
- Un registro caducado se elimina al consultarlo.
- `/api/logout` elimina el registro y borra la cookie; responde `200` aunque no hubiera sesión.
- Desactivar `loginEnabled` no invalida proactivamente las sesiones. Se borran cuando se consulta `/api/session` o cuando caducan.

### 5.4. Intentos y mensajes

- Límite de acceso: 5 intentos por dirección de red cada 10 minutos.
- Al superar el límite, `/api/login` responde `429` con `Retry-After` igual a `loginWindowSeconds` (600 por defecto).
- Los intentos con credenciales incorrectas consumen el límite. Un acceso correcto borra el contador.
- Un usuario incorrecto, una contraseña incorrecta y un secreto ausente o mal formado devuelven el mismo mensaje genérico: `Usuario o contraseña incorrectos.`
- Un cuerpo mal formado responde `400` con `Solicitud no válida`.
- Si `loginEnabled` es `false`, `/api/login` responde `404` con `El acceso no está disponible`.

## 6. R2 y catálogo

| Objeto | Contenido | Ciclo de vida |
|---|---|---|
| `input/{uuid}.mup` | Original subido | Se borra al terminar la conversión, con éxito o error |
| `output/{uuid}.json` | JSON-CMJN publicado | No se borra automáticamente |
| `temp/{uuid}.mup` | Original anónimo | Se borra al convertir |
| `temp/{uuid}/output.json` | Salida anónima temporal | Retención de 24 horas y limpieza horaria |

La Function comprueba la fecha antes de servir un objeto temporal y responde `404` si ha caducado, aunque la limpieza física todavía no se haya ejecutado.

- El original se borra al convertir. Lo que no se borra automáticamente es `output/`.
- El HTML no se almacena: se genera a demanda.
- El catálogo lee los objetos de `output/` y muestra título, archivo de origen, fecha de conversión, número de nodos, grupo y versión.
- Las subidas nuevas no tienen metadatos de grupo. El catálogo muestra `Sin grupo` y `group_path` vacío hasta que se asignen metadatos al objeto.
- La versión del conversor es `v7`.
- El catálogo queda vacío por defecto en una instalación nueva.
- La búsqueda, el filtro por grupo y la ordenación se resuelven en el cliente.
- La descarga de JSON exige sesión y solo existe en esta variante.

El catálogo no se rellena con datos de ejemplo. Si necesitas retención para `output/`, gestiónala de forma explícita; no hay borrado automático.

## 7. Instalación y despliegue

### 7.1. Preparar el entorno

Comprueba la autenticación de Wrangler:

```bash
npx -y wrangler@4 whoami
```

Guarda las credenciales y los valores reales fuera del repositorio. La ubicación prevista es:

```text
desa-temp/.env
desa-temp/credenciales.tsv
```

Puedes crear los contenedores a partir de las plantillas:

```bash
mkdir -p desa-temp
cp .env.example desa-temp/.env
cp credenciales.example.tsv desa-temp/credenciales.tsv
```

Rellena `desa-temp/.env` y `desa-temp/credenciales.tsv` con los valores de tu instalación. `desa-temp/` está excluido de Git. `.dev.vars` solo puede contener valores de prueba no sensibles o no existir; nunca guardes secretos reales en `.dev.vars`.

### 7.2. Crear R2 y los dos espacios de almacenamiento

```bash
npx -y wrangler@4 r2 bucket create {{NOMBRE_CUBO_R2}}

npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_CONFIG}}
npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_VARIABLES}}
```

Anota los identificadores que devuelve cada comando y sustitúyelos en:

```text
{{KV_CONFIG_ID}}
{{KV_VARIABLES_ID}}
```

### 7.3. Configurar los Workers

En `wrangler.converter.local.jsonc`, sustituye:

```text
{{NOMBRE_WORKER_CONVERSOR}}
{{NOMBRE_CUBO_R2}}
{{KV_CONFIG_ID}}
{{KV_VARIABLES_ID}}
```

En `wrangler.visualizer.local.jsonc`, sustituye:

```text
{{NOMBRE_WORKER_VISUALIZADOR}}
{{NOMBRE_CUBO_R2}}
{{KV_VARIABLES_ID}}
```

En `wrangler.pages.local.jsonc`, sustituye:

```text
{{PAGES_PROJECT}}
{{NOMBRE_CUBO_R2}}
{{KV_CONFIG_ID}}
{{KV_VARIABLES_ID}}
{{NOMBRE_WORKER_CONVERSOR}}
{{NOMBRE_WORKER_VISUALIZADOR}}
```

Los dos Workers comparten el cubo R2 y el espacio de variables. El Worker de conversión también usa el espacio de configuración.

### 7.4. Migración de los Durable Objects

Cada Worker declara su propio Durable Object y una migración con una etiqueta literal. Sustituye `{{MIGRATION_TAG}}` por un valor fijo, por ejemplo `init`, antes del primer despliegue:

```jsonc
"migrations": [
  {
    "tag": "init",
    "new_sqlite_classes": ["MupConverter"]
  }
]
```

En el Worker de visualización, la clase es `MupVisualizer`:

```jsonc
"migrations": [
  {
    "tag": "init",
    "new_sqlite_classes": ["MupVisualizer"]
  }
]
```

La migración se aplica una sola vez, en el primer despliegue del Worker. No reutilices una etiqueta ya aplicada de otro proyecto: el historial es acumulativo y no se puede volver a aplicar. Si el Worker ya existe con una migración, no copies la etiqueta; revisa su historial y añade una operación nueva solo si corresponde.

### 7.5. Desplegar los Workers

```bash
npx -y wrangler@4 deploy --config wrangler.converter.local.jsonc --keep-vars
npx -y wrangler@4 deploy --config wrangler.visualizer.local.jsonc --keep-vars
```

`--keep-vars` conserva las variables definidas en el panel en despliegues posteriores. Los secretos no se eliminan con el despliegue. El primer despliegue aplica la migración de cada Durable Object.

Comprueba que los Workers no tienen URL pública. Las plantillas ya incluyen `workers_dev: false` y `preview_urls: false`.

### 7.6. Crear el proyecto de Pages

```bash
npx -y wrangler@4 pages project create {{PAGES_PROJECT}} --production-branch main
```

### 7.7. Cargar la configuración en el almacenamiento clave-valor

Cada espacio guarda un único documento JSON. `--remote` escribe en el espacio real; sin ese indicador, Wrangler usa el almacenamiento local de desarrollo.

```bash
npx -y wrangler@4 kv key put app-config "$(cat config.local.json)" \
  --namespace-id {{KV_CONFIG_ID}} --remote

npx -y wrangler@4 kv key put app-variables "$(cat config.variables.local.json)" \
  --namespace-id {{KV_VARIABLES_ID}} --remote
```

Un cambio en el almacenamiento clave-valor puede tardar `configCacheSeconds` en propagarse.

### 7.8. Definir los secretos

Wrangler solicita el valor de forma interactiva. No pases secretos como argumentos del comando.

Worker de conversión:

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

El `INTERNAL_SHARED_SECRET` de Pages y el del Worker de conversión deben ser idénticos. Si activas Turnstile, añade `TURNSTILE_SECRET_KEY` al proyecto de Pages; no es necesario para esta variante.

### 7.9. Desplegar Pages

Para que Wrangler aplique la configuración de Pages, el archivo debe llamarse `wrangler.jsonc`, `wrangler.json` o `wrangler.toml`. Copia la configuración local a `wrangler.jsonc`, que está ignorado por Git:

```bash
cp wrangler.pages.local.jsonc wrangler.jsonc
npx -y wrangler@4 pages deploy --branch main
```

La configuración de Pages incluye:

- `pages_build_output_dir` con `./app`.
- Los espacios `CONFIG_KV` y `VARIABLES_KV`.
- El cubo `MMUP_BUCKET`.
- Los service bindings `CONVERTER` y `VISUALIZER`.

No uses `wrangler.jsonc` para desplegar los Workers; sus configuraciones son `wrangler.converter.local.jsonc` y `wrangler.visualizer.local.jsonc`.

## 8. Verificación

Sustituye `{{URL_PAGES}}` por la dirección HTTPS del proyecto de Pages y `{{UUID}}` por un identificador existente del catálogo. Las comprobaciones deben ejecutarse contra el despliegue real.

### 8.1. Configuración pública

```bash
curl -i "{{URL_PAGES}}/api/config"
```

Debe responder `200` con:

```json
{
  "mode": "catalogue",
  "loginEnabled": true,
  "catalogEnabled": true,
  "rateLimit": null
}
```

En modo catálogo, `rateLimit` es `null`; los límites por dirección de red no se exponen en esta respuesta.

### 8.2. Inicio de sesión y cookie

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

La contraseña generada por `generate-secrets.js` es Base64URL y no necesita escape para este ejemplo. Si usas una contraseña propia con comillas o barras invertidas, debes escaparla en el JSON.

Debe responder `200` con `authenticated: true` y una cabecera `Set-Cookie` con:

```text
__Host-mmup_session=<identificador>; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=<segundos>
```

La cookie no debe tener `Domain`. Comprueba que el navegador o el tarro de cookies la conserva:

```bash
grep '__Host-mmup_session' .tmp/cookies.txt
```

### 8.3. Sesión

```bash
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/session"
```

Debe responder `200` con `authenticated: true` y el usuario configurado. Sin cookie, la misma ruta responde `200` con `authenticated: false`.

### 8.4. Catálogo sin sesión y con sesión

Sin cookie, con `loginEnabled: true` y `catalogEnabled: true`:

```bash
curl -i "{{URL_PAGES}}/api/list"
```

Debe responder `401` con `No autorizado`.

Si cambias `catalogEnabled` a `false`, esperas `configCacheSeconds` y repites la petición, debe responder `404` con `Catálogo no disponible`, incluso sin sesión.

Con la cookie de una sesión válida:

```bash
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/list"
```

Debe responder `200` con `success: true`, `count` e `items`. Un resultado nuevo sin metadatos debe mostrar `group: "Sin grupo"`.

### 8.5. Descarga de JSON

```bash
curl -sS -b .tmp/cookies.txt -D .tmp/download.headers \
  -o .tmp/resultado.json -w '%{http_code}\n' \
  "{{URL_PAGES}}/api/download/{{UUID}}"
```

Debe responder `200`, con `Content-Type: application/json` y un archivo JSON-CMJN. Sin sesión, la misma ruta responde `401`. Si el objeto no existe, responde `404` con `Resultado no encontrado`.

### 8.6. Descarga de HTML

```bash
curl -sS -b .tmp/cookies.txt -o .tmp/mapa.html -w '%{http_code}\n' \
  "{{URL_PAGES}}/html/{{UUID}}"

curl -sS -b .tmp/cookies.txt -o .tmp/mapa.zip -w '%{http_code}\n' \
  "{{URL_PAGES}}/api/download-html/{{UUID}}"

unzip -l .tmp/mapa.zip
```

El HTML debe responder `200` y el ZIP debe contener el HTML y sus recursos. El HTML se genera a demanda; no se sirve desde un objeto almacenado.

### 8.7. Cierre de sesión

```bash
curl -i -b .tmp/cookies.txt -X POST "{{URL_PAGES}}/api/logout"
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/session"
curl -i -b .tmp/cookies.txt "{{URL_PAGES}}/api/list"
```

El cierre debe responder `200` y borrar la cookie. La sesión debe pasar a `authenticated: false` y `/api/list` debe responder `401` con la cookie anterior.

### 8.8. PBKDF2 con 5.000 iteraciones

La generación debe haberse ejecutado con:

```bash
node scripts/generate-secrets.js --iterations 5000
```

La salida debe incluir:

```text
ADMIN_PASSWORD_ITERATIONS=5000
```

Comprueba que los secretos están definidos, sin mostrar sus valores:

```bash
npx -y wrangler@4 pages secret list --project-name {{PAGES_PROJECT}}
```

Deben aparecer `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT`, `ADMIN_PASSWORD_ITERATIONS` e `INTERNAL_SHARED_SECRET`. Un inicio de sesión correcto con la contraseña generada confirma que el hash, la sal y las iteraciones desplegados son coherentes.

## 9. Seguridad

- Límite de acceso: 5 intentos por dirección de red cada 10 minutos. Los intentos con credenciales incorrectas consumen cuota.
- Los intentos inválidos consumen cuota: en el modo anónimo, los contadores de subida se incrementan antes de validar el archivo, Turnstile o el tipo de contenido.
- Los mensajes de acceso son genéricos. No revelan si el fallo fue el usuario, la contraseña o un secreto.
- Los secretos viven solo en Cloudflare y en los contenedores locales autorizados. `.env` y `credenciales.tsv` se guardan en `desa-temp/`, fuera de Git.
- `.dev.vars` solo contiene valores de prueba no sensibles o no existe. Nunca se usa para secretos reales.
- `ADMIN_PASSWORD` solo se usa para generar el hash y no se guarda en Cloudflare. La contraseña generada se muestra una vez.
- La cookie `__Host-` exige HTTPS, `Secure`, `Path=/` y ningún `Domain`. No la uses sobre HTTP.
- Los Workers no tienen URL pública. Las Functions son el único punto de entrada.
- No se usa GitHub Actions ni integración continua. El despliegue es manual con Wrangler 4.
- `conversionTimeoutSeconds` no aborta la conversión. `maxConcurrent` no se aplica; en el modo anónimo, la concurrencia se aproxima con una clave activa.
- Desactivar el inicio de sesión no invalida proactivamente las sesiones. Se borran al consultar `/api/session` o al caducar.
- La retención anónima se ancla al JSON temporal de salida. `output/` no se borra automáticamente.
- No compartas R2, almacenamiento clave-valor, Workers, Pages ni secretos entre instalaciones.

## 10. Resolución de problemas

| Síntoma | Causa probable | Acción |
|---|---|---|
| `/api/config` responde `500` con `Configuración no disponible` | Falta `CONFIG_KV`, falta `app-config` o el documento no es válido | Revisa el binding, ejecuta `validate-config.js` y vuelve a cargar con `--remote` |
| `/api/login` responde `401` con `Usuario o contraseña incorrectos.` | Usuario distinto de `loginUser`, contraseña incorrecta o secretos incoherentes | Revisa `loginUser`; regenera los tres secretos `ADMIN_*` juntos y vuelve a definirlos en Pages |
| `/api/login` responde `404` con `El acceso no está disponible` | `loginEnabled` es `false` | Activa `loginEnabled` y espera `configCacheSeconds` |
| `/api/login` responde `429` con `Demasiados intentos. Inténtalo de nuevo más tarde.` | Se alcanzaron 5 intentos fallidos en 10 minutos | Espera la ventana de `loginWindowSeconds` |
| `/api/list` responde `401` con `No autorizado` | No hay cookie válida o la sesión caducó | Inicia sesión; comprueba que la cookie `__Host-` se guarda sobre HTTPS |
| `/api/list` responde `404` con `Catálogo no disponible` | `catalogEnabled` es `false` o `loginEnabled` es `false` | Activa ambos valores y espera `configCacheSeconds` |
| `/api/list` responde `500` | Falta un binding, `app-variables` no es válido o R2 no responde | Revisa `CONFIG_KV`, `VARIABLES_KV`, `MMUP_BUCKET` y los documentos |
| `/api/upload` responde `500` con `Servicio de conversión no disponible` o `Configuración no disponible` | Falta `CONVERTER` o `INTERNAL_SHARED_SECRET` en Pages | Revisa el binding y define el secreto en Pages |
| `/api/upload` responde `502` con `No se pudo iniciar la conversión` | El Worker de conversión rechaza la llamada o no responde; suele indicar un `INTERNAL_SHARED_SECRET` distinto | Define el mismo secreto en Pages y en el Worker de conversión |
| `/html/{uuid}` responde `500` con `Visualizador no disponible` o `Configuración no disponible` | Falta `VISUALIZER`, `app-config` o `app-variables` | Revisa el binding y los documentos de configuración |
| `/html/{uuid}` responde `502` con `No se pudo generar la visualización` | Fallo al invocar el Worker de visualización | Revisa el despliegue y el binding `VISUALIZER` |
| `/api/download/{uuid}` responde `404` con `Resultado no encontrado` | No existe `output/{uuid}.json` o `loginEnabled` es `false` | Comprueba el objeto en R2 y el modo de configuración |
| La cookie no aparece en el navegador | Se está usando HTTP o un atributo incompatible con `__Host-` | Usa HTTPS; comprueba `Secure`, `Path=/` y ausencia de `Domain` |
| El despliegue del Worker falla por la migración | La etiqueta ya se aplicó o se reutilizó de otro proyecto | No reapliques la migración; usa una etiqueta nueva solo para una operación nueva |
| El catálogo muestra `Sin grupo` | La subida no tiene metadatos `group` ni `group_path` | Es el comportamiento esperado; asigna metadatos al objeto si necesitas clasificarlo |
| `output/` crece sin límite | No hay borrado automático del catálogo | Define una retención explícita o una política de ciclo de vida en R2 |
| Las sesiones siguen activas tras desactivar el inicio de sesión | El cambio de configuración no borra las sesiones existentes | Se eliminan al consultar `/api/session` o al caducar; no esperes invalidación inmediata |
| Pages no aplica los bindings | Se desplegó solo `app` sin configuración de Pages | Usa `wrangler.jsonc` con `pages_build_output_dir` o configura los bindings en el panel |

## 11. Lista de comprobación

- [ ] Node.js 22 o superior y Wrangler 4 disponibles.
- [ ] Cubo R2 y dos espacios de almacenamiento creados.
- [ ] Identificadores `{{KV_CONFIG_ID}}` y `{{KV_VARIABLES_ID}}` sustituidos en los archivos de configuración que los usan.
- [ ] Etiquetas de migración literales y propias en cada Worker.
- [ ] `config.local.json` con `loginEnabled: true`, `catalogEnabled: true` y `loginUser` definido.
- [ ] `validate-config.js` devuelve `Configuración válida`.
- [ ] `app-config` y `app-variables` cargados con `--remote`.
- [ ] `INTERNAL_SHARED_SECRET` idéntico en Pages y en el Worker de conversión.
- [ ] `ADMIN_PASSWORD_HASH`, `ADMIN_PASSWORD_SALT` y `ADMIN_PASSWORD_ITERATIONS` definidos en Pages con 5.000 iteraciones.
- [ ] Workers desplegados sin URL pública.
- [ ] Pages desplegado con los bindings y las Functions.
- [ ] Inicio de sesión, cookie, sesión y cierre comprobados.
- [ ] `/api/list` responde `401` sin sesión, `200` con sesión y `404` con el catálogo desactivado.
- [ ] Descarga de JSON y descarga de HTML comprobadas.
- [ ] `pages secret list` muestra los cuatro secretos.
- [ ] Ningún archivo `.env`, `credenciales.tsv`, `.dev.vars`, `*.local.*` ni `wrangler.jsonc` está en Git.
- [ ] No hay flujos de GitHub Actions ni integración continua.
