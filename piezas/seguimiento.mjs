// SEGUIMIENTOS por código (entregable 1 del brief): de ~4.500 tokens por
// seguimiento a 0. Solo cuando hay carrito: el texto sale del borrador
// (producto, etapa, dato que falta). Sin carrito → el agente actual, que ya
// tiene su prompt de reactivación.
//
// El contrato solo admite texto/redactar/actual aquí. Horarios, límites y
// destinatarios los conserva la plataforma.

import { camposDelPrompt, paisDelPrompt, systemDe, vecesDicho } from './contexto.mjs';
import { revisar } from './guardias.mjs';
import { preciosPermitidos } from './redactor.mjs';
import { faltantes } from './etapas.mjs';
import { paisDe } from '../paises/index.mjs';
import { primerNombre } from './texto.mjs';

const ETAPAS = new Set(['cart', 'awaiting_info', 'awaiting_confirmation']);

function productoDe(borrador) {
  const items = borrador.items || [];
  if (!items.length) return 'tu pedido';
  const primero = items[0].productName;
  return items.length > 1 ? `${primero} y ${items.length - 1} más` : primero;
}

/** Tres intentos, tres enfoques. Después, nada: insistir espanta. */
export function textosDeSeguimiento({ borrador, faltan, pais }) {
  const hola = borrador.customerName ? `Hola, ${primerNombre(borrador.customerName)} 👋` : 'Hola 👋';
  const producto = productoDe(borrador);
  if (borrador.stage === 'awaiting_confirmation') {
    return [
      `${hola} Tu pedido de ${producto} quedó listo, solo falta que lo confirmes. ¿Lo registro?`,
      `${hola} Sigo por aquí por si quieres que registre tu pedido de ${producto}. ¿Lo confirmo?`,
      `${hola} ¿Sigues interesado en ${producto}? Si prefieres lo dejamos para otro momento, sin compromiso.`,
    ];
  }
  if (borrador.stage === 'awaiting_info' && faltan.length) {
    const etiqueta = (pais.campos[faltan[0]]?.etiqueta || faltan[0]).toLowerCase();
    const que = faltan.length === 1 ? `tu ${etiqueta}` : 'tus datos de entrega';
    return [
      `${hola} Te quedó apartado ${producto}. Solo me falta ${que} para despacharlo, ¿me lo pasas?`,
      `${hola} Cuando quieras seguimos con ${producto}: me falta ${que} y queda listo.`,
      `${hola} ¿Sigues interesado en ${producto}? Si prefieres lo dejamos para otro momento, sin compromiso.`,
    ];
  }
  return [
    `${hola} Te quedó ${producto} en el carrito 🛒 ¿Te lo despacho?`,
    `${hola} Sigo por aquí por si quieres seguir con ${producto}. ¿Lo armamos?`,
    `${hola} ¿Sigues interesado en ${producto}? Si prefieres lo dejamos para otro momento, sin compromiso.`,
  ];
}

export function turnoDeSeguimiento(contexto) {
  const borrador = contexto.borrador || {};
  const mensajes = contexto.mensajes || [];
  if (!ETAPAS.has(borrador.stage) || !(borrador.items || []).length) return { plan: { tipo: 'actual' }, porque: ['sin carrito: reactivación con el actual'] };
  if (borrador.lastPedidoLabel) return { plan: { tipo: 'actual' }, porque: ['ya hay pedido'] };
  const system = systemDe(mensajes);
  const pais = paisDe(paisDelPrompt(system));
  const campos = camposDelPrompt(system);
  const f = faltantes({ borrador, campos, yaPedidos: new Set() });
  const textos = textosDeSeguimiento({ borrador, faltan: f.obligatorios, pais });
  // El que no se haya mandado aún; si ya salieron los tres, se calla (actual decide).
  const siguiente = textos.find((t) => vecesDicho(mensajes, t) === 0);
  if (!siguiente) return { plan: { tipo: 'actual' }, porque: ['ya se mandaron los tres seguimientos'] };
  const r = revisar({ texto: siguiente, contexto: { preciosPermitidos: preciosPermitidos(borrador) } });
  if (!r.texto) return { plan: { tipo: 'actual' }, porque: ['guardias'] };
  return { plan: { tipo: 'texto', texto: r.texto }, porque: [`seguimiento ${textos.indexOf(siguiente) + 1}`] };
}
