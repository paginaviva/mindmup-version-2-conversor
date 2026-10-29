# Instalación pública de MindMup 2 Conversor

Guía para desplegar la variante pública de MindMup 2 Conversor en una cuenta de Cloudflare propia. La variante pública no tiene inicio de sesión ni catálogo: recibe un archivo `.mup`, genera un HTML autocontenido y lo ofrece para previsualizar y descargar en ZIP. El JSON se genera internamente para construir el HTML, pero no se expone al usuario.

Esta variante es distinta de la instalación con inicio de sesión y R2 y del conversor local: no incluye autenticación ni catálogo, expone solo HTML y ZIP, y aplica una retención de 24 horas. El conversor local no usa Cloudflare y guarda los archivos en el disco del usuario.

## Compatibilidad de los archivos

El conversor acepta archivos `.mup` compatibles con `formatVersion: 3`. La compatibilidad se decide por ese valor interno, no por la versión comercial de MindMup:

- Acepta `.mup` con `formatVersion: 3` y un objeto `ideas` no vacío.
- Rechaza los archivos con `formatVersion: 2` y cualquier otro valor distinto de 3.
- No lee ni valida la versión comercial de MindMup (2 o 3).
- No se ha podido demostrar que todos los archivos de MindMup 2 usen `formatVersion: 3`; comprueba el valor del archivo antes de asumir que se aceptará.
- `v7` es la versión del conversor, no la de MindMup ni la del formato `.mup`.

La [documentación oficial de MindMup](https://www.mindmup.com/) no documenta este valor interno. El proyecto no afirma compatibilidad universal con todos los mapas de MindMup 2 ni incompatibilidad universal con MindMup 3.

El despliegue es manual, con Wrangler 4. No se usa GitHub Actions ni integración continua.

## 1. Requisitos

- Node.js 22 o superior.
- Una cuenta de Cloudflare con Pages, Workers, R2, almacenamiento clave-valor y Durable Objects.
- Wrangler 4, sin instalación global:

  ```bash
  npx -y wrangler@4 --version
  ```

- Sesión iniciada en la cuenta correcta:

  ```bash
  npx -y wrangler@4 whoami
  ```

- No hay dependencias npm que instalar. Los comandos del proyecto se ejecutan directamente con Node.js.

## 2. Arquitectura

```text
Navegador
   │
   ▼
Cloudflare Pages: app/ + functions/
   │
   ├── service binding CONVERTER ──► Worker de conversión ──► R2
   │                                      Durable Object
   │
   └── service binding VISUALIZER ─► Worker de visualización ─► R2
                                          Durable Object
```

| Componente | Función |
|---|---|
| Pages | Sirve la interfaz estática y las Functions que validan las peticiones. |
| Functions | Aplican los límites, comprueban la retención y llaman a los Workers. |
| Worker de conversión | Convierte el `.mup` en JSON-CMJN y lo guarda en R2. |
| Worker de visualización | Genera el HTML autocontenido a partir del JSON temporal. |
| R2 | Guarda el original temporal y el JSON temporal de salida. |
| Almacenamiento clave-valor | Guarda `app-config`, `app-variables` y los contadores de límites. |
| Durable Objects | Ejecutan la conversión y la visualización con estado aislado por identificador. |

Los dos Workers son internos: no tienen URL pública ni dominio propio. Pages es el único punto de entrada. La aplicación incluye el código de acceso y catálogo, pero la configuración pública mantiene ambos desactivados.

## 3. Recursos que hay que crear

| Recurso | Nombre | Observaciones |
|---|---|---|
| Proyecto de Pages | `pg-mindmup-v2-public` | Nombre fijo de esta variante. |
| Worker de conversión | `{{NOMBRE_WORKER_CONVERSOR}}` | Elige un nombre y úsalo también en el service binding `CONVERTER`. |
| Worker de visualización | `{{NOMBRE_WORKER_VISUALIZADOR}}` | Elige un nombre y úsalo también en el service binding `VISUALIZER`. |
| Cubo R2 | `{{NOMBRE_CUBO_R2}}` | Guarda los objetos temporales. |
| KV de configuración | `{{NOMBRE_ESPACIO_CONFIG}}` | Contiene la clave `app-config`; su identificador es `{{KV_CONFIG_ID}}`. |
| KV de variables | `{{NOMBRE_ESPACIO_VARIABLES}}` | Contiene la clave `app-variables`; su identificador es `{{KV_VARIABLES_ID}}`. |
| Durable Object de conversión | `MupConverter` | Lo crea el primer despliegue del Worker de conversión. |
| Durable Object de visualización | `MupVisualizer` | Lo crea el primer despliegue del Worker de visualización. |

No hace falta crear los Durable Objects por separado: se declaran en los archivos de configuración de los Workers y se crean al aplicar la migración del primer despliegue. El Worker de conversión incluye además una tarea programada cada hora para eliminar objetos temporales caducados.

Crea recursos nuevos para esta instalación. No reutilices el cubo R2, los espacios clave-valor ni los Workers de otra instalación.

## 4. Plantillas y placeholders

Copia las plantillas versionadas a archivos locales ignorados por Git:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
cp wrangler.converter.example.jsonc wrangler.converter.local.jsonc
cp wrangler.visualizer.example.jsonc wrangler.visualizer.local.jsonc
cp wrangler.pages.example.jsonc wrangler.jsonc
```

`wrangler.jsonc` es la configuración local de Pages y está ignorado por Git. Si ya existe uno, revisa que no pertenezca a otro proyecto antes de sustituirlo. Sustituye los marcadores en los archivos locales:

| Placeholder | Dónde se usa | Valor |
|---|---|---|
| `{{NOMBRE_WORKER_CONVERSOR}}` | Configuración del Worker de conversión y service binding `CONVERTER` de Pages. | Nombre elegido por el instalador. |
| `{{NOMBRE_WORKER_VISUALIZADOR}}` | Configuración del Worker de visualización y service binding `VISUALIZER` de Pages. | Nombre elegido por el instalador. |
| `{{NOMBRE_CUBO_R2}}` | Configuración de los dos Workers y de Pages. | Nombre del cubo creado en la cuenta. |
| `{{KV_CONFIG_ID}}` | Configuración de Pages (Functions) y del Worker de conversión. | Identificador del KV de configuración. |
| `{{KV_VARIABLES_ID}}` | Configuración de Pages (Functions), del Worker de conversión y del Worker de visualización. | Identificador del KV de variables. |
| `{{MIGRATION_TAG}}` | Migración de cada Worker. | Etiqueta literal nueva, por ejemplo `init_conversor_publico` e `init_visualizador_publico`. |
| `{{NOMBRE_ESPACIO_CONFIG}}` | Solo en el comando de creación del KV de configuración. | Nombre elegido por el instalador. |
| `{{NOMBRE_ESPACIO_VARIABLES}}` | Solo en el comando de creación del KV de variables. | Nombre elegido por el instalador. |
| `{{PAGES_PROJECT}}` | Plantilla de Pages. | En esta variante, `pg-mindmup-v2-public`. |

La etiqueta de migración se aplica una sola vez en el primer despliegue. No reutilices una etiqueta ya aplicada en ese Worker: el historial es acumulativo y sus operaciones no se pueden volver a aplicar.

## 5. Configuración

La configuración operativa vive en dos documentos JSON de KV:

| Binding | Clave | Plantilla |
|---|---|---|
| `CONFIG_KV` | `app-config` | `config.example.json` |
| `VARIABLES_KV` | `app-variables` | `config.variables.example.json` |

En `config.local.json`, mantén los dos conmutadores desactivados:

```json
{
  "loginEnabled": false,
  "catalogEnabled": false
}
```

El fragmento anterior no sustituye al archivo completo: conserva todas las claves de `config.example.json`. Además:

- Sustituye `{{LOGIN_USER}}` por una cadena vacía; no se usa con el acceso desactivado.
- Deja `turnstileEnabled` en `false` y `turnstileSiteKey` como cadena vacía si no activas Turnstile.
- Revisa los límites de la sección 9 antes de cargar el documento.

`config.variables.example.json` se puede usar tal cual. No contiene secretos ni identificadores de cuenta; `WORKER_URL` queda vacío y las rutas son internas del propio Worker.

Valida los dos documentos antes de cargarlos:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

La salida esperada empieza por `Configuración válida`. Si falta una clave o tiene un tipo incorrecto, el comando nombra la clave y termina con código 1.

## 6. Secretos

El único secreto obligatorio de esta variante es `INTERNAL_SHARED_SECRET`. Debe tener el mismo valor en el Worker de conversión y en el proyecto de Pages. No lo escribas en `config.local.json`, en `wrangler.*.local.jsonc` ni en ningún archivo versionado.

Genera un valor aleatorio de 32 bytes en base64url:

```bash
node --input-type=module -e "import { randomBytes } from 'node:crypto'; console.log(randomBytes(32).toString('base64url'))"
```

Guarda el valor fuera del repositorio y defínelo en los dos destinos. Wrangler lo solicita de forma interactiva; no pases el valor como argumento. Ejecuta estos comandos después de crear el proyecto de Pages y de desplegar los Workers (secciones 7.2 y 7.4):

```bash
npx -y wrangler@4 secret put INTERNAL_SHARED_SECRET \
  --config wrangler.converter.local.jsonc

npx -y wrangler@4 pages secret put INTERNAL_SHARED_SECRET \
  --project-name pg-mindmup-v2-public
```

Los secretos `ADMIN_PASSWORD_*` pertenecen a la variante con acceso y no son necesarios aquí.

### Turnstile opcional

Turnstile añade una verificación antiabuso al formulario público. Para activarlo:

1. Crea un widget de Turnstile en el panel de Cloudflare.
2. En `config.local.json`, pon `turnstileEnabled` en `true` y `turnstileSiteKey` con la clave pública del widget.
3. Define `TURNSTILE_SECRET_KEY` solo en Pages:

   ```bash
   npx -y wrangler@4 pages secret put TURNSTILE_SECRET_KEY \
     --project-name pg-mindmup-v2-public
   ```

No incluyas la clave secreta ni la clave pública en la documentación ni en el repositorio. Si Turnstile está activo, una petición sin token válido responde `403`, pero consume cuota igualmente porque los contadores se incrementan antes de verificar el token.

## 7. Despliegue

Ejecuta todos los comandos desde la raíz del repositorio.

### 7.1. Crear el cubo R2 y los espacios clave-valor

```bash
npx -y wrangler@4 r2 bucket create {{NOMBRE_CUBO_R2}}

npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_CONFIG}}
npx -y wrangler@4 kv namespace create {{NOMBRE_ESPACIO_VARIABLES}}
```

Cada `kv namespace create` imprime un identificador. Anótalo y úsalo como `{{KV_CONFIG_ID}}` o `{{KV_VARIABLES_ID}}`. Puedes consultar los espacios existentes con:

```bash
npx -y wrangler@4 kv namespace list
```

### 7.2. Crear el proyecto de Pages

```bash
npx -y wrangler@4 pages project create pg-mindmup-v2-public \
  --production-branch main
```

No conectes el proyecto a una rama de Git. El despliegue se hace con Wrangler, no con una integración automática.

### 7.3. Preparar y validar los archivos locales

Copia las plantillas de la sección 4 y sustituye los placeholders. Antes de desplegar, comprueba que la configuración es válida:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

También puedes ejecutar las pruebas del repositorio:

```bash
npm test
```

### 7.4. Desplegar los dos Workers

El primer despliegue crea cada Worker y aplica su migración de Durable Object. Usa `--keep-vars` para conservar las variables y secretos que ya existan en el panel.

```bash
npx -y wrangler@4 deploy --config wrangler.converter.local.jsonc --keep-vars
npx -y wrangler@4 deploy --config wrangler.visualizer.local.jsonc --keep-vars
```

No uses `wrangler.jsonc` para desplegar los Workers: ese archivo es la configuración de Pages. Los Workers usan siempre sus propios archivos `wrangler.converter.local.jsonc` y `wrangler.visualizer.local.jsonc`.

Comprueba que ambos Workers tienen `workers_dev` y `preview_urls` desactivados. No los actives: Pages debe ser el único punto de entrada.

### 7.5. Cargar `app-config` y `app-variables`

Cada documento se guarda como un único valor JSON bajo su clave. `--remote` escribe en el espacio real; sin ese indicador, Wrangler usa el almacenamiento local de desarrollo.

```bash
npx -y wrangler@4 kv key put app-config "$(cat config.local.json)" \
  --namespace-id {{KV_CONFIG_ID}} --remote

npx -y wrangler@4 kv key put app-variables "$(cat config.variables.local.json)" \
  --namespace-id {{KV_VARIABLES_ID}} --remote
```

Tras cambiar KV, vuelve a consultar `/api/config`; su respuesta puede estar cacheada hasta 60 segundos.

### 7.6. Definir el secreto interno

Si no lo hiciste en la sección 6, define `INTERNAL_SHARED_SECRET` ahora en el Worker de conversión y en Pages. Debe ser exactamente el mismo valor en ambos:

```bash
npx -y wrangler@4 secret put INTERNAL_SHARED_SECRET \
  --config wrangler.converter.local.jsonc

npx -y wrangler@4 pages secret put INTERNAL_SHARED_SECRET \
  --project-name pg-mindmup-v2-public
```

### 7.7. Configurar los bindings de Pages

El archivo `wrangler.jsonc` copiado de `wrangler.pages.example.jsonc` declara los bindings de Pages. `wrangler pages deploy` lo descubre en el directorio actual y los aplica al desplegar. No uses `--config`: Pages no admite una ruta personalizada para el archivo de configuración.

Comprueba que `wrangler.jsonc` contiene estos bindings:

| Tipo | Binding | Destino |
|---|---|---|
| KV namespace | `CONFIG_KV` | Espacio de configuración (`{{KV_CONFIG_ID}}`). |
| KV namespace | `VARIABLES_KV` | Espacio de variables (`{{KV_VARIABLES_ID}}`). |
| R2 bucket | `MMUP_BUCKET` | Cubo `{{NOMBRE_CUBO_R2}}`. |
| Service binding | `CONVERTER` | Worker `{{NOMBRE_WORKER_CONVERSOR}}`. |
| Service binding | `VISUALIZER` | Worker `{{NOMBRE_WORKER_VISUALIZADOR}}`. |

Los dos Workers deben existir antes de crear los service bindings. El secreto `INTERNAL_SHARED_SECRET` se configura aparte, como secreto de Pages; no es un binding de texto plano.

Mientras exista `wrangler.jsonc`, es la fuente de verdad de la configuración de Pages y los mismos campos no se pueden editar en el panel. Si prefieres configurar los bindings en el panel, no crees `wrangler.jsonc` (o elimínalo antes de desplegar), usa `wrangler.pages.example.jsonc` solo como referencia y añade los cinco bindings en la sección de Functions. No mezcles ambos métodos.

### 7.8. Desplegar la aplicación

Con `wrangler.jsonc`, `pages_build_output_dir` apunta a `./app`:

```bash
npx -y wrangler@4 pages deploy \
  --project-name pg-mindmup-v2-public --branch main
```

El comando publica `app/` y las Functions de `functions/`. No uses `--config` con `pages deploy`: Wrangler no lo admite para Pages.

Si no usas `wrangler.jsonc` y configuras los bindings en el panel, despliega el directorio de forma explícita:

```bash
npx -y wrangler@4 pages deploy app \
  --project-name pg-mindmup-v2-public --branch main
```

## 8. Verificación

Asigna a `BASE_URL` la URL que muestra el panel del proyecto:

```bash
BASE_URL="https://<PROYECTO>.pages.dev"
```

### 8.1. Configuración y sesión

```bash
curl -sS "$BASE_URL/api/config"
curl -sS "$BASE_URL/api/session"
```

Resultados esperados:

- `/api/config` devuelve `mode: "anonymous"`, `loginEnabled: false`, `catalogEnabled: false`, los tamaños de subida, la retención y el objeto `rateLimit`.
- `/api/session` devuelve `{"authenticated":false}`.

### 8.2. Conversión completa

Sube un archivo sintético de al menos 1 KB:

```bash
curl -sS -X POST "$BASE_URL/api/upload" \
  -F "file=@examples/entrada/mapa-minimo.mup"
```

La respuesta es `202` e incluye `uuid`, `mode: "anonymous"`, `statusUrl`, `htmlUrl`, `htmlDownloadUrl`, `expiresAt` y `downloadUrl: null`. Copia el `uuid` y consulta el estado hasta que sea `completed`:

```bash
UUID="<uuid>"
curl -sS "$BASE_URL/api/status/$UUID"
```

Después comprueba la vista previa y la descarga:

```bash
curl -sS -o /dev/null -w "%{http_code} %{content_type}\n" "$BASE_URL/html/$UUID"
curl -sS -o mapa.zip -w "%{http_code} %{content_type}\n" "$BASE_URL/api/download-html/$UUID"
```

Resultados esperados: `200` con `text/html` en la vista previa y `200` con `application/zip` en la descarga. El ZIP contiene el HTML limpio, la carpeta de recursos y, solo si faltan recursos remotos, `faltantes.txt`.

### 8.3. Comprobar que el catálogo y el JSON no se exponen

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/list"
curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/download/$UUID"
```

Ambas rutas deben responder `404`. La primera porque `catalogEnabled` es `false`; la segunda porque la variante pública no ofrece JSON. Comprobaciones adicionales:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" \
  -X POST "$BASE_URL/api/login" \
  -H "Content-Type: application/json" \
  -d '{"user":"prueba","password":"prueba"}'

curl -sS -o /dev/null -w "%{http_code}\n" "$BASE_URL/api/list"
```

`/api/login` debe responder `404` con un cuerpo válido. `/api/list` debe responder `404` porque el catálogo está desactivado. `/api/lista` no es una ruta de API: una petición a esa dirección puede devolver la página estática con `200`; no la uses como comprobación.

## 9. Límites reales

| Límite | Valor | Comprobación |
|---|---|---|
| Tamaño mínimo | 1 KB (1024 bytes) | Un archivo menor responde `400`. |
| Tamaño máximo | 16 MB (16777216 bytes) | Un archivo mayor responde `413`. |
| Retención de esta variante | 24 horas | Se comprueba contra la fecha del JSON temporal de salida. |
| Subidas por ventana | 2 cada 10 minutos | La tercera subida dentro de la ventana responde `429`. |
| Subidas por día | 10 | Al superar el límite responde `429` con `Retry-After`. |
| Conversión activa | 1 por dirección de red | Se aproxima con una clave activa por dirección. |

Matices que conviene conocer antes de operar:

- La retención se ancla al objeto JSON temporal de salida (`temp/{uuid}/output.json`), no al momento exacto de la subida. El JSON se escribe al terminar la conversión, así que la disponibilidad efectiva puede ser algo mayor que 24 horas desde la petición.
- La respuesta de `/api/upload` incluye `expiresAt` calculado al aceptar la subida; la comprobación real del servidor usa la fecha del objeto temporal.
- `conversionTimeoutSeconds` (120 segundos en la plantilla) no aborta la conversión. Se usa como tiempo de vida de la clave de conversión activa y como valor de `Retry-After`.
- `maxConcurrent` aparece en `app-config`, pero el código no lo lee. La concurrencia se aproxima con una clave activa por dirección de red.
- Los contadores de límites se incrementan antes de validar el archivo, el tipo de contenido o Turnstile. Los intentos inválidos consumen cuota.
- Si una conversión falla después de iniciarse, la clave activa puede tardar hasta `conversionTimeoutSeconds` en liberarse.
- `loginEnabled` decide el modo; `catalogEnabled` solo controla `/api/list` y la vista de catálogo. En esta variante ambos están desactivados.
- `/api/config` devuelve `rateLimit` en modo anónimo. En modo catálogo devolvería `null`, pero ese modo no se usa aquí.

## 10. Errores y resolución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| `500 Configuración no disponible` en `/api/config` o al subir | Falta un binding de KV, falta `app-config` o `app-variables`, el JSON no cumple el esquema o, al subir, falta `INTERNAL_SHARED_SECRET` en Pages. | Revisa los bindings y las claves, compara el secreto y ejecuta `validate-config.js`. |
| `500 Servicio de conversión no disponible` al subir | Falta el service binding `CONVERTER`. | Configura el binding en Pages. |
| `502 No se pudo iniciar la conversión` | El service binding apunta a otro Worker, el secreto no coincide o el Worker de conversión falla. | Revisa el nombre del servicio, compara el secreto en ambos destinos y consulta los registros del Worker. |
| `500 Visualizador no disponible` | Falta el service binding `VISUALIZER`. | Configura el binding en Pages. |
| `500 Almacenamiento no disponible` o `500 El binding de R2 no está disponible` | Falta el binding `MMUP_BUCKET` en Pages, en el Worker de visualización o en el de conversión. | Configura el cubo R2 en los tres destinos. |
| `404 Mapa no encontrado` | El objeto temporal caducó, no existe o la plantilla de clave no coincide. | Comprueba `temp/{uuid}/output.json` en R2. Si caducó, es el comportamiento esperado. |
| `429 Ya hay una conversión en curso` | Existe una clave activa para la dirección de red. | Espera el `Retry-After` indicado, como máximo `conversionTimeoutSeconds`. |
| `429 Demasiadas conversiones. Inténtalo más tarde.` | Se superaron 2 subidas en 10 minutos. | Espera a que expire la ventana. |
| `429 Límite diario de conversiones alcanzado.` | Se superaron 10 subidas en 24 horas. | Espera a que expire el contador diario. |
| `400 El archivo debe tener extensión .mup` | El archivo no tiene la extensión correcta. | Usa un archivo con extensión `.mup`; comprueba además que su `formatVersion` sea 3. |
| `400 El archivo está vacío o es demasiado pequeño (mínimo 1 KB)` | El archivo mide menos de 1024 bytes. | Usa un mapa con contenido suficiente. |
| `400 El archivo no contiene un JSON válido` | El `.mup` no es JSON o está dañado. | Expórtalo de nuevo desde MindMup. |
| `403 Verificación antiabuso fallida` | Turnstile está activo y falta el token o no es válido. | Revisa la clave pública y la secreta; el intento ya consumió cuota. |
| `404 Catálogo no disponible` en `/api/list` | `catalogEnabled` es `false`. | Es el comportamiento esperado en la variante pública. |
| `404 Resultado no encontrado` en `/api/download/{uuid}` | La variante pública no expone JSON. | Es el comportamiento esperado; usa `/api/download-html/{uuid}`. |
| `200` con HTML en `/api/lista` | `/api/lista` no es una ruta de API; el servidor devuelve la página estática. | La ruta del catálogo es `/api/list`; en esta variante está desactivada y responde `404`. |
| `Pages does not support custom paths for the Wrangler configuration file` | Se pasó `--config` a `pages deploy`. | Quita `--config`; deja que Wrangler descubra `wrangler.jsonc` o configura los bindings en el panel. |
| Error de migración en el primer despliegue | La etiqueta `{{MIGRATION_TAG}}` ya se aplicó en ese Worker. | Usa una etiqueta nueva; no edites una migración aplicada. |

Los detalles técnicos se registran en los registros estructurados del Worker o de la Function. Las respuestas al usuario no incluyen trazas, secretos ni rutas internas.

## 11. Seguridad y notas de operación

- Mantén los dos Workers sin URL pública. Pages es el único punto de entrada y las Functions aplican los límites.
- `INTERNAL_SHARED_SECRET` debe coincidir en el Worker de conversión y en Pages. Al rotarlo, actualiza ambos destinos en la misma ventana de mantenimiento; mientras ambos existan pero no coincidan, las subidas responderán `502`.
- No guardes secretos, identificadores de cuenta ni archivos `.local` en Git. `.gitignore` ya excluye `*.local.*`, `config.local.json`, `config.variables.local.json`, `.dev.vars` y `wrangler.jsonc`.
- No conectes el proyecto de Pages a una rama de Git ni añadas flujos de GitHub Actions. El despliegue es manual.
- El original `.mup` se elimina al terminar la conversión. El JSON temporal se conserva hasta que caduca; la tarea programada horaria elimina los objetos caducados y la Function también los borra al detectar la caducidad.
- La retención de 24 horas y la caducidad de URL corresponden a esta variante pública. No se aplican a la instalación con inicio de sesión y R2 ni al conversor local.
- El HTML no se almacena: se genera a demanda. El ZIP se construye en cada descarga.
- No hay catálogo, campaña ni `staging/` en esta variante. No busques datos publicados en `output/`: las conversiones anónimas usan `temp/`.
- Los límites se aplican por dirección de red. Varios usuarios detrás de la misma red pueden compartir cuota; es el comportamiento esperado.
- Turnstile es opcional y complementa los límites, no los sustituye.
- Conserva `LICENSE` y `THIRD_PARTY_LICENSES.md` en la distribución.

## Lista de comprobación

- [ ] `npm test` termina sin fallos.
- [ ] `validate-config.js` devuelve `Configuración válida`.
- [ ] El cubo R2 y los dos espacios clave-valor existen.
- [ ] El proyecto `pg-mindmup-v2-public` existe y no está conectado a Git.
- [ ] Los dos Workers están desplegados con `workers_dev: false`.
- [ ] Cada Worker aplicó su migración una sola vez.
- [ ] `INTERNAL_SHARED_SECRET` coincide en el Worker de conversión y en Pages.
- [ ] `app-config` y `app-variables` están cargados con `--remote`.
- [ ] Pages tiene los bindings `CONFIG_KV`, `VARIABLES_KV`, `MMUP_BUCKET`, `CONVERTER` y `VISUALIZER`.
- [ ] `/api/config` responde en modo anónimo y `/api/session` devuelve `authenticated: false`.
- [ ] Una subida completa termina en `completed`, el HTML responde `200` y el ZIP responde `200`.
- [ ] `/api/list` y `/api/download/{uuid}` responden `404`.
- [ ] No hay archivos `.local`, `.dev.vars`, `wrangler.jsonc` ni secretos en `git status`.
