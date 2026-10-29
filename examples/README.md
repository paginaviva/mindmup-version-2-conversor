# Examples

[English](README.md) | [Español](README-es.md)

All data in this folder is synthetic. It does not come from real maps, clients, groups, or projects.

## Input

- `entrada/mapa-minimo.mup`: minimal tree with root and child nodes.
- `entrada/mapa-completo.mup`: notes, attributes, stickers, external links, and an icon.
- `entrada/mapa-con-adjunto.mup`: text attachment and a small icon.

## Conversion

From the repository root:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

The command walks the input folder, writes one JSON-CMJN file per map, and generates the self-contained HTML. It does not overwrite existing files.

For a conversion without recursion and without HTML:

```bash
node scripts/convertir-local.js
```

`convertir-local.js` uses `config.local.json` or the `MUP_INPUT_DIR` and `MUP_OUTPUT_DIR` environment variables.

## Output

The `salida/` folder is empty in the repository. The command creates the generated files when it runs; you can empty and regenerate it with the same command. Do not edit the output files by hand.

## Note

The examples do not include private data, absolute paths, or addresses from the private deployment. If you add a new example, it must be synthetic and verifiable.
