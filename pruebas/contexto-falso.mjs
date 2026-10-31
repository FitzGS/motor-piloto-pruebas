// Un `contexto` del contrato, armado a mano para el banco de pruebas. Imita lo
// que manda la plataforma: system prompt con las frases que el motor lee,
// historial cliente/vendedor/herramientas, borrador y herramientas activas.

export const HERRAMIENTAS = [
  'search_products', 'send_product_card', 'add_to_cart', 'set_cart_quantity', 'remove_from_cart',
  'set_customer_info', 'confirm_order', 'clear_cart', 'get_customer_orders', 'get_shipping_options',
  'list_payment_methods', 'transfer_to_agent',
].map((name) => ({ type: 'function', function: { name, parameters: { type: 'object', properties: {} } } }));

/** El trozo del prompt de la plataforma que el motor lee. */
export function systemFalso({ pais = 'EC', campos = null, yaPedidos = [], oficina = null, contraentrega = false } = {}) {
  const lista = campos || [
    ['Nombre y apellido', true], ['Teléfono de contacto', true], ['Cédula / documento', false],
    ['Dirección exacta (sector, calle y número)', true], ['Ciudad', true], ['Punto de referencia', false],
  ];
  const lineas = [
    '# Eres Carolina, asesora de ventas de Tienda Falsa.',
    `La tienda opera en ${pais}.`,
    '### Recoger los datos del pedido',
    '```',
    'Para despacharlo necesito:',
    ...lista.map(([l]) => `📍 ${l}${l.startsWith('Dirección') && oficina ? ` — o dime si prefieres RETIRAR en una oficina de ${oficina} y te paso las de tu ciudad` : ''}`),
    '```',
    ...(yaPedidos.length ? [`- ⛔ **YA PEDISTE ${yaPedidos.join(', ')} en este chat y el cliente no lo dio. NO lo vuelvas a pedir.**`] : []),
    '- **Datos que tienes que recoger** (pide el que el cliente no haya dado):',
    ...lista.map(([l, ob]) => `   - **${l}** — ${ob ? '**OBLIGATORIO** (sin esto NO cierres el pedido)' : 'opcional (si no lo da tras 1 intento, sigue sin él)'}. Descripción.`),
    ...(contraentrega ? ['- **Se paga CONTRAENTREGA**: el cliente paga en efectivo al mensajero cuando recibe el producto, NO antes.'] : []),
    '## ESTADO ACTUAL DEL CARRITO (sincronizado server-side)',
  ];
  return lineas.join('\n');
}

export function borradorFalso(extra = {}) {
  return {
    stage: 'cart',
    items: [{ productSlug: 'combo-ligas', productName: 'Combo de ligas', variantSlug: 'unica', variantLabel: 'Único', quantity: 2, unitPrice: 19.99, lineTotal: 39.99, offerLabel: '2 por $39,99', productId: 'x', productCharacteristicId: 'y' }],
    customerName: null, customerAddress: null, customerEmail: null, customerIdentification: null, customerPhone: null,
    customerCity: null, customerState: null, customerReference: null, oficinaRetiro: null,
    customerLat: null, customerLng: null, geoSugerida: null, shippingCost: 0, lastPedidoNumber: null, lastPedidoLabel: null,
    ...extra,
  };
}

const cliente = (t) => ({ role: 'user', content: t });
const vendedor = (t) => ({ role: 'assistant', content: t });
const llamada = (nombre, argumentos, id = 'call_1') => ({ role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: nombre, arguments: JSON.stringify(argumentos) } }] });
const resultado = (obj, id = 'call_1') => ({ role: 'tool', tool_call_id: id, content: JSON.stringify(obj) });

export const m = { cliente, vendedor, llamada, resultado };

export function contextoFalso({ tipo = 'venta', borrador = {}, historial = [], system = {}, herramientas = HERRAMIENTAS, resultadoModelo = null } = {}) {
  return {
    protocolo: 1,
    tipo,
    borrador: borradorFalso(borrador),
    mensajes: [{ role: 'system', content: systemFalso(system) }, ...historial],
    herramientas,
    resultadoModelo,
  };
}
