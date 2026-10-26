# Motor piloto de Whapicommerce

Aquí Fitz desarrolla y publica el agente de ventas sin acceso libre al VPS.
La plataforma conserva las llaves, los permisos y la ejecución de acciones.
El código inicial devuelve siempre `{ tipo: 'actual' }`: no cambia la atención.

## Uso desde la terminal

La misma llave SSH de Fitz autentica estos comandos, sin abrir una consola:

```
ssh -p 65002 fitz@178.156.144.236 ayuda
ssh -p 65002 fitz@178.156.144.236 estado
ssh -p 65002 fitz@178.156.144.236 consultar tiendas
ssh -p 65002 fitz@178.156.144.236 consultar chats finotech-ve
ssh -p 65002 fitz@178.156.144.236 consultar mensajes finotech-ve ID_DEL_CHAT
ssh -p 65002 fitz@178.156.144.236 consultar pedidos finotech-ve
ssh -p 65002 fitz@178.156.144.236 consultar llamadas finotech-ve
ssh -p 65002 fitz@178.156.144.236 consultar costos finotech-ve
ssh -p 65002 fitz@178.156.144.236 consultar seguimientos finotech-ve
ssh -p 65002 fitz@178.156.144.236 consultar productos finotech-ve
```

Las consultas admiten una página numérica opcional, desde cero, de hasta 50 filas.
Se pueden consultar todas las tiendas excepto la privada de Luis. No hay SQL libre
ni función de exportación; poder leer no impide copiar texto localmente.
`llamadas` incluye `habilidades: piloto:<sha>` cuando intervino el motor, para
relacionar versión, conversación, pedidos y consumo. `costos` resume los últimos
30 días por modelo y fuente; los seguimientos mantienen sus límites actuales.

Para publicar: hacer commit/push aquí y usar el SHA completo de 40 caracteres.

```
ssh -p 65002 fitz@178.156.144.236 publicar SHA_COMPLETO
ssh -p 65002 fitz@178.156.144.236 activar finotech-ve SHA_COMPLETO
ssh -p 65002 fitz@178.156.144.236 desactivar finotech-ve
ssh -p 65002 fitz@178.156.144.236 historial
```

La publicación ejecuta comprobaciones técnicas mantenidas fuera de este repo.
No necesita aprobación de Luis en cada versión. Solo se puede activar en:
`finotech-ve`, `tienda-demo-soporte`, `whapicommerce`. Ampliarlo es decisión de Luis.

## Contrato 1

`index.mjs` exporta una función async por defecto. Puede importar otros archivos
`.mjs` y `.json` relativos del repo (sin dependencias npm ni scripts de instalación).
Cada llamada corre en un contenedor efímero sin red, sin secretos y sin escritura,
con CPU/RAM limitadas. El estado entre turnos está en `contexto.borrador`, conservado
por la plataforma; las variables de módulo no persisten. Presupuesto de ejecución:
3 segundos de código, 256 MB. Las llamadas de IA se solicitan por el contrato y se
hacen fuera del contenedor, por lo que no consumen esos 3 segundos.

Recibe:
- `protocolo: 1`, `tipo: 'venta' | 'seguimiento'`.
- `borrador`: carrito/datos del chat real. No se puede sustituir el chat o tienda.
- `mensajes`: contexto disponible de ese chat, con respuestas de herramientas.
- `herramientas`: esquemas de las herramientas disponibles para esta vuelta.
- `resultadoModelo`: texto de la redacción solicitada, o null inicialmente.

Devuelve UNA de estas acciones:

```js
{ tipo: 'actual' } // continuar con el agente actual y el contexto vigente
{ tipo: 'texto', texto: '¿En qué ciudad recibirías el pedido?' }
{ tipo: 'herramientas', llamadas: [
  { nombre: 'search_products', argumentos: { query: 'camiseta' } }
] }
{ tipo: 'redactar', mensajes: [
  { role: 'system', content: 'Escribe una pregunta breve para pedir la ciudad.' },
  { role: 'user', content: 'Usa un tono amable.' }
] }
```

Después de `redactar`, se vuelve a llamar a la función con `resultadoModelo`.
Se permiten hasta dos solicitudes de redacción por vuelta; usan el modelo actual
de la tienda y registran tokens/costo reales. No se cambian motor y modelo a la vez.

Las herramientas se validan contra la lista y esquema entregados: no se permite
inventar herramientas, destinatarios, IDs de tienda o conexión. Tampoco operaciones
bancarias ni imponer un costo de envío al confirmar. Confirmar va en una vuelta
separada, usando el carrito validado. Los textos pasan por los candados existentes.
El máximo actual son tres herramientas diferentes por propuesta y seis vueltas.
Los seguimientos solo devuelven texto/redacción/actual: el programador confiable
conserva horarios, límites, pausas y destinatarios; no puedes crear envíos libres.

Si falla el motor, devuelve un contrato inválido o tarda demasiado, la tienda vuelve
al actual. El fallback continúa desde los resultados ya obtenidos, no repite el
turno desde cero. Un cambio manual de versión invalida las salidas antiguas en curso.
No hay tope monetario de IA; sí límites de recursos y concurrencia.

## Validación comercial

Las comprobaciones técnicas no garantizan conversión ni ausencia de errores de
venta. Seguir el brief: primero el motor con el modelo actual, medición por versión,
pedido válido y conversación; después comparar modelos. Las primeras activaciones
son en tiendas reales y deben vigilarse. El resto de la plataforma no se modifica
desde este repositorio. Para ampliar el contrato, solicitar una revisión del sistema
principal, no intentar eludirlo.
