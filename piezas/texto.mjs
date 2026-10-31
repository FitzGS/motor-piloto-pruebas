// Normalización de texto, común a las piezas. Lo que escribe el cliente pasa
// por las MISMAS reglas en todas partes para poder compararlo.
//
//   "Sí, confírmalo!!"  → "si confirmalo"
//   "Dirección: Av. 10 de Agosto" → "direccion av 10 de agosto"

export function normalizar(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9ñ@+\n]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/** Como `normalizar`, pero conserva la puntuación que separa etiquetas (":", "=", "-"). */
export function normalizarSuave(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ 	]+/g, ' ')
    .trim();
}

/** Palabras del texto normalizado, en orden. */
export function palabras(texto) {
  return normalizar(texto).replace(/\n/g, ' ').split(' ').filter(Boolean);
}

/** 19.99 → "$19,99" · 1234.5 → "$1.234,50" */
export function formatearPrecio(n, moneda = 'USD') {
  const [entero, dec] = Number(n || 0).toFixed(2).split('.');
  const cuerpo = `${entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${dec}`;
  return moneda === 'USD' ? `$${cuerpo}` : `${cuerpo} ${moneda}`;
}

/** Primer nombre de "Paulina Vallejo" → "Paulina". */
export function primerNombre(nombre) {
  const p = String(nombre || '').trim().split(/\s+/)[0] || '';
  return p ? p[0].toUpperCase() + p.slice(1).toLowerCase() : '';
}

/** Mayúscula inicial en cada palabra: "quito" → "Quito". */
export function capitalizar(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_, a, b) => a + b.toUpperCase());
}
