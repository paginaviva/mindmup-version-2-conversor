# MindMup 2 Conversor

[English](README.md) | [Español](README-es.md)

Converts `.mup` files with `formatVersion: 3` into normalized JSON-CMJN with ten collections and self-contained HTML.

- **Public application:** https://pg-mindmup-v2-public.pages.dev
- **Repository:** https://github.com/paginaviva/mindmup-version-2-conversor
- **Documentation:** https://pg-mindmup-v2-web.pages.dev/en/#documentacion
- **License:** MIT.

## What it does

- Accepts `.mup` files with `formatVersion: 3` and a non-empty `ideas` object.
- Extracts nodes, notes, attributes, stickers, icons, internal links, external references, and attachments.
- Generates JSON-CMJN with ten collections and self-contained HTML.
- Offers three modes: public, private with login and R2, and local.

## Compatibility

| Check | Result |
|---|---|
| `.mup` with `formatVersion: 3` | Accepted. |
| `.mup` with `formatVersion: 2` | Rejected. |
| Any other `formatVersion` | Not supported. |
| Commercial version of MindMup | The converter does not read or validate it. |

`v7` is the converter version. The package version is `1.0.0`.

It has not been verified that all files exported by MindMup 2 use `formatVersion: 3`. Check that field before assuming that the converter will accept the file.

## Modes

| Mode | Access | Output | Storage |
|---|---|---|---|
| Public | No account | HTML and ZIP | Temporary R2 storage, 24 hours |
| Private with login and R2 | Username and password | JSON, HTML, and ZIP | R2 in `output/`, with no automatic deletion |
| Local | Command line | JSON and optional HTML | User folder |

The public variant expires after 24 hours. Download the ZIP to keep it. The private variant does not delete `output/` automatically. The local converter writes to disk.

## Quick start

```bash
npm test

node scripts/convert.js --input examples/entrada --output salida --recursive --html

MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=salida node scripts/convertir-local.js
```

Requirements: Node.js 22 or later. There are no dependencies to install.

## Documentation

| Document | Content |
|---|---|
| [Public installation](docs/instalacion-publica-en.md) | Variant without login |
| [Installation with login and R2](docs/instalacion-login-r2-en.md) | Authentication, catalog, and R2 |
| [Local converter](docs/conversor-local-en.md) | Use without Cloudflare |
| [Configuration](docs/configuracion-en.md) | `app-config`, `app-variables`, and validation |
| [Security](docs/seguridad-en.md) | Secrets, sessions, retention, and limits |
| [Architecture](docs/arquitectura-en.md) | Components, routes, and flow |
| [Tests](docs/pruebas-en.md) | Suites, commands, and synthetic data |

## Structure

```text
.
├── app/                    Static Pages interface
├── functions/              Pages Functions: api/ and html/
├── src/
│   ├── converter/          Conversion Worker: eight layers and a Durable Object
│   ├── visualizer/         Visualization Worker: six layers and a Durable Object
│   └── shared/             Configuration, session, validation, routes, and ZIP
├── scripts/                Local conversion, secrets, validation, and verification
├── test/                   Tests and synthetic data
├── examples/               Synthetic inputs and outputs
├── docs/                   Installation guides and documentation
├── site/                   Presentation page
├── package.json
├── config.example.json
├── config.variables.example.json
├── wrangler.converter.example.jsonc
├── wrangler.visualizer.example.jsonc
├── wrangler.pages.example.jsonc
├── LICENSE
└── THIRD_PARTY_LICENSES.md
```

## Tests

```bash
npm test
npm run test:shared
npm run test:converter
npm run test:visualizer
npm run test:functions
npm run test:ui
```

Tests and examples use synthetic data. Deployment is manual with Wrangler 4; there is no continuous integration.

## License

MIT. Copyright (c) 2026 PáginaVIVA.

See [LICENSE](LICENSE) and [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
