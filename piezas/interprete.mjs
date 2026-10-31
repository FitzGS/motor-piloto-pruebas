// El INTÉRPRETE: de lo que escribió el cliente a una intención y sus datos,
// SOLO por código (regex + lo que quedó pendiente en la conversación). Lo que
// no sea inequívoco se devuelve como 'otro' y el motor cede al agente actual.
//
//   interpretar({ texto, pendiente, pais }) → { intencion, datos, porque }
//
// Traído de Venelectronics (piezas/interprete.js) y recortado: aquí no hay
// catálogo ni FAQ; eso lo sigue haciendo el agente actual.

import { normalizar, normalizarSuave, capitalizar } from './texto.mjs';

export const AFIRMATIVO = /^(si|sii+|s|ok|okey|okay|dale|claro|de una|listo|perfecto|va|vale|por supuesto|confirmo|confirmado|confirmar|correcto|exacto|me parece|esta bien|asi es|por favor|si por favor|si claro|si dale|si confirmo|si confirma|sip|see|yes|bueno|afirmativo|hazlo|hazme el pedido|procede|adelante|de acuerdo|todo bien|todo correcto|esta correcto|si esta bien|si todo bien|si es correcto|si correcto|si esta correcto)( gracias| porfa| por favor)?[\s!.]*$/;
export const NEGATIVO = /^(no|nop|nel|no gracias|no por ahora|mejor no|negativo|aun no|todavia no|ahorita no|no quiero|no asi|cancela|cancelar|cancelalo|no lo quiero|ya no)[\s!.]*$/;
const SI_AL_INICIO = /^(si|sii+|sip|dale|ok|okey|okay|claro|perfecto|listo|correcto|confirmo|confirmado|confirmar|de acuerdo|esta bien|todo bien|todo correcto|asi es|exacto|por supuesto|afirmativo)\b/;
const NO_AL_INICIO = /^(no|nop|nel|negativo|aun no|todavia no|ahorita no)\b/;

const COMPRAR = /\b(lo quiero|la quiero|los quiero|las quiero|me lo llevo|me la llevo|quiero comprar|quiero pedir|quiero ordenar|hagamos el pedido|haz el pedido|hazme el pedido|apartamelo|apartamela|apartalo|apartala|me interesa comprar|como (lo )?compro|como (lo )?pido|como hago (el|para) (pedido|comprar)|quiero uno|quiero una|deseo comprar|voy a comprar|lo compro|la compro|lo pido|lo ordeno|mandamelo|mandamela|enviamelo|enviamela|despachamelo|despachamela)\b/;
const CONTINUAR_PEDIDO = /\b(confirm\w*|finaliz\w*|termin\w*|cerr\w*|complet\w*|proces\w*|hacer|haz|hagamos|seguir|sigamos|continu\w*)\b.{0,30}\b(pedido|compra|orden)\b|\b(pedido|compra|orden)\b.{0,30}\b(confirm\w*|finaliz\w*|termin\w*|complet\w*)\b/;
const ASESOR = /\b(asesor|asesora|humano|una persona|alguien real|un agente|operador|hablar con alguien|con una persona)\b/;
const PREGUNTA = /[?¿]/;
const MENCIONA_DATO = /\b(nombre|apellido|direccion|cedula|rif|telefono|celular|correo|email|ciudad|provincia|estado|departamento|referencia)\b/;
const SIN_CORREO = /\b(no (tengo|uso|manejo|poseo|cuento con)|sin|tampoco tengo) (un |el |mi )?(correo|email|e mail|mail)\b|\b(correo|email|mail) (no|tampoco) (tengo|uso|manejo|poseo)\b/;
const SIN_DATO = /^(no (tengo|uso|manejo)|no (lo )?tengo|no se|no la tengo|no lo se|ninguno|ninguna|n\/a|na)[\s!.]*$/;

// Etiquetas: "Nombre: Ana Pérez", "dir - Calle 5 #12", "Ciudad= Quito".
const ETIQUETAS = {
  nombre: /^(nombre|nombres|nombre y apellido|nombre completo|a nombre de)\s*[:=-]\s*(.+)$/i,
  telefono: /^(telefono|tel|celular|cel|numero|whatsapp|contacto|movil)\s*[:=-]\s*(.+)$/i,
  email: /^(correo|email|e-mail|mail|correo electronico)\s*[:=-]\s*(.+)$/i,
  direccion: /^(direccion|dir|direccion de entrega|domicilio|direccion exacta)\s*[:=-]\s*(.+)$/i,
  cedula: /^(cedula|ci|c\.i\.|rif|documento|identificacion|dni|cc)\s*[:=-]\s*(.+)$/i,
  ciudad: /^(ciudad|localidad|municipio|canton|parroquia)\s*[:=-]\s*(.+)$/i,
  estado: /^(estado|edo|provincia|departamento|region)\s*[:=-]\s*(.+)$/i,
  referencia: /^(referencia|punto de referencia|ref)\s*[:=-]\s*(.+)$/i,
};

// Frases sueltas que delatan un dato: "soy de Quito", "vivo en Guayaquil".
const CIUDAD_SUELTA = /\b(soy de|vivo en|estoy en|desde|en la ciudad de|ciudad de|de la ciudad)\s+([a-zñ]+(?:\s+[a-zñ]+){0,2})$/;
const NOMBRE_SUELTO = /^(me llamo|mi nombre es|soy|a nombre de)\s+(.+)$/;

const limpiarValor = (v) => String(v || '').replace(/^[\s:=-]+|[\s.]+$/g, '').trim();

/**
 * Datos del comprador que se pueden leer con reglas. Devuelve solo lo firme:
 * con etiqueta, de forma inconfundible (correo, teléfono del país, cédula con
 * letra) o como respuesta a la pregunta pendiente de UN solo dato.
 */
export function extraerDatos(texto, { pais, pendiente = null } = {}) {
  const original = String(texto || '');
  const datos = {};
  const lineas = original.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const linea of lineas) {
    const n = normalizarSuave(linea);
    for (const [clave, re] of Object.entries(ETIQUETAS)) {
      const m = re.exec(n);
      if (m && !datos[clave]) {
        // El valor se toma del ORIGINAL (con acentos y mayúsculas), cortando
        // tras el separador.
        const sep = linea.search(/[:=-]/);
        datos[clave] = limpiarValor(sep >= 0 ? linea.slice(sep + 1) : m[m.length - 1]);
      }
    }
  }

  // Lo que ya se leyó con etiqueta no se vuelve a leer suelto: "cédula:
  // 0912345678" no es además un teléfono.
  let restante = original;
  for (const v of Object.values(datos)) restante = restante.replace(v, ' ');

  const correo = restante.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  if (correo && !datos.email) datos.email = correo[0].replace(/[.,;]+$/, '');

  if (!datos.telefono && pais.telefono) {
    const t = restante.replace(/[^\d+\s.\-\n]/g, ' ').match(pais.telefono);
    if (t) datos.telefono = t[0];
  }
  if (!datos.cedula && pais.cedula) {
    const c = restante.match(pais.cedula);
    if (c) datos.cedula = `${c[1].toUpperCase()}-${c[2]}`;
  }

  // Frases sueltas de una sola línea.
  if (lineas.length === 1) {
    const n = normalizar(lineas[0]);
    const ciu = CIUDAD_SUELTA.exec(n);
    if (ciu && !datos.ciudad && !datos.direccion) datos.ciudad = capitalizar(ciu[2]);
    const nom = NOMBRE_SUELTO.exec(n);
    // "soy de Quito" es una ciudad, no un nombre.
    if (nom && !datos.nombre && !datos.ciudad && !/^(de|del|la|el|en)/.test(nom[2]) && !/\d|@/.test(nom[2]) && nom[2].split(' ').length <= 4) {
      datos.nombre = capitalizar(lineas[0].replace(/^(me llamo|mi nombre es|soy|a nombre de)\s+/i, ''));
    }
  }

  // La respuesta a la pregunta pendiente de UN dato: una línea corta, sin
  // signos de pregunta, es ese dato.
  if (pendiente && !datos[pendiente] && lineas.length === 1 && !PREGUNTA.test(original)) {
    const n = normalizar(lineas[0]);
    const pal = n.split(' ').filter(Boolean);
    const soloDigitos = original.replace(/[^\d]/g, '');
    if (pendiente === 'nombre' && pal.length >= 1 && pal.length <= 4 && !/\d|@/.test(n) && !pais.pistasDireccion.test(n) && !SIN_DATO.test(n)) datos.nombre = capitalizar(lineas[0]);
    if (pendiente === 'telefono' && pais.telefonoValido(soloDigitos)) datos.telefono = soloDigitos;
    if (pendiente === 'cedula' && pais.cedulaValida(lineas[0]) && !SIN_DATO.test(n)) datos.cedula = limpiarValor(lineas[0]);
    if (pendiente === 'ciudad' && pal.length >= 1 && pal.length <= 3 && !/\d|@/.test(n) && !SIN_DATO.test(n)) datos.ciudad = capitalizar(lineas[0]);
    if (pendiente === 'direccion' && pal.length >= 2 && !SIN_DATO.test(n)) datos.direccion = lineas[0];
    if (pendiente === 'referencia' && pal.length >= 1 && !SIN_DATO.test(n)) datos.referencia = lineas[0];
  }

  // Una línea con pinta de dirección, sin etiqueta, en un mensaje de varias líneas.
  if (!datos.direccion && lineas.length >= 2) {
    const dir = lineas.find((l) => {
      const n = normalizar(l);
      return pais.pistasDireccion.test(n) && !/[:=]/.test(l) && !/@/.test(l);
    });
    if (dir) datos.direccion = dir;
  }
  // Un nombre suelto en un mensaje de varias líneas: 2-4 palabras sin dígitos,
  // que no sea la dirección.
  if (!datos.nombre && lineas.length >= 2) {
    const nom = lineas.find((l) => {
      const n = normalizar(l);
      const pal = n.split(' ').filter(Boolean);
      return pal.length >= 2 && pal.length <= 4 && !/\d|@/.test(n) && !/[:=?¿!]/.test(l) && !pais.pistasDireccion.test(n) && l !== datos.direccion;
    });
    if (nom) datos.nombre = capitalizar(nom);
  }

  // Validaciones de forma: lo que no cuadra se descarta, no se adivina.
  if (datos.telefono) {
    const d = String(datos.telefono).replace(/[^\d]/g, '');
    if (pais.telefonoValido(d)) datos.telefono = d; else delete datos.telefono;
  }
  if (datos.email && !/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(datos.email)) delete datos.email;
  if (datos.cedula && !pais.cedulaValida(datos.cedula)) delete datos.cedula;
  if (datos.nombre && (/\d|@/.test(datos.nombre) || datos.nombre.split(' ').length > 5)) delete datos.nombre;
  for (const k of Object.keys(datos)) if (!datos[k] || !String(datos[k]).trim()) delete datos[k];
  return datos;
}

/**
 * @param {string} texto       lo que escribió el cliente
 * @param {string|null} pendiente  qué quedó preguntado: 'confirmar' | 'comprar' | una clave de dato | null
 * @param {object} pais        plantilla de país
 */
export function interpretar({ texto, pendiente = null, pais }) {
  const n = normalizar(texto).replace(/\n/g, ' ').trim();
  const porque = [];
  const r = (intencion, datos = {}) => ({ intencion, datos, normalizado: n, porque: [...porque, intencion] });
  if (!n) return r('vacio');

  const rechazaAsesor = /\bno (quiero|necesito|deseo|hace falta)\b.{0,25}\b(asesor|asesora|persona|humano|nadie)\b/.test(n);
  if (ASESOR.test(n) && !rechazaAsesor) return r('asesor');

  const corta = n.split(' ').length <= 9 && !PREGUNTA.test(texto) && !/\d{5,}/.test(n) && !MENCIONA_DATO.test(n)
    && !/\b(pero|cambi\w*|corrig\w*|falta|error|equivocad\w*|otro|otra|mejor|usa|toma|anota)\b/.test(n);

  if (pendiente === 'confirmar' || pendiente === 'comprar') {
    if (AFIRMATIVO.test(n) || (corta && SI_AL_INICIO.test(n) && !/\bno\b/.test(n))) { porque.push(`respuesta a ${pendiente}`); return r('si', { pendiente }); }
    if (NEGATIVO.test(n) || (corta && NO_AL_INICIO.test(n))) { porque.push(`respuesta a ${pendiente}`); return r('no', { pendiente }); }
  }

  // Datos: con etiqueta, inconfundibles, o respuesta a la pregunta de un dato.
  const pendienteDato = pendiente && !['confirmar', 'comprar'].includes(pendiente) ? pendiente : null;
  const datos = extraerDatos(texto, { pais, pendiente: pendienteDato });
  if (Object.keys(datos).length && !PREGUNTA.test(texto)) return r('datos', { datos, sinCorreo: SIN_CORREO.test(n) });
  if (pendienteDato === 'email' && (SIN_CORREO.test(n) || SIN_DATO.test(n))) return r('sin_dato', { clave: 'email' });
  if (pendienteDato && SIN_DATO.test(n)) return r('sin_dato', { clave: pendienteDato });

  if (CONTINUAR_PEDIDO.test(n) && !PREGUNTA.test(texto)) return r('continuar');
  if (COMPRAR.test(n) && !PREGUNTA.test(texto)) return r('comprar');
  if (/\bconfirmo\b|\bconfirmado\b/.test(n) && !PREGUNTA.test(texto)) return r('continuar');

  return r('otro');
}
