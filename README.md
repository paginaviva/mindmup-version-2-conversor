# MindMup Conversor

[![Licencia MIT](https://img.shields.io/static/v1?label=licencia&message=MIT&color=2ea44f)](LICENSE) [![Node.js 22 o superior](https://img.shields.io/static/v1?label=Node.js&message=22%20o%20superior&color=339933)](package.json)

Convierte mapas MindMup versión 3 (`.mup`) en JSON-CMJN normalizado (10 colecciones) y HTML autocontenido. Incluye tres formas de uso: una variante pública sin inicio de sesión, una variante con inicio de sesión y R2, y un conversor local sin Cloudflare.

**Conversor público:** [https://pg-mindmup-v2-public.pages.dev](https://pg-mindmup-v2-public.pages.dev)  
**Página de presentación:** [https://pg-mindmup-v2-web.pages.dev](https://pg-mindmup-v2-web.pages.dev)

## Problema que resuelve

MindMup exporta el mapa como un árbol anidado de ideas. Es un formato cómodo para editar, pero poco práctico para consultar nodos y relaciones, comparar mapas o reutilizar notas, atributos y recursos en otro sistema. El archivo `.mup` no incorpora una vista HTML independiente.

Este proyecto aplana la jerarquía, separa los datos en 10 colecciones relacionadas y genera una visualización navegable. El resultado se puede archivar, analizar o publicar sin depender de la interfaz de MindMup.

## Funcionamiento de la conversión

La entrada es un archivo `.mup` con `formatVersion: 3` y un árbol `ideas`. Las variantes web validan la extensión, el tamaño, el JSON y los campos obligatorios antes de convertir; el conversor local valida el JSON y los campos. Después se ejecutan ocho capas:

| Capa | Qué hace |
|---|---|
| 1. Lectura | Interpreta el `.mup` y extrae los metadatos del mapa. |
| 2. Aplanado | Recorre el árbol y crea un nodo por idea con `parent_id`, `depth`, `path` y `sibling_order`. |
| 3. Notas | Extrae el texto de las notas y sus datos asociados. |
| 4. Atributos | Separa estilos, posiciones y atributos del nodo. |
| 5. Pegatinas | Convierte los códigos de emoji en entradas de la colección `stickers`. |
| 6. Referencias | Localiza y clasifica direcciones externas. |
| 7. Ensamblado | Reúne las 10 colecciones con `source_file`, `converted_at` y `node_count` ya calculados. |
| 8. Almacenamiento | Escribe el JSON en R2; el conversor local lo guarda en la carpeta de salida. |

```text
mapa.mup
   │
   ▼
validación → 8 capas → JSON-CMJN (10 colecciones) → R2 o archivo local
                              │
                              └── 6 capas → HTML + ZIP
```

El JSON resultante contiene exactamente estas colecciones:

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

La visualización aplica seis capas: carga el JSON, construye el árbol, adjunta notas y recursos, aplica estilos, renderiza los nodos y ensambla el HTML. El HTML incluye los estilos y los scripts dentro del propio documento. El ZIP incluye los recursos remotos en `<mapa>_archivos/` cuando existen y, si alguno no se puede obtener, un archivo `faltantes.txt` con el motivo.

## Funcionalidades disponibles

- Conversión de mapas MindMup versión 3 en JSON-CMJN con 10 colecciones y `node_count` coherente.
- Aplanado de la jerarquía con conservación de la ruta, la profundidad y el orden de los nodos.
- Extracción de notas, atributos, pegatinas, iconos, enlaces internos, referencias externas y adjuntos.
- HTML con árbol navegable, contador de nodos visibles, expansión y contracción, cambio de tema, notas, pegatinas, iconos, referencias, enlaces, adjuntos, índice y ruta de navegación.
- Vista previa HTML y descarga en ZIP con el HTML limpio, los recursos disponibles y `faltantes.txt` cuando faltan recursos.
- Variante pública sin cuentas ni catálogo, con retención temporal y límites por dirección de red.
- Variante con inicio de sesión, sesiones en servidor, catálogo y descarga de JSON.
- Conversor local por línea de comandos, con recorrido de subcarpetas, generación opcional de HTML y omisión de salidas existentes.
- Pruebas con datos sintéticos y sin dependencias que instalar.

## Las tres variantes

| Aspecto | Pública sin inicio de sesión | Con inicio de sesión y R2 | Conversor local |
|---|---|---|---|
| Infraestructura | Cloudflare Pages + Functions + dos Workers | Cloudflare Pages + Functions + dos Workers, en una cuenta propia | Node.js, sin Cloudflare |
| Acceso | Sin cuenta | Usuario y contraseña | Línea de comandos |
| Catálogo | No | Sí, con sesión y `catalogEnabled` | No |
| Salida | Vista previa HTML y ZIP del HTML | JSON, vista previa HTML y ZIP del HTML | JSON y HTML opcional |
| Descarga de JSON | No | Sí | Sí, como archivo |
| Almacenamiento | R2 temporal, 24 horas | R2 en `output/`, sin borrado automático | Carpeta local |
| Configuración | `loginEnabled: false`, `catalogEnabled: false` | `loginEnabled: true`; `catalogEnabled` decide el catálogo | Opciones y variables de entorno |
| Guía | [Instalación pública](docs/instalacion-publica.md) | [Instalación con inicio de sesión y R2](docs/instalacion-login-r2.md) | [Conversor local](docs/conversor-local.md) |

`loginEnabled` decide el modo general. `catalogEnabled` solo controla el catálogo y la ruta `/api/list`; no activa ni desactiva el inicio de sesión, las subidas, el estado, la vista HTML ni las descargas. El catálogo requiere las dos opciones activas.

La variante pública ofrece solo HTML: vista previa y descarga del HTML en ZIP. No ofrece descarga de JSON. El JSON se genera para construir el HTML y se comprueba en las pruebas, pero no se expone. La descarga de JSON está disponible en la variante con inicio de sesión y en el conversor local.

### Variante pública

Se despliega en Cloudflare Pages con Functions y dos Workers internos. La aplicación se publica en el proyecto `pg-mindmup-v2-public`; la página de presentación, en `pg-mindmup-v2-web`. Los Workers no tienen dirección pública y las Functions son el único punto de entrada. La página de presentación se publica en Cloudflare Pages, no en GitHub Pages.

No se muestra formulario de acceso ni catálogo. El usuario sube un `.mup`, revisa la vista previa y descarga el HTML en ZIP. La retención es de 24 horas y la protección Turnstile es opcional.

### Variante con inicio de sesión y R2

Es la variante distribuible: se instala en una cuenta de Cloudflare propia y no se despliega en la cuenta pública. Incluye inicio de sesión con sesiones en servidor, catálogo, descarga de JSON y descarga de HTML. El catálogo lee `/api/list` y permite buscar, filtrar por grupo y ordenar en el navegador.

La contraseña se deriva con PBKDF2. La distribución usa 5.000 iteraciones como valor de referencia. Los secretos se generan con:

```bash
node scripts/generate-secrets.js --iterations 5000
```

El script no escribe archivos: imprime los secretos para guardarlos fuera del repositorio.

### Conversor local

Funciona con Node.js 22 o superior, sin cuenta de Cloudflare. `convertir-local.js` procesa solo la raíz de la carpeta de entrada y no genera HTML. `convert.js` permite recorrer subcarpetas con `--recursive` y generar HTML con `--html`. Ninguno sobrescribe una salida existente.

## Requisitos generales

| Requisito | Detalle |
|---|---|
| Node.js | 22 o superior. |
| Dependencias | Ninguna dependencia de ejecución que instalar. |
| Archivo de entrada | `.mup` de MindMup versión 3, con `formatVersion` y el árbol `ideas`. |
| Navegador | Una versión actual para la interfaz web. |
| Cloudflare | Solo para las dos variantes web: Pages, Functions, Workers, Durable Objects, R2 y dos espacios de almacenamiento clave-valor. |
| Wrangler | Versión 4 para el despliegue manual. |
| Secretos | Solo en la variante con inicio de sesión y en el despliegue de la variante pública. La variante local no usa secretos. |

## Guía rápida de uso

1. Exporta el mapa desde MindMup como archivo `.mup`.
2. Elige la variante:
   - **Pública:** abre el conversor público, selecciona el archivo, pulsa **Convertir mapa**, revisa la vista previa y usa **Descargar HTML**.
   - **Con inicio de sesión:** instala la variante, inicia sesión, sube el archivo y descarga el JSON o el HTML desde el resultado o el catálogo.
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

## Instalación por variante

| Variante | Guía |
|---|---|
| Pública sin inicio de sesión | [docs/instalacion-publica.md](docs/instalacion-publica.md) |
| Con inicio de sesión y R2 | [docs/instalacion-login-r2.md](docs/instalacion-login-r2.md) |
| Conversor local | [docs/conversor-local.md](docs/conversor-local.md) |

Las dos variantes web comparten el mismo código; la configuración decide el modo. Las guías describen los recursos, la configuración, los secretos, el despliegue con Wrangler y las comprobaciones de cada variante. La configuración pública y la privada son independientes.

### Documentación adicional

| Documento | Contenido |
|---|---|
| [Configuración](docs/configuracion.md) | `app-config`, `app-variables`, plantillas y validación |
| [Seguridad](docs/seguridad.md) | Secretos, sesiones, retención, límites y respuesta a incidentes |
| [Arquitectura](docs/arquitectura.md) | Componentes, flujo, rutas y responsabilidades |
| [Pruebas](docs/pruebas.md) | Suites, comandos, datos sintéticos y resolución de problemas |

## Estructura del repositorio

```text
.
├── app/                    Interfaz estática de Pages
├── functions/              Pages Functions: api/ y html/
├── src/
│   ├── converter/          Worker de conversión: 8 capas y Durable Object
│   ├── visualizer/         Worker de visualización: 6 capas y Durable Object
│   └── shared/             Configuración, sesión, validación, rutas, nombres y ZIP
├── scripts/                Conversión local, secretos, validación y verificación
├── test/                   Pruebas y datos sintéticos
├── examples/               Entradas y salidas sintéticas
├── docs/                   Guías de instalación y documentación
├── site/                   Página de presentación
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
