# MindMup 2 Conversor

[![Licencia MIT](https://img.shields.io/static/v1?label=licencia&message=MIT&color=2ea44f)](LICENSE) [![Node.js 22 o superior](https://img.shields.io/static/v1?label=Node.js&message=22%20o%20superior&color=339933)](package.json)

MindMup 2 Conversor recupera, transforma, visualiza y conserva mapas históricos de MindMup 2. Procesa archivos `.mup` con `formatVersion: 3`, los convierte en JSON-CMJN normalizado de diez colecciones y genera un HTML autocontenido que se puede consultar y descargar.

El nombre identifica el objetivo del proyecto: recuperar, consultar y conservar mapas históricos de MindMup 2. La compatibilidad técnica se decide por el valor interno `formatVersion`, no por el nombre comercial de la aplicación.

- **MindMup:** [https://www.mindmup.com/](https://www.mindmup.com/)
- **Conversor público:** [https://pg-mindmup-v2-public.pages.dev/](https://pg-mindmup-v2-public.pages.dev/)
- **Página de presentación:** [https://pg-mindmup-v2-web.pages.dev/](https://pg-mindmup-v2-web.pages.dev/)
- **Repositorio:** [https://github.com/paginaviva/mindmup-version-2-conversor](https://github.com/paginaviva/mindmup-version-2-conversor)
- **Documentación:** [https://pg-mindmup-v2-web.pages.dev/#documentacion](https://pg-mindmup-v2-web.pages.dev/#documentacion)
- **Licencia MIT:** [https://pg-mindmup-v2-web.pages.dev/#licencia](https://pg-mindmup-v2-web.pages.dev/#licencia)

## Contexto: de MindMup 2 a MindMup 3

[MindMup](https://www.mindmup.com/) es una aplicación web para crear mapas mentales y organizar ideas mediante nodos y relaciones jerárquicas. Su web oficial presenta también organigramas, diagramas de espina de pescado, visualización de argumentos, notas, adjuntos, publicación, presentaciones, almacenamiento en Google Drive, inicio de sesión único y aplicación de escritorio.

La [documentación oficial de la migración](https://www.mindmup.com/help/news/mindmup-3-migration/) anuncia que MindMup 3 comienza a sustituir a MindMup 2 a partir del 13 de abril, de forma gradual. Según esa página:

- Los mapas se trasladan automáticamente.
- Los equipos y miembros se conservan.
- La configuración y el historial de la cuenta permanecen.
- En el modo de vista previa, los mapas existentes aparecen en MindMup 3 como solo lectura; la edición de mapas existentes sigue en MindMup 2 hasta la migración.
- Measures, Progress y Storyboards no pasan a MindMup 3. Los mapas de tipo Fishbone quedan como solo lectura; los mapas de argumentos se reintroducen.
- La propia página responde «No» a la pregunta «Will Anything Be Lost?» y explica que mapas, equipos, miembros y configuración se trasladan.

La documentación oficial no presenta la migración como una pérdida de mapas ni como un traslado manual. Tampoco afirma que todos los mapas de MindMup 2 sean incompatibles con MindMup 3 ni que la migración exija un pago.

### Lectura, edición, importación, migración y exportación

Estas cinco acciones no son equivalentes. La documentación oficial las trata por separado:

| Acción | Qué significa | Lo que dice la documentación oficial |
|---|---|---|
| Lectura | Abrir y consultar un mapa. | Los mapas existentes en Google Drive siguen accesibles. En el plan Starter, los mapas que superan el límite editable pasan a solo lectura y se pueden abrir y consultar. |
| Edición | Modificar y guardar un mapa. | Desde el 1 de junio de 2026, MindMup para Google Drive requiere una suscripción Personal o superior; los usuarios gratuitos ya no pueden crear ni editar mapas con esa aplicación después de esa fecha. Los suscriptores Personal, Team y Organization conservan acceso completo. |
| Importación | Incorporar un mapa a una cuenta o aplicación. | La página de migración indica que los mapas se pueden exportar a Google Drive o importar desde Google Drive. Este conversor no importa mapas a MindMup. |
| Migración | Trasladar una cuenta de MindMup 2 a MindMup 3. | Es gradual desde el 13 de abril y los mapas se trasladan automáticamente. La página indica que no hace falta exportar ni mover el trabajo a mano. |
| Exportación | Guardar una copia del mapa en un archivo. | La página de Google Drive recomienda exportar y guardar los mapas importantes antes del 1 de junio de 2026 a quienes no vayan a actualizar. El conversor no exporta desde MindMup: procesa un `.mup` que ya hayas exportado. |

La documentación oficial también anuncia que, a partir del 6 de octubre, el plan Starter incluye hasta tres mapas editables en lugar de cinco. Los mapas existentes no se eliminan: los que superan el límite pasan a solo lectura y siguen disponibles en el panel. Los tres mapas creados más recientemente permanecen editables; los más antiguos pasan a solo lectura. Para editar más de tres hace falta actualizar el plan.

En resumen: accesible no es lo mismo que editable. La lectura puede seguir disponible aunque la edición requiera una suscripción o un plan superior.

## Problema y motivación

Los mapas pueden contener años de trabajo, notas, relaciones y conocimiento personal o profesional. Cuando cambian las versiones, las condiciones de acceso o las funcionalidades de una plataforma, conservar los archivos no siempre equivale a poder consultarlos con comodidad.

MindMup 2 Conversor nace para recuperar, leer y preservar esa información histórica. El foco no es la dificultad técnica del JSON, sino el contenido que hay dentro de los mapas y la posibilidad de seguir consultándolo sin depender permanentemente de la aplicación original.

El proyecto parte de los archivos `.mup` que el usuario ya tiene. No es una acusación contra MindMup: es una herramienta de conservación y consulta basada en hechos verificables. No afirma que todos los mapas de MindMup 2 sean incompatibles con MindMup 3, que se pierdan al migrar o que la migración exija un pago.

## Beneficios

1. **Recuperar y leer.** Procesa archivos `.mup` con `formatVersion: 3` y extrae la información estructurada que el conversor reconoce: nodos, notas, atributos, pegatinas, iconos, enlaces internos, referencias externas y adjuntos.
2. **Visualizar en HTML.** Genera una representación HTML navegable con la jerarquía, las notas, los recursos y los elementos compatibles. El HTML incluye los estilos y los scripts en el propio documento.
3. **Descargar y conservar.** Permite guardar el resultado para consultarlo después: vista previa HTML y ZIP en la variante pública; JSON, vista previa HTML y ZIP en la instalación privada; JSON y HTML opcional en el conversor local.

El conversor procesa los elementos que reconoce. No garantiza la conservación de elementos del mapa que no estén contemplados en sus capas ni en las diez colecciones.

## Compatibilidad técnica

La compatibilidad se decide por el valor interno `formatVersion`, no por el nombre comercial de la aplicación.

| Comprobación | Resultado |
|---|---|
| `.mup` con `formatVersion: 3` y un objeto `ideas` no vacío | Se acepta. `src/converter/layers/layer1-parse.js` compara el valor con `MUP_FORMAT_VERSION`; `config.variables.example.json` y `scripts/convert.js` lo fijan en `3`. |
| `.mup` con `formatVersion: 2` | Se rechaza. La prueba `test/converter/test-layers-1-4.js` lo comprueba con el fixture `test/converter/fixtures/synthetic-v2.mup`. |
| Versión comercial de MindMup | El conversor no la lee ni la valida. No distingue entre MindMup 2 y MindMup 3 por el nombre del producto. |
| Cualquier otro `formatVersion` | No se admite. |

La documentación oficial consultada no documenta el valor interno `formatVersion` de los archivos `.mup`. Por eso no se puede afirmar que todos los mapas exportados por MindMup 2 usen `formatVersion: 3`, ni que todos los exportados por MindMup 3 usen otro valor. Comprueba el `formatVersion` de tu archivo antes de asumir que el conversor lo aceptará.

Por tanto, el proyecto no afirma compatibilidad universal con todos los mapas de MindMup 2 ni incompatibilidad universal con MindMup 3.

| Concepto | Qué es | Valor o uso |
|---|---|---|
| Versión comercial de MindMup | MindMup 2 o MindMup 3 | No la lee el conversor |
| `formatVersion` del `.mup` | Versión interna del formato de archivo | El conversor acepta 3; rechaza 2 |
| `CONVERTER_VERSION` | Versión del proceso de conversión del proyecto | `v7` |
| Versión del paquete | Versión del repositorio | `1.0.0` |

`v7` es la versión del conversor, no la versión de MindMup ni la del formato `.mup`.

## Las tres modalidades

La misma base de código se usa de tres formas. La diferencia principal es dónde se ejecuta, cómo se accede y qué se conserva.

| Aspecto | Conversor público | Instalación privada con inicio de sesión y R2 | Conversor local |
|---|---|---|---|
| Infraestructura | Cloudflare Pages, Functions y dos Workers | Cloudflare Pages, Functions y dos Workers, en una cuenta propia | Node.js, sin Cloudflare |
| Acceso | Sin cuenta | Usuario y contraseña | Línea de comandos |
| Catálogo | No | Sí, con sesión y `catalogEnabled` | No |
| Salida | Vista previa HTML y ZIP del HTML | JSON, vista previa HTML y ZIP del HTML | JSON y HTML opcional |
| Descarga de JSON | No | Sí | Sí, como archivo |
| Almacenamiento | R2 temporal, 24 horas | R2 en `output/`, sin borrado automático; el original se elimina al convertir | Carpeta local del usuario |
| Configuración | `loginEnabled: false`, `catalogEnabled: false` | `loginEnabled: true`; `catalogEnabled` decide el catálogo | Opciones y variables de entorno |
| Guía | [Instalación pública](docs/instalacion-publica.md) | [Instalación con inicio de sesión y R2](docs/instalacion-login-r2.md) | [Conversor local](docs/conversor-local.md) |

`loginEnabled` decide el modo general. `catalogEnabled` solo controla el catálogo y la ruta `/api/list`; no activa ni desactiva el inicio de sesión, las subidas, el estado, la vista HTML ni las descargas. El catálogo requiere las dos opciones activas.

La variante pública ofrece solo HTML: vista previa y descarga del HTML en ZIP. No ofrece descarga de JSON. El JSON se genera para construir el HTML, pero no se expone. La descarga de JSON está disponible en la instalación privada y en el conversor local.

### Conversor público

Se despliega en Cloudflare Pages con Functions y dos Workers internos. La aplicación se publica en el proyecto `pg-mindmup-v2-public`; la página de presentación, en `pg-mindmup-v2-web`. Los Workers no tienen dirección pública y las Functions son el único punto de entrada.

No se muestra formulario de acceso ni catálogo. La persona sube un `.mup`, revisa la vista previa y descarga el HTML en ZIP. La retención es de 24 horas y la protección Turnstile es opcional.

### Instalación privada con inicio de sesión y R2

Está pensada para instalarse en una cuenta de Cloudflare propia. Incluye inicio de sesión con sesiones en servidor, catálogo, descarga de JSON y descarga de HTML. El catálogo lee `/api/list` y permite buscar, filtrar por grupo y ordenar en el navegador.

La contraseña se deriva con PBKDF2. La distribución usa 5.000 iteraciones como valor de referencia. Los secretos se generan con:

```bash
node scripts/generate-secrets.js --iterations 5000
```

El script no escribe archivos: imprime los secretos para guardarlos fuera del repositorio.

El original se elimina al convertir. Los resultados publicados en `output/` no se borran automáticamente.

### Conversor local

Funciona con Node.js 22 o superior, sin cuenta de Cloudflare. `convertir-local.js` procesa solo la raíz de la carpeta de entrada y no genera HTML. `convert.js` permite recorrer subcarpetas con `--recursive` y generar HTML con `--html`. Ninguno sobrescribe una salida existente.

Los resultados se guardan en el disco del usuario. No se aplica la retención de 24 horas de la variante pública.

## Retención y conservación

| Modalidad | Dónde queda el resultado | Política |
|---|---|---|
| Pública | R2 temporal, en `temp/{uuid}/output.json` | 24 horas desde la escritura del JSON de salida. La limpieza programada se ejecuta cada hora. |
| Privada | R2 en `output/` | Sin borrado automático. El original se elimina al convertir. |
| Local | Carpeta del usuario | Sin caducidad del servicio; depende del disco y de las copias del usuario. |

La retención de 24 horas es exclusiva de la variante pública. La instalación privada y el conversor local no comparten esa política.

En la variante pública, la URL caduca y los objetos temporales se eliminan. La caducidad de acceso y la eliminación física pueden no ser simultáneas: la comprobación de retención se hace contra el JSON temporal de salida y la tarea programada elimina los objetos caducados cada hora. El campo `expiresAt` es una estimación calculada al responder a la subida; la comprobación real usa la fecha del objeto temporal de salida.

Descarga el ZIP antes de que caduque la retención. En las variantes web, el original `.mup` se elimina al terminar la conversión, con éxito o error. El HTML no se almacena en R2: se genera a demanda en cada vista y en cada descarga del ZIP. El conversor local conserva el archivo de entrada y escribe el HTML en la carpeta de salida cuando se usa `--html`.

## Arquitectura y funcionamiento

Las dos variantes web usan Cloudflare Pages para la interfaz y las Functions como único punto de entrada. Las Functions validan las peticiones, aplican los límites y llaman mediante service bindings a dos Workers internos sin dirección pública: el de conversión y el de visualización. R2 guarda los originales temporales, los JSON y los resultados publicados; dos espacios de almacenamiento clave-valor guardan la configuración, las sesiones y los contadores; los Durable Objects aportan estado aislado por identificador. El conversor local reutiliza las capas y sustituye R2 por archivos.

La entrada es un archivo `.mup` con `formatVersion: 3` y un árbol `ideas`. Las variantes web validan la extensión, el tamaño, el JSON y los campos obligatorios antes de convertir; el conversor local valida el JSON y los campos. Después se ejecutan ocho capas:

| Capa | Qué hace |
|---|---|
| 1. Lectura | Interpreta el `.mup`, exige `formatVersion: 3` y un objeto `ideas` no vacío, y extrae los metadatos del mapa. |
| 2. Aplanado | Recorre el árbol y crea un nodo por idea con `parent_id`, `depth`, `path`, `sibling_order`, `original_id` y `is_leaf`. |
| 3. Notas | Extrae el texto de las notas y sus datos asociados. |
| 4. Atributos | Separa estilos, posiciones y atributos del nodo. |
| 5. Pegatinas | Convierte los códigos de emoji en entradas de la colección `stickers`. |
| 6. Referencias | Localiza y clasifica direcciones externas. |
| 7. Ensamblado | Reúne las diez colecciones, resuelve enlaces, extrae iconos, genera enums e índices y valida referencias y duplicados con avisos. |
| 8. Almacenamiento | Escribe el JSON en R2; el conversor local lo guarda en la carpeta de salida. |

```text
mapa.mup
   │
   ▼
validación → ocho capas → JSON-CMJN (diez colecciones) → R2 o archivo local
                              │
                              └── seis capas → HTML (y ZIP en las variantes web)
```

El JSON resultante contiene exactamente estas colecciones. `metadata` es un objeto; las otras nueve son arrays.

| Colección | Contenido |
|---|---|
| `metadata` | Identidad del mapa, versión de formato, archivo de origen, fecha y número de nodos. |
| `nodes` | Nodos aplanados con jerarquía, profundidad, ruta y orden entre hermanos. |
| `notes` | Notas asociadas a nodos. |
| `attributes` | Atributos y estilos. |
| `stickers` | Pegatinas y emojis. |
| `icons` | Iconos, también los incrustados como `data:`. |
| `links` | Enlaces internos entre nodos. |
| `externalRefs` | Direcciones externas clasificadas. |
| `enums` | Valores enumerados. |
| `indexes` | Índices precalculados. |

La visualización aplica seis capas:

| Capa | Qué hace |
|---|---|
| 1. Carga | Obtiene el JSON de R2 en las variantes web; el conversor local parte del resultado en memoria. |
| 2. Árbol | Construye la jerarquía a partir de `nodes`. |
| 3. Adjuntos | Incorpora notas, referencias externas, enlaces, pegatinas e iconos a cada nodo. |
| 4. Estilos | Aplica los estilos y atributos visuales. |
| 5. Renderizado | Genera el HTML del árbol. |
| 6. Ensamblado | Construye el documento completo con CSS y JavaScript en línea, `MMUP_DATA`, adjuntos y el `nonce` de la petición. |

El HTML es autocontenido: no carga hojas de estilo ni scripts externos. Los iconos pueden viajar como `data:` o como direcciones remotas; los adjuntos viajan como `data:` dentro de `MMUP_DATA`.

En las variantes web, el ZIP incluye los recursos remotos en `<mapa>_archivos/` cuando existen y, si alguno no se puede obtener, un archivo `faltantes.txt` con el motivo.

### Funcionalidades

- Conversión de archivos `.mup` con `formatVersion: 3` en JSON-CMJN con diez colecciones y `node_count` coherente.
- Aplanado de la jerarquía con conservación de la ruta, la profundidad y el orden de los nodos.
- Extracción de notas, atributos, pegatinas, iconos, enlaces internos, referencias externas y adjuntos.
- HTML con árbol navegable, contador de nodos visibles, expansión y contracción, cambio de tema, notas, pegatinas, iconos, referencias, enlaces, adjuntos, índice y ruta de navegación.
- Vista previa HTML y descarga en ZIP con el HTML limpio, los recursos disponibles y `faltantes.txt` cuando faltan recursos.
- Variante pública sin cuentas ni catálogo, con retención temporal y límites por dirección de red.
- Instalación privada con inicio de sesión, sesiones en servidor, catálogo y descarga de JSON.
- Conversor local por línea de comandos, con recorrido de subcarpetas, generación opcional de HTML y omisión de salidas existentes.
- Pruebas con datos sintéticos y sin dependencias que instalar.

## Requisitos generales

| Requisito | Detalle |
|---|---|
| Node.js | 22 o superior. |
| Dependencias | Ninguna dependencia de ejecución que instalar. |
| Archivo de entrada | `.mup` con `formatVersion: 3` y el árbol `ideas`. |
| Navegador | Una versión actual para la interfaz web. |
| Cloudflare | Solo para las dos variantes web: Pages, Functions, Workers, Durable Objects, R2 y dos espacios de almacenamiento clave-valor. |
| Wrangler | Versión 4 para el despliegue manual. |
| Secretos | Solo en las variantes web. La variante local no usa secretos. |

## Guía rápida de uso

1. Reúne el archivo `.mup` que quieras convertir. Si quieres anticipar la compatibilidad, comprueba que su `formatVersion` sea 3.
2. Elige la modalidad:
   - **Pública:** abre el conversor público, selecciona el archivo, pulsa **Convertir mapa**, revisa la vista previa y usa **Descargar HTML**.
   - **Privada:** instala la variante, inicia sesión, sube el archivo y descarga el JSON o el HTML desde el resultado o el catálogo.
   - **Local:** ejecuta uno de los comandos siguientes.
3. En la variante pública, guarda el ZIP antes de que caduque la retención de 24 horas.

Conversión local con recorrido de subcarpetas y HTML:

```bash
node scripts/convert.js --input examples/entrada --output salida --recursive --html
```

Conversión local desde la raíz de la carpeta de entrada, sin HTML:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=salida node scripts/convertir-local.js
```

## Instalación por modalidad

| Modalidad | Guía |
|---|---|
| Pública sin inicio de sesión | [docs/instalacion-publica.md](docs/instalacion-publica.md) |
| Privada con inicio de sesión y R2 | [docs/instalacion-login-r2.md](docs/instalacion-login-r2.md) |
| Conversor local | [docs/conversor-local.md](docs/conversor-local.md) |

Las dos variantes web comparten el mismo código; la configuración decide el modo. Las guías describen los recursos, la configuración, los secretos, el despliegue con Wrangler y las comprobaciones de cada variante. La configuración pública y la privada son independientes.

## Documentación

### Documentación del proyecto

| Documento | Contenido |
|---|---|
| [Configuración](docs/configuracion.md) | `app-config`, `app-variables`, plantillas y validación |
| [Seguridad](docs/seguridad.md) | Secretos, sesiones, retención, límites y respuesta a incidentes |
| [Arquitectura](docs/arquitectura.md) | Componentes, flujo, rutas y responsabilidades |
| [Pruebas](docs/pruebas.md) | Suites, comandos, datos sintéticos y resolución de problemas |

### Fuentes oficiales de MindMup

| Fuente | Contenido |
|---|---|
| [MindMup](https://www.mindmup.com/) | Producto y funciones |
| [Migración a MindMup 3](https://www.mindmup.com/help/news/mindmup-3-migration/) | Traslado gradual, vista previa y funciones que no pasan |
| [Cambios en MindMup para Google Drive](https://www.mindmup.com/help/news/mindmup-google-drive-changes/) | Producto de pago desde el 1 de junio de 2026 |
| [Límite de mapas editables del plan Starter](https://www.mindmup.com/help/news/editable-map-limit-changing/) | Tres mapas editables y mapas en solo lectura |

## Estructura del repositorio

```text
.
├── app/                    Interfaz estática de Pages
├── functions/              Pages Functions: api/ y html/
├── src/
│   ├── converter/          Worker de conversión: ocho capas y Durable Object
│   ├── visualizer/         Worker de visualización: seis capas y Durable Object
│   └── shared/             Configuración, sesión, validación, rutas, nombres y ZIP
├── scripts/                Conversión local, secretos, validación y verificación
├── test/                   Pruebas y datos sintéticos
├── examples/               Entradas y salidas sintéticas
├── docs/                   Guías de instalación y documentación
├── site/                   Página de presentación
├── .dev.vars.example
├── .env.example
├── credenciales.example.tsv
├── package.json
├── config.example.json
├── config.variables.example.json
├── wrangler.converter.example.jsonc
├── wrangler.visualizer.example.jsonc
├── wrangler.pages.example.jsonc
├── LICENSE
└── THIRD_PARTY_LICENSES.md
```

## Desarrollo, pruebas y contribuciones

No hay dependencias que instalar. Desde la raíz del repositorio:

```bash
npm test
```

Las pruebas se pueden ejecutar por separado:

```bash
npm run test:shared
npm run test:converter
npm run test:visualizer
npm run test:functions
npm run test:ui
```

Los archivos de prueba y los ejemplos son sintéticos. No contienen nombres reales de mapas, clientes o grupos, ni rutas absolutas o direcciones del despliegue privado.

El despliegue es manual con Wrangler 4. No se usa GitHub Actions ni integración continua. Los proyectos de Pages no se conectan a una rama para despliegues automáticos.

Las contribuciones se envían como incidencias o solicitudes de cambio. Incluye una descripción del cambio, el comando de prueba ejecutado y datos sintéticos. No añadas secretos, credenciales, datos personales, nombres reales, rutas absolutas ni direcciones privadas. El código se escribe en inglés; la documentación y los mensajes, en español de España.

## Licencia MIT

MIT. Copyright (c) 2026 Paginaviva.

Consulta [LICENSE](LICENSE) y [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). Los materiales de terceros conservan su licencia.
