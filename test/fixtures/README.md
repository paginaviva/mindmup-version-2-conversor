# Synthetic fixtures

[English](README.md) | [Español](README-es.md)

This directory contains test files for validating MindMup map uploads. All names, titles, identifiers, dates, and texts are invented and do not come from real maps. There is no personal data, client or organization information, absolute paths, or private URLs.

## Contents

- `mup/valido-minimo.mup`: minimal tree with root and child nodes.
- `mup/valido-completo.mup`: notes, attributes, stickers, external links, and an icon.
- `mup/valido-adjunto.mup`: text attachment and a small icon.
- `esperado/valido-minimo.contrato.json`, `esperado/valido-completo.contrato.json`, and `esperado/valido-adjunto.contrato.json`: expected JSON-CMJN contracts.
- `mup/invalido-*`: five rejection fixtures, one per reason.

## Valid fixtures

| File | Content | Use |
|---|---|---|
| `mup/valido-minimo.mup` | Simple tree with 10 nodes | Minimal conversion and layer tests |
| `mup/valido-completo.mup` | 12 nodes with notes, attributes, stickers, icon, link, and references | Full conversion and layer tests |
| `mup/valido-adjunto.mup` | 6 nodes with a text attachment and an icon | Attachment tests |

The contracts in `esperado/` contain the ten collections and a `node_count` consistent with `nodes.length`.

## Invalid fixtures

The `mup/` folder contains five invalid fixtures. Each represents a single rejection reason and is intended for the upload suite (`test/functions/test-upload.js`).

| File | Construction | Expected rejection |
|---|---|---|
| `mup/invalido-extension.txt` | Minimal text with a `.txt` extension | `400` · `El archivo debe tener extensión .mup` |
| `mup/invalido-pequeno.mup` | Valid JSON smaller than 1 KB | `400` · `El archivo está vacío o es demasiado pequeño (mínimo 1 KB)` |
| `mup/invalido-json.mup` | Larger than 1 KB, truncated after `"ideas": {` | `400` · `El archivo no contiene un JSON válido` |
| `mup/invalido-sin-format-version.mup` | Valid JSON larger than 1 KB, with `ideas` and without `formatVersion` | `400` · `Falta el campo obligatorio formatVersion` |
| `mup/invalido-sin-ideas.mup` | Valid JSON larger than 1 KB, with `formatVersion: 3` and without `ideas` | `400` · `Falta el árbol de nodos (ideas)` |

## Validation order

The upload checks the extension first, then the minimum size, then the maximum size, then the JSON, and finally the required fields. The fixtures are built so that the first error reached is the one indicated in the table.

## Maintenance

- One file per rejection reason; the name describes the condition.
- Internal identifiers are generic and are not reused between fixtures.
- Do not add real data, absolute paths, or private URLs.
- If the validation messages change, update the table and the corresponding tests.
