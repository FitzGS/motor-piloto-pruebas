/**
 * Motor piloto del agente de ventas de Whapicommerce — v1.
 *
 * «Código asistido por IA»: la venta es una secuencia de pasos
 * (producto → datos → pago → confirmación) y la decide el CÓDIGO; el modelo
 * entra solo donde el código no llega. En esta versión:
 *
 *   · Tramo carrito → datos → confirmación por código (piezas/etapas.mjs):
 *     lee datos firmes, pide lo que falta en UN mensaje, muestra la
 *     previsualización y confirma SOLO si el cliente dijo que sí a la
 *     previsualización mostrada en un mensaje anterior.
 *   · Seguimientos por código cuando hay carrito (piezas/seguimiento.mjs).
 *   · Todo lo demás (explorar, buscar, dudas, cierre con pago) →
 *     { tipo: 'actual' }: responde el agente de hoy con su contexto.
 *
 * Contrato 1: función pura por turno, sin red, sin secretos, sin escritura.
 * El estado vive en `contexto.borrador`. Cualquier error → 'actual'.
 */
import { turnoDeVenta } from './piezas/etapas.mjs';
import { turnoDeSeguimiento } from './piezas/seguimiento.mjs';

/** Igual que `motor`, pero devuelve también el porqué (para el banco de pruebas). */
export function motorConTraza(contexto) {
  try {
    if (!contexto || contexto.protocolo !== 1) return { plan: { tipo: 'actual' }, porque: ['protocolo desconocido'] };
    // Una redacción pedida por otra versión del motor: esta no pide ninguna.
    if (contexto.resultadoModelo) return { plan: { tipo: 'actual' }, porque: ['resultadoModelo inesperado'] };
    if (contexto.tipo === 'seguimiento') return turnoDeSeguimiento(contexto);
    if (contexto.tipo === 'venta') return turnoDeVenta(contexto);
    return { plan: { tipo: 'actual' }, porque: [`tipo ${contexto.tipo}`] };
  } catch (e) {
    return { plan: { tipo: 'actual' }, porque: [`error: ${e?.message || e}`] };
  }
}

export default async function motor(contexto) {
  return motorConTraza(contexto).plan;
}
