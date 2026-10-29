# Arquitectura

MindMup Conversor convierte mapas MindMup versión 3 (`.mup`) en JSON-CMJN normalizado de 10 colecciones y en HTML autocontenido. La misma base de código se usa en tres formas: la variante pública sin inicio de sesión, la variante con inicio de sesión y R2, y el conversor local.

Esta página describe los componentes, los flujos, las rutas y las decisiones que explican el comportamiento observable. Las medidas de protección se detallan en [Seguridad](seguridad.md).

## 1. Componentes

```text
Navegador
   │
   ▼
Cloudflare Pages: app/ + functions/
   │  service binding CONVERTER; secreto interno
   ├──────────────► Worker de conversión ──► R2
   │                    Durable Object MupConverter
   │  service binding VISUALIZER
   └──────────────► Worker de visualización ──► R2
                        Durable Object MupVisualizer

Functions ──► CONFIG_KV (app-config, sesiones y contadores)
Functions ──► VARIABLES_KV (app-variables)
```

| Componente | Función |
|---|---|
| Cloudflare Pages | Sirve la interfaz estática de `app/` y las Functions de `functions/`. Es el único punto de entrada público. |
| Functions | Validan las peticiones, aplican la autorización y los límites, comprueban la retención y llaman a los Workers mediante service bindings. |
| Worker de conversión | Recibe el `.mup`, lo guarda en R2, ejecuta las ocho capas de conversión en un Durable Object y escribe el JSON-CMJN. |
| Worker de visualización | Carga el JSON-CMJN de R2, ejecuta las seis capas de visualización en un Durable Object y devuelve el HTML autocontenido. |
| R2 | Guarda los originales temporales, los JSON temporales y los resultados publicados. El binding es `MMUP_BUCKET`. |
| Almacenamiento clave-valor | `CONFIG_KV` guarda `app-config`, las sesiones y los contadores. `VARIABLES_KV` guarda `app-variables`. |
| Durable Objects | `MupConverter` y `MupVisualizer` aportan estado aislado por identificador y usan almacenamiento SQLite. |
| Service bindings | `CONVERTER` une Pages con el Worker de conversión. `VISUALIZER` une Pages con el Worker de visualización. |
| Secreto interno | `INTERNAL_SHARED_SECRET` autentica las llamadas de Pages al Worker de conversión. |

Los dos Workers son internos: se configuran con `workers_dev: false` y `preview_urls: false`. No tienen dirección pública ni dominio propio. Pages es el único punto de entrada y las Functions son las que aplican los límites y la autorización.

La interfaz estática declara sus rutas en `app/_routes.json`: las peticiones a `/api/*` y `/html/*` pasan por Functions; el resto se sirve como contenido estático. Las cabeceras de seguridad de la aplicación están en `app/_headers`.

Cada instalación crea sus propios recursos. No se comparten el cubo R2, los espacios de almacenamiento clave-valor, los Workers, el proyecto de Pages ni los secretos entre instalaciones.

## 2. Modos de funcionamiento

`loginEnabled` decide el modo general. `catalogEnabled` solo controla el catálogo y la ruta `/api/list`; no activa ni desactiva el inicio de sesión, las subidas, el estado, la vista HTML ni las descargas.

| `loginEnabled` | `catalogEnabled` | Modo | Catálogo | Salida pública |
|---|---|---|---|---|
| `false` | `false` | Anónimo | No | Solo HTML temporal |
| `false` | `true` | Anónimo | No; el catálogo queda desactivado | Solo HTML temporal |
| `true` | `true` | Catálogo | Sí, con sesión | JSON, HTML y ZIP con sesión |
| `true` | `false` | Catálogo sin catálogo | No; `/api/list` responde `404` | JSON, HTML y ZIP con sesión |

Con `loginEnabled: false`, `/api/config` devuelve `mode: "anonymous"`, `loginEnabled: false` y `catalogEnabled: false`, aunque `app-config` tenga `catalogEnabled: true`. La aplicación no muestra el formulario de acceso ni la vista de catálogo.

Con `loginEnabled: true`, `/api/config` devuelve `mode: "catalogue"` y `rateLimit: null`. Los límites por dirección de red de las subidas anónimas no se exponen en esa respuesta. El límite de intentos de acceso sigue aplicándose en `/api/login`.

Si `catalogEnabled` es `false` con `loginEnabled: true`, las rutas de subida, estado, HTML y descargas siguen funcionando con una sesión válida. Solo `/api/list` responde `404` y la interfaz oculta la vista de catálogo.

Desactivar `loginEnabled` no invalida proactivamente las sesiones existentes. Se borran cuando se consulta `/api/session` o cuando caducan.

Las subidas nuevas no reciben automáticamente un grupo en esta distribución. El catálogo muestra `Sin grupo` y `group_path` vacío hasta que se asignen metadatos al objeto.

## 3. Flujo de una conversión pública

1. El navegador carga la aplicación. La interfaz consulta `GET /api/config` y recibe `mode: "anonymous"`. Si se consulta `GET /api/session`, responde `authenticated: false`; la interfaz no muestra acceso ni catálogo.
2. La persona selecciona un archivo `.mup` y lo envía a `POST /api/upload` como `multipart/form-data`.
3. La Function carga `app-config` y aplica los límites anónimos: clave activa, ventana de subidas y contador diario. Los contadores se incrementan antes de validar el archivo.
4. La Function valida el tipo de contenido, el tamaño declarado, el formulario, Turnstile si está activo, la extensión, el tamaño real y el JSON del `.mup`.
5. La Function envía el archivo al Worker de conversión mediante el service binding `CONVERTER`, con `Authorization: Bearer <INTERNAL_SHARED_SECRET>` y `X-MMUP-Mode: anonymous`. El Worker vuelve a validar la petición.
6. El Worker genera un identificador, guarda el original en `temp/{uuid}.mup`, despierta el Durable Object con `idFromName(uuid)` y responde `202`.
7. El Durable Object ejecuta las ocho capas, escribe `temp/{uuid}/output.json` y elimina el original en el bloque `finally`. El estado se guarda en el almacenamiento SQLite del Durable Object.
8. La interfaz consulta `GET /api/status/{uuid}`. La Function llama al Worker de conversión y este consulta el estado al Durable Object.
9. `GET /html/{uuid}` comprueba la retención contra `temp/{uuid}/output.json`. Si el objeto no existe o ha caducado, responde `404` con `Mapa no encontrado`; si ha caducado, lo elimina. Si es válido, llama al Worker de visualización y devuelve el HTML con la barra de descarga inyectada.
10. `GET /api/download-html/{uuid}` vuelve a generar el HTML y construye un ZIP con el HTML limpio, los recursos disponibles y, si procede, `faltantes.txt`. `GET /api/download/{uuid}` responde `404`: la variante pública no expone JSON.

La respuesta de `POST /api/upload` incluye `uuid`, `mode: "anonymous"`, `statusUrl`, `htmlUrl`, `htmlDownloadUrl`, `expiresAt` y `downloadUrl: null`. El campo `expiresAt` es una estimación calculada al responder a la subida; la comprobación real usa la fecha del objeto temporal de salida.

## 4. Flujo de una conversión con catálogo

1. La persona envía usuario y contraseña a `POST /api/login`. La Function verifica el usuario configurado y el hash PBKDF2, crea una sesión en `CONFIG_KV` y devuelve la cookie `__Host-mmup_session`.
2. La interfaz consulta `GET /api/config` y `GET /api/session`. El modo es `catalogue` y la sesión indica si es válida.
3. `POST /api/upload` exige una sesión válida. La Function llama al Worker de conversión con `X-MMUP-Mode: catalogue`.
4. El Worker guarda el original en `input/{uuid}.mup` y despierta el Durable Object. El Durable Object escribe `output/{uuid}.json` y elimina el original. El objeto de salida guarda `version: v7` en los metadatos personalizados de R2.
5. La interfaz consulta el estado con `GET /api/status/{uuid}`. La vista HTML y las descargas exigen sesión.
6. `GET /api/list` exige `loginEnabled: true` y `catalogEnabled: true`, además de una sesión válida. Lee R2 directamente, pagina de 1000 en 1000, lee cada JSON y construye el listado con título, archivo de origen, fecha, número de nodos, grupo y versión. Ordena por fecha de conversión descendente.
7. `GET /api/download/{uuid}` también lee R2 directamente. Obtiene `output/{uuid}.json` y usa `metadata.source_file` para el nombre de descarga. No exige `catalogEnabled`.
8. `GET /api/download-html/{uuid}` genera el HTML y el ZIP con sesión. El HTML no se guarda como objeto.
9. Si `catalogEnabled` es `false`, `/api/list` responde `404` y la vista de catálogo se oculta. Las demás rutas protegidas siguen funcionando con sesión. `output/` no se borra automáticamente.

Los objetos nuevos muestran `group: "Sin grupo"` y `group_path: ""` hasta que se asignen metadatos personalizados. La distribución pública no incluye una asignación automática de grupo.

## 5. Rutas y responsabilidades

### Rutas públicas

| Ruta | Método | Responsabilidad | Respuestas principales |
|---|---|---|---|
| `/api/config` | `GET` | Modo, tamaños, retención, límites anónimos y Turnstile público | `200`; `500` si la configuración no es válida |
| `/api/session` | `GET` | Estado de la sesión en el servidor | `200` con `authenticated: true` o `false` |
| `/api/login` | `POST` | Verifica credenciales y crea la sesión | `200` con cookie; `400`; `401` genérico; `404` si el acceso está desactivado; `429`; `500` |
| `/api/logout` | `POST` | Borra la sesión y la cookie | `200`, también en modo anónimo |
| `/api/upload` | `POST` | Valida el `.mup` y llama al Worker de conversión | `202`; `400`; `401` en catálogo sin sesión; `403` por Turnstile; `413`; `429`; `500`; `502` |
| `/api/status/{uuid}` | `GET` | Consulta el estado de la conversión | `200`; `400`; `401` en catálogo sin sesión; `500`; `502` |
| `/api/list` | `GET` | Lista el catálogo | `200` con sesión; `401` sin sesión; `404` en anónimo o con catálogo desactivado; `500` |
| `/api/download/{uuid}` | `GET` | Descarga el JSON del catálogo | `200`; `400`; `401` sin sesión; `404` en anónimo o si no existe; `500` |
| `/html/{uuid}` | `GET` | Genera y sirve la vista HTML | `200`; `400`; `401` en catálogo sin sesión; `404` si falta o caducó; `500`; `502` |
| `/api/download-html/{uuid}` | `GET` | Genera el ZIP del HTML | `200`; `400`; `401`; `404`; `413` si el HTML supera 30 MB; `500`; `502` |

La ruta del catálogo es `/api/list`. `/api/lista` no es una ruta de API; una petición a esa dirección puede devolver la página estática con `200`.

`/api/config` se envía con `Cache-Control: public, max-age=60`. Un cambio en `app-config` puede tardar hasta ese intervalo en verse en la interfaz. En modo catálogo, `rateLimit` es `null`.

El identificador de las rutas acepta de 1 a 200 caracteres de `[A-Za-z0-9._-]` y rechaza los valores formados solo por puntos. No exige UUID versión 4. Los identificadores que genera el conversor sí son UUID versión 4, pero las rutas aceptan otros identificadores válidos para conservar compatibilidad.

`/api/list` y `/api/download/{uuid}` leen R2 directamente. Las rutas de conversión, estado y HTML usan las Functions y los service bindings. `/api/download/{uuid}` no exige `catalogEnabled`; solo exige modo catálogo y sesión.

### Rutas internas

| Componente | Ruta | Uso |
|---|---|---|
| Worker de conversión | `POST /convertir` | Recibe el `.mup`, lo guarda y despierta el Durable Object. Exige `Authorization: Bearer <INTERNAL_SHARED_SECRET>` |
| Worker de conversión | `GET /status/{uuid}` | Consulta el estado al Durable Object |
| Worker de conversión | `GET /download/{uuid}` | Descarga el JSON de `output/`; no se usa en modo anónimo |
| Durable Object `MupConverter` | `POST /convertir` | Inicia la conversión en segundo plano |
| Durable Object `MupConverter` | `GET /status` | Devuelve el estado guardado |
| Worker de visualización | `GET /visor/api/lista` | Lista interna del visualizador; no es la ruta del catálogo público |
| Worker de visualización | `GET /visor/mmup-output/{uuid}` | Genera el HTML de un identificador |
| Durable Object `MupVisualizer` | `GET /convert/{uuid}` | Ejecuta las seis capas y devuelve el HTML |

El Worker de conversión también declara una tarea programada con la expresión `0 * * * *` para limpiar objetos temporales caducados.

## 6. Estructura del JSON-CMJN

El resultado tiene 10 colecciones. `metadata` es un objeto; las otras nueve son arrays.

| Colección | Tipo | Campos principales |
|---|---|---|
| `metadata` | Objeto | `map_id`, `title`, `format_version`, `source_file`, `converted_at`, `node_count`; opcionales `author`, `created_at`, `updated_at`, `theme`, `themeOverrides` |
| `nodes` | Array | `node_id`, `map_id`, `parent_id`, `sort_key`, `title`, `depth`, `sibling_order`, `path`, `original_id`, `is_leaf` |
| `notes` | Array | `note_id`, `node_id`, `index`, `text`, `char_count`, `truncated` |
| `attributes` | Array | `attr_id`, `node_id`, `attr_type`, `value`; opcional `raw_attributes` |
| `stickers` | Array | `sticker_id`, `node_id`, `emoji_code`, `emoji_display`, `category` |
| `icons` | Array | `icon_id`, `node_id`, `url`, `width`, `height`, `position`, `mime_type`, `base64_length`; opcional `metaData` |
| `links` | Array | `link_id`, `map_id`, `from_node_id`, `to_node_id`; opcionales `color`, `line_style`, `arrow`, `width`, `label`, `resolution` |
| `externalRefs` | Array | `ref_id`, `node_id`, `url`, `ref_type`; opcional `label` |
| `enums` | Array | `enum_id`, `category`, `code`, `label` |
| `indexes` | Array | `index_id`, `name`, `type`, `query`, `description` |

Esqueleto del documento:

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

Los marcadores no son valores reales. `format_version` es 3. `source_file`, `converted_at` y `node_count` se completan durante la conversión. `node_count` coincide con el número de elementos de `nodes`.

- `nodes` se aplana en orden previo en profundidad. `parent_id` es `null` en la raíz; `path` contiene los identificadores desde la raíz hasta el nodo.
- `notes` y `attributes` se relacionan con `nodes` mediante `node_id`. `attributes.raw_attributes` puede contener el adjunto original.
- `icons` admite direcciones `data:` y remotas. `mime_type` y `base64_length` describen el contenido cuando es una dirección `data:`.
- `links` resuelve los enlaces internos del `.mup`. Si un extremo no existe, el campo correspondiente es `null` y se añade `resolution`.
- `externalRefs` contiene las direcciones externas clasificadas. `ref_type` procede del clasificador de direcciones.
- `enums` genera el vocabulario controlado de `sticker_categories`, `attr_types` y `ref_types`.
- `indexes` contiene cuatro consultas base: todos los nodos, nodos raíz, nodos hoja y nodos padre.

La versión del conversor es `v7`. Se guarda en los metadatos personalizados del objeto de R2, no como una clave adicional del JSON. El catálogo la muestra con el valor `v7` cuando el objeto no tiene otro valor.

## 7. Capas del conversor y del visualizador

### Conversor: ocho capas

| Capa | Qué hace |
|---|---|
| 1. Lectura | Interpreta el `.mup`, exige `formatVersion: 3` y un objeto `ideas` no vacío, y extrae los metadatos del mapa. |
| 2. Aplanado | Recorre el árbol en orden previo en profundidad y crea un nodo por idea con `parent_id`, `depth`, `path`, `sibling_order`, `original_id` y `is_leaf`. |
| 3. Notas | Extrae las notas y sus datos asociados. |
| 4. Atributos | Separa estilos, posiciones y atributos del nodo. |
| 5. Pegatinas | Convierte los códigos de emoji en entradas de `stickers`. |
| 6. Referencias | Localiza y clasifica direcciones externas. |
| 7. Ensamblado | Reúne las 10 colecciones, resuelve enlaces, extrae iconos, genera enums e índices y valida referencias y duplicados con avisos. |
| 8. Almacenamiento | Serializa el JSON con indentación de dos espacios, lo escribe en R2 con `Content-Type: application/json` y guarda `version: v7` en los metadatos personalizados. |

La capa 7 no bloquea la conversión por referencias huérfanas o identificadores duplicados: registra avisos y devuelve el resultado completo.

El Durable Object guarda estos estados en su almacenamiento SQLite: `parsing`, `flattening`, `extracting_notes`, `extracting_attributes`, `extracting_stickers`, `extracting_urls`, `assembling`, `storing`, `completed` y `error`. Si falla, guarda `conversionError` y el estado pasa a `error`.

### Visualizador: seis capas

| Capa | Qué hace |
|---|---|
| 1. Carga | Obtiene el JSON de R2 con la plantilla de clave recibida. |
| 2. Árbol | Construye la jerarquía a partir de `nodes`. |
| 3. Adjuntos | Incorpora notas, referencias externas, enlaces, pegatinas e iconos a cada nodo. |
| 4. Estilos | Aplica los estilos y atributos visuales. |
| 5. Renderizado | Genera el HTML del árbol. |
| 6. Ensamblado | Construye el documento completo con CSS y JavaScript en línea, `MMUP_DATA`, adjuntos y el `nonce` de la petición. |

El HTML es autocontenido: no carga hojas de estilo ni scripts externos. Los iconos pueden viajar como `data:` o como direcciones remotas; los adjuntos viajan como `data:` dentro de `MMUP_DATA`.

El visualizador distingue estos errores: `NOT_FOUND` responde `404`; `INVALID_JSON` e `INVALID_STRUCTURE` responden `400`; cualquier otro fallo responde `500` con un mensaje genérico. Los detalles quedan en los registros estructurados.

## 8. Almacenamiento, retención y borrado

| Modo | Entrada | Salida | Permanencia |
|---|---|---|---|
| Anónimo | `temp/{uuid}.mup` | `temp/{uuid}/output.json` | 24 horas desde la escritura del JSON de salida |
| Catálogo | `input/{uuid}.mup` | `output/{uuid}.json` | Sin borrado automático |

Las plantillas de clave viven en `app-variables`: `R2_TEMP_INPUT_PATH_TEMPLATE`, `R2_TEMP_OUTPUT_PATH_TEMPLATE`, `R2_INPUT_PATH_TEMPLATE` y `R2_OUTPUT_PATH_TEMPLATE`. El catálogo usa además `outputPrefix` (`output/`) y `jsonSuffix` (`.json`). Si se cambian, hay que adaptar el catálogo y las descargas.

- El original se elimina al convertir, tanto en modo anónimo como en modo catálogo, con éxito o error. Si el Worker no puede despertar al Durable Object, también elimina el original que acababa de guardar.
- El HTML no se almacena. Se genera a demanda en cada vista y en cada descarga del ZIP.
- La retención anónima se comprueba con `head` sobre el JSON temporal de salida. Si el objeto ha caducado, la Function lo elimina y responde `404`. `/api/status` solo consulta el estado; la comprobación de retención se hace en `/html` y en `/api/download-html`.
- La tarea programada del Worker de conversión recorre el prefijo temporal y elimina los objetos más antiguos que la retención. Una política de ciclo de vida de R2 puede añadirse como red de seguridad, pero no sustituye la comprobación de la Function.
- `output/` no se borra automáticamente. En una instalación con catálogo, su crecimiento debe gestionarse con una retención explícita o una política de ciclo de vida.
- `/api/list` lee R2 directamente, pagina de 1000 en 1000 y lee cada JSON para construir el listado. Un objeto dañado se omite sin detener el resto.
- `/api/download/{uuid}` lee R2 directamente y usa `metadata.source_file` para el nombre del archivo. Si el objeto no existe, responde `404`.
- Las subidas nuevas no tienen `group` ni `group_path`. El catálogo muestra `Sin grupo` hasta que se asignen metadatos personalizados al objeto.

## 9. Relación entre las tres variantes

| Aspecto | Pública sin inicio de sesión | Con inicio de sesión y R2 | Conversor local |
|---|---|---|---|
| Infraestructura | Pages, Functions y dos Workers | Pages, Functions y dos Workers en una cuenta propia | Node.js, sin Cloudflare |
| Acceso | Sin cuenta | Usuario y contraseña | Línea de comandos |
| Catálogo | No | Sí, con sesión y `catalogEnabled` | No |
| Salida | Vista previa HTML y ZIP del HTML | JSON, vista previa HTML y ZIP del HTML | JSON y HTML opcional |
| Descarga de JSON | No | Sí | Sí, como archivo |
| Almacenamiento | R2 temporal, 24 horas | R2 en `output/`, sin borrado automático | Carpeta local |
| Configuración | `loginEnabled: false`, `catalogEnabled: false` | `loginEnabled: true`; `catalogEnabled` decide el catálogo | Opciones y variables de entorno |

Las dos variantes web comparten el mismo código. La configuración decide el modo; la variante pública mantiene el acceso y el catálogo desactivados, pero el código de inicio de sesión y catálogo se incluye en la aplicación.

El conversor local reutiliza las capas de conversión y de visualización; sustituye el almacenamiento en R2 por archivos locales. No usa Pages, Workers, R2, almacenamiento clave-valor ni Durable Objects. `scripts/convertir-local.js` procesa solo la raíz de la carpeta de entrada, no recorre subcarpetas y no genera HTML. `scripts/convert.js` permite recorrer subcarpetas con `--recursive` y generar HTML con `--html`. Ambos omiten las salidas existentes y escriben el JSON con indentación de dos espacios.

La distribución pública no incluye código de campaña ni `staging/`. Solo existen los modos anónimo y catálogo.

## 10. Decisiones de diseño y consecuencias

| Decisión | Consecuencia |
|---|---|
| Dos Workers internos con service bindings y sin URL pública | Pages es el único punto de entrada. El secreto interno debe coincidir en Pages y en el Worker de conversión; si no coincide, las subidas responden `502`. |
| Las Functions aplican límites y autorización; el Worker de conversión exige el secreto interno | Los Workers no se exponen directamente. Las Functions necesitan los bindings de configuración, R2 y servicios. |
| La configuración vive en dos documentos de almacenamiento clave-valor, sin valores por defecto silenciosos | Una clave ausente o un tipo incorrecto produce un `500` explícito. La respuesta de `/api/config` se cachea 60 segundos. |
| `loginEnabled` decide el modo y `catalogEnabled` solo controla el catálogo | Activar `catalogEnabled` no habilita el acceso. Con `loginEnabled: false`, el catálogo no existe aunque `catalogEnabled` sea `true`. |
| Desactivar el inicio de sesión no borra las sesiones de forma proactiva | Las sesiones existentes se eliminan al consultar `/api/session` o al caducar. No hay invalidación inmediata. |
| Los identificadores de ruta admiten 1 a 200 caracteres de `[A-Za-z0-9._-]` | No se exige UUID versión 4. Los identificadores generados por el conversor sí son UUID versión 4, pero las rutas conservan compatibilidad con otros válidos. |
| La retención anónima se ancla al JSON temporal de salida | La disponibilidad efectiva puede ser algo mayor que 24 horas desde la subida. `expiresAt` es una estimación; la comprobación real usa la fecha del objeto. |
| El original se borra al convertir y `output/` no se borra automáticamente | El flujo normal no conserva originales en R2, pero el catálogo puede crecer sin límite. La retención de `output/` debe gestionarse de forma explícita. |
| El HTML se genera a demanda y el ZIP se construye en cada descarga | No hay HTML almacenado que pueda quedar obsoleto. Cada vista consume CPU y cada descarga vuelve a empaquetar los recursos. |
| `conversionTimeoutSeconds` no aborta la conversión | Se usa como tiempo de vida de la clave activa y como `Retry-After`. Una conversión fallida puede mantener la clave activa hasta que expire. |
| `maxConcurrent` no se aplica | La concurrencia se aproxima con una clave activa por dirección de red. No hay un contador exacto de conversiones simultáneas. |
| Los contadores se incrementan antes de validar el archivo, el tipo de contenido o Turnstile | Los intentos inválidos consumen cuota. Un usuario puede agotar su ventana con peticiones rechazadas. |
| `/api/list` y `/api/download/{uuid}` leen R2 directamente | Se evita una llamada adicional al Worker, pero las Functions necesitan el binding `MMUP_BUCKET` y el listado lee cada JSON del catálogo. |
| Las subidas nuevas no reciben grupo automáticamente | El catálogo muestra `Sin grupo` hasta que se asignen `group` y `group_path` en los metadatos personalizados del objeto. |
| Los Durable Objects usan SQLite y migraciones con etiqueta literal | La migración se aplica una sola vez. No se puede reutilizar una etiqueta ya aplicada; el historial es acumulativo. |
| El despliegue es manual con Wrangler 4, sin GitHub Actions | No hay despliegue automático ni integración continua. Cada instalación controla cuándo publica. |
| Turnstile es opcional y solo afecta al modo anónimo | Si se activa, la aplicación depende de un servicio externo. Un token inválido responde `403` y consume cuota. |
| La distribución pública no incluye campaña ni `staging/` | Solo existen los modos anónimo y catálogo. No hay publicación por lotes ni objetos de campaña. |

## Documentación relacionada

- [Seguridad](seguridad.md)
- [Instalación pública](instalacion-publica.md)
- [Instalación con inicio de sesión y R2](instalacion-login-r2.md)
- [README del proyecto](../README.md)
- [Licencias de terceros](../THIRD_PARTY_LICENSES.md)
