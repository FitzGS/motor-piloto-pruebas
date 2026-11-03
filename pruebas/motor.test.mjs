// Banco de pruebas LOCAL, sin npm: `node --test pruebas/`.
// Cada caso arma un `contexto` del contrato y mira la acción que devuelve el
// motor. Son casos dorados: si uno cambia, cambió una regla de venta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import motor, { motorConTraza } from '../index.mjs';
import { contextoFalso, m, HERRAMIENTAS } from './contexto-falso.mjs';
import { extraerDatos, interpretar } from '../piezas/interprete.mjs';
import { paisDe } from '../paises/index.mjs';
import { PROMPT_DECIDIR } from '../piezas/busqueda.mjs';

const ec = paisDe('ec');
const ve = paisDe('ve');

// ── Lo que NO es del motor cede al actual ─────────────────────────────────
test('explorando (sin carrito) y solo saluda → actual, sin preguntar nada', async () => {
  const c = contextoFalso({ borrador: { stage: 'browsing', items: [] }, historial: [m.cliente('hola, buenas tardes')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('protocolo desconocido o tipo raro → actual, nunca lanza', async () => {
  assert.deepEqual(await motor(null), { tipo: 'actual' });
  assert.deepEqual(await motor({ protocolo: 2 }), { tipo: 'actual' });
  assert.deepEqual(await motor({ protocolo: 1, tipo: 'otra', borrador: null, mensajes: null }), { tipo: 'actual' });
});

test('resultados de herramientas que no son del motor (el actual buscó) → actual', async () => {
  const c = contextoFalso({ historial: [m.cliente('quiero ver otra cosa'), m.llamada('search_products', { query: 'crema' }), m.resultado({ ok: true, products: [] })] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('una pregunta del cliente en medio de los datos → actual', async () => {
  const c = contextoFalso({ borrador: { stage: 'awaiting_info', customerName: 'Ana Pérez' }, historial: [m.vendedor('¿Cuál es tu dirección exacta?'), m.cliente('¿cuánto cuesta el envío?')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('pide un asesor → actual (el actual sabe transferir)', async () => {
  const c = contextoFalso({ borrador: { stage: 'awaiting_info' }, historial: [m.cliente('quiero hablar con una persona')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

// ── "¿Te lo despacho?" → sí → se piden los datos en UN mensaje ────────────
test('sí a "¿te lo despacho?" con carrito → lista de datos en un solo mensaje', async () => {
  const c = contextoFalso({ historial: [m.vendedor('Quedan 2 combos a $39,99. ¿Te lo despacho?'), m.cliente('sí')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.match(r.plan.texto, /Nombre y apellido/);
  assert.match(r.plan.texto, /Dirección exacta/);
  assert.match(r.plan.texto, /Ciudad/);
  assert.match(r.plan.texto, /un solo mensaje/);
  // Un mensaje, no una pregunta por dato.
  assert.ok((r.plan.texto.match(/\?/g) || []).length <= 1);
});

test('"lo quiero" con carrito → lista de datos', async () => {
  const c = contextoFalso({ historial: [m.vendedor('Este combo trae 3 ligas de resistencia.'), m.cliente('lo quiero')] });
  assert.equal(motorConTraza(c).plan.tipo, 'texto');
});

test('sí a "¿quieres ver las características?" NO es comprar → actual', async () => {
  const c = contextoFalso({ historial: [m.vendedor('¿Quieres que te cuente las características?'), m.cliente('sí')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('los opcionales ya pedidos no vuelven a la lista', async () => {
  const c = contextoFalso({ system: { yaPedidos: ['Cédula / documento', 'Punto de referencia'] }, historial: [m.vendedor('¿Te lo despacho?'), m.cliente('dale')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto');
  assert.doesNotMatch(r.plan.texto, /Cédula/);
  assert.doesNotMatch(r.plan.texto, /referencia/i);
});

test('si la tienda ofrece oficina, la línea de dirección lo dice', async () => {
  const c = contextoFalso({ system: { oficina: 'Servientrega' }, historial: [m.vendedor('¿Te lo despacho?'), m.cliente('sí')] });
  assert.match(motorConTraza(c).plan.texto, /oficina de Servientrega/);
});

// ── Datos → set_customer_info con TODO lo del mensaje ─────────────────────
test('datos con etiquetas en varias líneas → una sola llamada con todos', async () => {
  const c = contextoFalso({ borrador: { stage: 'awaiting_info' }, historial: [
    m.vendedor('Para despacharlo necesito:\n👤 Nombre y apellido\n📱 Teléfono\n📍 Dirección\n🏙️ Ciudad'),
    m.cliente('Nombre: Ana Pérez\nTeléfono: 0987593542\nDirección: La Floresta, Carlos Montúfar E13-361 y El Monitor\nCiudad: Quito'),
  ] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'herramientas', r.porque.join(' | '));
  assert.equal(r.plan.llamadas.length, 1);
  assert.equal(r.plan.llamadas[0].nombre, 'set_customer_info');
  assert.deepEqual(r.plan.llamadas[0].argumentos, { name: 'Ana Pérez', phone: '0987593542', address: 'La Floresta, Carlos Montúfar E13-361 y El Monitor', city: 'Quito' });
});

test('datos sin etiquetas, en varias líneas → nombre, teléfono y dirección', async () => {
  const c = contextoFalso({ borrador: { stage: 'awaiting_info' }, historial: [m.vendedor('Para despacharlo necesito…'), m.cliente('Ana Pérez\n0987593542\nAv. Amazonas N24-03 y Colón')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'herramientas', r.porque.join(' | '));
  assert.deepEqual(r.plan.llamadas[0].argumentos, { name: 'Ana Pérez', phone: '0987593542', address: 'Av. Amazonas N24-03 y Colón' });
});

test('respuesta corta a la pregunta de UN dato (ciudad) → se guarda como ese dato', async () => {
  const c = contextoFalso({
    borrador: { stage: 'awaiting_info', customerName: 'Ana Pérez', customerPhone: '0987593542', customerAddress: 'Av. Amazonas N24-03', customerIdentification: '1705401592', customerReference: 'frente al parque' },
    historial: [m.vendedor('Solo me falta un dato 🙂\n¿En qué ciudad recibes el pedido?'), m.cliente('Guayaquil')],
  });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'herramientas', r.porque.join(' | '));
  assert.deepEqual(r.plan.llamadas[0].argumentos, { city: 'Guayaquil' });
});

test('"soy de Quito" → ciudad', () => {
  assert.deepEqual(extraerDatos('soy de Quito', { pais: ec }), { ciudad: 'Quito' });
  assert.deepEqual(extraerDatos('me llamo Ana Pérez', { pais: ec }), { nombre: 'Ana Pérez' });
});

test('el ejemplo del prompt NO se guarda: una respuesta vacía de datos cede al actual', async () => {
  // "ok" como respuesta a la lista de datos no es un dato.
  const c = contextoFalso({ borrador: { stage: 'awaiting_info' }, historial: [m.vendedor('Para despacharlo necesito:\n👤 Nombre\n📍 Dirección'), m.cliente('ok')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('Venezuela: cédula con letra y teléfono 04xx se leen sueltos', () => {
  const d = extraerDatos('Luis Álvarez\nV-12345678\n0414 123 4567\nUrb. El Paraíso, calle 3, casa 12', { pais: ve });
  assert.deepEqual(d, { nombre: 'Luis Álvarez', cedula: 'V-12345678', telefono: '04141234567', direccion: 'Urb. El Paraíso, calle 3, casa 12' });
});

test('Ecuador: una cédula de 10 dígitos SUELTA no se toma (puede ser un celular de Guayas)', () => {
  assert.deepEqual(extraerDatos('0912345678', { pais: ec }), { telefono: '0912345678' });
  assert.deepEqual(extraerDatos('cédula: 0912345678', { pais: ec }), { cedula: '0912345678' });
});

test('un teléfono que no cuadra con el país se descarta, no se adivina', () => {
  assert.deepEqual(extraerDatos('tel: 12345', { pais: ec }), {});
});

// ── Tras guardar: pedir lo que falte o la previsualización ────────────────
test('tras set_customer_info con datos aún faltantes → pide SOLO lo que falta', async () => {
  const c = contextoFalso({
    borrador: { stage: 'awaiting_info', customerName: 'Ana Pérez', customerPhone: '0987593542' },
    historial: [m.cliente('Ana Pérez 0987593542'), m.llamada('set_customer_info', { name: 'Ana Pérez', phone: '0987593542' }), m.resultado({ ok: true, carrito: '…' })],
  });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.doesNotMatch(r.plan.texto, /Nombre y apellido/);
  assert.match(r.plan.texto, /Dirección/);
  assert.match(r.plan.texto, /Ciudad/);
});

test('tras set_customer_info con todo → previsualización con total y UNA pregunta', async () => {
  const c = contextoFalso({
    borrador: { stage: 'awaiting_confirmation', customerName: 'Ana Pérez', customerPhone: '0987593542', customerAddress: 'Av. Amazonas N24-03 y Colón', customerCity: 'Quito', customerState: 'Pichincha', customerIdentification: '1705401592', customerReference: 'frente al parque' },
    historial: [m.cliente('Quito'), m.llamada('set_customer_info', { city: 'Quito' }), m.resultado({ ok: true })],
  });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.match(r.plan.texto, /2× Combo de ligas — \$39,99/);
  assert.match(r.plan.texto, /Total: \$39,99/);
  assert.match(r.plan.texto, /Quito, Pichincha/);
  assert.match(r.plan.texto, /¿Todo bien así\?/);
  assert.equal((r.plan.texto.match(/\?/g) || []).length, 1);
});

test('set_customer_info rechazado (ok:false) → actual, que sabe leer la pista', async () => {
  const c = contextoFalso({ borrador: { stage: 'awaiting_info' }, historial: [m.cliente('…'), m.llamada('set_customer_info', { email: 'no tengo' }), m.resultado({ ok: false, retry: true, hint: 'Eso no es un correo' })] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('aviso de zona en el resultado → actual (lo explica el actual)', async () => {
  const c = contextoFalso({ borrador: { stage: 'awaiting_confirmation', customerName: 'Ana', customerAddress: 'x 1', customerCity: 'y', customerState: 'z', customerPhone: '0987593542' }, historial: [m.cliente('…'), m.llamada('set_customer_info', { city: 'y' }), m.resultado({ ok: true, avisoZona: 'La transportadora no entrega ahí' })] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

// ── Confirmación: el candado ──────────────────────────────────────────────
const listo = { stage: 'awaiting_confirmation', customerName: 'Ana Pérez', customerPhone: '0987593542', customerAddress: 'Av. Amazonas N24-03 y Colón', customerCity: 'Quito', customerState: 'Pichincha' };

test('sí a NUESTRA previsualización → confirm_order sin argumentos, sola', async () => {
  const c = contextoFalso({ borrador: listo, historial: [m.vendedor('Te resumo el pedido 📝\n…\n¿Confirmas el pedido? Responde *sí* y lo registro.'), m.cliente('Sí, confirmo')] });
  const r = motorConTraza(c);
  assert.deepEqual(r.plan, { tipo: 'herramientas', llamadas: [{ nombre: 'confirm_order', argumentos: {} }] }, r.porque.join(' | '));
});

test('sí a la confirmación que pidió el agente ACTUAL con sus palabras → confirm_order', async () => {
  const c = contextoFalso({ borrador: listo, historial: [m.vendedor('Resumen: 2 combos, $39,99, a Quito. ¿Confirmas para despacharlo?'), m.cliente('dale')] });
  assert.equal(motorConTraza(c).plan.tipo, 'herramientas');
});

test('"sí" SIN previsualización previa NO confirma: muestra la previsualización', async () => {
  const c = contextoFalso({ borrador: listo, historial: [m.vendedor('Guardé tus datos.'), m.cliente('sí')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'actual', r.porque.join(' | '));
});

test('"sí" a la previsualización pero el borrador dice que faltan datos → actual', async () => {
  const c = contextoFalso({ borrador: { ...listo, stage: 'awaiting_info', customerAddress: null }, historial: [m.vendedor('¿Confirmas el pedido?'), m.cliente('sí')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('"no" a la previsualización → pregunta qué cambiar, sin tocar nada', async () => {
  const c = contextoFalso({ borrador: listo, historial: [m.vendedor('…¿Confirmas el pedido? Responde *sí* y lo registro.'), m.cliente('no')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto');
  assert.match(r.plan.texto, /cambiar/);
});

test('corrección en la previsualización ("la dirección es…") → set_customer_info', async () => {
  const c = contextoFalso({ borrador: listo, historial: [m.vendedor('…¿Confirmas el pedido?'), m.cliente('dirección: Av. Amazonas N24-10 y Colón, edificio azul')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'herramientas');
  assert.deepEqual(r.plan.llamadas[0].argumentos, { address: 'Av. Amazonas N24-10 y Colón, edificio azul' });
});

test('sin la herramienta confirm_order en esta vuelta → actual', async () => {
  const sinConfirmar = HERRAMIENTAS.filter((t) => t.function.name !== 'confirm_order');
  const c = contextoFalso({ borrador: listo, herramientas: sinConfirmar, historial: [m.vendedor('¿Confirmas el pedido?'), m.cliente('sí')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('pedido creado SIN contraentrega → el cierre lo escribe el actual (sabe ofrecer los pagos)', async () => {
  const c = contextoFalso({ borrador: { ...listo, lastPedidoLabel: '#0042' }, historial: [m.cliente('sí'), m.llamada('confirm_order', {}), m.resultado({ ok: true, pedidoLabel: '#0042', pedidoNumber: 42, total: 39.99 })] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

// Ronda 3 de simulaciones (31-oct-2026): el cierre tras confirm_order era el
// turno más caro de la venta (~37.000 tokens, $0,003) para escribir un texto
// fijo que la propia plataforma define en el prompt.
test('pedido creado CON contraentrega → cierre por código, con el número y el total', async () => {
  const c = contextoFalso({ system: { contraentrega: true }, borrador: { ...listo, stage: 'confirmed', lastPedidoLabel: '#0042' }, historial: [m.cliente('sí'), m.llamada('confirm_order', {}), m.resultado({ ok: true, pedidoLabel: '#0042', pedidoNumber: 42, total: 39.99 })] });
  assert.deepEqual(await motor(c), { tipo: 'texto', texto: 'Pedido confirmado #0042 · Pagas $39,99 en efectivo cuando lo recibas 🚚' });
});

test('confirm_order rechazado (pedido duplicado) → actual, aunque sea contraentrega', async () => {
  const c = contextoFalso({ system: { contraentrega: true }, borrador: listo, historial: [m.cliente('sí'), m.llamada('confirm_order', {}), m.resultado({ ok: false, hint: 'Este cliente YA tiene el pedido #0006' })] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('confirm_order sin número de pedido válido → actual', async () => {
  const c = contextoFalso({ system: { contraentrega: true }, borrador: listo, historial: [m.cliente('sí'), m.llamada('confirm_order', {}), m.resultado({ ok: true, total: 39.99 })] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('ya hay un pedido confirmado en el chat → actual (no se reabre el embudo)', async () => {
  const c = contextoFalso({ borrador: { ...listo, lastPedidoLabel: '#0042' }, historial: [m.vendedor('¿Confirmas el pedido?'), m.cliente('sí')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

// ── Guardias ──────────────────────────────────────────────────────────────
test('misma respuesta ya dicha dos veces → actual (no se insiste)', async () => {
  const lista = motorConTraza(contextoFalso({ historial: [m.vendedor('¿Te lo despacho?'), m.cliente('sí')] })).plan.texto;
  const c = contextoFalso({ historial: [m.vendedor(lista), m.cliente('mmm'), m.vendedor(lista), m.vendedor('¿Te lo despacho?'), m.cliente('sí')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('la previsualización nunca nombra un precio que no esté en el carrito', async () => {
  const c = contextoFalso({ borrador: { ...listo, shippingCost: 3.5 }, historial: [m.cliente('Quito'), m.llamada('set_customer_info', { city: 'Quito' }), m.resultado({ ok: true })] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.match(r.plan.texto, /Envío: \$3,50/);
  assert.match(r.plan.texto, /Total: \$43,49/);
});

// ── Seguimientos ──────────────────────────────────────────────────────────
test('seguimiento sin carrito → actual (reactivación del actual)', async () => {
  const c = contextoFalso({ tipo: 'seguimiento', borrador: { stage: 'browsing', items: [] }, herramientas: [] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('seguimiento con carrito listo → texto propio que pide confirmar, con el nombre', async () => {
  const c = contextoFalso({ tipo: 'seguimiento', borrador: listo, herramientas: [] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto');
  assert.match(r.plan.texto, /Hola, Ana/);
  assert.match(r.plan.texto, /Combo de ligas/);
  assert.match(r.plan.texto, /confirm/i);
});

test('seguimiento con un dato faltante → lo nombra', async () => {
  const c = contextoFalso({ tipo: 'seguimiento', borrador: { ...listo, stage: 'awaiting_info', customerCity: null, customerState: null }, herramientas: [] });
  assert.match(motorConTraza(c).plan.texto, /me falta tu ciudad/i);
});

test('los seguimientos no se repiten: el 2.º y el 3.º cambian, el 4.º cede', async () => {
  const primero = motorConTraza(contextoFalso({ tipo: 'seguimiento', borrador: listo, herramientas: [] })).plan.texto;
  const segundo = motorConTraza(contextoFalso({ tipo: 'seguimiento', borrador: listo, herramientas: [], historial: [m.vendedor(primero)] })).plan.texto;
  const tercero = motorConTraza(contextoFalso({ tipo: 'seguimiento', borrador: listo, herramientas: [], historial: [m.vendedor(primero), m.vendedor(segundo)] })).plan.texto;
  assert.notEqual(primero, segundo);
  assert.notEqual(segundo, tercero);
  assert.match(tercero, /sin compromiso/);
  const cuarto = await motor(contextoFalso({ tipo: 'seguimiento', borrador: listo, herramientas: [], historial: [m.vendedor(primero), m.vendedor(segundo), m.vendedor(tercero)] }));
  assert.deepEqual(cuarto, { tipo: 'actual' });
});

// Simulación del 31-oct-2026: el cliente pidió cambiar de producto, el agente
// enseñó el nuevo y el motor resumió el carrito viejo con los datos.
test('el vendedor acaba de enseñar otro producto → actual, aunque lleguen datos', async () => {
  const c = contextoFalso({
    borrador: { stage: 'awaiting_info' },
    historial: [
      m.cliente('mejor cámbialo por el micrófono'),
      m.llamada('send_product_card', { productSlug: 'microfono' }),
      m.resultado({ ok: true, sent: true }),
      m.vendedor('El micrófono cuesta $35. ¿Quieres 1?'),
      m.cliente('Nombre: Jose Prueba\nTeléfono: 0991234567\nDirección: Av. Principal 22\nCiudad: Quito'),
    ],
  });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('la ficha enseñada es la del carrito → el motor sigue con los datos', async () => {
  const c = contextoFalso({
    borrador: { stage: 'awaiting_info' },
    historial: [
      m.cliente('quiero el combo'),
      m.llamada('send_product_card', { productSlug: 'combo-ligas' }),
      m.resultado({ ok: true, sent: true }),
      m.vendedor('Para despacharlo necesito:\n📍 Nombre y apellido\n📍 Ciudad'),
      m.cliente('Nombre: Jose Prueba\nCiudad: Quito'),
    ],
  });
  assert.equal((await motor(c)).tipo, 'herramientas');
});

// ── El intérprete, suelto ─────────────────────────────────────────────────
test('intérprete: sí/no solo cuentan con una pregunta pendiente', () => {
  assert.equal(interpretar({ texto: 'sí', pendiente: 'confirmar', pais: ec }).intencion, 'si');
  assert.equal(interpretar({ texto: 'no gracias', pendiente: 'confirmar', pais: ec }).intencion, 'no');
  assert.equal(interpretar({ texto: 'sí', pendiente: null, pais: ec }).intencion, 'otro');
  assert.equal(interpretar({ texto: 'sí pero cambia la dirección', pendiente: 'confirmar', pais: ec }).intencion, 'otro');
});

test('intérprete: "no tengo correo" cuando se pidió el correo → sin_dato', () => {
  assert.deepEqual(interpretar({ texto: 'no tengo correo', pendiente: 'email', pais: ec }).datos, { clave: 'email' });
});

// ── v2: la búsqueda y la ficha las decide el código ───────────────────────
// Un id como los que arma la plataforma para un plan del motor (piloto/cliente.ts).
const ID_MOTOR = `call_${'a1'.repeat(16)}`;
const ID_MODELO = 'call_Xk29fPqLmN03aBcDeFgHiJk1';
const sinCarrito = { stage: 'browsing', items: [] };
const producto = (slug, name, price, extra = {}) => ({ slug, name, available: true, lowestPrice: price, variants: [{ slug: 'unico', label: 'Único', price, available: true }], ...extra });

test('búsqueda A: pregunta por un producto sin carrito → redactar con el prompt corto de decidir', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.vendedor('Qué producto estás buscando?'), m.cliente('tienes audífonos inalámbricos?')] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'redactar', r.porque.join(' | '));
  assert.equal(r.plan.mensajes.length, 2);
  assert.match(r.plan.mensajes[0].content, /buscar en el catálogo/);
  assert.match(r.plan.mensajes[1].content, /tienes audífonos inalámbricos\?/);
  assert.match(r.plan.mensajes[1].content, /Qué producto estás buscando/);
  // Corto de verdad: es lo que hace barato el turno.
  assert.ok(JSON.stringify(r.plan.mensajes).length < 2000);
});

test('búsqueda B: la decisión dice que sí → search_products con la consulta', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes audífonos inalámbricos?')], resultadoModelo: '{"buscar": true, "consulta": "audífono inalámbrico", "precio": null}' });
  assert.deepEqual(await motor(c), { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { query: 'audífono inalámbrico' } }] });
});

test('búsqueda B: por precio → manda también el precio', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('cual es el reloj mas barato')], resultadoModelo: 'claro: {"buscar":true,"consulta":"reloj","precio":0}' });
  assert.deepEqual((await motor(c)).llamadas[0].argumentos, { query: 'reloj', precio: 0 });
});

test('búsqueda B: «qué venden» sin consulta útil → search_products sin query (categorías)', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('que venden?')], resultadoModelo: '{"buscar":true,"consulta":"productos","precio":null}' });
  assert.deepEqual((await motor(c)).llamadas[0].argumentos, {});
});

test('búsqueda B: la decisión dice que no, o no se entiende → actual', async () => {
  for (const crudo of ['{"buscar": false, "consulta": null, "precio": null}', 'no sé', '{"buscar":"si"}']) {
    const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('y eso cómo es?')], resultadoModelo: crudo });
    assert.deepEqual(await motor(c), { tipo: 'actual' }, crudo);
  }
});

test('búsqueda A: envío, pago, pedido, asesor o datos → actual sin pagar la pregunta', async () => {
  for (const t of ['cuánto tarda el envío a Maracay?', 'aceptan pago móvil?', 'dónde va mi pedido', 'quiero hablar con un asesor', 'mi correo es ana@x.com']) {
    const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente(t)] });
    assert.deepEqual(await motor(c), { tipo: 'actual' }, t);
  }
});

test('búsqueda A: acaba de ver una ficha y contesta («2», «en negro») → actual, no se vuelve a buscar', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('el micrófono'), m.llamada('send_product_card', { productSlug: 'microfono' }), m.resultado({ ok: true, sent: true }), m.vendedor('$35. Cuántas quieres?'), m.cliente('2')] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('búsqueda A: con carrito no es de este tramo (lo de siempre)', async () => {
  const c = contextoFalso({ historial: [m.vendedor('Quedan 2 combos.'), m.cliente('tienes audífonos?')] });
  assert.equal(motorConTraza(c).plan.tipo, 'actual');
});

test('búsqueda C: un solo disponible → send_product_card de ese', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero el micrófono'), m.llamada('search_products', { query: 'micrófono' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('microfono', 'Micrófono Solapa', 35)] }, ID_MOTOR)] });
  assert.deepEqual(await motor(c), { tipo: 'herramientas', llamadas: [{ nombre: 'send_product_card', argumentos: { productSlug: 'microfono' } }] });
});

test('búsqueda C: varios → lista corta por código con nombre y precio, y una pregunta', async () => {
  const productos = [producto('a1', 'Audífono A', 12), producto('a2', 'Audífono B', 18.5), producto('a3', 'Audífono C', 25, { variants: [{ price: 25 }, { price: 30 }] }), producto('a4', 'Audífono D', 40)];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes audífonos?'), m.llamada('search_products', { query: 'audífono' }, ID_MOTOR), m.resultado({ ok: true, products: productos, variasOpciones: '...' }, ID_MOTOR)] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.match(r.plan.texto, /Audífono A\* — \$12,00/);
  assert.match(r.plan.texto, /Audífono B\* — \$18,50/);
  assert.match(r.plan.texto, /Audífono C\* — desde \$25,00/);
  assert.doesNotMatch(r.plan.texto, /Audífono D/);
  assert.equal((r.plan.texto.match(/\?/g) || []).length, 1);
});

test('búsqueda C: los agotados no entran en la lista ni en la ficha', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes relojes?'), m.llamada('search_products', { query: 'reloj' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('r1', 'Reloj 1', 10, { available: false }), producto('r2', 'Reloj 2', 20)] }, ID_MOTOR)] });
  assert.deepEqual((await motor(c)).llamadas, [{ nombre: 'send_product_card', argumentos: { productSlug: 'r2' } }]);
});

test('búsqueda C: categorías, resultado inválido o agotado con parecidos disponibles → actual', async () => {
  // Agotado o nada SIN disponibles ya no va directo al actual: antes se prueba
  // otro nombre (ver «otro nombre», más abajo).
  for (const res of [{ ok: true, products: [producto('b', 'Cámara tipo domo', 9)], agotados: [{ slug: 'x', name: 'Cámara wifi' }] }, { ok: true, products: [producto('a', 'A', 1)], categorias: ['Hogar', 'Audio', 'Belleza'] }, { ok: false }]) {
    const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes cámaras?'), m.llamada('search_products', { query: 'cámara' }, ID_MOTOR), m.resultado(res, ID_MOTOR)] });
    assert.deepEqual(await motor(c), { tipo: 'actual' }, JSON.stringify(res));
  }
});

test('búsqueda C: si la búsqueda la pidió el agente actual, no se toca → actual', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero el micrófono'), m.llamada('search_products', { query: 'micrófono' }, ID_MODELO), m.resultado({ ok: true, products: [producto('microfono', 'Micrófono', 35)] }, ID_MODELO)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('búsqueda C: el producto ya se enseñó en el chat → actual, sin repetir la ficha', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.llamada('send_product_card', { productSlug: 'microfono' }, 'call_viejo'), m.resultado({ ok: true }, 'call_viejo'), m.vendedor('Cuántas quieres?'), m.cliente('mmm y el micrófono cuánto era'), m.llamada('search_products', { query: 'micrófono' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('microfono', 'Micrófono', 35)] }, ID_MOTOR)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('búsqueda D: tras la ficha que mandó el motor → escribe el actual', async () => {
  const id2 = `call_${'b2'.repeat(16)}`;
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero el micrófono'), m.llamada('search_products', { query: 'micrófono' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('microfono', 'Micrófono', 35)] }, ID_MOTOR), m.llamada('send_product_card', { productSlug: 'microfono' }, id2), m.resultado({ ok: true, sent: true }, id2)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('búsqueda: sin search_products o send_product_card activas → no es del motor', async () => {
  const sin = HERRAMIENTAS.filter((t) => t.function.name !== 'send_product_card');
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes audífonos?')], herramientas: sin });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('búsqueda C: el encabezado dice de dónde sale la lista (general, por precio)', async () => {
  const productos = [producto('a1', 'Reloj uno', 7), producto('a2', 'Reloj dos', 15), producto('a3', 'Reloj tres', 29)];
  const lista = async (argumentos, dijo = 'tienen relojes?') => (await motor(contextoFalso({ borrador: sinCarrito, historial: [m.cliente(dijo), m.llamada('search_products', argumentos, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] }))).texto;
  assert.match(await lista({}, 'qué venden?'), /^Algunos de nuestros productos:/);
  assert.match(await lista({ precio: 20 }, 'algo de 20'), /^Cerca de ese precio tengo:/);
  assert.match(await lista({ query: 'reloj' }), /^Tengo estas opciones:/);
  assert.match(await lista({ category: 'Hogar' }, 'algo para la casa'), /^Para eso tengo:/);
});

test('búsqueda A: el prompt de decidir no deja inventar productos ni buscar necesidades', () => {
  assert.match(PROMPT_DECIDIR, /Nunca pongas un producto que el cliente no nombró/);
  assert.match(PROMPT_DECIDIR, /describe una NECESIDAD, un USO, una CATEGORÍA/);
  assert.match(PROMPT_DECIDIR, /EN GENERAL qué venden/);
});

test('búsqueda C: nombres repetidos cuentan una vez (catálogos con duplicados) → ficha, no lista', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienen el perfume bomba?'), m.llamada('search_products', { query: 'perfume bomba' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('bomba-1', 'Bomba Carolina Herrera perfume', 48), producto('bomba-2', 'Bomba  carolina herrera Perfume', 48), producto('bomba-3', 'Bomba Carolina Herrera perfume', 50)] }, ID_MOTOR)] });
  assert.deepEqual(await motor(c), { tipo: 'herramientas', llamadas: [{ nombre: 'send_product_card', argumentos: { productSlug: 'bomba-1' } }] });
});

test('búsqueda A: el prompt manda al actual las necesidades, categorías y para quién es', () => {
  assert.match(PROMPT_DECIDIR, /necesito algo para la cocina/);
  assert.match(PROMPT_DECIDIR, /es para mi mamá/);
  assert.match(PROMPT_DECIDIR, /de tecnología qué tienen/);
});

test('búsqueda C: «quiero los audífonos» y solo uno se llama así → su ficha, no la lista', async () => {
  const productos = [producto('audifonos-a31', 'Audifonos A31', 7), producto('microfono', 'Micrófono solapa', 35), producto('cargador', 'Cargador 3 en 1', 35)];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero los audífonos'), m.llamada('search_products', { query: 'audífono' }, ID_MOTOR), m.resultado({ ok: true, products: productos, variasOpciones: '...' }, ID_MOTOR)] });
  assert.deepEqual((await motor(c)).llamadas, [{ nombre: 'send_product_card', argumentos: { productSlug: 'audifonos-a31' } }]);
});

test('búsqueda C: varios con ese nombre → la lista es solo de esos', async () => {
  const productos = [producto('a1', 'Audífonos A31', 7), producto('x', 'Lámpara LED', 2), producto('a2', 'Audífonos de clip', 20)];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes audífonos?'), m.llamada('search_products', { query: 'audífonos' }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] });
  const t = (await motor(c)).texto;
  assert.match(t, /Audífonos A31/);
  assert.match(t, /Audífonos de clip/);
  assert.doesNotMatch(t, /Lámpara/);
});

test('búsqueda B: dos productos en la consulta → actual', async () => {
  for (const consulta of ['audífono, aro de luz', 'audífono y aro de luz']) {
    const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero los audífonos y el aro de luz')], resultadoModelo: JSON.stringify({ buscar: true, consulta, precio: null }) });
    assert.deepEqual(await motor(c), { tipo: 'actual' }, consulta);
  }
});

// ── Otro nombre para lo mismo: antes de «no lo tenemos» ───────────────────
const ID_MOTOR_2 = `call_${'c3'.repeat(16)}`;
const ID_MOTOR_3 = `call_${'d4'.repeat(16)}`;
const vacio = { ok: true, products: [], noEstaComoDecirlo: '...', alternativasDisponibles: [{ slug: 'lampara', name: 'Lámpara LED', price: 2 }] };
const soloAgotado = { ok: true, products: [], agotados: [{ slug: 'cam-wifi', name: 'Cámara de seguridad wifi' }], alternativasDisponibles: [{ slug: 'luces', name: 'Luces LED', price: 5 }] };

test('otro nombre: la búsqueda no trae nada disponible → pregunta UN nombre alternativo (redactar)', async () => {
  for (const res of [vacio, soloAgotado]) {
    const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado(res, ID_MOTOR)] });
    const r = motorConTraza(c);
    assert.equal(r.plan.tipo, 'redactar', r.porque.join(' | '));
    assert.match(r.plan.mensajes[0].content, /MISMO tipo de producto/);
    assert.match(r.plan.mensajes[1].content, /"parlante bluetooth"/);
  }
});

test('otro nombre: con la respuesta → busca ese término', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR)], resultadoModelo: '{"termino": "corneta"}' });
  assert.deepEqual(await motor(c), { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { query: 'corneta' } }] });
});

test('otro nombre: repetido, vacío o raro → actual', async () => {
  for (const crudo of ['{"termino": null}', '{"termino": "Parlante Bluetooth"}', 'ni idea', '{"termino": "corneta, bocina"}']) {
    const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR)], resultadoModelo: crudo });
    assert.deepEqual(await motor(c), { tipo: 'actual' }, crudo);
  }
});

test('otro nombre: lo encontrado con un solo nombre que casa → su ficha', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR), m.llamada('search_products', { query: 'corneta' }, ID_MOTOR_2), m.resultado({ ok: true, products: [producto('corneta-trust', 'Corneta Trust GXT606B', 30)] }, ID_MOTOR_2)] });
  assert.deepEqual((await motor(c)).llamadas, [{ nombre: 'send_product_card', argumentos: { productSlug: 'corneta-trust' } }]);
});

test('otro nombre: lo encontrado con varios → lo presenta el actual (sabe decir «eso no, pero tengo esto»)', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR), m.llamada('search_products', { query: 'corneta' }, ID_MOTOR_2), m.resultado({ ok: true, products: [producto('c1', 'Corneta Trust', 30), producto('c2', 'Tobo con corneta bluetooth', 15)] }, ID_MOTOR_2)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('otro nombre: como mucho dos; al tercer vacío → actual', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante'), m.llamada('search_products', { query: 'parlante' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR), m.llamada('search_products', { query: 'corneta' }, ID_MOTOR_2), m.resultado(vacio, ID_MOTOR_2), m.llamada('search_products', { query: 'bocina' }, ID_MOTOR_3), m.resultado(vacio, ID_MOTOR_3)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('otro nombre: el segundo vacío → pide otro sin repetir los ya probados', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante'), m.llamada('search_products', { query: 'parlante' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR), m.llamada('search_products', { query: 'corneta' }, ID_MOTOR_2), m.resultado(vacio, ID_MOTOR_2)] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'redactar');
  assert.match(r.plan.mensajes[1].content, /"parlante", "corneta"/);
});

test('otro nombre: búsquedas de un turno anterior no cuentan', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienes relojes?'), m.llamada('search_products', { query: 'reloj' }, ID_MOTOR_3), m.resultado(vacio, ID_MOTOR_3), m.vendedor('No tengo relojes ahora.'), m.cliente('y parlantes?'), m.llamada('search_products', { query: 'parlante' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR)] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'redactar');
  assert.match(r.plan.mensajes[1].content, /Ya se probó: "parlante"$/);
});

test('otro nombre: una búsqueda general o por precio sin nada no pide otro nombre', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('algo de 3 dólares?'), m.llamada('search_products', { precio: 3 }, ID_MOTOR), m.resultado({ ok: true, products: [] }, ID_MOTOR)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('otro nombre: lo encontrado solo lo menciona en la descripción (no se llama así) → también se prueba otro nombre', async () => {
  const relleno = { ok: true, products: [producto('lampara', 'Lámpara LED USB bluetooth', 2), producto('reloj', 'Reloj inteligente bluetooth', 15)] };
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado(relleno, ID_MOTOR)] });
  assert.equal(motorConTraza(c).plan.tipo, 'redactar');
});

test('otro nombre: si alguno se llama a medias así (falta un adjetivo), no se pregunta otro nombre: elige el actual', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('busco un parlante bluetooth'), m.llamada('search_products', { query: 'parlante bluetooth' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('parlante-x', 'Parlante portátil X', 25)] }, ID_MOTOR)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('ficha directa solo si el nombre lleva TODO lo pedido: «masajeador espalda» no manda el de cuero cabelludo', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero 2 masajeadores para la espalda'), m.llamada('search_products', { query: 'masajeador espalda' }, ID_MOTOR), m.resultado({ ok: true, products: [producto('arana', 'Masajeador de cuero cabelludo tipo araña', 5), producto('pistola', 'Pistola de masaje muscular', 30)] }, ID_MOTOR)] });
  assert.deepEqual(await motor(c), { tipo: 'actual' });
});

test('mirar opciones con nombres en inglés: «tienen relojes inteligentes?» lista aunque solo uno diga «reloj»', async () => {
  const productos = [producto('militar', 'Reloj militar inteligente', 18), producto('t900', 'T900 Ultra 2 Smart Watch', 25), producto('t800', 'T800 Smart Watch', 19)];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienen relojes inteligentes?'), m.llamada('search_products', { query: 'reloj inteligente' }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] });
  const r = await motor(c);
  assert.equal(r.tipo, 'texto');
  assert.match(r.texto, /Reloj militar/);
  assert.match(r.texto, /Smart Watch/);
});

test('otro nombre: la pregunta lleva el país de la tienda', async () => {
  const c = contextoFalso({ system: { pais: 'VE' }, borrador: sinCarrito, historial: [m.cliente('busco un parlante'), m.llamada('search_products', { query: 'parlante' }, ID_MOTOR), m.resultado(vacio, ID_MOTOR)] });
  assert.match(motorConTraza(c).plan.mensajes[1].content, /La tienda está en Venezuela/);
});

test('mirar opciones vs pedir uno: «¿qué audífonos tienen?» lista los que se llaman así; «quiero los audífonos» va a la ficha', async () => {
  const productos = [producto('a31', 'Audifonos A31', 7), producto('clip', 'Audífonos de clip', 20), producto('mic', 'Micrófono solapa', 35)];
  const turno = (texto) => contextoFalso({ borrador: sinCarrito, historial: [m.cliente(texto), m.llamada('search_products', { query: 'audífono' }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] });
  const lista = await motor(turno('qué audífonos tienen?'));
  assert.equal(lista.tipo, 'texto');
  assert.match(lista.texto, /Audifonos A31/);
  assert.match(lista.texto, /Audífonos de clip/);
  assert.doesNotMatch(lista.texto, /Micrófono/);
  assert.equal((await motor(turno('tienes audífonos?'))).tipo, 'texto');
  assert.equal((await motor(turno('quiero los audífonos'))).tipo, 'texto', 'dos se llaman así: lista también');
});

test('mirar opciones: frases', async () => {
  const { exploraOpciones } = await import('../piezas/busqueda.mjs');
  for (const t of ['qué audífonos tienen?', 'tienes relojes?', 'cuáles relojes hay', 'qué modelos de licuadora manejan']) assert.equal(exploraOpciones(t), true, t);
  for (const t of ['quiero los audífonos', 'tienes el micrófono?', 'me llevo la licuadora', 'tienen un parlante bluetooth?']) assert.equal(exploraOpciones(t), false, t);
});

// ── Pasadas 10 a 13 de la tienda grande: lo que fallaba al elegir ─────────
test('«el más barato» lo decide el código: ficha del de menor precio, no lista', async () => {
  // El T900 no se llama «reloj», pero es de la misma categoría que el que sí.
  const productos = [producto('t900-30', 'T900 Smart Watch', 30, { category: 'Tecnología' }), producto('t900-19', 'T900 Smart Watch Lite', 19, { category: 'Tecnología' }), producto('militar', 'Reloj militar', 65, { category: 'Tecnología' }), producto('bambu', 'Bambú chino', 5, { category: 'Otros' })];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('cuál es el más barato?'), m.llamada('search_products', { query: 'reloj', precio: 0 }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] });
  assert.deepEqual((await motor(c)).llamadas, [{ nombre: 'send_product_card', argumentos: { productSlug: 't900-19' } }]);
});

test('«cuál es el más barato» tras ver una ficha NO cede al actual: pregunta la decisión', async () => {
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienen relojes?'), m.llamada('send_product_card', { productSlug: 'militar' }), m.resultado({ ok: true, sent: true }), m.vendedor('Reloj militar $65. Cuántas quieres?'), m.cliente('cuál es el más barato?')] });
  assert.equal(motorConTraza(c).plan.tipo, 'redactar');
});

test('accesorio ≠ producto: «freidora de aire» con solo la bandeja PARA freidora → prueba otro nombre', async () => {
  const bandeja = producto('bandeja', 'Bandeja molde de silicón protector freidora', 11);
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero una freidora de aire'), m.llamada('search_products', { query: 'freidora de aire' }, ID_MOTOR), m.resultado({ ok: true, products: [bandeja] }, ID_MOTOR)] });
  assert.equal(motorConTraza(c).plan.tipo, 'redactar');
});

test('accesorio ≠ producto: agotados los nombres, lo relacionado se ofrece como relacionado, por código', async () => {
  const bandeja = producto('bandeja', 'Bandeja molde de silicón protector freidora', 11);
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero una freidora de aire'), m.llamada('search_products', { query: 'freidora de aire' }, ID_MOTOR), m.resultado({ ok: true, products: [bandeja] }, ID_MOTOR), m.llamada('search_products', { query: 'air fryer' }, ID_MOTOR_2), m.resultado({ ok: true, products: [] }, ID_MOTOR_2), m.llamada('search_products', { query: 'freidora sin aceite' }, ID_MOTOR_3), m.resultado({ ok: true, products: [bandeja] }, ID_MOTOR_3)] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.match(r.plan.texto, /^Freidora de aire como tal no tengo por ahora\. Relacionado con eso tengo:/);
  assert.match(r.plan.texto, /Bandeja molde.*\$11,00/);
  assert.doesNotMatch(r.plan.texto, /parecid|cercan/);
});

test('es de ese tipo: la palabra pedida va entre las primeras del nombre', async () => {
  const { esDeEseTipo } = await import('../piezas/busqueda.mjs');
  assert.equal(esDeEseTipo('Bandeja molde de silicón protector freidora', 'freidora de aire'), false);
  assert.equal(esDeEseTipo('Lentes de sol inteligentes con bluetooth y bocinas', 'bocina'), false);
  assert.equal(esDeEseTipo('Eigiis Reloj Militar Inteligente', 'reloj inteligente'), true);
  assert.equal(esDeEseTipo('Bomba Carolina Herrera perfume', 'perfume bomba'), true);
  assert.equal(esDeEseTipo('Corneta Trust GXT606B', 'corneta'), true);
  assert.equal(esDeEseTipo('Cámara tipo domo', 'cámara de seguridad'), true);
});

test('necesidad → categoría: «algo para la cocina» busca sin texto, elige categoría y lista lo de esa categoría', async () => {
  const c1 = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('necesito algo para la cocina')], resultadoModelo: '{"buscar": true, "consulta": null, "precio": null, "necesidad": true}' });
  assert.deepEqual(await motor(c1), { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: {} }] });
  const conCategorias = { ok: true, products: [producto('p', 'Pijama', 30)], categorias: ['Tecnología y gadgets', 'Hogar y cocina', 'Ropa'] };
  const c2 = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('necesito algo para la cocina'), m.llamada('search_products', {}, ID_MOTOR), m.resultado(conCategorias, ID_MOTOR)] });
  const r2 = motorConTraza(c2);
  assert.equal(r2.plan.tipo, 'redactar', r2.porque.join(' | '));
  assert.match(r2.plan.mensajes[1].content, /"Hogar y cocina"/);
  const c3 = contextoFalso({ borrador: sinCarrito, historial: c2.mensajes.slice(1), resultadoModelo: '{"categoria": "hogar y cocina"}' });
  assert.deepEqual(await motor(c3), { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { category: 'Hogar y cocina' } }] });
  const c4 = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('necesito algo para la cocina'), m.llamada('search_products', { category: 'Hogar y cocina' }, ID_MOTOR_2), m.resultado({ ok: true, products: [producto('lic', 'Licuadora', 25), producto('bat', 'Batidora', 47), producto('olla', 'Olla', 30), producto('x', 'Sartén', 12)] }, ID_MOTOR_2)] });
  const r4 = await motor(c4);
  assert.equal(r4.tipo, 'texto');
  assert.match(r4.texto, /^Para eso tengo:/);
  assert.doesNotMatch(r4.texto, /Sartén/);
});

test('necesidad en catálogo chico (sin categorías) → actual; «qué venden» con categorías → actual', async () => {
  const chico = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('necesito algo para la cocina'), m.llamada('search_products', {}, ID_MOTOR), m.resultado({ ok: true, products: [producto('a', 'A', 1), producto('b', 'B', 2)] }, ID_MOTOR)] });
  assert.deepEqual(await motor(chico), { tipo: 'actual' });
  const general = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('hola, qué venden?'), m.llamada('search_products', {}, ID_MOTOR), m.resultado({ ok: true, products: [producto('a', 'A', 1)], categorias: ['X', 'Y', 'Z'] }, ID_MOTOR)] });
  assert.deepEqual(await motor(general), { tipo: 'actual' });
});

test('necesidad concreta → categoría + palabra («algo para licuar» → licuadora dentro de Hogar y cocina)', async () => {
  const conCategorias = { ok: true, products: [producto('p', 'Pijama', 30)], categorias: ['Tecnología y gadgets', 'Hogar y cocina', 'Ropa'] };
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('algo para licuar'), m.llamada('search_products', {}, ID_MOTOR), m.resultado(conCategorias, ID_MOTOR)], resultadoModelo: '{"categoria": "Hogar y cocina", "palabra": "licuadora"}' });
  assert.deepEqual(await motor(c), { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { category: 'Hogar y cocina', query: 'licuadora' } }] });
  // Dentro de la categoría, con la palabra: primero lo que se llama así.
  const r = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('algo para licuar'), m.llamada('search_products', { category: 'Hogar y cocina', query: 'licuadora' }, ID_MOTOR_2), m.resultado({ ok: true, products: [producto('bat', 'Batidora licuadora de mano', 47), producto('lic', 'Licuadora de vaso', 25)] }, ID_MOTOR_2)] });
  const plan = await motor(r);
  assert.equal(plan.tipo, 'texto');
  assert.match(plan.texto, /Licuadora de vaso/);
});

test('necesidad: la palabra no da nada en la categoría → lo que haya en la categoría; la misma lista no se repite', async () => {
  const vacio2 = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('algo para licuar'), m.llamada('search_products', { category: 'Hogar y cocina', query: 'licuadora' }, ID_MOTOR), m.resultado({ ok: true, products: [] }, ID_MOTOR)] });
  assert.deepEqual(await motor(vacio2), { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { category: 'Hogar y cocina' } }] });
  const productos = [producto('bat', 'Batidora', 47), producto('bolso', 'Bolso térmico', 14.9), producto('olla', 'Olla', 30)];
  const lista = 'Para eso tengo:\n• *Batidora* — $47,00\n• *Bolso térmico* — $14,90\n• *Olla* — $30,00\n\n¿Cuál te muestro?';
  const repetida = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('algo para la cocina'), m.vendedor(lista), m.cliente('algo para licuar'), m.llamada('search_products', { category: 'Hogar y cocina' }, ID_MOTOR_2), m.resultado({ ok: true, products: productos }, ID_MOTOR_2)] });
  assert.deepEqual(await motor(repetida), { tipo: 'actual' });
});

test('«el más barato» busca por el TIPO: «reloj militar inteligente con linterna» → «reloj»; tras una ficha sin nombrar nada → el tipo del slug', async () => {
  const c1 = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('cuál es el más barato?')], resultadoModelo: '{"buscar": true, "consulta": "reloj militar inteligente con linterna", "precio": 0, "necesidad": false}' });
  assert.deepEqual((await motor(c1)).llamadas[0].argumentos, { query: 'reloj', precio: 0 });
  const c1b = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('cuál es el más barato?')], resultadoModelo: '{"buscar": true, "consulta": "reloj inteligente", "precio": 0, "necesidad": false}' });
  assert.deepEqual((await motor(c1b)).llamadas[0].argumentos, { query: 'reloj inteligente', precio: 0 });
  const c2 = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('tienen audífonos?'), m.llamada('send_product_card', { productSlug: 'audifonos-a31' }), m.resultado({ ok: true, sent: true }), m.vendedor('$7. Cuántas quieres?'), m.cliente('los más baratos')], resultadoModelo: '{"buscar": true, "consulta": null, "precio": 0, "necesidad": false}' });
  assert.deepEqual((await motor(c2)).llamadas[0].argumentos, { query: 'audifonos', precio: 0 });
});

test('«el más barato» solo entre los que SON lo pedido: el bambú de $5 no es un audífono', async () => {
  const productos = [producto('bambu', 'Bambú chino', 5, { category: 'Otros' }), producto('a31', 'Audifonos A31', 7, { category: 'Tecnología' }), producto('clip', 'Audífonos de clip', 20, { category: 'Tecnología' })];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('los más baratos'), m.llamada('search_products', { query: 'audifonos', precio: 0 }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] });
  assert.deepEqual((await motor(c)).llamadas, [{ nombre: 'send_product_card', argumentos: { productSlug: 'a31' } }]);
});

test('es de ese tipo: una palabra corta se compara entera («air» no es «airpods»)', async () => {
  const { esDeEseTipo } = await import('../piezas/busqueda.mjs');
  assert.equal(esDeEseTipo('Airpods pro 2', 'air fryer'), false);
  assert.equal(esDeEseTipo('Aro de luz LED', 'aro de luz'), true);
  assert.equal(esDeEseTipo('Cargador 3 en 1', 'aro'), false);
});

test('otro nombre: si lo que trae el otro nombre tampoco ES lo pedido, se ofrece lo relacionado (no cede al actual)', async () => {
  const bandeja = producto('bandeja', 'Bandeja Molde De Silicon Protector Freidora Anti-adherente', 11);
  const airpods = producto('airpods', 'Airpods pro 2', 20);
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('quiero la freidora de aire'), m.llamada('search_products', { query: 'freidora de aire' }, ID_MOTOR), m.resultado({ ok: true, products: [bandeja] }, ID_MOTOR), m.llamada('search_products', { query: 'freidora eléctrica' }, ID_MOTOR_2), m.resultado({ ok: true, products: [producto('afeitadora', 'Afeitadora Electrica Facial', 15)] }, ID_MOTOR_2), m.llamada('search_products', { query: 'air fryer' }, ID_MOTOR_3), m.resultado({ ok: true, products: [airpods, producto('a31', 'Audifonos A31', 7)] }, ID_MOTOR_3)] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.match(r.plan.texto, /Freidora de aire como tal no tengo/);
  assert.match(r.plan.texto, /Bandeja Molde/);
  assert.doesNotMatch(r.plan.texto, /Airpods|Afeitadora/);
});

test('necesidad con edad: el prompt pide el tipo de producto típico (niño de 5 años → juguete)', async () => {
  const { PROMPT_CATEGORIA } = await import('../piezas/busqueda.mjs');
  assert.match(PROMPT_CATEGORIA, /"niño de 5 años" → "juguete"/);
});

test('tras la ficha del más barato, el texto va por código con ese nombre y precio', async () => {
  const productos = [producto('ninos', 'Reloj Niños 3 en 1', 11, { category: 'Tecnología' }), producto('t900', 'T900 Smart Watch', 25, { category: 'Tecnología' })];
  const id2 = `call_${'e5'.repeat(16)}`;
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('cuál es el más barato?'), m.llamada('search_products', { query: 'reloj', precio: 0 }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR), m.llamada('send_product_card', { productSlug: 'ninos' }, id2), m.resultado({ ok: true, sent: true, productSlug: 'ninos' }, id2)] });
  const r = motorConTraza(c);
  assert.equal(r.plan.tipo, 'texto', r.porque.join(' | '));
  assert.equal(r.plan.texto, 'Lo más económico que tengo es *Reloj Niños 3 en 1* a $11,00. ¿Cuántas quieres?');
});


test('nombres repetidos: se queda el más barato, no el primero', async () => {
  const productos = [producto('t900-30', 'T900 Ultra 2 Smart Watch', 30, { category: 'Tecnología' }), producto('t900-25', 'T900 Ultra 2 Smart Watch', 25, { category: 'Tecnología' }), producto('t900-19', 'T900 Ultra 2 Smart Watch', 19, { category: 'Tecnología' }), producto('militar', 'Reloj militar', 65, { category: 'Tecnología' })];
  const c = contextoFalso({ borrador: sinCarrito, historial: [m.cliente('cuál es el más barato?'), m.llamada('search_products', { query: 'reloj inteligente', precio: 0 }, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] });
  assert.deepEqual((await motor(c)).llamadas, [{ nombre: 'send_product_card', argumentos: { productSlug: 't900-19' } }]);
});
