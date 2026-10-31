// El país de la tienda decide la plantilla. Sin archivo propio → general.
import { general } from './general.mjs';
import { ec } from './ec.mjs';
import { ve } from './ve.mjs';
import { co } from './co.mjs';

const POR_CODIGO = { ec, ve, co, ecuador: ec, venezuela: ve, colombia: co };

export function paisDe(codigo) {
  const c = String(codigo || '').trim().toLowerCase();
  return POR_CODIGO[c] || general;
}
