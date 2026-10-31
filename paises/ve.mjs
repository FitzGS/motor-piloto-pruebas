// Venezuela: cédula V/E con letra, teléfono 04XX, estado (no provincia),
// y entrega a domicilio solo en algunas ciudades: en el resto, oficina.
import { general } from './general.mjs';

export const ve = {
  ...general,
  codigo: 've',
  divisionLabel: 'estado',
  // 04XX-XXXXXXX ó +58 4XX…; fijos 02XX-XXXXXXX.
  telefono: /(?:\+?58[\s.-]?)?0?4\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b|(?:\+?58[\s.-]?)?0?2\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  telefonoValido: (d) => /^(?:58)?0?[24]\d{9}$/.test(d),
  // V-12345678 · E12345678 · J-123456789. La letra la hace inconfundible.
  cedula: /\b([VvEeJjGg])\s?-?\s?(\d{6,9})\b/,
  cedulaValida: (d) => /^[VEJG]-?\d{6,9}$/i.test(d.replace(/\s/g, '')),
  direccionValida: (t) => /\d/.test(t) || /\b(casa|apto|edif|edificio|torre|piso|quinta|local)\b/i.test(t),
  campos: {
    ...general.campos,
    telefono: { etiqueta: 'Teléfono de contacto', ejemplo: '04141234567' },
    cedula: { etiqueta: 'Cédula', ejemplo: 'V-12345678' },
    direccion: {
      etiqueta: 'Dirección exacta (urbanización, calle, casa o edificio)',
      ejemplo: 'Urb. El Paraíso, calle 3, casa 12',
    },
    ciudad: { etiqueta: 'Ciudad', ejemplo: 'Valencia' },
  },
  pistasDireccion: /\b(av|avenida|calle|urb|urbanizacion|casa|apto|apartamento|edif|edificio|sector|residencias|res|torre|piso|esquina|carrera|manzana|conjunto|quinta|local|km|kilometro|via|callejon|vereda|bloque)\b/,
};

export default ve;
