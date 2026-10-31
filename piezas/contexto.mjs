// Lo que el motor LEE del contexto del contrato, puesto en limpio.
//
// `mensajes` es el historial tal como lo ve el modelo actual: el system
// prompt de la plataforma primero, luego cliente/vendedor/herramientas. El
// motor no reescribe ese prompt: solo saca de él lo poco que necesita (país,
// campos obligatorios, nombre del asistente) y mira el último mensaje.

import { normalizar } from './texto.mjs';

const ETIQUETA_A_CLAVE = [
  [/nombre y apellido/i, 'nombre'],
  [/tel[eé]fono|celular/i, 'telefono'],
  [/c[eé]dula|documento/i, 'cedula'],
  [/correo/i, 'email'],
  [/direcci[oó]n/i, 'direccion'],
  [/ciudad/i, 'ciudad'],
  [/referencia/i, 'referencia'],
];

/** El texto de un mensaje, sea string o lista de partes (imagen + texto). */
export function textoDe(mensaje) {
  const c = mensaje?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((p) => p?.type === 'text').map((p) => p.text).join('\n');
  return '';
}

/** El system prompt de la plataforma (el primero), o ''. */
export function systemDe(mensajes) {
  const s = (mensajes || []).find((m) => m?.role === 'system');
  return textoDe(s);
}

/** "La tienda opera en EC." → "ec". Sin esa línea → null (plantilla general). */
export function paisDelPrompt(system) {
  const m = /La tienda opera en ([A-Za-z]{2,3})\./.exec(system || '');
  return m ? m[1].toLowerCase() : null;
}

/**
 * Qué datos pide esta tienda y cuáles son obligatorios, leídos del bloque
 * "Datos que tienes que recoger" del prompt:
 *   - **Nombre y apellido** — **OBLIGATORIO** (sin esto NO cierres el pedido). …
 *   - **Correo electrónico** — opcional (si no lo da tras 1 intento, sigue sin él). …
 * Sin el bloque (p. ej. tienda que no pide dirección) → solo el nombre.
 */
export function camposDelPrompt(system) {
  const campos = [];
  const re = /^\s*- \*\*([^*]+)\*\* — (\*\*OBLIGATORIO\*\*|opcional)/gm;
  let m;
  while ((m = re.exec(system || ''))) {
    const clave = ETIQUETA_A_CLAVE.find(([r]) => r.test(m[1]))?.[1];
    if (clave && !campos.some((c) => c.clave === clave))
      campos.push({ clave, obligatorio: m[2].startsWith('**') });
  }
  if (!campos.some((c) => c.clave === 'nombre')) campos.unshift({ clave: 'nombre', obligatorio: true });
  return campos;
}

/** El último mensaje del historial y su tipo: 'cliente' | 'herramienta' | 'vendedor' | null. */
export function ultimoDe(mensajes) {
  const lista = (mensajes || []).filter((m) => m?.role !== 'system');
  const ultimo = lista[lista.length - 1];
  if (!ultimo) return { tipo: null, mensaje: null };
  if (ultimo.role === 'user') return { tipo: 'cliente', mensaje: ultimo };
  if (ultimo.role === 'tool') return { tipo: 'herramienta', mensaje: ultimo };
  if (ultimo.role === 'assistant') return { tipo: 'vendedor', mensaje: ultimo };
  return { tipo: null, mensaje: ultimo };
}

/** Lo último que dijo el vendedor en texto (sin contar llamadas a herramientas). */
export function ultimoDelVendedor(mensajes) {
  const lista = (mensajes || []).filter((m) => m?.role === 'assistant' && textoDe(m).trim());
  return textoDe(lista[lista.length - 1]);
}

/** Lo último que escribió el cliente. */
export function ultimoDelCliente(mensajes) {
  const lista = (mensajes || []).filter((m) => m?.role === 'user');
  return textoDe(lista[lista.length - 1]);
}

/** Los resultados de herramientas del tramo final (desde la última llamada del vendedor). */
export function resultadosRecientes(mensajes) {
  const lista = mensajes || [];
  let i = lista.length - 1;
  const resultados = [];
  while (i >= 0 && lista[i]?.role === 'tool') {
    let contenido = null;
    try { contenido = JSON.parse(textoDe(lista[i])); } catch { contenido = { crudo: textoDe(lista[i]) }; }
    resultados.unshift({ id: lista[i].tool_call_id, contenido });
    i--;
  }
  const llamada = lista[i]?.role === 'assistant' && Array.isArray(lista[i].tool_calls) ? lista[i] : null;
  // Emparejar nombre de herramienta con su resultado.
  return resultados.map((r) => {
    const tc = llamada?.tool_calls?.find((c) => c.id === r.id);
    let argumentos = {};
    try { argumentos = tc ? JSON.parse(tc.function?.arguments || '{}') : {}; } catch {}
    return { nombre: tc?.function?.name || null, argumentos, resultado: r.contenido };
  });
}

/**
 * ¿La tienda cobra al recibir? El prompt de la plataforma lo marca con
 * «**Se paga CONTRAENTREGA**» y define ahí mismo el texto del cierre
 * («Pedido confirmado #0001 · Pagas $20 en efectivo cuando lo recibas 🚚»).
 */
export function cobraAlRecibir(system) {
  return /\*\*Se paga CONTRAENTREGA\*\*/.test(String(system || ''));
}

/** ¿La tienda tiene esta herramienta activa en esta vuelta? */
export function tieneHerramienta(herramientas, nombre) {
  return (herramientas || []).some((t) => t?.type === 'function' && t.function?.name === nombre);
}

/** Las veces que un texto idéntico (normalizado) ya salió del vendedor. */
export function vecesDicho(mensajes, texto) {
  const n = normalizar(texto);
  return (mensajes || []).filter((m) => m?.role === 'assistant' && normalizar(textoDe(m)) === n).length;
}
