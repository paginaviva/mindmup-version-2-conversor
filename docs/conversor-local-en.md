# Local converter for MindMup 2 Conversor

[Español](conversor-local-es.md) | [English](conversor-local-en.md)

The local converter in MindMup 2 Conversor converts `.mup` files compatible with `formatVersion: 3` into JSON-CMJN and, if requested, into a self-contained HTML file. It runs on Node.js and the file system: it does not use Cloudflare, Wrangler, or npm dependencies. Results are saved to the user's disk.

## File compatibility

The converter accepts `.mup` files compatible with `formatVersion: 3`. Compatibility is determined by that internal value, not by the commercial version of MindMup:

- It accepts `.mup` files with `formatVersion: 3` and a non-empty `ideas` object.
- It rejects files with `formatVersion: 2` and any other value other than 3.
- It does not read or validate the commercial version of MindMup (2 or 3).
- It has not been possible to demonstrate that all MindMup 2 files use `formatVersion: 3`; check the value in the file before assuming it will be accepted.
- `v7` is the converter version, not the MindMup version or the `.mup` format version.

The [official MindMup documentation](https://www.mindmup.com/) does not document this internal value. The project does not claim universal compatibility with all MindMup 2 maps or universal incompatibility with MindMup 3.

Execution is manual. There is no continuous integration or GitHub Actions.

## 1. Requirements

- Node.js 22 or later. The requirement is declared in `package.json`.
- No npm dependencies to install. Do not run `npm install` to use the converter.
- No Cloudflare resources: no account, no Workers, no Pages, no R2, no key-value storage, and no Durable Objects.
- A `.mup` file with `formatVersion: 3` and a non-empty `ideas` object. Check the internal value before converting it.
- Read permission on the input folder and write permission on the output folder.
- The examples run from the repository root. The scripts import modules from `src/`, so do not copy only the `scripts/` folder.

The limits of the web variants do not apply: minimum or maximum size, quota per network address, retention, sessions, or catalog. The 24-hour retention belongs to the public variant. Those checks belong to Pages Functions.

## 2. Tools

| Tool | Subfolders | HTML | Path selection | Help |
|---|---|---|---|---|
| `scripts/convert.js` | With `--recursive` | With `--html` | Command-line options, environment variables, and configuration | `--help` and `-h` |
| `scripts/convertir-local.js` | No | No | Environment variables and configuration | No |

Both tools read `.mup` files, write JSON-CMJN, skip existing outputs, and resolve relative paths from the current directory. `convertir-local.js` imports and reuses the engine in `convert.js`; it is not a different implementation.

`convertir-local.js` does not interpret arguments. Do not pass options such as `--input`, `--output`, or `--help`: it ignores them and runs the conversion with the available configuration.

## 3. Local configuration and environment variables

### 3.1. Priority

| Item | `convert.js` | `convertir-local.js` |
|---|---|---|
| Input folder | `--input`, then `MUP_INPUT_DIR`, then `local.inputDir` | `MUP_INPUT_DIR`, then `local.inputDir` |
| Output folder | `--output`, then `MUP_OUTPUT_DIR`, then `local.outputDir` | `MUP_OUTPUT_DIR`, then `local.outputDir` |
| Configuration file | `--config`, then `config.local.json` | `MUP_CONFIG_FILE`, then `config.local.json` |

Priority is read from left to right: the first available option wins.

### 3.2. Configuration file

`convert.js` and `convertir-local.js` read the `local` section of the configuration file. The other keys are not used in local conversion.

```json
{
  "local": {
    "inputDir": "./examples/entrada",
    "outputDir": "./examples/salida"
  }
}
```

You can use the same `config.local.json` that contains the keys from `config.example.json`: the local scripts read only `local`. The configuration of the web variants is explained in [configuracion-en.md](configuracion-en.md).

- If the file does not exist, it is ignored. The error appears if the input or output folders are missing.
- If the file exists and does not contain valid JSON, the process ends with an error.
- `--config` and `MUP_CONFIG_FILE` accept a path relative to the current directory.
- `convert.js` does not read `MUP_CONFIG_FILE`. `convertir-local.js` does not accept `--config`.
- Input and output paths are also resolved from the current directory.

### 3.3. Environment variables

| Variable | Tool | Use |
|---|---|---|
| `MUP_INPUT_DIR` | Both | Input folder. |
| `MUP_OUTPUT_DIR` | Both | Output folder. |
| `MUP_CONFIG_FILE` | `convertir-local.js` only | Configuration file. |

The scripts do not load `.env` on their own. Export the variables in the terminal or use the configuration file.

```bash
MUP_INPUT_DIR=./examples/entrada \
MUP_OUTPUT_DIR=./examples/salida \
node scripts/convertir-local.js
```

## 4. Run and help commands

```bash
# Help for convert.js
node scripts/convert.js --help

# Conversion from the root of the input folder
node scripts/convert.js --input examples/entrada --output examples/salida

# Conversion with subfolders and HTML
node scripts/convert.js --input examples/entrada --output examples/salida --recursive --html

# Conversion with a configuration file
node scripts/convert.js --config ./config.local.json

# Local conversion without options: uses environment variables or config.local.json
node scripts/convertir-local.js

# Local conversion with environment variables
MUP_INPUT_DIR=./examples/entrada MUP_OUTPUT_DIR=./examples/salida node scripts/convertir-local.js

# Local conversion with a different configuration file
MUP_CONFIG_FILE=./config.local.json node scripts/convertir-local.js
```

`node scripts/convert.js --help` shows this text:

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

`--help` and `-h` show the help and do not convert anything. An unknown option in `convert.js` produces an error and exit code 1.

## 5. Behavior

### 5.1. Recursion and file selection

- Without `--recursive`, `convert.js` processes only the `.mup` files in the root of the input folder.
- With `--recursive`, it traverses all subfolders.
- The output is flat: all JSON and HTML files are written directly to the output folder, without reproducing the input structure.
- The extension is compared case-insensitively. Files that do not end in `.mup` are ignored.
- Files are processed in alphabetical order.
- The output folder is created if it does not exist. The input folder must exist.

### 5.2. HTML

- `convert.js` always writes JSON. With `--html`, it also writes one HTML file per map.
- The HTML is a single file. No `<mapa>_archivos/` folder, no `faltantes.txt` file, and no ZIP are created.
- `convertir-local.js` never generates HTML.
- The HTML is built from the same JSON-CMJN result that is written to disk.

### 5.3. Skipping existing outputs

- If the JSON already exists, the map is skipped.
- With `--html`, the map is skipped if either the JSON or the HTML exists.
- No file is overwritten, and there is no force option.
- If the JSON exists but the HTML is missing, the map is skipped entirely: the missing part is not generated.
- The check is performed before reading the `.mup`. An invalid file with an existing output is counted as skipped, not as failed.
- Dates, sizes, and content are not compared. An old output still blocks conversion.

To regenerate an output, use another output folder or delete the files you want to replace.

### 5.4. Name normalization

The base name of the input file is transformed before the extension is added:

1. Each sequence of spaces becomes a hyphen.
2. Accented characters are separated with Unicode NFD normalization, and diacritical marks are removed.
3. Only letters without accents, digits, dot, hyphen, and underscore are kept.
4. Leading and trailing hyphens are removed.
5. If no valid character remains, `salida` is used.

Uppercase and lowercase are not changed. A dot in the middle of the name is preserved. The converter adds the final extension: `.json` and, with `--html`, `.html`.

| Input | Normalized base name | JSON output |
|---|---|---|
| `Mapa de Ángeles.mup` | `Mapa-de-Angeles` | `Mapa-de-Angeles.json` |
| `España 2026.mup` | `Espana-2026` | `Espana-2026.json` |
| `plan maestro.mup` | `plan-maestro` | `plan-maestro.json` |
| `###.mup` | `salida` | `salida.json` |

Two files with the same normalized name share an output. If the first one has already been written, the second one is skipped.

### 5.5. Summary and exit code

Each file prints one line with its result: conversion, skip, or error. When finished, one line is printed in this format:

```text
Resumen: <convertidos> convertidos, <omitidos> omitidos, <fallidos> fallidos.
```

- An error in one file does not stop the batch. It is counted in `fallidos`, and processing continues with the next file.
- The exit code is 0 if there are no failures, even if all files were skipped.
- The exit code is 1 if any file fails or a fatal error occurs.
- A fatal error, such as a missing input folder or an unreadable configuration, ends the process before the summary and returns 1.
- If there are no `.mup` files, the summary shows `0 convertidos, 0 omitidos, 0 fallidos` and the code is 0.

### 5.6. Output format

- JSON is written with two-space indentation and a trailing newline.
- The JSON contains the 10 JSON-CMJN collections.
- `metadata.source_file` is the name of the input file.
- `metadata.converted_at` is the conversion date in ISO 8601 format.
- `metadata.node_count` is the number of nodes in the map.
- HTML is written as a separate text file.

## 6. Examples with `examples/entrada` and `examples/salida`

The `examples/entrada` folder contains three synthetic maps:

| File | Content |
|---|---|
| `mapa-minimo.mup` | Minimal tree with a root node and children. |
| `mapa-completo.mup` | Notes, attributes, stickers, external links, and an icon. |
| `mapa-con-adjunto.mup` | Text attachment and a small icon. |

Convert the three maps to JSON and HTML:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

Expected outputs:

```text
examples/salida/mapa-minimo.json
examples/salida/mapa-minimo.html
examples/salida/mapa-completo.json
examples/salida/mapa-completo.html
examples/salida/mapa-con-adjunto.json
examples/salida/mapa-con-adjunto.html
```

If you run the same command again, all six files are skipped. To see a new conversion, use another output folder or delete the previous outputs.

To generate only JSON, without HTML and without traversing subfolders:

```bash
MUP_INPUT_DIR=examples/entrada MUP_OUTPUT_DIR=examples/salida-json node scripts/convertir-local.js
```

Expected outputs:

```text
examples/salida-json/mapa-minimo.json
examples/salida-json/mapa-completo.json
examples/salida-json/mapa-con-adjunto.json
```

The example data is synthetic. See [examples/README.md](../examples/README.md) for the scope of each file.

## 7. Verified limitations and common issues

### 7.1. Limitations

- The limits of the web variants do not apply: minimum size of 1 KB, maximum size of 16 MB, quota per network address, 24-hour retention, sessions, or catalog.
- File size is not validated. Explicit input validation is limited to checking that the JSON is valid, that `formatVersion` is 3, and that `ideas` exists and is not empty.
- There is no option to overwrite existing outputs.
- The output is flat. Two files with the same normalized name share an output, and the second one is skipped.
- `convertir-local.js` does not accept command-line options or show help.
- `convert.js` reads only the `local` section of the configuration file. The keys in `app-config` and `app-variables` are not used in local conversion.
- The scripts do not load `.env` automatically.
- Local HTML does not generate a ZIP, a resource folder, or a missing-resources file.
- If HTML fails after the JSON is written, the JSON remains on disk and the file is counted as failed.
- The scripts depend on `src/`. Do not copy only the `scripts/` folder.
- A `.mup` file with a `formatVersion` other than 3 is not supported.

### 7.2. Common issues

| Symptom | Probable cause | Action |
|---|---|---|
| `Faltan las carpetas de entrada o salida. Usa --input/--output, MUP_INPUT_DIR/MUP_OUTPUT_DIR o config.local.json.` | The input or output was not specified. | Use the `convert.js` options, environment variables, or `config.local.json`. In `convertir-local.js`, use environment variables or configuration: it does not accept options. |
| `No se pudo leer la configuración "<ruta>": ...` | The configuration file does not contain valid JSON. | Fix the JSON or use another file. |
| `Opción desconocida: <opción>` | An option that `convert.js` does not recognize was entered. | See `node scripts/convert.js --help`. |
| `Formato .mup no soportado. Se esperaba versión 3, se recibió <versión>.` | The file does not have `formatVersion: 3`. | Check the internal `formatVersion` value of the file. The converter only supports 3; it does not interpret the commercial version of MindMup. |
| `El archivo .mup no contiene un objeto ideas válido o está vacío.` | The `ideas` tree is missing or has no nodes. | Fix the file or export it again. |
| JSON error when reading the `.mup` | The file is not valid JSON or is damaged. | Export it again from MindMup. |
| `ENOENT` when traversing the input folder | The input folder does not exist or the path is incorrect. | Check the path and run from the repository root. |
| Subfolders are not processed | `--recursive` is missing. | Add `--recursive` to `convert.js`. |
| No HTML is generated | `--html` is missing or `convertir-local.js` was used. | Use `convert.js` with `--html`. |
| All files are skipped | The outputs already exist. | Use another output folder or delete the outputs you want to regenerate. |
| The JSON exists, the HTML is missing, and no HTML is generated | With `--html`, the existence of the JSON skips the entire map. | Delete the JSON or use another output folder. |
| Two files share an output | The normalized names match. | Rename one input or use separate output folders. |
| `convertir-local.js` ignores `--input` and `--output` | The script does not interpret arguments. | Use `MUP_INPUT_DIR`, `MUP_OUTPUT_DIR`, or `config.local.json`. |
