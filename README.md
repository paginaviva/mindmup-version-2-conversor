# MindMup 2 Conversor

Convierte archivos `.mup` con `formatVersion: 3` en JSON-CMJN normalizado de diez colecciones y HTML autocontenido.

- **Aplicación pública:** https://pg-mindmup-v2-public.pages.dev
- **Repositorio:** https://github.com/paginaviva/mindmup-version-2-conversor
- **Documentación:** https://pg-mindmup-v2-web.pages.dev/#documentacion
- **Licencia:** MIT.

## Qué hace

- Acepta archivos `.mup` con `formatVersion: 3` y un objeto `ideas` no vacío.
- Extrae nodos, notas, atributos, pegatinas, iconos, enlaces internos, referencias externas y adjuntos.
- Genera un JSON-CMJN con diez colecciones y un HTML autocontenido.
- Ofrece tres modalidades: pública, privada con inicio de sesión y R2, y local.

## Compatibilidad

| Comprobación | Resultado |
|---|---|
| `.mup` con `formatVersion: 3` | Se acepta. |
| `.mup` con `formatVersion: 2` | Se rechaza. |
| Cualquier otro `formatVersion` | No se admite. |
| Versión comercial de MindMup | El conversor no la lee ni la valida. |

`v7` es la versión del conversor. La versión del paquete es `1.0.0`.

No se ha verificado que todos los archivos exportados por MindMup 2 usen `formatVersion: 3`. Comprueba ese campo antes de asumir que el conversor aceptará el archivo.

## Modalidades

| Modalidad | Acceso | Salida | Almacenamiento |
|---|---|---|---|
| Pública | Sin cuenta | HTML y ZIP | R2 temporal, 24 horas |
| Privada con inicio de sesión y R2 | Usuario y contraseña | JSON, HTML y ZIP | R2 en `output/`, sin borrado automático |
| Local | Línea de comandos | JSON y HTML opcional | Carpeta del usuario |

La variante pública caduca a las 24 horas. Descarga el ZIP para conservarlo. La variante privada no borra automáticamente `output/`. El conversor local escribe en el disco.

## Inicio rápido

```bash
npm test

node scripts/convert.js --input examples/entrada --output salida --recursive --html

MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=salida node scripts/convertir-local.js
```

Requisitos: Node.js 22 o superior. No hay dependencias que instalar.

## Documentación

| Documento | Contenido |
|---|---|
| [Instalación pública](docs/instalacion-publica.md) | Variante sin inicio de sesión |
| [Instalación con inicio de sesión y R2](docs/instalacion-login-r2.md) | Autenticación, catálogo y R2 |
| [Conversor local](docs/conversor-local.md) | Uso sin Cloudflare |
| [Configuración](docs/configuracion.md) | `app-config`, `app-variables` y validación |
| [Seguridad](docs/seguridad.md) | Secretos, sesiones, retención y límites |
| [Arquitectura](docs/arquitectura.md) | Componentes, rutas y flujo |
| [Pruebas](docs/pruebas.md) | Suites, comandos y datos sintéticos |

## Estructura

```text
.
├── app/                    Interfaz estática de Pages
├── functions/              Pages Functions: api/ y html/
├── src/
│   ├── converter/          Worker de conversión: ocho capas y Durable Object
│   ├── visualizer/         Worker de visualización: seis capas y Durable Object
│   └── shared/             Configuración, sesión, validación, rutas y ZIP
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

## Pruebas

```bash
npm test
npm run test:shared
npm run test:converter
npm run test:visualizer
npm run test:functions
npm run test:ui
```

Las pruebas y los ejemplos usan datos sintéticos. El despliegue es manual con Wrangler 4; no hay integración continua.

## Licencia

MIT. Copyright (c) 2026 Paginaviva.

Consulta [LICENSE](LICENSE) y [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
