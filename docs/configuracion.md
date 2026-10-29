# Configuración

MindMup Conversor guarda la configuración operativa en dos documentos JSON dentro del almacenamiento clave-valor de Cloudflare. La carga no sustituye las claves ausentes por valores por defecto: si falta un binding, una clave o el tipo no coincide, se produce un error explícito que nombra el elemento que falla.

La validación y la carga son manuales. El repositorio no incluye integración continua ni GitHub Actions.

Para el despliegue completo, consulta [instalacion-publica.md](instalacion-publica.md) y [instalacion-login-r2.md](instalacion-login-r2.md).

## 1. Los dos documentos

| Binding | Clave | Plantilla | Contenido |
|---|---|---|---|
| `CONFIG_KV` | `app-config` | [config.example.json](../config.example.json) | Modo, límites, retención, sesión y protección antiabuso. |
| `VARIABLES_KV` | `app-variables` | [config.variables.example.json](../config.variables.example.json) | Rutas internas, códigos HTTP, plantillas de R2, caché del catálogo y CORS del visualizador. |

- Cada documento se guarda como un único valor JSON bajo su clave. No se reparte el documento en varias claves.
- Los nombres `CONFIG_KV` y `VARIABLES_KV` son los bindings que espera `src/shared/config.js`.
- Las claves `app-config` y `app-variables` son fijas. Cambiarlas exige cambiar el código.
- En la variante con inicio de sesión, `CONFIG_KV` también guarda sesiones y contadores. `VARIABLES_KV` solo guarda `app-variables`.
- Los dos documentos son necesarios. Cada ruta carga el que necesita y falla si el suyo no está disponible.

Copia las plantillas a archivos locales ignorados por Git:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
```

`config.local.json` y `config.variables.local.json` están excluidos por `.gitignore`. No los confirmes en Git.

## 2. Esquema de `app-config`

### 2.1. Claves obligatorias

| Clave | Tipo | Valor de referencia | Uso |
|---|---|---|---|
| `schemaVersion` | number | `1` | Entero mayor o igual que 1. |
| `loginEnabled` | boolean | `false` | Decide el modo. Con `true` se activa el acceso; con `false` se usa el modo anónimo. |
| `catalogEnabled` | boolean | `false` | Solo controla `/api/list` y la vista de catálogo. Requiere `loginEnabled: true`. No activa el acceso por sí solo. |
| `loginUser` | string | `{{LOGIN_USER}}` | Usuario exacto del formulario. Puede quedar vacío con el acceso desactivado; con acceso activo debe ser una cadena no vacía. |
| `sessionTtlMinutes` | number | `1440` | Vigencia de la sesión en minutos. |
| `anonymousRetentionHours` | number | `24` | Retención anónima en horas. Se ancla al JSON temporal de salida `temp/{uuid}/output.json`, no al instante exacto de la subida. |
| `maxUploadBytes` | number | `16777216` | Tamaño máximo de subida: 16 MB. |
| `minUploadBytes` | number | `1024` | Tamaño mínimo de subida: 1 KB. |
| `rateLimit` | object | Ver la tabla siguiente | Límites por dirección de red en modo anónimo. |
| `loginMaxAttempts` | number | `5` | Intentos de acceso permitidos por ventana. |
| `loginWindowSeconds` | number | `600` | Ventana de intentos de acceso en segundos. |
| `allowedOrigins` | array | `[]` | Sin uso en el código actual. Los orígenes del visualizador se configuran en `app-variables.visualizer.allowedOrigins`. |
| `configCacheSeconds` | number | `60` | Presente en el esquema. El código actual no la lee. |
| `conversionTimeoutSeconds` | number | `120` | Tiempo de vida de la clave de conversión activa y valor de `Retry-After`. No aborta la conversión. |
| `htmlCacheSeconds` | number | `0` | Presente en el esquema. El código actual no la lee; el HTML se sirve con `Cache-Control: private, no-store`. |

### 2.2. Claves opcionales

| Clave | Tipo | Valor de referencia | Uso |
|---|---|---|---|
| `turnstileEnabled` | boolean | `false` | Activa la verificación antiabuso. Si falta, se considera desactivada. |
| `turnstileSiteKey` | string | `{{TURNSTILE_SITE_KEY}}` | Clave pública del widget de Turnstile. No es un secreto. Solo se envía al cliente si `turnstileEnabled` es `true`. |

### 2.3. `rateLimit`

| Clave | Valor de referencia | Efecto |
|---|---|---|
| `windowSeconds` | `600` | Ventana de 10 minutos para el contador de subidas. |
| `maxRequestsPerWindow` | `2` | Subidas permitidas por ventana en modo anónimo. |
| `maxRequestsPerDay` | `10` | Subidas permitidas por día en modo anónimo. |
| `maxConcurrent` | `1` | No se aplica. La concurrencia se aproxima con una clave activa por dirección de red. |
| `appliesToAuthenticated` | `false` | No se lee. Los límites solo se aplican en modo anónimo. |

Matices de comportamiento:

- Los contadores se incrementan antes de validar el archivo, el tipo de contenido o Turnstile. Los intentos inválidos consumen cuota.
- `/api/config` devuelve `rateLimit: null` en modo catálogo. Los límites por dirección de red no se exponen en esa respuesta.
- `maxConcurrent` no se aplica. La concurrencia se aproxima con una clave activa por dirección de red.
- `conversionTimeoutSeconds` no aborta la conversión. Se usa como tiempo de vida de la clave activa y como valor de `Retry-After`.
- La ruta del catálogo es `/api/list`. `/api/lista` no es una ruta de API; puede devolver la página estática.

### 2.4. Modos

| `loginEnabled` | `catalogEnabled` | Modo | `/api/list` |
|---|---|---|---|
| `false` | `false` | Anónimo, sin catálogo. | `404` |
| `true` | `false` | Con acceso, sin catálogo. | `404` |
| `true` | `true` | Con acceso y catálogo. | `401` sin sesión y `200` con sesión. |
| `false` | `true` | Anónimo. `catalogEnabled` no activa el acceso. | `404` |

`loginEnabled` decide el modo general. `catalogEnabled` solo controla el catálogo y `/api/list`; no activa ni desactiva el inicio de sesión, las subidas, el estado, la vista HTML ni las descargas.

El catálogo requiere `loginEnabled: true` y `catalogEnabled: true`. Con el catálogo activo, `/api/list` responde `401` sin sesión válida; con el catálogo desactivado, responde `404`.

### 2.5. Comprobaciones del validador

`validateConfig` comprueba que el documento sea un objeto JSON, que `schemaVersion` sea un entero mayor o igual que 1 y que las 15 claves obligatorias existan con el tipo declarado. Las claves `turnstileEnabled` y `turnstileSiteKey` son opcionales, pero si aparecen deben tener el tipo correcto.

El validador no comprueba rangos numéricos, salvo el entero de `schemaVersion`, ni las claves internas de `rateLimit`. En ejecución, `loginMaxAttempts` y `loginWindowSeconds` deben ser enteros positivos, y `sessionTtlMinutes` debe producir una duración de al menos un segundo; de lo contrario, `/api/login` responde `500 Configuración no disponible`.

Las claves `allowedOrigins`, `configCacheSeconds` y `htmlCacheSeconds` son obligatorias aunque el código actual no las lea. No las elimines: el validador las exige.

## 3. Esquema de `app-variables`

El documento tiene `schemaVersion` en la raíz y dos secciones obligatorias: `converter` y `visualizer`. `schemaVersion` debe ser un entero mayor o igual que 1. Las dos secciones deben ser objetos JSON.

```json
{
  "schemaVersion": 1,
  "converter": {},
  "visualizer": {}
}
```

### 3.1. Sección `converter`

| Clave | Tipo | Valor de referencia | Uso |
|---|---|---|---|
| `API_PATH_CONVERT` | string | `/convertir` | Ruta interna de conversión del Worker. |
| `API_PATH_STATUS` | string | `/status` | Ruta interna de estado. |
| `API_PATH_DOWNLOAD` | string | `/download` | Ruta interna de descarga del JSON. |
| `DO_BINDING_NAME` | string | `MMUP_CONVERT_DO` | Binding del Durable Object de conversión. |
| `BINDING_R2` | string | `MMUP_BUCKET` | Binding del cubo R2. |
| `R2_INPUT_PATH_TEMPLATE` | string | `input/{uuid}.mup` | Original en modo catálogo. |
| `R2_OUTPUT_PATH_TEMPLATE` | string | `output/{uuid}.json` | Resultado publicado en el catálogo. |
| `R2_TEMP_INPUT_PATH_TEMPLATE` | string | `temp/{uuid}.mup` | Original en modo anónimo. |
| `R2_TEMP_OUTPUT_PATH_TEMPLATE` | string | `temp/{uuid}/output.json` | Salida temporal anónima. |
| `UPLOAD_TIMEOUT_SECONDS` | number | `30` | Tiempo máximo de la subida al Worker. |
| `HTTP_OK` | number | `200` | Código de respuesta correcta. |
| `HTTP_ACCEPTED` | number | `202` | Código de conversión aceptada. |
| `HTTP_BAD_REQUEST` | number | `400` | Código de solicitud no válida. |
| `HTTP_NOT_FOUND` | number | `404` | Código de recurso no encontrado. |
| `HTTP_PAYLOAD_TOO_LARGE` | number | `413` | Código de archivo demasiado grande. |
| `HTTP_INTERNAL_ERROR` | number | `500` | Código de error interno. |
| `MUP_FORMAT_VERSION` | number | `3` | Versión de formato aceptada. |
| `MUP_KEY_IDEAS` | string | `ideas` | Clave del árbol de nodos. |
| `DEFAULT_STICKER_CATEGORY` | string | `unknown` | Categoría por defecto de las pegatinas. |
| `DEFAULT_REF_TYPE` | string | `web_page` | Tipo por defecto de las referencias externas. |
| `DEFAULT_LINK_RESOLUTION` | string | `unresolved` | Estado por defecto de los enlaces internos. |
| `URL_REGEX_PATTERN` | string | Patrón de la plantilla | Expresión regular para detectar direcciones externas. |
| `WORKER_URL` | string | `""` | Origen para construir la URL de descarga. Vacío usa el origen de la petición. |

Valor de referencia de `URL_REGEX_PATTERN`:

```json
{
  "URL_REGEX_PATTERN": "(https?:\\/\\/[^\\s]+|www\\.[^\\s]+)"
}
```

### 3.2. Sección `visualizer`

| Clave | Tipo | Valor de referencia | Uso |
|---|---|---|---|
| `allowedOrigins` | array de cadenas | `[]` | Orígenes permitidos para CORS del visualizador. |
| `outputPrefix` | string | `output/` | Prefijo de los objetos del catálogo en R2. |
| `jsonSuffix` | string | `.json` | Sufijo de los objetos del catálogo. |
| `listCacheSeconds` | number | `60` | `Cache-Control: private, max-age=...` de `/api/list`. |
| `corsMaxAgeSeconds` | number | `86400` | `Access-Control-Max-Age` de las respuestas CORS. |
| `durableObjectBinding` | string | `MMUP_VISOR_DO` | Binding del Durable Object de visualización. |

No cambies `outputPrefix` ni `jsonSuffix` sin adaptar el catálogo y las descargas. `BINDING_R2` y `durableObjectBinding` deben coincidir con los bindings del entorno; `DO_BINDING_NAME` admite el valor heredado `MMUP_CONVERT_DO` como respaldo.

En ejecución, `loadVariables` devuelve `{ schemaVersion, ...converter, visualizer }`. El código del conversor lee las claves del convertidor en el nivel superior y el visualizador lee `variables.visualizer`.

## 4. Plantillas

- [config.example.json](../config.example.json) es un documento completo de `app-config`.
- [config.variables.example.json](../config.variables.example.json) es un documento completo de `app-variables`.
- `config.variables.example.json` no contiene placeholders. Sus valores son rutas, códigos y nombres de binding internos.
- `config.example.json` contiene dos placeholders que debes sustituir antes de cargar el documento.

| Placeholder | Documento | Uso |
|---|---|---|
| `{{LOGIN_USER}}` | `app-config` | Usuario del formulario de acceso. |
| `{{TURNSTILE_SITE_KEY}}` | `app-config` | Clave pública del widget de Turnstile. |

El validador acepta los placeholders porque son cadenas y no los detecta. Sustitúyelos antes de usar el documento en un despliegue real.

### 4.1. Secretos fuera de estos documentos

`app-config` y `app-variables` no contienen secretos. Los secretos se definen en el Worker o en el proyecto de Pages:

| Secreto | Destino | Uso |
|---|---|---|
| `INTERNAL_SHARED_SECRET` | Worker de conversión y Pages | Autentica las llamadas de Pages al Worker. |
| `ADMIN_PASSWORD_HASH` | Pages | Hash de la contraseña de acceso. |
| `ADMIN_PASSWORD_SALT` | Pages | Sal del hash. |
| `ADMIN_PASSWORD_ITERATIONS` | Pages | Número de iteraciones de PBKDF2. |
| `TURNSTILE_SECRET_KEY` | Pages | Verificación de Turnstile. Opcional. |

La distribución usa PBKDF2 con **5.000 iteraciones** como valor de referencia. Genera los secretos con el indicador explícito:

```bash
node scripts/generate-secrets.js --iterations 5000
```

`turnstileSiteKey` es una clave pública y sí pertenece a `app-config`. `TURNSTILE_SECRET_KEY` es un secreto y no se guarda en ninguno de los dos documentos.

## 5. Validación con `node scripts/validate-config.js`

Valida los dos documentos antes de cargarlos:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

Si omites las opciones, el script usa `config.local.json` y `config.variables.local.json`:

```bash
node scripts/validate-config.js
```

La ayuda está disponible con:

```bash
node scripts/validate-config.js --help
```

Con las plantillas, la salida es:

```text
Configuración válida: 23 claves del convertidor y 6 claves del visualizador.
```

- El código de salida es 0 si los dos documentos son válidos.
- El código de salida es 1 si falta un archivo, no se puede leer, no contiene JSON válido o incumple el esquema.
- El script solo lee archivos. No escribe, no carga y no modifica el almacenamiento clave-valor.

La validación es manual.

## 6. Carga en el almacenamiento clave-valor con `--remote`

Cada documento se guarda como un único valor JSON bajo su clave. `--remote` escribe en el espacio real; sin ese indicador, Wrangler usa el almacenamiento local de desarrollo.

```bash
npx -y wrangler@4 kv key put app-config "$(cat config.local.json)" \
  --namespace-id {{KV_CONFIG_ID}} --remote

npx -y wrangler@4 kv key put app-variables "$(cat config.variables.local.json)" \
  --namespace-id {{KV_VARIABLES_ID}} --remote
```

- `{{KV_CONFIG_ID}}` y `{{KV_VARIABLES_ID}}` son los identificadores que devuelve `kv namespace create`, no los nombres de los espacios.
- Las claves deben ser exactamente `app-config` y `app-variables`.
- Carga los dos documentos. Las rutas que usan cada uno fallan si falta el suyo.
- Valida los archivos antes de cargarlos. Cargar no valida el documento: la comprobación la hace `validate-config.js` o, en ejecución, `loadConfig` y `loadVariables`.
- Si cambias un documento, vuelve a cargarlo con `--remote`.

## 7. Caché de configuración y propagación

No hay una caché en memoria de `app-config` o `app-variables`. `loadConfig` y `loadVariables` leen el espacio clave-valor en cada petición que los necesita.

| Respuesta | Cabecera | Origen |
|---|---|---|
| `/api/config` | `public, max-age=60` | Fijada en el código. No usa `configCacheSeconds`. |
| `/api/list` | `private, max-age=<listCacheSeconds>` | `app-variables.visualizer.listCacheSeconds`. |
| `/api/session`, `/api/upload`, `/api/status/{uuid}`, `/html/{uuid}`, `/api/download/{uuid}`, `/api/download-html/{uuid}` | `no-store` o `private, no-store` | Datos de sesión o resultados. |

- `/api/config` lee el documento en cada petición, pero la respuesta puede servirse desde la caché del navegador o de un intermediario durante 60 segundos. Un cambio en `app-config` no se refleja necesariamente al instante.
- `/api/list` puede servirse desde la caché privada del navegador durante `listCacheSeconds`.
- El almacenamiento clave-valor no garantiza una lectura inmediata en todas las ubicaciones. Los cambios se propagan con el tiempo; repite la comprobación después de un intervalo.
- `configCacheSeconds` está en el esquema, pero el código actual no la lee. No la uses para calcular el retardo real.
- `htmlCacheSeconds` está en el esquema, pero el código actual no la lee. Las respuestas HTML se sirven con `Cache-Control: private, no-store`.
- La aplicación no ofrece una ruta para invalidar la caché de configuración. Para comprobar un cambio, espera y vuelve a consultar.

## 8. Errores explícitos si falta un binding o una clave

La carga falla con un mensaje que nombra el binding o la clave. Estos son los mensajes de `src/shared/config.js`:

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

- `CONFIG_KV` y `VARIABLES_KV` son los nombres de binding que espera el cargador. Un binding con otro nombre se considera ausente.
- `app-config` y `app-variables` son las claves que espera el cargador. Una clave con otro nombre se considera ausente.
- No hay valores por defecto silenciosos para las claves obligatorias. La ausencia de una clave no se sustituye por un valor interno.
- Las Functions capturan estos errores y responden `500 Configuración no disponible` sin revelar detalles internos. El mensaje concreto no se envía al cliente.
- `/api/session` responde `authenticated: false` si no puede cargar la configuración, en lugar de devolver `500`.

El script de validación usa mensajes equivalentes para los archivos locales:

```text
No se encontró el archivo de configuración "config.local.json".
El archivo de configuración "config.local.json" no contiene JSON válido: ...
No se encontró el archivo de variables "config.variables.local.json".
```

## 9. Variables de campaña: no existen en esta distribución

Esta distribución no incluye el modo campaña:

- No hay claves de campaña en `app-config` ni en `app-variables`.
- No hay rutas `/api/campaign/*`, módulo `campaign.js`, prefijo `staging/` ni cabecera `X-MMUP-Mode: campaign`.
- Los únicos modos son `anonymous` y `catalogue`.
- No añadas claves de campaña a los documentos: el validador no las exige y el código no las lee.

Si un documento o una configuración menciona `staging/` o una ruta de campaña, pertenece a otra distribución y no se debe trasladar a esta.

## 10. Lista de comprobación

- [ ] `config.local.json` y `config.variables.local.json` existen y están fuera de Git.
- [ ] Los placeholders `{{LOGIN_USER}}` y `{{TURNSTILE_SITE_KEY}}` están sustituidos.
- [ ] `node scripts/validate-config.js` devuelve `Configuración válida`.
- [ ] Los bindings `CONFIG_KV` y `VARIABLES_KV` existen con esos nombres.
- [ ] `app-config` y `app-variables` están cargados con `--remote`.
- [ ] `loginEnabled` y `catalogEnabled` coinciden con el modo que quieres operar.
- [ ] No hay secretos en `app-config` ni en `app-variables`.
- [ ] `/api/config` refleja el modo después de la ventana de caché de 60 segundos.
