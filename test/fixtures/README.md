# Fixtures sintéticos

Este directorio contiene archivos de prueba para la validación de subidas de mapas MindMup. Todos los nombres, títulos, identificadores, fechas y textos son inventados y no proceden de mapas reales. No hay datos personales, clientes, organizaciones, rutas absolutas ni URL privadas.

## Contenido

La carpeta `mup/` reúne cinco fixtures inválidos. Cada uno representa un único motivo de rechazo y está pensado para la suite de subida (`test/functions/test-upload.js`).

| Archivo | Construcción | Rechazo esperado |
|---|---|---|
| `mup/invalido-extension.txt` | Texto mínimo con extensión `.txt` | `400` · `El archivo debe tener extensión .mup` |
| `mup/invalido-pequeno.mup` | JSON válido de menos de 1 KB | `400` · `El archivo está vacío o es demasiado pequeño (mínimo 1 KB)` |
| `mup/invalido-json.mup` | Más de 1 KB, truncado después de `"ideas": {` | `400` · `El archivo no contiene un JSON válido` |
| `mup/invalido-sin-format-version.mup` | JSON válido de más de 1 KB, con `ideas` y sin `formatVersion` | `400` · `Falta el campo obligatorio formatVersion` |
| `mup/invalido-sin-ideas.mup` | JSON válido de más de 1 KB, con `formatVersion: 3` y sin `ideas` | `400` · `Falta el árbol de nodos (ideas)` |

## Orden de validación

La subida comprueba primero la extensión, después el tamaño mínimo, después el tamaño máximo, después el JSON y, por último, los campos obligatorios. Los fixtures están construidos para que el primer error que se alcance sea el indicado en la tabla:

- `invalido-extension.txt` no se lee: la extensión se valida antes del contenido. Por eso basta con un texto mínimo.
- `invalido-pequeno.mup` es JSON válido, pero no llega a parsearse porque el tamaño se comprueba antes.
- `invalido-json.mup` supera el tamaño mínimo y falla al interpretarse como JSON.
- `invalido-sin-format-version.mup` supera el tamaño y el parseo, pero no tiene `formatVersion`.
- `invalido-sin-ideas.mup` supera el tamaño y el parseo, tiene `formatVersion`, pero no tiene `ideas`.

Los tres últimos incluyen un campo `relleno` con notas sintéticas para superar 1 KB sin aportar datos reales.

## Mantenimiento

- Un archivo por motivo de rechazo; el nombre describe la condición.
- Los identificadores internos son genéricos y no se reutilizan entre fixtures.
- No añadir datos reales, rutas absolutas ni URL privadas.
- Si cambian los mensajes de validación, actualizar la tabla y las pruebas correspondientes.
- Los fixtures válidos y sus contratos se añadirán por separado; este README documenta únicamente el conjunto inválido.
