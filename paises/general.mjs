// Lo que cambia por país y NADA más. El motor común no sabe de países: le
// pregunta a este archivo cómo se llama la división ("provincia"/"estado"),
// cómo luce un teléfono o una cédula, y qué ejemplo dar al pedir cada dato.
// Sin archivo propio, una tienda usa este.

export const general = {
  codigo: 'general',
  divisionLabel: 'provincia o región',
  // Teléfono local: entre 7 y 12 dígitos, con o sin prefijo. Se exige etiqueta
  // o pregunta pendiente para no confundirlo con una cédula.
  telefono: /(?:\+?\d{1,3}[\s.-]?)?\d{7,12}/,
  telefonoValido: (d) => d.length >= 7 && d.length <= 15,
  // Cédula o documento: solo con etiqueta o pregunta pendiente.
  cedula: null,
  cedulaValida: (d) => d.replace(/\D/g, '').length >= 5,
  // Una dirección despachable tiene un número.
  direccionValida: (t) => /\d/.test(t),
  campos: {
    nombre: { etiqueta: 'Nombre y apellido', ejemplo: 'Ana Pérez' },
    telefono: { etiqueta: 'Teléfono de contacto', ejemplo: null },
    cedula: { etiqueta: 'Cédula o documento', ejemplo: null },
    email: { etiqueta: 'Correo electrónico', ejemplo: 'ana@correo.com' },
    direccion: { etiqueta: 'Dirección exacta (calle y número)', ejemplo: 'Calle 5 #12-34, apto 201' },
    ciudad: { etiqueta: 'Ciudad', ejemplo: null },
    referencia: { etiqueta: 'Punto de referencia', ejemplo: 'frente al parque' },
  },
  // Palabras que delatan una dirección escrita suelta, sin etiqueta.
  pistasDireccion: /\b(av|avenida|calle|cl|cra|carrera|kr|transversal|diagonal|mz|manzana|lote|casa|apto|apartamento|edif|edificio|piso|torre|sector|barrio|urb|urbanizacion|conjunto|km|kilometro|via|pasaje|esquina|numero|n°|#)\b/,
};

export default general;
