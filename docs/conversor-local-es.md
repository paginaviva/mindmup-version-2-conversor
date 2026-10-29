# Conversor local — MindMup 2 Conversor

[Español](conversor-local-es.md) | [English](conversor-local-en.md)


El conversor local de MindMup 2 Conversor convierte archivos `.mup` compatibles con `formatVersion: 3` en JSON-CMJN y, si se indica, en un HTML autocontenido. Funciona con Node.js y el sistema de archivos: no usa Cloudflare, Wrangler ni dependencias npm. Los resultados se guardan en el disco del usuario.

## Compatibilidad de los archivos

El conversor acepta archivos `.mup` compatibles con `formatVersion: 3`. La compatibilidad se decide por ese valor interno, no por la versión comercial de MindMup:

- Acepta `.mup` con `formatVersion: 3` y un objeto `ideas` no vacío.
- Rechaza los archivos con `formatVersion: 2` y cualquier otro valor distinto de 3.
- No lee ni valida la versión comercial de MindMup (2 o 3).
- No se ha podido demostrar que todos los archivos de MindMup 2 usen `formatVersion: 3`; comprueba el valor del archivo antes de asumir que se aceptará.
- `v7` es la versión del conversor, no la de MindMup ni la del formato `.mup`.

La [documentación oficial de MindMup](https://www.mindmup.com/) no documenta este valor interno. El proyecto no afirma compatibilidad universal con todos los mapas de MindMup 2 ni incompatibilidad universal con MindMup 3.

La ejecución es manual. No hay integración continua ni GitHub Actions.

## 1. Requisitos

- Node.js 22 o superior. El requisito está declarado en `package.json`.
- Ninguna dependencia npm que instalar. No ejecutes `npm install` para usar el conversor.
- Ningún recurso de Cloudflare: ni cuenta, ni Workers, ni Pages, ni R2, ni almacenamiento clave-valor, ni Durable Objects.
- Un archivo `.mup` con `formatVersion: 3` y un objeto `ideas` no vacío. Comprueba el valor interno antes de convertirlo.
- Permiso de lectura sobre la carpeta de entrada y de escritura sobre la carpeta de salida.
- Los ejemplos se ejecutan desde la raíz del repositorio. Los scripts importan módulos de `src/`, así que no copies solo la carpeta `scripts/`.

No se aplican los límites de las variantes web: tamaño mínimo o máximo, cuota por dirección de red, retención, sesiones ni catálogo. La retención de 24 horas corresponde a la variante pública. Esas comprobaciones pertenecen a Pages Functions.

## 2. Herramientas

| Herramienta | Subcarpetas | HTML | Selección de rutas | Ayuda |
|---|---|---|---|---|
| `scripts/convert.js` | Con `--recursive` | Con `--html` | Opciones de línea de comandos, variables de entorno y configuración | `--help` y `-h` |
| `scripts/convertir-local.js` | No | No | Variables de entorno y configuración | No |

Las dos herramientas leen archivos `.mup`, escriben JSON-CMJN, omiten las salidas existentes y resuelven las rutas relativas desde el directorio actual. `convertir-local.js` importa y reutiliza el motor de `convert.js`; no es una implementación distinta.

`convertir-local.js` no interpreta argumentos. No le pases opciones como `--input`, `--output` o `--help`: las ignora y ejecuta la conversión con la configuración disponible.

## 3. Configuración local y variables de entorno

### 3.1. Prioridad

| Dato | `convert.js` | `convertir-local.js` |
|---|---|---|
| Carpeta de entrada | `--input`, después `MUP_INPUT_DIR`, después `local.inputDir` | `MUP_INPUT_DIR`, después `local.inputDir` |
| Carpeta de salida | `--output`, después `MUP_OUTPUT_DIR`, después `local.outputDir` | `MUP_OUTPUT_DIR`, después `local.outputDir` |
| Archivo de configuración | `--config`, después `config.local.json` | `MUP_CONFIG_FILE`, después `config.local.json` |

La prioridad se lee de izquierda a derecha: la primera opción disponible gana.

### 3.2. Archivo de configuración

`convert.js` y `convertir-local.js` leen la sección `local` del archivo de configuración. El resto de claves no se usa en la conversión local.

```json
{
  "local": {
    "inputDir": "./examples/entrada",
    "outputDir": "./examples/salida"
  }
}
```

Puedes usar el mismo `config.local.json` que contiene las claves de `config.example.json`: los scripts locales solo leen `local`. La configuración de las variantes web se explica en [configuracion-es.md](configuracion-es.md).

- Si el archivo no existe, se ignora. El error aparece si faltan las carpetas de entrada o de salida.
- Si el archivo existe y no contiene JSON válido, el proceso termina con un error.
- `--config` y `MUP_CONFIG_FILE` aceptan una ruta relativa al directorio actual.
- `convert.js` no lee `MUP_CONFIG_FILE`. `convertir-local.js` no acepta `--config`.
- Las rutas de entrada y salida también se resuelven desde el directorio actual.

### 3.3. Variables de entorno

| Variable | Herramienta | Uso |
|---|---|---|
| `MUP_INPUT_DIR` | Las dos | Carpeta de entrada. |
| `MUP_OUTPUT_DIR` | Las dos | Carpeta de salida. |
| `MUP_CONFIG_FILE` | Solo `convertir-local.js` | Archivo de configuración. |

Los scripts no cargan `.env` por sí solos. Exporta las variables en la terminal o usa el archivo de configuración.

```bash
MUP_INPUT_DIR=./examples/entrada \
MUP_OUTPUT_DIR=./examples/salida \
node scripts/convertir-local.js
```

## 4. Comandos de ejecución y ayuda

```bash
# Ayuda de convert.js
node scripts/convert.js --help

# Conversión de la raíz de la carpeta de entrada
node scripts/convert.js --input examples/entrada --output examples/salida

# Conversión con subcarpetas y HTML
node scripts/convert.js --input examples/entrada --output examples/salida --recursive --html

# Conversión con un archivo de configuración
node scripts/convert.js --config ./config.local.json

# Conversión local sin opciones: usa variables de entorno o config.local.json
node scripts/convertir-local.js

# Conversión local con variables de entorno
MUP_INPUT_DIR=./examples/entrada MUP_OUTPUT_DIR=./examples/salida node scripts/convertir-local.js

# Conversión local con un archivo de configuración distinto
MUP_CONFIG_FILE=./config.local.json node scripts/convertir-local.js
```

`node scripts/convert.js --help` muestra este texto:

```text
Uso:
  node scripts/convert.js --input <carpeta> --output <carpeta> [opciones]

Opciones:
  --input <carpeta>     Carpeta de entrada.
  --output <carpeta>    Carpeta de salida.
  --recursive           Recorre subcarpetas.
  --html                Genera también el HTML autocontenido.
  --config <archivo>    Configuración local (por defecto: config.local.json).
  --help                Muestra esta ayuda.

Los archivos de salida existentes no se sobrescriben.
```

`--help` y `-h` muestran la ayuda y no convierten nada. Una opción desconocida en `convert.js` produce un error y el código de salida 1.

## 5. Comportamiento

### 5.1. Recursión y selección de archivos

- Sin `--recursive`, `convert.js` procesa solo los archivos `.mup` de la raíz de la carpeta de entrada.
- Con `--recursive`, recorre todas las subcarpetas.
- La salida es plana: todos los JSON y HTML se escriben directamente en la carpeta de salida, sin reproducir la estructura de entrada.
- La extensión se compara sin distinguir mayúsculas y minúsculas. Los archivos que no terminan en `.mup` se ignoran.
- Los archivos se procesan en orden alfabético.
- La carpeta de salida se crea si no existe. La carpeta de entrada debe existir.

### 5.2. HTML

- `convert.js` escribe JSON siempre. Con `--html`, escribe además un archivo HTML por mapa.
- El HTML es un archivo único. No se crea una carpeta `<mapa>_archivos/`, ni un archivo `faltantes.txt`, ni un ZIP.
- `convertir-local.js` nunca genera HTML.
- El HTML se construye a partir del mismo resultado JSON-CMJN que se escribe en disco.

### 5.3. Omisión de salidas existentes

- Si el JSON ya existe, el mapa se omite.
- Con `--html`, el mapa se omite si existe el JSON o el HTML.
- No se sobrescribe ningún archivo y no hay una opción de forzado.
- Si existe el JSON pero falta el HTML, el mapa se omite completo: no se genera la parte que falta.
- La comprobación se hace antes de leer el `.mup`. Un archivo inválido con salida existente se cuenta como omitido, no como fallido.
- No se comparan fechas, tamaños ni contenido. Una salida antigua sigue bloqueando la conversión.

Para regenerar una salida, usa otra carpeta de salida o elimina los archivos que quieras reemplazar.

### 5.4. Normalización de nombres

El nombre base del archivo de entrada se transforma antes de añadir la extensión:

1. Cada secuencia de espacios se convierte en un guion.
2. Los caracteres acentuados se separan con normalización Unicode NFD y se eliminan las marcas diacríticas.
3. Se conservan solo letras sin acento, dígitos, punto, guion y guion bajo.
4. Se eliminan los guiones iniciales y finales.
5. Si no queda ningún carácter válido, se usa `salida`.

No se cambian las mayúsculas ni las minúsculas. El punto intermedio se conserva. La extensión final la añade el conversor: `.json` y, con `--html`, `.html`.

| Entrada | Nombre base normalizado | Salida JSON |
|---|---|---|
| `Mapa de Ángeles.mup` | `Mapa-de-Angeles` | `Mapa-de-Angeles.json` |
| `España 2026.mup` | `Espana-2026` | `Espana-2026.json` |
| `plan maestro.mup` | `plan-maestro` | `plan-maestro.json` |
| `###.mup` | `salida` | `salida.json` |

Dos archivos con el mismo nombre normalizado comparten salida. Si el primero ya escribió, el segundo se omite.

### 5.5. Resumen y código de salida

Cada archivo imprime una línea con el resultado: conversión, omisión o error. Al terminar, se imprime una línea con este formato:

```text
Resumen: <convertidos> convertidos, <omitidos> omitidos, <fallidos> fallidos.
```

- Un error en un archivo no detiene el lote. Se cuenta en `fallidos` y se continúa con el siguiente.
- El código de salida es 0 si no hay fallos, aunque todos los archivos se hayan omitido.
- El código de salida es 1 si algún archivo falla o si se produce un error fatal.
- Un error fatal, como una carpeta de entrada inexistente o una configuración ilegible, termina el proceso antes del resumen y devuelve 1.
- Si no hay archivos `.mup`, el resumen muestra `0 convertidos, 0 omitidos, 0 fallidos` y el código es 0.

### 5.6. Formato de las salidas

- El JSON se escribe con indentación de dos espacios y un salto de línea final.
- El JSON contiene las 10 colecciones de JSON-CMJN.
- `metadata.source_file` es el nombre del archivo de entrada.
- `metadata.converted_at` es la fecha de conversión en formato ISO 8601.
- `metadata.node_count` es el número de nodos del mapa.
- El HTML se escribe como un archivo de texto independiente.

## 6. Ejemplos con `examples/entrada` y `examples/salida`

La carpeta `examples/entrada` contiene tres mapas sintéticos:

| Archivo | Contenido |
|---|---|
| `mapa-minimo.mup` | Árbol mínimo con nodo raíz e hijos. |
| `mapa-completo.mup` | Notas, atributos, pegatinas, enlaces externos e icono. |
| `mapa-con-adjunto.mup` | Adjunto de texto y un icono pequeño. |

Convierte los tres mapas con JSON y HTML:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

Salidas esperadas:

```text
examples/salida/mapa-minimo.json
examples/salida/mapa-minimo.html
examples/salida/mapa-completo.json
examples/salida/mapa-completo.html
examples/salida/mapa-con-adjunto.json
examples/salida/mapa-con-adjunto.html
```

Si vuelves a ejecutar el mismo comando, los seis archivos se omiten. Para ver una conversión nueva, usa otra carpeta de salida o elimina las salidas anteriores.

Para generar solo JSON, sin HTML y sin recorrer subcarpetas:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=examples/salida-json node scripts/convertir-local.js
```

Salidas esperadas:

```text
examples/salida-json/mapa-minimo.json
examples/salida-json/mapa-completo.json
examples/salida-json/mapa-con-adjunto.json
```

Los datos de los ejemplos son sintéticos. Consulta [examples/README-es.md](../examples/README-es.md) para ver el alcance de cada archivo.

## 7. Limitaciones verificadas y problemas habituales

### 7.1. Limitaciones

- No se aplican los límites de las variantes web: tamaño mínimo de 1 KB, tamaño máximo de 16 MB, cuota por dirección de red, retención de 24 horas, sesiones ni catálogo.
- No se valida el tamaño del archivo. La validación explícita de entrada se limita a comprobar que el JSON sea válido, que `formatVersion` sea 3 y que `ideas` exista y no esté vacío.
- No hay opción para sobrescribir salidas existentes.
- La salida es plana. Dos archivos con el mismo nombre normalizado comparten salida y el segundo se omite.
- `convertir-local.js` no acepta opciones de línea de comandos ni muestra ayuda.
- `convert.js` lee solo la sección `local` del archivo de configuración. Las claves de `app-config` y `app-variables` no se usan en la conversión local.
- Los scripts no cargan `.env` automáticamente.
- El HTML local no genera ZIP, carpeta de recursos ni archivo de recursos faltantes.
- Si el HTML falla después de escribir el JSON, el JSON permanece en disco y el archivo se cuenta como fallido.
- Los scripts dependen de `src/`. No copies solo la carpeta `scripts/`.
- No se admite un `.mup` con `formatVersion` distinto de 3.

### 7.2. Problemas habituales

| Síntoma | Causa probable | Solución |
|---|---|---|
| `Faltan las carpetas de entrada o salida. Usa --input/--output, MUP_INPUT_DIR/MUP_OUTPUT_DIR o config.local.json.` | No se indicó la entrada o la salida. | Usa las opciones de `convert.js`, las variables de entorno o `config.local.json`. En `convertir-local.js`, usa variables de entorno o configuración: no acepta opciones. |
| `No se pudo leer la configuración "<ruta>": ...` | El archivo de configuración no contiene JSON válido. | Corrige el JSON o usa otro archivo. |
| `Opción desconocida: <opción>` | Se escribió una opción que `convert.js` no reconoce. | Consulta `node scripts/convert.js --help`. |
| `Formato .mup no soportado. Se esperaba versión 3, se recibió <versión>.` | El archivo no tiene `formatVersion: 3`. | Comprueba el valor interno `formatVersion` del archivo. El conversor solo admite 3; no interpreta la versión comercial de MindMup. |
| `El archivo .mup no contiene un objeto ideas válido o está vacío.` | Falta el árbol `ideas` o no tiene nodos. | Corrige el archivo o expórtalo de nuevo. |
| Error de JSON al leer el `.mup` | El archivo no es JSON válido o está dañado. | Expórtalo de nuevo desde MindMup. |
| `ENOENT` al recorrer la carpeta de entrada | La carpeta de entrada no existe o la ruta es incorrecta. | Revisa la ruta y ejecuta desde la raíz del repositorio. |
| No se procesan las subcarpetas | Falta `--recursive`. | Añade `--recursive` a `convert.js`. |
| No se genera HTML | Falta `--html` o se usó `convertir-local.js`. | Usa `convert.js` con `--html`. |
| Todos los archivos se omiten | Las salidas ya existen. | Usa otra carpeta de salida o elimina las salidas que quieras regenerar. |
| Existe el JSON, falta el HTML y no se genera | Con `--html`, la existencia del JSON omite el mapa completo. | Elimina el JSON o usa otra carpeta de salida. |
| Dos archivos comparten salida | Los nombres normalizados coinciden. | Renombra una entrada o usa carpetas de salida separadas. |
| `convertir-local.js` ignora `--input` y `--output` | El script no interpreta argumentos. | Usa `MUP_INPUT_DIR`, `MUP_OUTPUT_DIR` o `config.local.json`. |
