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
  assert.match(r.plan.texto, /¿Confirmas el pedido\?/);
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

test('búsqueda C: agotado, nada, o categorías → actual (escribe con la alternativa que trae el resultado)', async () => {
  for (const res of [{ ok: true, products: [], agotados: [{ slug: 'x', name: 'X' }] }, { ok: true, products: [], noEstaComoDecirlo: '...' }, { ok: true, products: [producto('a', 'A', 1)], categorias: ['Hogar', 'Audio', 'Belleza'] }, { ok: false }]) {
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
  const productos = [producto('a1', 'Uno', 7), producto('a2', 'Dos', 15), producto('a3', 'Tres', 29)];
  const lista = async (argumentos) => (await motor(contextoFalso({ borrador: sinCarrito, historial: [m.cliente('x'), m.llamada('search_products', argumentos, ID_MOTOR), m.resultado({ ok: true, products: productos }, ID_MOTOR)] }))).texto;
  assert.match(await lista({}), /^Algunos de nuestros productos:/);
  assert.match(await lista({ precio: 0 }), /^Lo más económico que tengo:/);
  assert.match(await lista({ precio: 20 }), /^Cerca de ese precio tengo:/);
  assert.match(await lista({ query: 'x' }), /^Tengo estas opciones:/);
});

test('búsqueda A: el prompt de decidir no deja inventar productos ni buscar necesidades', () => {
  assert.match(PROMPT_DECIDIR, /Nunca pongas un producto que el cliente no nombró/);
  assert.match(PROMPT_DECIDIR, /NECESIDAD sin nombrar el producto/);
  assert.match(PROMPT_DECIDIR, /EN GENERAL qué venden/);
});
