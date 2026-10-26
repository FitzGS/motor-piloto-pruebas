/**
 * Motor piloto. Este arranque conserva el agente actual en todos los casos.
 * Fitz puede reemplazar esta función por su máquina de estados.
 * No hay red, claves, filesystem escribible ni acceso a la base de datos.
 */
export default async function motor(contexto) {
  return { tipo: 'actual' };
}
