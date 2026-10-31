// Ecuador: teléfono 09…, cédula de 10 dígitos, provincia, dirección con
// calle principal, numeración y calle secundaria ("X y Y").
import { general } from './general.mjs';

export const ec = {
  ...general,
  codigo: 'ec',
  divisionLabel: 'provincia',
  // 09XXXXXXXX ó +593 9XXXXXXXX. Fijos 0[2-7]XXXXXXX.
  telefono: /(?:\+?593[\s.-]?)?0?9\d{8}\b|\b0[2-7]\d{7}\b/,
  telefonoValido: (d) => /^(?:593)?0?9\d{8}$/.test(d) || /^0[2-7]\d{7}$/.test(d),
  // 10 dígitos. ⚠️ Guayas es la provincia 09: una cédula puede empezar por 09
  // igual que un celular, así que la cédula solo se toma con etiqueta o con
  // la pregunta pendiente, nunca suelta.
  cedula: null,
  cedulaValida: (d) => /^\d{10}$/.test(d.replace(/\D/g, '')),
  direccionValida: (t) => /\d/.test(t),
  campos: {
    ...general.campos,
    telefono: { etiqueta: 'Teléfono de contacto', ejemplo: '0987593542' },
    cedula: { etiqueta: 'Cédula', ejemplo: '1705401592' },
    direccion: {
      etiqueta: 'Dirección exacta (sector, calle y número)',
      ejemplo: 'La Floresta, Carlos Montúfar E13-361 y El Monitor',
    },
    ciudad: { etiqueta: 'Ciudad', ejemplo: 'Quito' },
  },
};

export default ec;
