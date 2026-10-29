# Ejemplos

[English](README.md) | [Español](README-es.md)

Todos los datos de esta carpeta son sintéticos. No proceden de mapas, clientes, grupos ni proyectos reales.

## Entrada

- `entrada/mapa-minimo.mup`: árbol mínimo con nodos raíz e hijos.
- `entrada/mapa-completo.mup`: notas, atributos, pegatinas, enlaces externos e icono.
- `entrada/mapa-con-adjunto.mup`: adjunto de texto y un icono pequeño.

## Conversión

Desde la raíz del repositorio:

```bash
node scripts/convert.js --input examples/entrada --output examples/salida --html
```

El comando recorre la carpeta de entrada, escribe un JSON-CMJN por mapa y genera el HTML autocontenido. No sobrescribe archivos existentes.

Para una conversión sin recursión y sin HTML:

```bash
node scripts/convertir-local.js
```

`convertir-local.js` usa `config.local.json` o las variables `MUP_INPUT_DIR` y `MUP_OUTPUT_DIR`.

## Salida

La carpeta `salida/` está vacía en el repositorio. El comando crea los archivos generados al ejecutarse; se puede vaciar y regenerar con el mismo comando. Los archivos de salida no se editan a mano.

## Nota

Los ejemplos no incluyen datos privados, rutas absolutas ni direcciones del despliegue privado. Si se añade un ejemplo nuevo, debe ser sintético y verificable.
