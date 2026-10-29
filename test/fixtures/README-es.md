# Fixtures sintéticos

[English](README.md) | [Español](README-es.md)

Este directorio contiene archivos de prueba para la validación de subidas de mapas MindMup. Todos los nombres, títulos, identificadores, fechas y textos son inventados y no proceden de mapas reales. No hay datos personales, clientes, organizaciones, rutas absolutas ni URL privadas.

## Contenido

- `mup/valido-minimo.mup`: árbol mínimo con nodos raíz e hijos.
- `mup/valido-completo.mup`: notas, atributos, pegatinas, enlaces externos e icono.
- `mup/valido-adjunto.mup`: adjunto de texto y un icono pequeño.
- `esperado/valido-minimo.contrato.json`, `esperado/valido-completo.contrato.json` y `esperado/valido-adjunto.contrato.json`: contratos JSON-CMJN esperados.
- `mup/invalido-*`: cinco fixtures de rechazo, uno por motivo.

## Fixtures válidos

| Archivo | Contenido | Uso |
|---|---|---|
| `mup/valido-minimo.mup` | Árbol simple de 10 nodos | Conversión mínima y pruebas de capas |
| `mup/valido-completo.mup` | 12 nodos con notas, atributos, pegatinas, icono, enlace y referencias | Conversión completa y pruebas de capas |
| `mup/valido-adjunto.mup` | 6 nodos con adjunto de texto e icono | Pruebas de adjuntos |

Los contratos de `esperado/` contienen las diez colecciones y `node_count` coherente con `nodes.length`.

## Fixtures inválidos

La carpeta `mup/` reúne cinco fixtures inválidos. Cada uno representa un único motivo de rechazo y está pensado para la suite de subida (`test/functions/test-upload.js`).

| Archivo | Construcción | Rechazo esperado |
|---|---|---|
| `mup/invalido-extension.txt` | Texto mínimo con extensión `.txt` | `400` · `El archivo debe tener extensión .mup` |
| `mup/invalido-pequeno.mup` | JSON válido de menos de 1 KB | `400` · `El archivo está vacío o es demasiado pequeño (mínimo 1 KB)` |
| `mup/invalido-json.mup` | Más de 1 KB, truncado después de `"ideas": {` | `400` · `El archivo no contiene un JSON válido` |
| `mup/invalido-sin-format-version.mup` | JSON válido de más de 1 KB, con `ideas` y sin `formatVersion` | `400` · `Falta el campo obligatorio formatVersion` |
| `mup/invalido-sin-ideas.mup` | JSON válido de más de 1 KB, con `formatVersion: 3` y sin `ideas` | `400` · `Falta el árbol de nodos (ideas)` |

## Orden de validación

La subida comprueba primero la extensión, después el tamaño mínimo, después el tamaño máximo, después el JSON y, por último, los campos obligatorios. Los fixtures están construidos para que el primer error que se alcance sea el indicado en la tabla.

## Mantenimiento

- Un archivo por motivo de rechazo; el nombre describe la condición.
- Los identificadores internos son genéricos y no se reutilizan entre fixtures.
- No añadir datos reales, rutas absolutas ni URL privadas.
- Si cambian los mensajes de validación, actualizar la tabla y las pruebas correspondientes.
