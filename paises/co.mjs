// Colombia: teléfono 3XXXXXXXXX, cédula de 6 a 10 dígitos, departamento,
// dirección en cuadrícula ("Carrera 15A #23-45").
import { general } from './general.mjs';

export const co = {
  ...general,
  codigo: 'co',
  divisionLabel: 'departamento',
  telefono: /(?:\+?57[\s.-]?)?3\d{2}[\s.-]?\d{3}[\s.-]?\d{4}\b/,
  telefonoValido: (d) => /^(?:57)?3\d{9}$/.test(d),
  cedula: null,
  cedulaValida: (d) => /^\d{6,10}$/.test(d.replace(/\D/g, '')),
  // Sin número específico no se despacha.
  direccionValida: (t) => /\d/.test(t) && /\b(cra|carrera|kr|cl|calle|av|avenida|diagonal|dg|transversal|tv|manzana|mz)\b/i.test(t),
  campos: {
    ...general.campos,
    telefono: { etiqueta: 'Celular de contacto', ejemplo: '3001234567' },
    cedula: { etiqueta: 'Cédula', ejemplo: '1020304050' },
    direccion: {
      etiqueta: 'Dirección exacta (vía, número y complemento)',
      ejemplo: 'Carrera 15A #23-45, apto 302',
    },
    ciudad: { etiqueta: 'Ciudad o municipio', ejemplo: 'Medellín' },
  },
};

export default co;
