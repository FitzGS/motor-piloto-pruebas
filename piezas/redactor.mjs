// El REDACTOR: del plan al texto que ve el cliente, TODO por código. En esta
// versión el modelo no escribe ni una línea en el tramo de datos y
// confirmación: cada texto sale de aquí y pasa por las guardias.

import { formatearPrecio, primerNombre } from './texto.mjs';

const EMOJI = { nombre: '👤', telefono: '📱', cedula: '🪪', email: '📧', direccion: '📍', ciudad: '🏙️', referencia: '🏠' };

// Cómo se pregunta UN dato suelto. Lo que se copia manda: cada pregunta trae
// el ejemplo del país para que el cliente conteste con la forma que sirve.
const PREGUNTA = {
  nombre: () => '¿A nombre de quién va el pedido? (nombre y apellido)',
  telefono: (c) => `¿Cuál es tu teléfono de contacto?${c.ejemplo ? ` (ej: ${c.ejemplo})` : ''}`,
  cedula: (c) => `¿Cuál es tu número de cédula?${c.ejemplo ? ` (ej: ${c.ejemplo})` : ''}`,
  email: () => '¿Me pasas tu correo electrónico? Si no usas, dime y seguimos.',
  direccion: (c) => `¿Cuál es tu dirección exacta?${c.ejemplo ? ` (ej: ${c.ejemplo})` : ''}`,
  ciudad: () => '¿En qué ciudad recibes el pedido?',
  referencia: () => '¿Algún punto de referencia para ubicar tu casa? (un local, un parque…)',
};

/** La línea de la lista para un dato, con el ejemplo del país. */
function lineaDe(clave, pais, oficina) {
  const c = pais.campos[clave] || { etiqueta: clave, ejemplo: null };
  let linea = `${EMOJI[clave] || '•'} ${c.etiqueta}${c.ejemplo ? ` (ej: ${c.ejemplo})` : ''}`;
  if (clave === 'direccion' && oficina) linea += ` — o dime si prefieres retirar en una oficina de ${oficina} y te paso las de tu ciudad`;
  return linea;
}

/**
 * Pedir los datos que faltan. Varios → una lista en UN mensaje (nunca de a uno:
 * cada pregunta suelta es una oportunidad de que el cliente se vaya). Uno →
 * la pregunta de ese dato.
 */
export function pedirDatos({ faltan, pais, nombre = null, oficina = null, primeraVez = true }) {
  if (!faltan.length) return '';
  if (faltan.length === 1) {
    const clave = faltan[0];
    const c = pais.campos[clave] || { etiqueta: clave, ejemplo: null };
    const pregunta = (PREGUNTA[clave] || (() => `¿Me pasas tu ${c.etiqueta.toLowerCase()}?`))(c);
    return primeraVez ? `¡Listo${nombre ? `, ${primerNombre(nombre)}` : ''}! Solo me falta un dato para despacharlo 🙂\n${pregunta}` : `Solo me falta un dato: ${pregunta}`;
  }
  const lineas = faltan.map((k) => lineaDe(k, pais, oficina));
  const cabeza = primeraVez
    ? `¡Perfecto${nombre ? `, ${primerNombre(nombre)}` : ''}! Para despacharlo necesito:`
    : 'Me falta esto para despacharlo:';
  return `${cabeza}\n${lineas.join('\n')}\n\nMándamelos en un solo mensaje 🙂`;
}

/** Las líneas del carrito, con el precio tal como lo guarda la plataforma. */
export function lineasDelCarrito(borrador) {
  return (borrador.items || []).map((it) => {
    const total = it.lineTotal ?? it.unitPrice * it.quantity;
    const variante = it.variantLabel && it.variantLabel !== 'Único' ? ` (${it.variantLabel})` : '';
    const oferta = it.offerLabel ? ` · ${it.offerLabel}` : '';
    return `• ${it.quantity}× ${it.productName}${variante} — ${formatearPrecio(total)}${oferta}`;
  });
}

export function totalDe(borrador) {
  const items = (borrador.items || []).reduce((a, i) => a + (i.lineTotal ?? i.unitPrice * i.quantity), 0);
  return Number((items + (borrador.shippingCost || 0)).toFixed(2));
}

/** Todos los montos que el texto puede nombrar: líneas, unitarios, envío y total. */
export function preciosPermitidos(borrador) {
  const p = [];
  for (const it of borrador.items || []) {
    p.push(it.lineTotal ?? it.unitPrice * it.quantity, it.unitPrice);
    if (it.listPrice) p.push(it.listPrice);
  }
  if (borrador.shippingCost) p.push(borrador.shippingCost);
  p.push(totalDe(borrador));
  return p.map((n) => Number(Number(n).toFixed(2)));
}

/**
 * El cierre tras crear el pedido en una tienda que cobra al recibir. Es el
 * texto que el prompt de la plataforma da como modelo: no hay nada que
 * preguntar (el pago ya está definido), solo confirmar número y monto.
 */
export function cierreContraentrega({ pedidoLabel, total }) {
  return `Pedido confirmado ${pedidoLabel} · Pagas ${formatearPrecio(total)} en efectivo cuando lo recibas 🚚`;
}

/** La previsualización: carrito + datos + UNA pregunta. */
export function preview({ borrador, pais }) {
  const lineas = ['Te resumo el pedido 📝', '', ...lineasDelCarrito(borrador)];
  if (borrador.shippingCost > 0) lineas.push(`Envío: ${formatearPrecio(borrador.shippingCost)}`);
  lineas.push(`*Total: ${formatearPrecio(totalDe(borrador))}*`, '');
  const d = borrador;
  if (d.customerName) lineas.push(`Nombre: ${d.customerName}`);
  if (d.customerPhone) lineas.push(`Teléfono: ${d.customerPhone}`);
  if (d.customerIdentification) lineas.push(`Cédula: ${d.customerIdentification}`);
  if (d.customerEmail) lineas.push(`Correo: ${d.customerEmail}`);
  if (d.oficinaRetiro?.nombre) lineas.push(`Retiro en: ${d.oficinaRetiro.nombre}${d.oficinaRetiro.ciudad ? `, ${d.oficinaRetiro.ciudad}` : ''}`);
  else if (d.customerAddress) lineas.push(`Dirección: ${d.customerAddress}`);
  if (d.customerCity) lineas.push(`Ciudad: ${d.customerCity}${d.customerState ? `, ${d.customerState}` : ''}`);
  if (d.customerReference) lineas.push(`Referencia: ${d.customerReference}`);
  lineas.push('', '¿Confirmas el pedido? Responde *sí* y lo registro.');
  return lineas.join('\n');
}

/** El marcador que deja la previsualización, para saber que se mostró. */
export const PREGUNTA_CONFIRMAR = /¿confirmas el pedido\?/i;

export function cambioTrasNo() {
  return 'Sin problema 🙂 ¿Qué quieres cambiar: el producto, la cantidad o algún dato de entrega?';
}
