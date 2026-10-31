// Las GUARDIAS: el código revisa el texto antes de entregarlo. Si algo falla
// se usa el texto escrito solo por código; si ese también falla, el motor
// cede al agente actual. Traídas de Venelectronics y recortadas a lo que
// aplica aquí (sin lista de contactos del negocio: aquí NO va ningún número,
// correo ni enlace que no haya dado el cliente).

/** "$1.234,56" → 1234.56 · "$949,99" → 949.99 · "$500" → 500 · "$19.99" → 19.99 */
export function leerPrecio(texto) {
  const s = String(texto).replace(/\$\s*/, '').trim();
  if (/,\d{1,2}$/.test(s)) return Number(s.replace(/\./g, '').replace(',', '.'));
  if (/\.\d{1,2}$/.test(s)) return Number(s.replace(/,/g, ''));
  return Number(s.replace(/[.,]/g, ''));
}

const precio = {
  id: 'precio',
  revisar({ texto, contexto }) {
    const montos = texto.match(/\$\s?\d[\d.]*(?:,\d{1,2})?/g) || [];
    const permitidos = contexto.preciosPermitidos || [];
    return montos
      .map(leerPrecio)
      .filter((m) => !permitidos.some((p) => Math.abs(p - m) < 0.011))
      .map((m) => ({ detalle: `precio ${m} que no está en el carrito` }));
  },
};

const contactos = {
  id: 'contactos',
  revisar({ texto, contexto }) {
    const fallas = [];
    const sinUrls = texto.replace(/https?:\/\/\S+/g, ' ');
    for (const m of sinUrls.match(/(?<!\d)\+?\d[\d\s.-]{6,}\d(?!\d)/g) || []) {
      const digitos = m.replace(/\D/g, '');
      if (digitos.length < 9) continue;
      const permitido = (contexto.numerosPermitidos || []).some((n) => {
        const d = String(n).replace(/\D/g, '');
        return d && (d.endsWith(digitos) || digitos.endsWith(d));
      });
      if (!permitido) fallas.push({ detalle: `número ${digitos} que no es del cliente` });
    }
    for (const hallado of texto.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []) {
      const correo = hallado.replace(/[.\-_]+$/, '').toLowerCase();
      if (!(contexto.correosPermitidos || []).map((c) => String(c).toLowerCase()).includes(correo)) fallas.push({ detalle: `correo ${correo} que no es del cliente` });
    }
    if (/https?:\/\//.test(texto)) fallas.push({ detalle: 'enlace: el motor no manda enlaces' });
    return fallas;
  },
};

const prohibidas = {
  id: 'prohibidas',
  revisar({ texto }) {
    const fallas = [];
    const palabras = texto.match(/\b(sku|mcp|json|tool|herramienta interna|invocando|invoking|consultando el cat[aá]logo|whapify|whapicommerce|dropi|dropanas|openai|chatgpt|modelo de lenguaje|como ia|soy una ia|soy (?:un|una) (?:bot|robot|asistente virtual|inteligencia artificial|programa)|como (?:asistente virtual|inteligencia artificial)|proveedor)\b/gi) || [];
    for (const p of palabras) fallas.push({ detalle: `palabra prohibida "${p}"` });
    if (/\{\s*"|"messages"\s*:|"tipo"\s*:/.test(texto)) fallas.push({ detalle: 'JSON visible' });
    return fallas;
  },
};

const emojis = {
  id: 'emojis',
  revisar({ texto }) {
    // Los que abren una línea son viñetas de una lista (👤 Nombre…), no adorno.
    const sinVinetas = texto.replace(/^\s*\p{Extended_Pictographic}️?\s/gmu, '');
    const n = (sinVinetas.match(/\p{Extended_Pictographic}/gu) || []).length;
    return n > 3 ? [{ detalle: `${n} emojis` }] : [];
  },
};

const largo = {
  id: 'largo',
  revisar({ texto, contexto }) {
    const tope = contexto.largoMaximo || 900;
    return texto.length > tope ? [{ detalle: `${texto.length} caracteres (tope ${tope})` }] : [];
  },
};

const repetido = {
  id: 'repetido',
  revisar({ texto, contexto }) {
    // Misma respuesta 3 veces → no se insiste; el motor cede al actual.
    return (contexto.vecesDicho?.(texto) || 0) >= 2 ? [{ detalle: 'esta respuesta ya salió dos veces' }] : [];
  },
};

export const GUARDIAS = [precio, contactos, prohibidas, emojis, largo, repetido];

/** Arreglos que no necesitan reescritura: formato. */
export function arreglar(texto) {
  return String(texto || '')
    .replace(/\*\*(.+?)\*\*/g, '*$1*')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Revisa el texto. Devuelve el aprobado (el original o el de respaldo) o null
 * si ninguno pasa, con la traza de lo que falló.
 */
export function revisar({ texto, textoCodigo = null, contexto = {} }) {
  const traza = [];
  for (const [intento, candidato] of [[0, texto], [1, textoCodigo]]) {
    if (candidato === null || candidato === undefined) continue;
    const arreglado = arreglar(candidato);
    const fallas = GUARDIAS.flatMap((g) => g.revisar({ texto: arreglado, contexto }).map((f) => ({ guardia: g.id, ...f })));
    traza.push({ intento, fallas });
    if (!fallas.length) return { texto: arreglado, estado: intento ? 'respaldo' : 'ok', traza };
  }
  return { texto: null, estado: 'bloqueado', traza };
}
