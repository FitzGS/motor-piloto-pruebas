// LA BÚSQUEDA: del «tienes audífonos?» a la ficha, decidido por el CÓDIGO.
//
// Medido en las simulaciones del 1-nov-2026: el turno en que el cliente nombra
// un producto es el más caro de la venta. El agente actual entra TRES veces
// (~13.500 tokens cada una): una para decidir que busca, otra para elegir y
// mandar la ficha, otra para escribir. Aquí:
//
//   A. Mensaje del cliente, sin carrito → `redactar` con un prompt de ~250
//      tokens que SOLO decide si hay que buscar y con qué palabras.
//   B. Con esa decisión → `herramientas: search_products`.
//   C. Con el resultado → uno disponible: `send_product_card`; varios: una
//      lista corta por código y «¿cuál te muestro?».
//   D. Tras la ficha → `actual`: escribe el agente de hoy, con las reglas de la
//      tienda (lo que edita Tina). Una sola entrada en vez de tres.
//
// Lo que no es claro cede al actual, que sigue con lo que ya haya en el
// historial: lo peor que pasa es ahorrar menos, nunca contestar peor.
//
//   turnoDeBusqueda(contexto) → { plan, porque } | null   (null = no es mío)

import { fichasDelUltimoTurno, resultadosRecientes, tieneHerramienta, textoDe, ultimoDe, ultimoDelCliente, ultimoDelVendedor, vecesDicho } from './contexto.mjs';
import { revisar } from './guardias.mjs';
import { formatearPrecio, normalizar } from './texto.mjs';

const actual = (porque) => ({ plan: { tipo: 'actual' }, porque });

// Las llamadas que arma la plataforma para un plan del motor llevan
// `call_` + un UUID sin guiones (piloto/cliente.ts). Las del modelo traen otro
// formato. Así se sabe si una búsqueda la pidió el motor o el agente actual: la
// del actual era para contestar algo suyo y no se toca.
export const ID_DEL_MOTOR = /^call_[0-9a-f]{32}$/;

// Mensajes que no son del catálogo aunque nombren algo: los resuelve el actual
// sin pagar la pregunta de si hay que buscar.
const SOLO_SALUDO = /^((hola|holaa+|buenas|buenos|buen|dia|dias|tardes|noches|hey|holi|saludos|gracias|muchas|mil|ok|okay|okey|chao|adios|bendiciones|que|tal|como|estas|esta|amigo|amiga|y|tu|usted)\s*)+$/;
const NO_ES_CATALOGO = /\b(envio|envios|enviar|flete|delivery|despach\w*|tarda|demora|llega|llegaria|pedido|orden|pago|pagar|pagos|transferencia|zelle|binance|efectivo|bolivares|garantia|devolu\w*|factura|horario|ubicad\w*|direccion|tienda fisica|asesor\w*|persona|humano|reclamo|queja|estafa|cancel\w*)\b/;

/** El prompt que decide si se busca. Corto a propósito: no escribe, decide. */
export const PROMPT_DECIDIR = `Decides UNA cosa: si para contestarle a este cliente de una tienda hay que buscar en el catálogo, y con qué palabras. No le contestas al cliente.

buscar=true si NOMBRA un producto (audífonos, reloj, faja…) y pregunta si lo hay, su precio, colores, tallas o fotos, o dice que lo quiere.
buscar=true y consulta=null si pregunta EN GENERAL qué venden o qué tienen, o pide ver el catálogo.
buscar=false si saluda, agradece, dicta sus datos, confirma o rechaza algo, contesta una cantidad, reclama, o pregunta por el envío, el pago o un pedido.
buscar=false si describe una NECESIDAD sin nombrar el producto ("algo para grabar videos", "un regalo para mi mamá"): eso lo resuelve otro.

consulta: las palabras del producto TAL COMO LAS DIJO, limpias y en singular ("audífono bluetooth", no "unos audífonos buenos"). Nunca pongas un producto que el cliente no nombró.
precio: si busca POR PRECIO ("algo de 20", "el más barato" = 0), ese número; si no, null.

Responde SOLO este JSON, sin nada más: {"buscar": true|false, "consulta": "..."|null, "precio": número|null}`;

/** Los productos que ya se enseñaron en todo el chat (no se repite la ficha). */
export function fichasEnviadas(mensajes) {
  const slugs = new Set();
  for (const m of mensajes || []) {
    if (m?.role !== 'assistant') continue;
    for (const tc of m.tool_calls || []) {
      if (tc?.function?.name !== 'send_product_card') continue;
      try {
        const s = JSON.parse(tc.function.arguments || '{}').productSlug;
        if (s) slugs.add(String(s));
      } catch {}
    }
  }
  return slugs;
}

/** ¿Las herramientas de la última vuelta las pidió el motor? */
function llamadaDelMotor(mensajes) {
  const lista = mensajes || [];
  let i = lista.length - 1;
  while (i >= 0 && lista[i]?.role === 'tool') i--;
  const llamada = lista[i];
  return llamada?.role === 'assistant' && (llamada.tool_calls || []).length > 0 && llamada.tool_calls.every((c) => ID_DEL_MOTOR.test(String(c?.id || '')));
}

/** La respuesta del prompt de decidir, puesta en limpio. Lo raro → null. */
export function leerDecision(crudo) {
  const m = /\{[\s\S]*\}/.exec(String(crudo || ''));
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  if (!o || typeof o.buscar !== 'boolean') return null;
  let consulta = typeof o.consulta === 'string' ? o.consulta.trim().slice(0, 80) : null;
  // «productos», «catálogo», «todo» no son nombres de nada: la búsqueda
  // volvería vacía. Sin consulta la tienda enseña sus categorías.
  if (consulta && /^(producto|productos|catalogo|todo|cosas|articulos|que venden|que tienen)$/.test(normalizar(consulta))) consulta = null;
  const precio = typeof o.precio === 'number' && Number.isFinite(o.precio) && o.precio >= 0 && o.precio < 1e6 ? o.precio : null;
  return { buscar: o.buscar, consulta: consulta || null, precio };
}

/** Los mensajes para `redactar`: el prompt corto y una línea de contexto. */
export function mensajesParaDecidir({ cliente, vendedor }) {
  const antes = vendedor?.trim() ? `Lo último que le dijimos: "${vendedor.trim().slice(0, 200)}"` : 'No le habíamos dicho nada todavía.';
  return [
    { role: 'system', content: PROMPT_DECIDIR },
    { role: 'user', content: `${antes}\n\nMensaje del cliente: "${String(cliente).slice(0, 400)}"` },
  ];
}

/** El precio que se nombra en la lista: el más bajo, con «desde» si varía. */
function precioDe(p) {
  const precios = (p.variants || []).map((v) => Number(v.price)).filter((n) => Number.isFinite(n) && n > 0);
  const bajo = Number.isFinite(Number(p.lowestPrice)) && Number(p.lowestPrice) > 0 ? Number(p.lowestPrice) : precios.length ? Math.min(...precios) : null;
  if (bajo === null) return null;
  const distintos = new Set(precios.map((n) => n.toFixed(2))).size;
  return { valor: bajo, texto: `${distintos > 1 ? 'desde ' : ''}${formatearPrecio(bajo)}` };
}

/**
 * Varias opciones → lista corta por código y UNA pregunta. El encabezado dice
 * de dónde sale la lista: a «qué venden» no se le contesta «tengo estas
 * opciones» como si la tienda tuviera solo tres cosas.
 */
export function listaDeOpciones(productos, { query = null, precio = null } = {}) {
  const lineas = productos.slice(0, 3).map((p) => {
    const pr = precioDe(p);
    return `• *${p.name}*${pr ? ` — ${pr.texto}` : ''}`;
  });
  const cabeza = query
    ? 'Tengo estas opciones:'
    : precio !== null
      ? precio === 0 ? 'Lo más económico que tengo:' : 'Cerca de ese precio tengo:'
      : 'Algunos de nuestros productos:';
  return `${cabeza}\n${lineas.join('\n')}\n\n¿Cuál te muestro?`;
}

/** Un turno de búsqueda, o null si el turno no es de este tramo. */
export function turnoDeBusqueda(contexto) {
  const borrador = contexto.borrador || {};
  const mensajes = contexto.mensajes || [];
  const herramientas = contexto.herramientas || [];
  // Con carrito el tramo es otro (cambiar de producto lo lleva el actual) y
  // tras un pedido no se reabre la venta por aquí.
  if ((borrador.items || []).length || borrador.lastPedidoLabel) return null;
  if (!tieneHerramienta(herramientas, 'search_products') || !tieneHerramienta(herramientas, 'send_product_card')) return null;
  const ultimo = ultimoDe(mensajes);

  // ── C/D. Vuelta tras herramientas que pidió el motor ───────────────────
  if (ultimo.tipo === 'herramienta') {
    if (!llamadaDelMotor(mensajes)) return null;
    const resultados = resultadosRecientes(mensajes);
    if (resultados.length !== 1 || resultados[0].nombre !== 'search_products') {
      // D: la ficha ya salió; escribe el actual con las reglas de la tienda.
      return actual(['tras la ficha: escribe el actual']);
    }
    const r = resultados[0].resultado || {};
    if (r.ok !== true || !Array.isArray(r.products)) return actual(['búsqueda sin resultado válido']);
    if (r.categorias) return actual(['catálogo grande: las categorías las nombra el actual']);
    if ((r.agotados || []).length) return actual(['agotado: lo explica el actual con su alternativa']);
    const disponibles = r.products.filter((p) => p && p.slug && p.available !== false);
    if (!disponibles.length) return actual(['nada disponible: lo dice el actual con su alternativa']);
    if (disponibles.length === 1) {
      const slug = String(disponibles[0].slug);
      if (fichasEnviadas(mensajes).has(slug)) return actual([`${slug} ya se enseñó: contesta el actual`]);
      return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'send_product_card', argumentos: { productSlug: slug } }] }, porque: [`uno disponible: ficha de ${slug}`] };
    }
    const elegidos = disponibles.slice(0, 3);
    const pedido = resultados[0].argumentos || {};
    const t = listaDeOpciones(elegidos, { query: pedido.query || null, precio: typeof pedido.precio === 'number' ? pedido.precio : null });
    const rev = revisar({
      texto: t,
      contexto: {
        preciosPermitidos: elegidos.map((p) => precioDe(p)?.valor).filter((n) => n !== undefined && n !== null).map((n) => Number(n.toFixed(2))),
        numerosPermitidos: [],
        correosPermitidos: [],
        vecesDicho: (x) => vecesDicho(mensajes, x),
      },
    });
    if (!rev.texto) return actual(['la lista no pasó las guardias', JSON.stringify(rev.traza)]);
    return { plan: { tipo: 'texto', texto: rev.texto }, porque: [`${disponibles.length} disponibles: lista de ${elegidos.length}`] };
  }

  if (ultimo.tipo !== 'cliente') return null;
  const cliente = ultimoDelCliente(mensajes);
  const n = normalizar(cliente).replace(/\n/g, ' ').trim();
  if (!n) return null;

  // ── B. Ya se preguntó si hay que buscar ────────────────────────────────
  if (contexto.resultadoModelo) {
    const d = leerDecision(contexto.resultadoModelo);
    if (!d) return actual(['la decisión de buscar no se pudo leer']);
    if (!d.buscar) return actual(['no hay que buscar']);
    const argumentos = {};
    if (d.consulta) argumentos.query = d.consulta;
    if (d.precio !== null) argumentos.precio = d.precio;
    return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos }] }, porque: [`buscar ${JSON.stringify(argumentos)}`] };
  }

  // ── A. ¿Vale la pena preguntar? ────────────────────────────────────────
  if (SOLO_SALUDO.test(n)) return actual(['solo saluda']);
  if (NO_ES_CATALOGO.test(n)) return actual(['no es del catálogo (envío, pago, pedido, asesor…)']);
  if (/@|\d{7,}/.test(n)) return actual(['trae datos']);
  // Acaba de ver una ficha: lo que diga es sobre ese producto (cantidad,
  // color, una duda) y lo contesta el actual, que lo tiene delante.
  if (fichasDelUltimoTurno(mensajes).length) return actual(['contesta sobre la ficha que acaba de ver']);
  return { plan: { tipo: 'redactar', mensajes: mensajesParaDecidir({ cliente, vendedor: ultimoDelVendedor(mensajes) }) }, porque: ['¿hay que buscar?'] };
}

export { textoDe };
