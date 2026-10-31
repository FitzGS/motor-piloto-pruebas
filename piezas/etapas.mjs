// LAS ETAPAS: la máquina de estados del tramo carrito → datos → confirmación.
//
// El estado NO vive aquí: vive en `contexto.borrador` (lo guarda la
// plataforma) y en lo que ya se dijo en el chat. Cada vuelta se reconstruye:
//   · qué etapa dice el borrador (cart / awaiting_info / awaiting_confirmation)
//   · qué datos faltan (los que la tienda pide, leídos del prompt)
//   · qué quedó preguntado (se deduce del último mensaje del vendedor)
//
// Candados (de Venelectronics, se copian tal cual):
//   1. confirm_order SOLO si la previsualización se mostró en un mensaje
//      ANTERIOR y el cliente acaba de decir que sí.
//   2. Un dato se guarda solo si vino firme (etiqueta, forma inconfundible o
//      respuesta a la pregunta de ese dato). Nada se adivina.
//   3. Lo que no es inequívoco → { tipo: 'actual' }: responde el agente de hoy.
//   4. Misma respuesta 3 veces → actual.

import { camposDelPrompt, cobraAlRecibir, paisDelPrompt, resultadosRecientes, systemDe, tieneHerramienta, ultimoDe, ultimoDelCliente, ultimoDelVendedor, vecesDicho, textoDe } from './contexto.mjs';
import { interpretar } from './interprete.mjs';
import { revisar } from './guardias.mjs';
import { PREGUNTA_CONFIRMAR, cambioTrasNo, cierreContraentrega, pedirDatos, preciosPermitidos, preview } from './redactor.mjs';
import { paisDe } from '../paises/index.mjs';
import { normalizar } from './texto.mjs';

const ETAPAS_DEL_MOTOR = new Set(['cart', 'awaiting_info', 'awaiting_confirmation']);
const NUESTRAS = new Set(['set_customer_info', 'confirm_order']);

// clave del motor → campo del borrador / argumento de set_customer_info
const CAMPO = {
  nombre: { borrador: 'customerName', arg: 'name' },
  telefono: { borrador: 'customerPhone', arg: 'phone' },
  cedula: { borrador: 'customerIdentification', arg: 'identification' },
  email: { borrador: 'customerEmail', arg: 'email' },
  direccion: { borrador: 'customerAddress', arg: 'address' },
  ciudad: { borrador: 'customerCity', arg: 'city' },
  estado: { borrador: 'customerState', arg: 'state' },
  referencia: { borrador: 'customerReference', arg: 'reference' },
};

const MENCION = {
  nombre: /a nombre de|tu nombre|nombre y apellido/i,
  telefono: /tel[eé]fono|celular/i,
  cedula: /c[eé]dula|documento/i,
  email: /correo/i,
  direccion: /direcci[oó]n/i,
  ciudad: /ciudad/i,
  referencia: /referencia/i,
};

const actual = (porque) => ({ plan: { tipo: 'actual' }, porque });

/** ¿El borrador ya tiene este dato? Una oficina elegida vale como dirección. */
function tiene(borrador, clave) {
  if (clave === 'direccion') return !!(borrador.customerAddress?.trim() || borrador.oficinaRetiro?.nombre);
  return !!String(borrador[CAMPO[clave]?.borrador] || '').trim();
}

/** Los datos que faltan: primero los obligatorios, luego los opcionales no gastados. */
export function faltantes({ borrador, campos, yaPedidos }) {
  const obligatorios = campos.filter((c) => c.obligatorio && !tiene(borrador, c.clave)).map((c) => c.clave);
  const opcionales = campos.filter((c) => !c.obligatorio && !tiene(borrador, c.clave) && !yaPedidos.has(c.clave)).map((c) => c.clave);
  // En el orden en que la tienda los lista, no obligatorios-primero.
  const todos = campos.map((c) => c.clave).filter((k) => obligatorios.includes(k) || opcionales.includes(k));
  return { obligatorios, opcionales, todos };
}

/** Lo que el prompt dice que YA se pidió y el cliente no dio (opcionales gastados). */
function opcionalesGastados(system) {
  const m = /YA PEDISTE ([^\n]+?) en este chat/.exec(system || '');
  if (!m) return new Set();
  const claves = new Set();
  for (const [clave, re] of Object.entries(MENCION)) if (re.test(m[1])) claves.add(clave);
  return claves;
}

/** El nombre de la transportadora si la tienda ofrece retirar en oficina. */
function oficinaOfrecida(system) {
  const m = /prefieres RETIRAR en una oficina de (\w+)/.exec(system || '');
  return m ? m[1] : null;
}

/**
 * Qué quedó preguntado, mirando el último mensaje del vendedor (nuestro o del
 * agente actual): 'confirmar' | 'comprar' | una clave de dato | null.
 */
export function pendienteDe({ ultimoVendedor, borrador, faltan }) {
  const t = String(ultimoVendedor || '');
  if (!t.trim()) return null;
  const n = normalizar(t);
  if (borrador.stage === 'awaiting_confirmation') {
    if (PREGUNTA_CONFIRMAR.test(t)) return 'confirmar';
    // El agente actual pide la confirmación con sus palabras: "¿confirmas?",
    // "¿todo correcto?", "¿procedo?", "¿lo registro?".
    if (/\?/.test(t) && /\b(confirm\w*|todo (esta )?(bien|correcto)|es correcto|proced\w*|lo registro|lo armo|lo genero|esta bien asi)\b/.test(n)) return 'confirmar';
  }
  // Pregunta de UN dato: solo si es el único que falta y el mensaje lo nombra.
  if (faltan.length === 1 && MENCION[faltan[0]]?.test(t) && /\?/.test(t)) return faltan[0];
  // Una lista de datos (varios) no deja pendiente concreto: se leen con etiquetas.
  if (faltan.length > 1 && faltan.filter((k) => MENCION[k]?.test(t)).length >= 2) return null;
  // "¿Te lo despacho?", "¿te lo aparto?", "¿hacemos el pedido?"
  if (['cart', 'awaiting_info'].includes(borrador.stage) && /\?/.test(t) && /\b(despach\w*|apart\w*|te lo (envio|mando)|hacemos el pedido|armamos el pedido|lo quieres|lo llevas|te lo llevas|pedirlo|comprarlo|lo compras|lo pides|seguimos con (el|tu) pedido)\b/.test(n)) return 'comprar';
  return null;
}

/** Un texto propio, pasado por las guardias. Si no pasa → actual. */
function texto(t, { borrador, mensajes, porque, pais }) {
  // Los ejemplos del país se pueden escribir ("ej: 0987593542"); la cédula del
  // cliente también es suya.
  const ejemplos = Object.values(pais?.campos || {}).map((c) => c.ejemplo).filter((e) => e && /\d{6,}/.test(e));
  const r = revisar({
    texto: t,
    contexto: {
      preciosPermitidos: preciosPermitidos(borrador),
      numerosPermitidos: [borrador.customerPhone, borrador.customerIdentification, ...ejemplos].filter(Boolean),
      correosPermitidos: [borrador.customerEmail].filter(Boolean),
      vecesDicho: (x) => vecesDicho(mensajes, x),
    },
  });
  if (!r.texto) return actual([...porque, `guardias: ${JSON.stringify(r.traza)}`]);
  return { plan: { tipo: 'texto', texto: r.texto }, porque };
}

/** Pedir lo que falte, o la previsualización si ya está todo. */
function siguientePaso({ borrador, pais, campos, yaPedidos, mensajes, system, porque, primeraVez }) {
  const f = faltantes({ borrador, campos, yaPedidos });
  if (!f.obligatorios.length && borrador.stage === 'awaiting_confirmation' || (!f.todos.length && (borrador.items || []).length)) {
    return texto(preview({ borrador, pais }), { borrador, mensajes, pais, porque: [...porque, 'preview'] });
  }
  if (!f.obligatorios.length && f.opcionales.length === 0) {
    return texto(preview({ borrador, pais }), { borrador, mensajes, pais, porque: [...porque, 'preview'] });
  }
  // Primero los obligatorios; los opcionales se piden junto a ellos una sola vez.
  const pedir = f.obligatorios.length ? f.todos : f.opcionales;
  const t = pedirDatos({ faltan: pedir, pais, nombre: borrador.customerName, oficina: oficinaOfrecida(system), primeraVez });
  return texto(t, { borrador, mensajes, pais, porque: [...porque, `pedir ${pedir.join(',')}`] });
}

/** Un turno de venta. Devuelve { plan, porque }. */
export function turnoDeVenta(contexto) {
  const borrador = contexto.borrador || {};
  const mensajes = contexto.mensajes || [];

  // ── El cierre justo después de confirm_order ─────────────────────────
  // Va primero: al volver de la herramienta el borrador ya está confirmado
  // (lastPedidoLabel, etapa confirmed) y las salidas de abajo cederían. Solo
  // en tiendas que cobran al recibir: ahí el cierre es un texto fijo de la
  // plataforma y escribirlo por código ahorra el turno más caro de la venta.
  // Con pago por adelantado (link, transferencia) lo sigue escribiendo el
  // agente actual, que sabe ofrecer los métodos.
  if (ultimoDe(mensajes).tipo === 'herramienta') {
    const resultados = resultadosRecientes(mensajes);
    const conf = resultados.find((r) => r.nombre === 'confirm_order');
    if (conf && resultados.length === 1) {
      const r = conf.resultado || {};
      const label = String(r.pedidoLabel || '');
      const total = Number(r.total);
      if (r.ok === true && /^#\d{1,8}$/.test(label) && Number.isFinite(total) && total > 0 && cobraAlRecibir(systemDe(mensajes))) {
        const t = cierreContraentrega({ pedidoLabel: label, total });
        const rev = revisar({
          texto: t,
          contexto: {
            preciosPermitidos: [Number(total.toFixed(2))],
            numerosPermitidos: [],
            correosPermitidos: [],
            vecesDicho: (x) => vecesDicho(mensajes, x),
          },
        });
        if (rev.texto) return { plan: { tipo: 'texto', texto: rev.texto }, porque: ['pedido creado: cierre contraentrega por código'] };
        return actual(['pedido creado: el cierre no pasó las guardias', JSON.stringify(rev.traza)]);
      }
      return actual([r.ok ? 'pedido creado: cierre con el actual (no es contraentrega)' : 'confirm_order falló: lo resuelve el actual']);
    }
  }

  if (!ETAPAS_DEL_MOTOR.has(borrador.stage) || !(borrador.items || []).length) return actual([`etapa ${borrador.stage || 'sin borrador'}: no es del motor`]);
  if (borrador.lastPedidoLabel) return actual(['ya hay un pedido confirmado en este chat']);

  const system = systemDe(mensajes);
  const pais = paisDe(paisDelPrompt(system));
  const campos = camposDelPrompt(system);
  const yaPedidos = opcionalesGastados(system);
  const ultimo = ultimoDe(mensajes);
  const base = { borrador, pais, campos, yaPedidos, mensajes, system };

  // ── Vuelta tras herramientas ──────────────────────────────────────────
  if (ultimo.tipo === 'herramienta') {
    const resultados = resultadosRecientes(mensajes);
    if (!resultados.length || resultados.some((r) => !NUESTRAS.has(r.nombre))) return actual(['resultados de herramientas que no son del motor']);
    const confirmacion = resultados.find((r) => r.nombre === 'confirm_order');
    // El cierre (pago, aviso de despacho) lo escribe el agente actual: sabe
    // cómo cobra la tienda. Es una llamada por pedido, no por turno.
    if (confirmacion) return actual([confirmacion.resultado?.ok ? 'pedido creado: cierre con el actual' : 'confirm_order falló: lo resuelve el actual']);
    const guardado = resultados.find((r) => r.nombre === 'set_customer_info');
    if (guardado && guardado.resultado?.ok === false) return actual(['set_customer_info rechazó algo: lo resuelve el actual']);
    const aviso = guardado?.resultado?.avisoZona || guardado?.resultado?.avisoOficina;
    if (aviso) return actual(['aviso de zona u oficina: lo explica el actual']);
    return siguientePaso({ ...base, porque: ['datos guardados'], primeraVez: false });
  }

  if (ultimo.tipo !== 'cliente') return actual(['el último mensaje no es del cliente']);

  // ── Vuelta con mensaje del cliente ────────────────────────────────────
  const textoCliente = ultimoDelCliente(mensajes);
  if (!textoCliente.trim()) return actual(['mensaje sin texto (imagen, audio sin transcribir)']);
  const ultimoVendedor = ultimoDelVendedor(mensajes);
  const f = faltantes({ borrador, campos, yaPedidos });
  const pendiente = pendienteDe({ ultimoVendedor, borrador, faltan: f.todos });
  const i = interpretar({ texto: textoCliente, pendiente, pais });
  const porque = [`pendiente=${pendiente}`, ...i.porque];

  switch (i.intencion) {
    case 'si': {
      if (pendiente === 'confirmar') {
        if (borrador.stage !== 'awaiting_confirmation' || f.obligatorios.length) return actual([...porque, 'dijo sí pero faltan datos']);
        if (!tieneHerramienta(contexto.herramientas, 'confirm_order')) return actual([...porque, 'sin confirm_order']);
        return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'confirm_order', argumentos: {} }] }, porque: [...porque, 'confirmar'] };
      }
      // "¿Te lo despacho?" → sí → se piden los datos (o la previsualización si ya están).
      return siguientePaso({ ...base, porque, primeraVez: true });
    }
    case 'no': {
      if (pendiente === 'confirmar') return texto(cambioTrasNo(), { borrador, mensajes, pais, porque });
      return actual([...porque, 'dijo que no a comprar']);
    }
    case 'datos': {
      if (!tieneHerramienta(contexto.herramientas, 'set_customer_info')) return actual([...porque, 'sin set_customer_info']);
      const argumentos = {};
      for (const [clave, valor] of Object.entries(i.datos.datos || {})) {
        const arg = CAMPO[clave]?.arg;
        if (arg) argumentos[arg] = String(valor).slice(0, 300);
      }
      if (!Object.keys(argumentos).length) return actual([...porque, 'datos sin campo conocido']);
      return { plan: { tipo: 'herramientas', llamadas: [{ nombre: 'set_customer_info', argumentos }] }, porque: [...porque, Object.keys(argumentos).join(',')] };
    }
    case 'sin_dato': {
      const clave = i.datos.clave;
      const esObligatorio = campos.some((c) => c.clave === clave && c.obligatorio);
      if (esObligatorio) return actual([...porque, `no tiene ${clave} y es obligatorio`]);
      // Opcional que no da: se sigue sin él (no se vuelve a pedir en este turno).
      const sinEse = { ...base, yaPedidos: new Set([...yaPedidos, clave]) };
      return siguientePaso({ ...sinEse, porque, primeraVez: false });
    }
    case 'comprar':
    case 'continuar':
      return siguientePaso({ ...base, porque, primeraVez: true });
    default:
      return actual([...porque, 'no es inequívoco']);
  }
}

export { textoDe };
