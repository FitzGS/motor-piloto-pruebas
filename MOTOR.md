# Motor v2 — cómo está hecho y cómo se prueba

«Código asistido por IA»: la venta es una secuencia de pasos y la decide el
**código**; el modelo entra solo donde el código no llega. En esta versión el
modelo no entra en ningún sitio: lo que el motor no resuelve por código lo cede
al agente actual con `{ tipo: 'actual' }`.

## Qué hace la v1

| Situación | Qué devuelve |
|---|---|
| Sin carrito, el cliente nombra un producto o pregunta qué venden | `redactar`: un prompt de ~300 tokens decide si se busca y con qué palabras (nunca inventa un producto; una necesidad sin producto la lleva el actual) |
| Con esa decisión | `herramientas`: `search_products` con la consulta o el precio |
| La búsqueda del motor trae UN disponible | `herramientas`: `send_product_card`; luego escribe el actual (una entrada en vez de tres) |
| Trae varios | `texto`: lista corta por código (hasta 3, nombre y precio) y «¿Cuál te muestro?» |
| Agotado, nada, categorías, ficha ya enseñada, o la búsqueda la pidió el actual | `actual`, que ya tiene el resultado delante |
| Carrito con items y el cliente dice que sí a «¿te lo despacho?», «lo quiero», «hagamos el pedido» | `texto`: la lista de datos que faltan, en UN solo mensaje, con los ejemplos del país |
| El cliente manda datos (con etiqueta, en varias líneas, o la respuesta a la pregunta de UN dato) | `herramientas`: una sola `set_customer_info` con TODO lo que trajo el mensaje |
| Tras guardar, aún faltan datos | `texto`: pide SOLO lo que falta |
| Tras guardar, ya está todo (`awaiting_confirmation`) | `texto`: previsualización (líneas, total, datos) + «¿Confirmas el pedido?» |
| Dijo que sí a la previsualización mostrada en un mensaje ANTERIOR | `herramientas`: `confirm_order` sin argumentos, sola |
| Dijo que no a la previsualización | `texto`: «¿qué quieres cambiar?» |
| Corrige un dato en la previsualización | `set_customer_info` con la corrección |
| Seguimiento con carrito | `texto` propio por etapa (tres enfoques, nunca repetidos) |
| Todo lo demás: necesidades sin producto, dudas, objeciones, cierre con pago, asesor, imágenes | `actual` |

## Candados (de Venelectronics, copiados tal cual)

1. `confirm_order` solo si la previsualización se mostró en un mensaje anterior
   y el cliente acaba de decir que sí. Un «sí» sin previsualización no confirma.
2. Un dato se guarda solo si vino firme: con etiqueta, de forma inconfundible
   (correo, teléfono del país, cédula con letra) o como respuesta a la pregunta
   de ese dato. Nada se adivina. Una cédula de 10 dígitos suelta en Ecuador no
   se toma: puede ser un celular de Guayas.
3. Los textos pasan por guardias: ningún precio fuera del carrito, ningún
   número/correo que no sea del cliente, sin enlaces, sin palabras técnicas ni
   el nombre del proveedor, máximo 3 emojis. Si no pasan → `actual`.
4. Misma respuesta ya dicha dos veces → `actual`.
5. Resultados de herramientas que no son del motor (el actual buscó) → `actual`.
6. Cualquier error → `actual`.

## Piezas

```
index.mjs              motor(contexto) → plan · motorConTraza → { plan, porque }
piezas/contexto.mjs    lee el contrato: país y campos del prompt, último mensaje, resultados
piezas/interprete.mjs  regex + pregunta pendiente → { intencion, datos }
piezas/busqueda.mjs    búsqueda y ficha por código (sin carrito)
piezas/etapas.mjs      la máquina: cart → awaiting_info → awaiting_confirmation
piezas/redactor.mjs    textos por código: pedir datos, previsualización
piezas/guardias.mjs    revisan el texto antes de entregarlo
piezas/seguimiento.mjs seguimientos por etapa
paises/{general,ec,ve,co}.mjs  lo que cambia por país y nada más
```

El estado vive en `contexto.borrador` (lo guarda la plataforma). Lo que quedó
preguntado se deduce del último mensaje del vendedor; no hay variables de módulo.

## Probar

```
node --test pruebas/motor.test.mjs
```

Casos dorados en `pruebas/motor.test.mjs`; el `contexto` falso en
`pruebas/contexto-falso.mjs` imita el prompt de la plataforma en lo que el motor
lee: `La tienda opera en EC.`, el bloque «Datos que tienes que recoger» y el
aviso «YA PEDISTE …».

Un turno tarda ~170 ms con el proceso encerrado de pruebas (`local-runner.mjs`),
contra un tope de 3 s.
