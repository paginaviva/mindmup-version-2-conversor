# Pruebas de MindMup 2 Conversor

Las pruebas de MindMup 2 Conversor se ejecutan a mano desde la raíz del repositorio. No hay integración continua ni GitHub Actions. Las suites usan datos sintéticos, no necesitan red y no crean recursos de Cloudflare.

La compatibilidad verificada por la suite se limita a archivos `.mup` con `formatVersion: 3` y al rechazo de `formatVersion: 2`. Las pruebas no demuestran compatibilidad universal con todos los archivos de MindMup 2 ni con todos los de MindMup 3.

Este documento describe qué comprueba cada suite, cómo ejecutarla y cómo conservar una evidencia verificable. No declara resultados de ejecución: cada persona debe ejecutar los comandos y conservar su salida y su código de salida.

## 1. Requisitos

- Node.js 22 o superior. El requisito está declarado en `package.json`.
- Ninguna dependencia npm que instalar. No ejecutes `npm install` para probar el proyecto.
- Ningún secreto, cuenta de Cloudflare ni recurso desplegado. Las suites usan objetos simulados y almacenamiento en memoria.
- Permiso de escritura en la carpeta de salida y en `.tmp/`, que está excluida por `.gitignore`.
- Los comandos se ejecutan desde la raíz del repositorio. Los archivos de prueba importan módulos de `src/`, así que no copies solo `test/` ni `scripts/`.
- `config.local.json` y `config.variables.local.json` solo son necesarios para la validación de configuración. Se crean a partir de las plantillas y no se versionan.

## 2. Comandos

### 2.1. Suites

```bash
npm test
npm run test:shared
npm run test:converter
npm run test:visualizer
npm run test:functions
npm run test:ui
```

`npm test` ejecuta las cinco suites en este orden: shared, converter, visualizer, functions y ui. Cada paso se encadena con `&&`: si una suite falla, las siguientes no se ejecutan. Para localizar un fallo, ejecuta la suite afectada por separado.

Una suite se considera correcta cuando termina con código de salida 0 y no imprime líneas `FAIL` ni `❌`. El código de salida 1 indica un fallo. Las comprobaciones omitidas del visualizador no cuentan como superadas; se explican en la sección 8.

### 2.2. Validación de configuración

Copia las plantillas a los nombres locales que espera el comando:

```bash
cp config.example.json config.local.json
cp config.variables.example.json config.variables.local.json
```

Después valida los dos documentos:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json
```

Si los dos documentos son válidos, el comando imprime una línea que empieza por `Configuración válida:` e incluye el número de claves del convertidor y del visualizador. Si falta un archivo, no contiene JSON válido o incumple el esquema, imprime `Error:` y termina con código 1.

El comando no forma parte de `npm test` y no despliega nada. `config.local.json` y `config.variables.local.json` están excluidos por `.gitignore`.

### 2.3. Conversión local con `examples/entrada` y `examples/salida`

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

Con la carpeta `examples/salida` vacía, el comando debe generar tres JSON y tres HTML:

```text
examples/salida/mapa-minimo.json
examples/salida/mapa-minimo.html
examples/salida/mapa-completo.json
examples/salida/mapa-completo.html
examples/salida/mapa-con-adjunto.json
examples/salida/mapa-con-adjunto.html
```

Si vuelves a ejecutar el mismo comando, los seis archivos se omiten y el código de salida sigue siendo 0. Para una conversión solo JSON, usa otra carpeta de salida:

```bash
node scripts/convert.js --input examples/entrada --output .tmp/pruebas/salida-json
```

`convertir-local.js` procesa solo la raíz de la entrada y nunca genera HTML:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=.tmp/pruebas/salida-json node scripts/convertir-local.js
```

Los datos de `examples/entrada` son sintéticos. Consulta [examples/README.md](../examples/README.md).

## 3. Matriz de suites

| Suite | Comando | Cobertura |
|---|---|---|
| Shared | `npm run test:shared` | Configuración y variables, sesión y cookies, PBKDF2, ZIP, empaquetado HTML y límites de tamaño. |
| Converter | `npm run test:converter` | Capas 1 a 4, capas 5 a 8, unidades del Worker, autenticación, validación y limpieza temporal. |
| Visualizer | `npm run test:visualizer` | Capas 1 a 6, utilidades, seguridad del HTML y datos sintéticos en línea. |
| Functions | `npm run test:functions` | Inicio de sesión, sesión, configuración, protección de sesión, `/api/list`, subida, estado, HTML, barra de descargas y ZIP. |
| Interfaz | `npm run test:ui` | Estructura estática de `app/index.html`, `app/app.js`, `app/_headers` y `app/_routes.json`. |
| Configuración | `node scripts/validate-config.js ...` | Esquema de `config.local.json` y `config.variables.local.json`. |
| Local | `node scripts/convert.js ...` y `node scripts/convertir-local.js` | Conversión, recursión, HTML, omisión de salidas y código de salida. |

Detalle de archivos:

- Shared: `test/shared/test-config.js`, `test-session.js`, `test-zip.js` y `test-html-bundle.js`.
- Converter: `test-layers-1-4.js`, `test-layers-5-8.js`, `test-worker-units.js` y `test-cleanup.js`.
- Visualizer: `test-layers.js`.
- Functions: `test-login.js`, `test-session.js`, `test-config.js`, `test-session-guard.js`, `test-list.js`, `test-upload.js`, `test-result-endpoints.js`, `test-html-toolbar.js` y `test-download-html.js`.
- Interfaz: `test-static-shell.js`.

Las suites de Functions no levantan Pages, Workers, Durable Objects ni R2 reales. Usan peticiones y respuestas estándar, almacenamiento en memoria y cubos simulados.

## 4. Datos sintéticos

Todos los nombres, títulos, identificadores, fechas, notas, adjuntos y direcciones son inventados. No hay mapas reales, clientes, grupos, rutas absolutas ni direcciones del despliegue privado.

### 4.1. `test/fixtures/mup/`

Contiene ocho archivos sintéticos:

| Archivo | Caso |
|---|---|
| `valido-minimo.mup` | Árbol mínimo de 10 nodos, sin atributos opcionales. |
| `valido-completo.mup` | Notas, estilos, pegatinas, icono, enlace interno y referencias externas. |
| `valido-adjunto.mup` | Adjunto de texto y un icono pequeño en nodos distintos. |
| `invalido-extension.txt` | Extensión distinta de `.mup`. |
| `invalido-pequeno.mup` | JSON válido de menos de 1 KB. |
| `invalido-json.mup` | Más de 1 KB, truncado para que el JSON no sea válido. |
| `invalido-sin-format-version.mup` | JSON válido con `ideas`, sin `formatVersion`. |
| `invalido-sin-ideas.mup` | JSON válido con `formatVersion: 3`, sin `ideas`. |

Los cinco inválidos están construidos para que el primer error que se alcance sea el indicado en `test/fixtures/README.md`. Ese README se centra en el conjunto inválido; los tres válidos se documentan en esta página.

Las pruebas de Functions construyen sus propias entradas en memoria y no cargan estos archivos de forma automática. El conjunto sirve como corpus de referencia y para comprobaciones manuales de la validación de subidas. No edites un fixture para hacer pasar una prueba: corrige la prueba o el código.

### 4.2. `test/fixtures/esperado/`

Contiene tres contratos de referencia:

- `valido-minimo.contrato.json`
- `valido-completo.contrato.json`
- `valido-adjunto.contrato.json`

Los contratos no son copias byte a byte. Normalizan los valores dinámicos, como UUID, `path`, `converted_at` y otras fechas, para que la comparación no dependa del reloj ni del orden de generación. Las suites actuales no los cargan directamente; sirven para comparar una salida concreta y para futuras pruebas de contrato.

### 4.3. Otros datos sintéticos

- `examples/entrada/` contiene tres mapas sintéticos para la conversión local.
- `test/converter/fixtures/` contiene `synthetic-empty.mup` y `synthetic-v2.mup`, usados por las pruebas de capas.
- `test/visualizer/test-layers.js` define mapas sintéticos en línea; no lee datos de referencia.
- Los dominios de ejemplo usan `example.com`, `example.org` o `example.test`. Las direcciones de red de prueba usan rangos de documentación.

No añadas datos personales, nombres de clientes, identificadores reales, rutas absolutas ni direcciones privadas a las pruebas, a los fixtures o a los ejemplos.

### 4.4. `synthetic-v2.mup` y el límite de la comprobación

`test/converter/fixtures/synthetic-v2.mup` es un fixture sintético con `formatVersion: 2` y un árbol `ideas` mínimo. No reproduce un mapa real de MindMup 2 ni representa a todos los archivos de esa versión comercial.

Su finalidad es comprobar el rechazo de `formatVersion: 2`. La prueba 1.2 de `test/converter/test-layers-1-4.js` llama a `parseMup` con `MUP_FORMAT_VERSION: 3` y espera el error `Formato .mup no soportado`. Que la prueba pase acredita que la capa 1 rechaza un valor distinto de 3 en ese fixture. No acredita que el conversor lea todos los mapas de MindMup 2, ni que todos los mapas de MindMup 2 sean incompatibles con MindMup 3.

La suite no demuestra compatibilidad universal con todos los archivos de MindMup 2. Tampoco demuestra que todos los archivos de MindMup 2 usen `formatVersion: 2`. Solo cubre el comportamiento del código ante el valor 2 y el valor 3 en los datos de prueba.

## 5. Variante pública sin inicio de sesión

| Área | Qué se comprueba | Dónde |
|---|---|---|
| Configuración | `loginEnabled: false` produce `mode: "anonymous"`, desactiva el catálogo y expone los límites anónimos. No se publican `loginUser`, la duración de la sesión ni los límites de acceso. | `test/functions/test-config.js` |
| Configuración | Los campos sensibles no aparecen en `/api/config`; un fallo de configuración responde `500` con un mensaje genérico. | `test/functions/test-config.js` |
| Subida | Una subida anónima responde `202`, usa el modo `anonymous` y devuelve `downloadUrl: null`, `htmlUrl` y `htmlDownloadUrl`. | `test/functions/test-upload.js` |
| Subida | Una subida sin sesión en modo catálogo responde `401`. | `test/functions/test-upload.js` |
| Límites | La ventana agotada y una conversión activa responden `429`. Un fallo del conversor responde `502` y libera la clave activa. | `test/functions/test-upload.js` |
| Límites | La validación de tamaño mínimo y máximo se prueba con límites inyectados. | `test/shared/test-config.js` |
| Turnstile | Sin token, con token rechazado y con token aceptado: `403`, `403` y `202`. | `test/functions/test-upload.js` |
| Estado | Un identificador inválido responde `400`; el modo anónimo responde `200` sin sesión. | `test/functions/test-result-endpoints.js` |
| HTML | Un resultado inexistente responde `404`; un resultado caducado se elimina y responde `404`. | `test/functions/test-result-endpoints.js` |
| HTML | La vista anónima inyecta la barra de descarga, no ofrece JSON, usa la plantilla temporal y se sirve con `Cache-Control: private, no-store`. | `test/functions/test-result-endpoints.js` |
| ZIP | La descarga devuelve `application/zip`, el nombre `<uuid>.zip`, la firma de archivo y el HTML limpio sin la barra de la aplicación. | `test/functions/test-download-html.js` |
| ZIP | Un recurso remoto no permitido se cuenta en `X-MMUP-Missing-Count` y se añade `faltantes.txt`; un recurso `data:` no genera faltantes. | `test/functions/test-download-html.js` |
| Retención | La comprobación se ancla a `temp/{uuid}/output.json`. Un objeto de 25 horas responde `404` y se borra esa misma clave. | `test/functions/test-result-endpoints.js` |
| Ausencia de JSON | `/api/download/{uuid}` responde `404` en modo anónimo. La barra HTML anónima solo muestra «Descargar HTML». | `test/functions/test-result-endpoints.js` y `test/functions/test-html-toolbar.js` |

Matices que las pruebas deben respetar:

- La retención anónima se ancla al JSON temporal de salida, no al instante exacto de la subida. `expiresAt` es una estimación.
- `maxConcurrent` no se aplica. La concurrencia se aproxima con una clave activa por dirección de red.
- Los contadores se incrementan antes de validar el archivo, el tipo de contenido o Turnstile. Los intentos inválidos consumen cuota.
- `conversionTimeoutSeconds` no aborta la conversión. Se usa como tiempo de vida de la clave activa y como `Retry-After`.
- La variante pública no ofrece descarga de JSON. El JSON se genera para construir el HTML, pero no se expone.

## 6. Variante con inicio de sesión y R2

| Área | Qué se comprueba | Dónde |
|---|---|---|
| Inicio de sesión | Un acceso correcto devuelve el usuario y una cookie `__Host-mmup_session` con `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` y sin `Domain`. | `test/functions/test-login.js` |
| Inicio de sesión | El registro de sesión guarda el usuario y el tiempo de vida configurado; un acceso correcto borra el contador de intentos. | `test/functions/test-login.js` |
| Inicio de sesión | Usuario o contraseña incorrectos devuelven el mismo `401` genérico y no crean sesión. | `test/functions/test-login.js` |
| Inicio de sesión | Con el acceso desactivado, `/api/login` responde `404` y no toca el contador. Si faltan secretos, falla de forma cerrada con `401`. | `test/functions/test-login.js` |
| Inicio de sesión | Un cuerpo mal formado responde `400`; el límite de intentos responde `429` con `Retry-After`; sin `CF-Connecting-IP` se usa el contador `unknown`. | `test/functions/test-login.js` |
| Sesión | Una sesión válida devuelve el usuario; una cookie ausente, vacía, desconocida, caducada o mal formada no autentica. Las caducadas y mal formadas se eliminan. | `test/functions/test-session.js` |
| Sesión | El cierre de sesión borra el registro y la cookie, también sin cookie o sin almacenamiento. La cookie conserva las invariantes `__Host-`. | `test/functions/test-session.js` |
| Protección | Sin sesión, las rutas protegidas responden `401`; con el catálogo desactivado o el acceso desactivado, `/api/list` responde `404`; un fallo de configuración responde `500`. | `test/functions/test-session-guard.js` |
| Catálogo | `/api/list` responde `401` sin sesión, `404` con el acceso o el catálogo desactivados y `200` con sesión. Devuelve elementos ordenados por fecha, con grupo y versión `v7`. | `test/functions/test-list.js` |
| Catálogo | La paginación sigue el cursor y un cubo ausente responde `500`. | `test/functions/test-list.js` |
| Descarga JSON | `/api/download/{uuid}` responde `401` sin sesión y `200` con sesión, con el nombre de archivo normalizado a partir de `metadata.source_file`. | `test/functions/test-result-endpoints.js` |
| Descarga HTML | La vista con sesión ofrece «Descargar HTML» y «Descargar JSON»; el ZIP se genera con sesión y no incluye la barra de la aplicación. | `test/functions/test-result-endpoints.js` y `test/functions/test-download-html.js` |
| PBKDF2 | Se comprueban el hash, la verificación, la sal, la longitud de la clave y el rechazo de parámetros inválidos. | `test/shared/test-session.js` y `test/functions/test-login.js` |

Matices que las pruebas deben respetar:

- La ruta del catálogo es `/api/list`. `/api/lista` no es una ruta de API; puede devolver la página estática con `200`.
- `loginEnabled` decide el modo general. `catalogEnabled` solo controla el catálogo y `/api/list`; no activa el inicio de sesión.
- En modo catálogo, `/api/config` devuelve `rateLimit: null`.
- Desactivar `loginEnabled` no invalida las sesiones de forma proactiva. Se borran al consultar `/api/session` o al caducar.
- Las pruebas usan un cubo R2 simulado. No leen ni escriben un cubo real.

### 6.1. PBKDF2 y el valor de referencia de 5.000 iteraciones

Las suites de sesión y de inicio de sesión usan 1.000 iteraciones para que la ejecución sea rápida. Comprueban el mecanismo PBKDF2, no un número concreto de iteraciones.

El valor de referencia de esta distribución es **5.000 iteraciones**. Se fija al generar los secretos y se revisa en el despliegue:

```bash
node scripts/generate-secrets.js --iterations 5000
```

`ADMIN_PASSWORD_ITERATIONS` debe coincidir con el valor usado para generar `ADMIN_PASSWORD_HASH` y `ADMIN_PASSWORD_SALT`. Si cambias las iteraciones, regenera los tres valores juntos. No cambies solo uno.

## 7. Variante local

La normalización de nombres está cubierta por `test/converter/test-layers-5-8.js`. La recursión, la generación de HTML, la omisión de salidas y el código de salida no tienen una suite que invoque los scripts locales; se comprueban manualmente con los comandos de esta sección.

### 7.1. Recursión y HTML

Prepara una entrada con una subcarpeta:

```bash
mkdir -p .tmp/pruebas/recursivo/entrada/subcarpeta .tmp/pruebas/recursivo/salida
cp examples/entrada/mapa-minimo.mup .tmp/pruebas/recursivo/entrada/subcarpeta/
```

Sin `--recursive`, el archivo de la subcarpeta no se procesa:

```bash
node scripts/convert.js --input .tmp/pruebas/recursivo/entrada --output .tmp/pruebas/recursivo/salida
```

Con `--recursive`, se procesa y se escribe la salida plana en la carpeta indicada:

```bash
node scripts/convert.js --input .tmp/pruebas/recursivo/entrada --output .tmp/pruebas/recursivo/salida --recursive --html
```

Comprueba que la segunda ejecución genera el JSON y el HTML del mapa. La salida es plana: no se reproduce `subcarpeta/` dentro de `salida`.

Para la comprobación principal con los ejemplos:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

### 7.2. Omisión de salidas existentes

Vuelve a ejecutar el comando anterior:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

Los seis archivos existentes deben contarse como omitidos. No se sobrescribe ninguno. Si existe el JSON pero falta el HTML, el mapa se omite completo. Para regenerar una salida, usa otra carpeta o elimina los archivos que quieras reemplazar.

### 7.3. Normalización de nombres

La suite automática comprueba, entre otros casos, que la base `Mapa de Ángeles` produce `Mapa-de-Angeles` y que `España 2026.mup` produce `Espana-2026.mup`.

Comprobación manual:

```bash
mkdir -p .tmp/pruebas/nombres/entrada .tmp/pruebas/nombres/salida
cp examples/entrada/mapa-minimo.mup ".tmp/pruebas/nombres/entrada/Mapa de Ángeles.mup"
node scripts/convert.js --input .tmp/pruebas/nombres/entrada --output .tmp/pruebas/nombres/salida
```

Debe aparecer `.tmp/pruebas/nombres/salida/Mapa-de-Angeles.json`. Los puntos del nombre se conservan; los acentos se eliminan; las mayúsculas y minúsculas no se cambian.

### 7.4. Código de salida

Un lote correcto termina con código 0, aunque todos los archivos se hayan omitido:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
echo $?
```

Un archivo inválido se cuenta como fallido y produce código 1, sin detener el resto del lote:

```bash
mkdir -p .tmp/pruebas/fallo/entrada .tmp/pruebas/fallo/salida
cp test/fixtures/mup/invalido-json.mup .tmp/pruebas/fallo/entrada/
node scripts/convert.js --input .tmp/pruebas/fallo/entrada --output .tmp/pruebas/fallo/salida
echo $?
```

Un error fatal, como una carpeta de entrada inexistente, termina antes del resumen y devuelve código 1:

```bash
node scripts/convert.js --input .tmp/pruebas/no-existe --output .tmp/pruebas/salida
echo $?
```

`convertir-local.js` comparte el motor y el código de salida, pero no interpreta `--input`, `--output` ni `--help`. Usa variables de entorno o `config.local.json`:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=.tmp/pruebas/salida-json node scripts/convertir-local.js
```

## 8. Pruebas omitidas de forma controlada

`test/visualizer/test-layers.js` contiene nueve comprobaciones de página que todavía no se han migrado al modelo de sesión en servidor. La constante `PAGE_AVAILABLE` vale `false`; por eso `testPage` no ejecuta la comprobación, incrementa el contador `skippedTests` e imprime:

```text
⏭️  <nombre> — omitido (página aún no migrada)
```

Las nueve comprobaciones son:

- `6.25 _headers de la página estática: CSP coherente con app.js (S-2 de la revisión 2d)`
- `U3.4 Página estática: encodeURIComponent y node_count numérico (VIS-C3)`
- `U3.5 Página estática: escapeHtml local escapa comillas (VIS-C3)`
- `U3.8 Página estática: script externalizado para la CSP (W2)`
- `U3.9 Login: index.html incluye formulario accesible y cierre de sesión`
- `U3.10 Login: app.js verifica SHA-256 contra credenciales.json y gestiona la sesión`
- `U3.11 Login: credenciales.json solo guarda usuario y hash SHA-256 (sin contraseña)`
- `U3.12 Página estática: listado en tabla ordenable y título (VIS-C3)`
- `U3.13 Página estática: ordenación, fecha UTC y nombre desde source_file`

Estas comprobaciones describen la página antigua con inicio de sesión en el cliente y `credentials.json`. No son válidas para el modelo actual, que usa sesiones en servidor. No las presentes como superadas: están omitidas y no suman al total de pruebas ejecutadas. `npm run test:visualizer` imprime el número de omitidas y termina con código 0 si las demás pruebas pasan.

La estructura estática actual se cubre en `npm run test:ui`. El inicio de sesión en servidor se cubre en `npm run test:functions`. Cuando se reescriban las pruebas de página, hay que migrarlas al modelo actual y retirar `PAGE_AVAILABLE`; no basta con cambiar el valor de la constante si las suposiciones antiguas siguen en el código.

## 9. Evidencias

Guarda las evidencias en `.tmp/evidencias/`, que no se versiona. Una evidencia útil incluye la fecha, la versión de Node.js, el commit y el código de salida de cada comando.

```bash
mkdir -p .tmp/evidencias
node --version > .tmp/evidencias/node-version.txt
git rev-parse HEAD > .tmp/evidencias/commit.txt
date -u +%Y-%m-%dT%H:%M:%SZ > .tmp/evidencias/fecha.txt

npm test > .tmp/evidencias/npm-test.log 2>&1
echo "npm test: $?" >> .tmp/evidencias/exit-codes.txt
```

Si `npm test` falla, ejecuta las suites por separado para aislar el problema y conserva cada registro:

```bash
for suite in shared converter visualizer functions ui; do
  npm run "test:$suite" > ".tmp/evidencias/test-$suite.log" 2>&1
  printf '%s: %s\n' "$suite" "$?" >> .tmp/evidencias/exit-codes.txt
done
```

Conserva también la validación de configuración y la conversión local:

```bash
node scripts/validate-config.js --config config.local.json --variables config.variables.local.json > .tmp/evidencias/validate-config.log 2>&1
echo "validate-config: $?" >> .tmp/evidencias/exit-codes.txt

node scripts/convert.js --input examples/entrada --output .tmp/evidencias/salida --html > .tmp/evidencias/convert-local.log 2>&1
echo "convert-local: $?" >> .tmp/evidencias/exit-codes.txt
```

Para dejar constancia de las pruebas omitidas:

```bash
grep -n "omitidos de forma controlada" .tmp/evidencias/test-visualizer.log
```

### 9.1. Comprobación de secretos y datos privados

Comprueba que no hay contenedores sensibles versionados:

```bash
git ls-files | grep -E '(^|/)(\.env|\.dev\.vars|credenciales\.tsv|config\.local\.json|config\.variables\.local\.json|wrangler\.jsonc|.*\.local\..*)$' \
  || echo "Sin contenedores sensibles versionados."
```

Busca valores con forma de secreto en los archivos versionados:

```bash
git grep -nE 'BEGIN [A-Z ]*PRIVATE KEY|CLOUDFLARE_API_TOKEN[=][A-Za-z0-9]|ADMIN_PASSWORD[=][^<{ ]|INTERNAL_SHARED_SECRET[=][A-Za-z0-9_-]{20,}' \
  -- . ':(exclude)docs/pruebas.md' \
  || echo "Sin valores con forma de secreto."
```

Busca rutas absolutas y direcciones de despliegue:

```bash
git grep -nE '/[[:alnum:]_.-]+/[[:alnum:]_.-]+/|[A-Za-z]:[/\\][^ ]+|https?://[^ )]*(pages\.dev|workers\.dev)' \
  -- . ':(exclude)docs/pruebas.md' \
  || true
```

Esta página contiene los propios patrones de búsqueda; por eso las dos órdenes excluyen `docs/pruebas.md`. Revisa esta página a mano. Los marcadores como `https://<PROYECTO>.pages.dev` son plantillas; un subdominio concreto exige revisión. No copies direcciones del despliegue privado.

Revisa también los registros de evidencia:

```bash
grep -RInE '(/[[:alnum:]_.-]+/[[:alnum:]_.-]+/|[A-Za-z]:[/\\][^ ]+|BEGIN [A-Z ]*PRIVATE KEY|CLOUDFLARE_API_TOKEN[=][A-Za-z0-9]|ADMIN_PASSWORD[=][^<{ ])' \
  .tmp/evidencias || true
```

Las suites usan valores de prueba como `secret` o contraseñas sintéticas. Esos valores pueden aparecer en un registro y no son secretos reales. No ejecutes las suites con secretos reales exportados y no adjuntes registros con datos de una instalación real a una incidencia pública.

## 10. Resolución de problemas habituales

| Síntoma | Causa probable | Solución |
|---|---|---|
| `node: command not found` o una versión inferior a 22 | Node.js no está instalado o es antiguo. | Instala Node.js 22 o superior y comprueba `node --version`. |
| `npm test` se detiene después de una suite | La cadena usa `&&` y la suite anterior falló. | Ejecuta `npm run test:<suite>` para localizar el fallo y corrige primero esa suite. |
| `ERR_MODULE_NOT_FOUND` o `Cannot find module` | El comando se ejecutó fuera de la raíz o se copió solo una carpeta. | Ejecuta desde la raíz del repositorio y conserva `src/`, `test/` y `scripts/`. |
| `No se encontró el archivo de configuración` | No existe `config.local.json` o `config.variables.local.json`. | Copia las plantillas con los comandos de la sección 2.2. |
| `No se pudo leer la configuración` | El archivo de configuración no contiene JSON válido. | Corrige el JSON o usa otra copia de la plantilla. |
| `Faltan las carpetas de entrada o salida` | No se indicaron las rutas. | Usa `--input` y `--output`, `MUP_INPUT_DIR` y `MUP_OUTPUT_DIR`, o `config.local.json`. |
| `Opción desconocida` | `convert.js` no reconoce el argumento. | Consulta `node scripts/convert.js --help`. `convertir-local.js` no acepta opciones. |
| Todos los mapas se omiten | Las salidas ya existen. | Usa otra carpeta de salida o elimina solo las salidas que quieras regenerar. |
| No se generan las subcarpetas | Falta `--recursive`. | Añade `--recursive` a `convert.js`. |
| No se genera HTML | Falta `--html` o se usó `convertir-local.js`. | Usa `convert.js` con `--html`; `convertir-local.js` nunca genera HTML. |
| `Formato .mup no soportado. Se esperaba versión 3, se recibió <versión>.` | El archivo declara un `formatVersion` distinto de 3. | Comprueba el campo interno del `.mup`. El conversor no lee la versión comercial de MindMup y no admite otros valores. |
| El visualizador imprime pruebas omitidas | Son las nueve comprobaciones de página pendientes de migrar. | No es un fallo. Consúltalas en la sección 8 y no las cuentes como superadas. |
| El inicio de sesión falla después de cambiar PBKDF2 | El hash, la sal y las iteraciones no son coherentes. | Regenera los tres valores juntos con `--iterations 5000` y actualiza `ADMIN_PASSWORD_ITERATIONS`. |
| `EACCES` al escribir | La carpeta de salida no tiene permisos de escritura. | Usa una carpeta escribible o corrige los permisos. |

## 11. Limitaciones

- No hay integración continua ni GitHub Actions. Las pruebas se ejecutan manualmente antes de publicar y después de cada cambio relevante.
- No hay despliegue automático. Las suites no publican Pages, no despliegan Workers y no crean recursos de Cloudflare.
- Las pruebas de Functions usan mocks y almacenamiento en memoria. No demuestran el comportamiento de un R2, un Durable Object o una cuenta de Cloudflare reales.
- Las nueve comprobaciones de página del visualizador están omitidas de forma controlada. No cuentan como cobertura superada.
- La recursión, la generación de HTML, la omisión de salidas y el código de salida de los scripts locales se comprueban manualmente. La normalización de nombres sí tiene cobertura automática.
- Las suites de PBKDF2 usan 1.000 iteraciones para abreviar la ejecución. El valor de referencia de la distribución es 5.000, pero no hay una aserción automática de ese número.
- La retención se prueba con un objeto simulado de 25 horas. No se espera un día real ni se comprueba una política de ciclo de vida de R2.
- No se prueban cargas, tiempos de conversión, límites reales de la plataforma ni ataques de seguridad. Las pruebas de HTML cubren casos de escape y recursos, no una auditoría completa.
- No se prueba el límite de 30 MB del ZIP ni todos los estados de error de todas las rutas.
- `conversionTimeoutSeconds` no aborta la conversión. Se usa como tiempo de vida de la clave activa y como `Retry-After`.
- `maxConcurrent` no se aplica. La concurrencia se aproxima con una clave activa por dirección de red.
- Los intentos inválidos consumen cuota. Los contadores se incrementan antes de validar el archivo, el tipo de contenido o Turnstile.
- No se prueba la página de presentación de `site/`. La suite de interfaz cubre el shell de `app/`.
- La compatibilidad con MindMup 2 no se ha verificado de forma universal. La suite usa datos con `formatVersion: 3` y un fixture con `formatVersion: 2`; no incluye una muestra representativa de archivos reales de MindMup 2 ni de MindMup 3.

## Documentación relacionada

- [Conversor local](conversor-local.md)
- [Arquitectura](arquitectura.md)
- [Seguridad](seguridad.md)
- [Configuración](configuracion.md)
- [README del proyecto](../README.md)
- [Ejemplos](../examples/README.md)
