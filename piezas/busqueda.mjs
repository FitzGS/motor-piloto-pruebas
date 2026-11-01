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
buscar=true y consulta=null si pregunta EN GENERAL qué venden o qué tienen, sin más, o pide ver el catálogo.
buscar=false si saluda, agradece, dicta sus datos, confirma o rechaza algo, contesta una cantidad, reclama, o pregunta por el envío, el pago o un pedido.
buscar=false si NO nombra un producto concreto y en cambio describe una NECESIDAD, un USO, una CATEGORÍA o PARA QUIÉN es: "algo para grabar videos", "necesito algo para la cocina", "es para mi mamá", "un regalo", "qué tienen para niños", "y de tecnología qué tienen?". Eso lo resuelve otro.
Excepción: si además da un precio ("algo de unos 20 dólares"), buscar=true con ese precio y consulta=null.
buscar=false si nombra DOS productos o más ("los audífonos y el aro de luz").

consulta: las palabras del producto TAL COMO LAS DIJO, limpias y en singular ("audífono bluetooth", no "unos audífonos buenos"). Nunca pongas un producto que el cliente no nombró.
precio: si busca POR PRECIO ("algo de 20", "el más barato" = 0), ese número; si no, null.

Responde SOLO este JSON, sin nada más: {"buscar": true|false, "consulta": "..."|null, "precio": número|null}`;

/**
 * OTRO NOMBRE PARA LO MISMO. Cuando la búsqueda no trae nada disponible, el
 * agente decía «no lo tenemos» teniendo el producto con otra palabra
 * («parlante» → las cornetas) u ofrecía cualquier cosa (cámara wifi agotada →
 * luces LED). Antes de rendirse, el motor pide UN nombre alternativo y lo
 * busca; hasta dos veces.
 */
export const PROMPT_OTRO_NOMBRE = `Un cliente de una tienda pidió un producto y la búsqueda en el catálogo no encontró nada disponible con las palabras que se probaron. Propón UNA forma distinta de llamar a ese MISMO tipo de producto, como suele aparecer en el nombre de un producto de tienda online en Latinoamérica.

Ejemplos: parlante → corneta; bocina → corneta; audífonos → auriculares; cámara wifi → cámara ip; franela → camiseta; tenis → zapatos deportivos.

Reglas:
- Un sustantivo y como mucho una palabra más. Sin marcas.
- El MISMO tipo de producto, nunca otro distinto ("cámara de seguridad" no es "lámpara").
- No repitas ninguna de las palabras ya probadas.
- Si no hay otra forma razonable de llamarlo, null.

Responde SOLO este JSON: {"termino": "..."|null}`;

export const MAX_OTROS_NOMBRES = 2;

/**
 * Las búsquedas que el motor hizo en ESTE turno (desde el último mensaje del
 * cliente), con lo que trajeron: [{ query, precio, resultado }].
 */
export function busquedasDelTurno(mensajes) {
  const lista = mensajes || [];
  let i = lista.length - 1;
  while (i >= 0 && lista[i]?.role !== 'user') i--;
  const resultados = new Map();
  for (const m of lista.slice(i + 1)) {
    if (m?.role !== 'tool') continue;
    try { resultados.set(m.tool_call_id, JSON.parse(textoDe(m))); } catch { resultados.set(m.tool_call_id, null); }
  }
  const busquedas = [];
  for (const m of lista.slice(i + 1)) {
    if (m?.role !== 'assistant') continue;
    for (const tc of m.tool_calls || []) {
      if (tc?.function?.name !== 'search_products' || !ID_DEL_MOTOR.test(String(tc.id || ''))) continue;
      let a = {};
      try { a = JSON.parse(tc.function.arguments || '{}'); } catch {}
      busquedas.push({ query: a.query || null, precio: typeof a.precio === 'number' ? a.precio : null, resultado: resultados.get(tc.id) || null });
    }
  }
  return busquedas;
}

/** ¿El resultado de una búsqueda trae algo que se pueda vender ya? */
function hayDisponibles(r) {
  return Array.isArray(r?.products) && r.products.some((p) => p && p.slug && p.available !== false);
}

export function mensajesParaOtroNombre({ cliente, probadas }) {
  return [
    { role: 'system', content: PROMPT_OTRO_NOMBRE },
    { role: 'user', content: `El cliente escribió: "${String(cliente).slice(0, 300)}"\nYa se probó: ${probadas.map((p) => `"${p}"`).join(', ')}` },
  ];
}

/** La respuesta del prompt de otro nombre. Lo raro, vacío o repetido → null. */
export function leerOtroNombre(crudo, probadas = []) {
  const m = /\{[\s\S]*\}/.exec(String(crudo || ''));
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const t = typeof o?.termino === 'string' ? o.termino.trim().slice(0, 60) : '';
  if (!t || /[,;+]/.test(t) || t.split(/\s+/).length > 3) return null;
  if (probadas.some((p) => normalizar(p) === normalizar(t))) return null;
  return t;
}

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

// La raíz de una palabra, como la búsqueda de la plataforma: «audífonos» y
// «audífono» casan con «Audifonos A31».
function raiz(palabra) {
  if (palabra.length >= 6) return palabra.slice(0, palabra.length - 2);
  if (palabra.length === 5) return palabra.slice(0, 4);
  return palabra;
}
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'con', 'para', 'por', 'en', 'y']);

/** ¿El nombre del producto lleva todas las palabras de lo que pidió? */
export function seLlamaAsi(nombre, consulta) {
  const n = ` ${normalizar(nombre)} `;
  const palabras = normalizar(consulta).split(' ').filter((p) => p.length >= 3 && !VACIAS.has(p));
  return palabras.length > 0 && palabras.every((p) => n.includes(` ${raiz(p)}`));
}

/**
 * ¿El nombre lleva al menos el sustantivo de lo pedido («parlante» de
 * «parlante bluetooth»)? Más laxo que `seLlamaAsi`: decide si lo encontrado
 * es de lo que pidió o solo lo menciona en la descripción («Lámpara LED…
 * bluetooth» para «parlante bluetooth», tienda grande, pasada 10).
 */
export function seLlamaParecido(nombre, consulta) {
  const nucleo = normalizar(consulta).split(' ').find((p) => p.length >= 3 && !VACIAS.has(p));
  return !!nucleo && ` ${normalizar(nombre)} `.includes(` ${raiz(nucleo)}`);
}

/**
 * ¿El cliente está mirando opciones («¿qué audífonos tienen?», «tienes
 * relojes?») o ya pide uno («quiero los audífonos», «tienes el micrófono?»)?
 */
export function exploraOpciones(texto) {
  const n = normalizar(texto);
  if (/\b(quiero|dame|me llevo|me lo llevo|me la llevo|mandame|enviame|lo quiero|la quiero)\b/.test(n)) return false;
  if (/\b(que|cuales)\b.{0,40}\b(tienen|tienes|tiene|hay|venden|vendes|manejan|manejas|ofrecen)\b/.test(n)) return true;
  if (/\b(opciones|modelos|variedad)\b/.test(n)) return true;
  const m = /\b(tienen|tienes|hay|venden|vendes|manejan|manejas)\s+(\w+)/.exec(n);
  return !!m && !['el', 'la', 'ese', 'esa', 'este', 'esta', 'un', 'una'].includes(m[2]);
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
    const busquedas = busquedasDelTurno(mensajes);
    const conOtroNombre = busquedas.length > 1;

    // Nada disponible que se llame como lo pedido (vacío, solo agotados, o
    // cosas que solo lo mencionan en la descripción): antes de rendirse, otro
    // nombre.
    const consultaActual = resultados[0].argumentos?.query || null;
    const nadaConEseNombre = consultaActual
      ? !(r.products || []).some((p) => p && p.slug && p.available !== false && seLlamaParecido(p.name, consultaActual))
      : !hayDisponibles(r);
    if (nadaConEseNombre && (consultaActual || !hayDisponibles(r))) {
      const probadas = busquedas.map((b) => b.query).filter(Boolean);
      if (!busquedas[0]?.query) return actual(['búsqueda general o por precio sin nada: lo dice el actual']);
      if (busquedas.length - 1 >= MAX_OTROS_NOMBRES) return actual([`ni con otros nombres (${probadas.join(' / ')}): lo dice el actual`]);
      if (contexto.resultadoModelo) {
        const termino = leerOtroNombre(contexto.resultadoModelo, probadas);
        if (!termino) return actual([`sin otro nombre para ${probadas.join(' / ')}`]);
        return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { query: termino } }] }, porque: [`otro nombre: ${termino}`] };
      }
      return { plan: { tipo: 'redactar', mensajes: mensajesParaOtroNombre({ cliente: ultimoDelCliente(mensajes), probadas }) }, porque: [`nada disponible con ${probadas.join(' / ')}: ¿otro nombre?`] };
    }
    if ((r.agotados || []).length) return actual(['agotado, con parecidos disponibles: lo explica el actual']);
    // El mismo nombre dos veces es el mismo producto para el cliente (catálogos
    // importados con duplicados): una lista con tres «Bomba Carolina Herrera»
    // no deja elegir nada (tienda grande, pasada 8). Se queda el primero.
    const nombres = new Set();
    const disponibles = r.products.filter((p) => {
      if (!p || !p.slug || p.available === false) return false;
      const clave = normalizar(p.name);
      if (nombres.has(clave)) return false;
      nombres.add(clave);
      return true;
    });
    if (!disponibles.length) return actual(['nada disponible: lo dice el actual con su alternativa']);
    const pedido = resultados[0].argumentos || {};
    // «quiero los audífonos»: si UNO solo se llama así, es ese. La búsqueda
    // también trae parecidos por descripción, y listarlos hacía elegir de
    // nuevo a quien ya había elegido (ronda 16, 1-nov-2026).
    const porNombre = pedido.query ? disponibles.filter((p) => seLlamaAsi(p.name, pedido.query)) : [];
    // Pero «¿QUÉ audífonos tienen?» pide ver las opciones, no que se elija por
    // él (tienda grande, pasada 11): si explora y hay varios que se llaman así,
    // va la lista de esos.
    const parecidos = pedido.query ? disponibles.filter((p) => seLlamaParecido(p.name, pedido.query)) : disponibles;
    const explora = !conOtroNombre && exploraOpciones(ultimoDelCliente(mensajes));
    const candidatos = explora && parecidos.length >= 2 ? parecidos : porNombre.length ? porNombre : parecidos.length ? parecidos : disponibles;
    // Encontrado con otro nombre: la ficha solo si UNO se llama así; lo demás
    // lo escribe el actual, que tiene delante lo que no había (o lo agotado)
    // y lo que sí, y sabe decir «eso no, pero tengo esto».
    if (conOtroNombre && !(porNombre.length === 1)) return actual(['encontrado con otro nombre: lo presenta el actual']);
    if (candidatos.length === 1) {
      const slug = String(candidatos[0].slug);
      if (fichasEnviadas(mensajes).has(slug)) return actual([`${slug} ya se enseñó: contesta el actual`]);
      return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'send_product_card', argumentos: { productSlug: slug } }] }, porque: [`uno ${porNombre.length ? 'con ese nombre' : 'disponible'}: ficha de ${slug}`] };
    }
    const elegidos = candidatos.slice(0, 3);
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
    // Dos productos en un mensaje («los audífonos y el aro»): una búsqueda no
    // sirve para los dos; lo lleva el actual (ronda 16).
    if (d.consulta && /[,+;]|\s(y|e|o)\s/i.test(` ${d.consulta} `)) return actual(['nombra más de un producto']);
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
