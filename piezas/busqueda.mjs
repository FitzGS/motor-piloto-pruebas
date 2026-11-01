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

import { fichasDelUltimoTurno, paisDelPrompt, resultadosRecientes, systemDe, tieneHerramienta, textoDe, ultimoDe, ultimoDelCliente, ultimoDelVendedor, vecesDicho } from './contexto.mjs';
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
buscar=true, consulta=null y necesidad=true si NO nombra un producto concreto y en cambio describe una NECESIDAD, un USO, una CATEGORÍA o PARA QUIÉN es: "algo para grabar videos", "necesito algo para la cocina", "es para mi mamá", "un regalo", "qué tienen para niños", "y de tecnología qué tienen?".
buscar=false si nombra DOS productos o más ("los audífonos y el aro de luz").

consulta: las palabras del producto TAL COMO LAS DIJO, limpias y en singular, conservando el tipo o para qué es si lo dijo ("audífono bluetooth", "masajeador espalda"; no "unos audífonos buenos"). Nunca pongas un producto que el cliente no nombró. Si pide "el más barato" DE algo que le acabamos de mencionar, consulta = el TIPO de producto en una o dos palabras ("reloj inteligente", "audífono"), nunca el nombre completo del modelo.
precio: si busca POR PRECIO ("algo de 20", "el más barato" = 0), ese número; si no, null.

Responde SOLO este JSON, sin nada más: {"buscar": true|false, "consulta": "..."|null, "precio": número|null, "necesidad": true|false}`;

/**
 * NECESIDAD → CATEGORÍA. «Algo para la cocina», «para niños de 5 años»: en un
 * catálogo grande la búsqueda sin texto devuelve las categorías de la tienda;
 * ~150 tokens eligen una y se lista lo que hay en ella. Sin esto el agente
 * elegía un producto cualquiera y mandaba su folleto (pasadas 10 a 13).
 */
export const PROMPT_CATEGORIA = `Un cliente de una tienda describió lo que necesita, sin nombrar un producto. Elige de la lista la categoría de la tienda donde buscarlo. Si ninguna encaja, null.

palabra: si la necesidad apunta a UN tipo de producto concreto ("algo para licuar" → "licuadora", "para grabar videos" → "micrófono"), ese nombre en singular, para buscarlo dentro de la categoría. Si dice la EDAD o para quién ("niño de 5 años" → "juguete", "bebé" → "tetero"), el tipo de producto típico para esa persona. Si es amplia ("algo para la cocina", "un regalo"), null.

Responde SOLO este JSON: {"categoria": "<nombre exacto de la lista>"|null, "palabra": "..."|null}`;

export function mensajesParaCategoria({ cliente, categorias }) {
  return [
    { role: 'system', content: PROMPT_CATEGORIA },
    { role: 'user', content: `El cliente escribió: "${String(cliente).slice(0, 300)}"\nCategorías: ${categorias.map((c) => `"${c}"`).join(', ')}` },
  ];
}

/** La categoría elegida (solo si es una de la lista, tal cual) y la palabra para buscar dentro. */
export function leerCategoria(crudo, categorias = []) {
  const m = /\{[\s\S]*\}/.exec(String(crudo || ''));
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const t = typeof o?.categoria === 'string' ? o.categoria.trim() : '';
  const categoria = categorias.find((c) => normalizar(c) === normalizar(t)) || null;
  if (!categoria) return null;
  const p = typeof o?.palabra === 'string' ? o.palabra.trim().slice(0, 40) : '';
  const palabra = p && !/[,;+]/.test(p) && p.split(/\s+/).length <= 2 ? p : null;
  return { categoria, palabra };
}

// «¿Qué venden?» a secas: se contesta con categorías o con lo destacado. Una
// necesidad («algo para la cocina») no es esto.
const PIDE_GENERAL = /^(hola |buenas |buenos dias |buenas tardes |buenas noches )*(que|cuales|cuáles) (productos |cosas |articulos )?(venden|tienen|hay|manejan|ofrecen)( ustedes| aqui| ahi)?\s*$|catalogo|muestrame (todo|lo que (tienen|venden))/;
// «¿Cuál es el más barato?» tras ver una ficha o una lista: lo decide el
// código con la búsqueda por precio, no la IA leyendo (pasada 12: dijo $25 con
// uno de $19 delante).
const PIDE_MAS_BARATO = /\b(mas|más) (barat\w*|economic\w*)\b|\bmenor precio\b|\bmas bajo\b/;

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

const PAISES = { ve: 'Venezuela', ec: 'Ecuador', co: 'Colombia', mx: 'México', pe: 'Perú', cl: 'Chile', ar: 'Argentina', gt: 'Guatemala', pa: 'Panamá', py: 'Paraguay', bo: 'Bolivia', cr: 'Costa Rica', do: 'República Dominicana', es: 'España', us: 'Estados Unidos' };

export function mensajesParaOtroNombre({ cliente, probadas, pais = null }) {
  // El país cambia la palabra: en Venezuela el parlante es «corneta»; sin
  // saberlo proponía «bocina» y salían unos lentes con bocinas (pasada 12).
  const donde = PAISES[pais] ? `La tienda está en ${PAISES[pais]}: usa la palabra de allí. ` : '';
  return [
    { role: 'system', content: PROMPT_OTRO_NOMBRE },
    { role: 'user', content: `${donde}El cliente escribió: "${String(cliente).slice(0, 300)}"\nYa se probó: ${probadas.map((p) => `"${p}"`).join(', ')}` },
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
  return { buscar: o.buscar, consulta: consulta || null, precio, necesidad: o.necesidad === true };
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
 * ¿El producto ES de ese tipo, o solo lo menciona? Un nombre de producto lleva
 * su tipo entre las primeras palabras («Reloj militar…», «Eigiis Reloj…»); si
 * lo pedido aparece recién al final («Bandeja molde de silicón protector
 * FREIDORA»), es un accesorio o algo relacionado, no el producto. Pasadas 10 a
 * 13: la bandeja se ofrecía como si fuera la freidora de aire.
 */
export function esDeEseTipo(nombre, consulta) {
  const palabras = normalizar(consulta).split(' ').filter((p) => p.length >= 3 && !VACIAS.has(p));
  if (!palabras.length) return false;
  const [cabeza, ...resto] = palabras;
  const todas = normalizar(nombre).split(' ').filter((p) => p.length >= 2 && !VACIAS.has(p));
  const primeras = todas.slice(0, 3);
  // Una palabra corta se compara entera: «air» (de «air fryer») no es «airpods»
  // (pasada 15: por eso la bandeja acabó vendida como freidora).
  const lleva = (lista, w) => lista.some((p) => (w.length <= 4 ? p === w : p.startsWith(raiz(w))));
  // La palabra principal («parlante» en «parlante bluetooth») va al frente del
  // nombre; o, si va al final («Bomba Carolina Herrera PERFUME»), otra de las
  // pedidas va al frente («Bomba»). Un adjetivo suelto («bluetooth») no basta.
  return lleva(primeras, cabeza) || (lleva(todas, cabeza) && resto.some((w) => lleva(primeras, w)));
}

/** Lo relacionado se ofrece como tal: ni «parecido» ni «lo más cercano». */
export function textoRelacionados(consulta, productos) {
  const lineas = productos.slice(0, 3).map((p) => {
    const pr = precioDe(p);
    return `• *${p.name}*${pr ? ` — ${pr.texto}` : ''}`;
  });
  return `${capitalizarInicio(consulta)} como tal no tengo por ahora. Relacionado con eso tengo:\n${lineas.join('\n')}\n\n¿Te muestro alguno?`;
}

function capitalizarInicio(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
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
export function listaDeOpciones(productos, { query = null, precio = null, categoria = null } = {}) {
  const lineas = productos.slice(0, 3).map((p) => {
    const pr = precioDe(p);
    return `• *${p.name}*${pr ? ` — ${pr.texto}` : ''}`;
  });
  const cabeza = categoria
    ? 'Para eso tengo:'
    : query
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
      // Salvo tras la ficha del MÁS BARATO: el actual escribía otro precio
      // («el más barato es el T900 de $25» con la ficha del de $11 delante,
      // g16). Ahí el texto va por código, con el nombre y el precio de la ficha.
      const ficha = resultados.find((x) => x.nombre === 'send_product_card');
      const ultimaBusqueda = busquedasDelTurno(mensajes).slice(-1)[0];
      if (ficha && ultimaBusqueda?.precio === 0 && ficha.resultado?.ok) {
        const slug = String(ficha.argumentos?.productSlug || '');
        const p = (ultimaBusqueda.resultado?.products || []).find((x) => x && String(x.slug) === slug);
        const pr = p ? precioDe(p) : null;
        if (p && pr) {
          const t = `Lo más económico que tengo es *${p.name}* a ${pr.texto}. ¿Cuántas quieres?`;
          const rev = revisar({ texto: t, contexto: { preciosPermitidos: [Number(pr.valor.toFixed(2))], numerosPermitidos: [], correosPermitidos: [], vecesDicho: (x) => vecesDicho(mensajes, x) } });
          if (rev.texto) return { plan: { tipo: 'texto', texto: rev.texto }, porque: ['tras la ficha del más barato: texto por código'] };
        }
      }
      return actual(['tras la ficha: escribe el actual']);
    }
    const r = resultados[0].resultado || {};
    if (r.ok !== true || !Array.isArray(r.products)) return actual(['búsqueda sin resultado válido']);
    const busquedas = busquedasDelTurno(mensajes);
    const conOtroNombre = busquedas.length > 1;
    const pedido = resultados[0].argumentos || {};
    const textoCliente = ultimoDelCliente(mensajes);
    const nCliente = normalizar(textoCliente).replace(/\n/g, ' ').trim();
    const esNecesidad = !pedido.query && typeof pedido.precio !== 'number' && !pedido.category && !PIDE_GENERAL.test(nCliente);

    // ── Necesidad → categoría ─────────────────────────────────────────────
    if (r.categorias) {
      if (!esNecesidad) return actual(['catálogo grande: las categorías las nombra el actual']);
      const categorias = r.categorias.filter((c) => typeof c === 'string' && c.trim());
      if (contexto.resultadoModelo) {
        const elegida = leerCategoria(contexto.resultadoModelo, categorias);
        if (!elegida) return actual(['ninguna categoría encaja: lo lleva el actual']);
        // Con palabra («algo para licuar» → licuadora) se busca ESO dentro de
        // la categoría; sin ella, lo que haya. Sin la palabra, «algo para
        // licuar» tras «algo para la cocina» repetía la misma lista y la
        // plataforma, que no repite lo que acaba de decir, se callaba (g14).
        const argumentos = elegida.palabra ? { category: elegida.categoria, query: elegida.palabra } : { category: elegida.categoria };
        return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos }] }, porque: [`necesidad → categoría ${elegida.categoria}${elegida.palabra ? ` · ${elegida.palabra}` : ''}`] };
      }
      return { plan: { tipo: 'redactar', mensajes: mensajesParaCategoria({ cliente: textoCliente, categorias }) }, porque: ['necesidad: ¿qué categoría?'] };
    }
    if (esNecesidad) return actual(['necesidad en catálogo chico: lo lleva el actual']);

    // Nada disponible que SEA lo pedido (vacío, solo agotados, o cosas que
    // solo lo mencionan: la bandeja PARA freidora no es una freidora): antes
    // de rendirse, otro nombre.
    const consultaActual = pedido.query || null;
    const vendibles = (r.products || []).filter((p) => p && p.slug && p.available !== false);
    const nadaConEseNombre = consultaActual ? !vendibles.some((p) => esDeEseTipo(p.name, consultaActual)) : !vendibles.length;
    // Dentro de una categoría no se prueban otros nombres: si la palabra no
    // dio nada, se enseña lo que hay en la categoría.
    if (pedido.category && pedido.query && !vendibles.length) {
      if (busquedas.some((b) => b.resultado && !b.query && b.resultado.products && !b.resultado.categorias)) return actual(['la categoría tampoco tiene: lo lleva el actual']);
      return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { category: pedido.category } }] }, porque: [`sin «${pedido.query}» en ${pedido.category}: lo que haya`] };
    }
    if (nadaConEseNombre && typeof pedido.precio !== 'number' && !pedido.category) {
      const probadas = busquedas.map((b) => b.query).filter(Boolean);
      if (!busquedas[0]?.query) return actual(['búsqueda general sin nada: lo dice el actual']);
      // Lo relacionado que apareció en el turno (contiene la palabra pero no es
      // el producto), para ofrecerlo como tal cuando no queden nombres.
      const relacionados = [];
      const vistos = new Set();
      for (const b of busquedas) {
        for (const p of (b.resultado?.products || [])) {
          if (!p || !p.slug || p.available === false || vistos.has(p.slug)) continue;
          if (busquedas[0].query && seLlamaParecido(p.name, busquedas[0].query) && !esDeEseTipo(p.name, busquedas[0].query)) { vistos.add(p.slug); relacionados.push(p); }
        }
      }
      const rendirse = (porque) => {
        if (!relacionados.length) return actual([...porque, 'lo dice el actual']);
        const t = textoRelacionados(busquedas[0].query, relacionados);
        const rev = revisar({ texto: t, contexto: { preciosPermitidos: relacionados.map((p) => precioDe(p)?.valor).filter((n) => n !== undefined && n !== null).map((n) => Number(n.toFixed(2))), numerosPermitidos: [], correosPermitidos: [], vecesDicho: (x) => vecesDicho(mensajes, x) } });
        if (!rev.texto) return actual([...porque, 'relacionados no pasaron las guardias']);
        return { plan: { tipo: 'texto', texto: rev.texto }, porque: [...porque, `relacionados: ${relacionados.length}`] };
      };
      if (busquedas.length - 1 >= MAX_OTROS_NOMBRES) return rendirse([`ni con otros nombres (${probadas.join(' / ')})`]);
      if (contexto.resultadoModelo) {
        const termino = leerOtroNombre(contexto.resultadoModelo, probadas);
        if (!termino) return rendirse([`sin otro nombre para ${probadas.join(' / ')}`]);
        return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos: { query: termino } }] }, porque: [`otro nombre: ${termino}`] };
      }
      return { plan: { tipo: 'redactar', mensajes: mensajesParaOtroNombre({ cliente: textoCliente, probadas, pais: paisDelPrompt(systemDe(mensajes)) }) }, porque: [`nada disponible con ${probadas.join(' / ')}: ¿otro nombre?`] };
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
    // «El más barato»: lo decide el código. La plataforma ya los manda del más
    // barato al más caro; se toma el de menor precio y va su ficha.
    if (pedido.precio === 0) {
      // Solo entre los que SON lo pedido: «los audífonos más baratos» no es el
      // bambú chino de $5 que la búsqueda trajo por la descripción (g14).
      // …o de la MISMA categoría que esos: el «T900 Smart Watch» es un reloj
      // aunque no se llame así, y comparte categoría con el «Reloj militar».
      const porNombreTipo = pedido.query ? disponibles.filter((p) => esDeEseTipo(p.name, pedido.query)) : disponibles;
      const categoriasDelTipo = new Set(porNombreTipo.map((p) => normalizar(p.category || '')).filter(Boolean));
      const delTipo = pedido.query ? disponibles.filter((p) => esDeEseTipo(p.name, pedido.query) || (p.category && categoriasDelTipo.has(normalizar(p.category)))) : disponibles;
      if (pedido.query && !delTipo.length) return actual([`por precio sin nada que sea «${pedido.query}»: lo lleva el actual`]);
      const conPrecio = delTipo.filter((p) => precioDe(p));
      if (!conPrecio.length) return actual(['por precio sin precios: lo lleva el actual']);
      const barato = conPrecio.reduce((a, b) => (precioDe(b).valor < precioDe(a).valor ? b : a));
      if (fichasEnviadas(mensajes).has(String(barato.slug))) return actual([`el más barato (${barato.slug}) ya se enseñó: contesta el actual`]);
      return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'send_product_card', argumentos: { productSlug: String(barato.slug) } }] }, porque: [`el más barato: ficha de ${barato.slug}`] };
    }
    // Por categoría (necesidad): lo que hay en ella, en lista; con palabra,
    // primero lo que se llama así.
    if (pedido.category) {
      const deEseTipo = pedido.query ? disponibles.filter((p) => esDeEseTipo(p.name, pedido.query)) : [];
      const elegidos = (deEseTipo.length ? deEseTipo : disponibles).slice(0, 3);
      if (elegidos.length === 1) return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'send_product_card', argumentos: { productSlug: String(elegidos[0].slug) } }] }, porque: [`categoría ${pedido.category}: uno, ficha`] };
      const t = listaDeOpciones(elegidos, { categoria: pedido.category });
      // La misma lista que acaba de decir no se repite: la plataforma la
      // callaría. Que conteste el actual con lo que ya tiene delante.
      if (vecesDicho(mensajes, t) >= 1) return actual(['la lista por categoría ya se dijo: contesta el actual']);
      const rev = revisar({ texto: t, contexto: { preciosPermitidos: elegidos.map((p) => precioDe(p)?.valor).filter((n) => n !== undefined && n !== null).map((n) => Number(n.toFixed(2))), numerosPermitidos: [], correosPermitidos: [], vecesDicho: (x) => vecesDicho(mensajes, x) } });
      if (!rev.texto) return actual(['la lista por categoría no pasó las guardias']);
      return { plan: { tipo: 'texto', texto: rev.texto }, porque: [`categoría ${pedido.category}: lista de ${elegidos.length}`] };
    }
    // «quiero los audífonos»: si UNO solo se llama así, es ese. La búsqueda
    // también trae parecidos por descripción, y listarlos hacía elegir de
    // nuevo a quien ya había elegido (ronda 16, 1-nov-2026).
    const porNombre = pedido.query ? disponibles.filter((p) => seLlamaAsi(p.name, pedido.query)) : [];
    // Pero «¿QUÉ audífonos tienen?» pide ver las opciones, no que se elija por
    // él (tienda grande, pasada 11): si explora, va la lista — primero los que
    // se llaman así y luego lo que la búsqueda puso delante (los relojes se
    // llaman «Smart Watch», pasada 12).
    const parecidos = pedido.query ? disponibles.filter((p) => seLlamaParecido(p.name, pedido.query)) : disponibles;
    const explora = !conOtroNombre && exploraOpciones(textoCliente);
    let candidatos;
    if (explora && disponibles.length >= 2) candidatos = parecidos.length >= 2 ? [...new Set([...porNombre, ...parecidos])] : [...new Set([...parecidos, ...disponibles])];
    else if (porNombre.length) candidatos = porNombre;
    else if (!pedido.query) candidatos = disponibles;
    // Nada se llama EXACTAMENTE como lo pidió: elegir por media palabra
    // mandaba el masajeador de cuero cabelludo a quien pidió uno «para la
    // espalda» (pasada 12). Elige el actual, que lee las descripciones.
    else return actual(['ninguno se llama del todo así: elige el actual leyendo las descripciones']);
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
    // Una necesidad se busca sin texto: la tienda devuelve sus categorías (si
    // es grande) y se elige una. Con precio, por precio.
    if (d.necesidad) {
      if (d.precio !== null) argumentos.precio = d.precio;
      return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos }] }, porque: [`necesidad: buscar ${JSON.stringify(argumentos)}`] };
    }
    if (d.consulta) argumentos.query = d.consulta;
    if (d.precio !== null) argumentos.precio = d.precio;
    // «El más barato»: se busca por el TIPO (la palabra principal), no por el
    // modelo entero («reloj militar inteligente con linterna» solo traía ese).
    // Y «los más baratos» justo después de una ficha, sin nombrar nada, son
    // los más baratos DE ESO: el tipo sale del slug de la ficha (g14).
    if (d.precio === 0) {
      // El tipo: la primera palabra, o las dos si solo son dos («reloj
      // inteligente» sigue siendo inteligente; «reloj militar inteligente con
      // linterna» se queda en «reloj»).
      const tipoDe = (q) => {
        const ws = normalizar(q).split(' ').filter((w) => w.length >= 3 && !VACIAS.has(w));
        return ws.length === 2 ? ws.join(' ') : ws[0] || null;
      };
      const deLaFicha = fichasDelUltimoTurno(mensajes)[0];
      // Del slug de la ficha solo la primera palabra: «audifonos-a31» → audifonos.
      const tipo = d.consulta ? tipoDe(d.consulta) : deLaFicha ? tipoDe(String(deLaFicha).split('-')[0] || '') : null;
      if (tipo) argumentos.query = tipo; else delete argumentos.query;
    }
    return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'search_products', argumentos }] }, porque: [`buscar ${JSON.stringify(argumentos)}`] };
  }

  // ── A. ¿Vale la pena preguntar? ────────────────────────────────────────
  if (SOLO_SALUDO.test(n)) return actual(['solo saluda']);
  if (NO_ES_CATALOGO.test(n)) return actual(['no es del catálogo (envío, pago, pedido, asesor…)']);
  if (/@|\d{7,}/.test(n)) return actual(['trae datos']);
  // Acaba de ver una ficha: lo que diga es sobre ese producto (cantidad,
  // color, una duda) y lo contesta el actual, que lo tiene delante. Salvo
  // «¿cuál es el más barato?», que es una búsqueda por precio y la decide el
  // código.
  if (fichasDelUltimoTurno(mensajes).length && !PIDE_MAS_BARATO.test(n)) return actual(['contesta sobre la ficha que acaba de ver']);
  return { plan: { tipo: 'redactar', mensajes: mensajesParaDecidir({ cliente, vendedor: ultimoDelVendedor(mensajes) }) }, porque: ['¿hay que buscar?'] };
}

export { textoDe };
