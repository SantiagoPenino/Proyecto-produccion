/**
 * Descripción corta de una línea de factura para el papel (PDF).
 *
 * El texto guardado en DocumentosContablesDetalle.DcdDscItem lo arma el resolvedor de
 * líneas con etiquetas que en el papel solo ocupan lugar: "Orden: DTF-20703 (ck) - Retiro
 * RW-26043". Acá se sacan las palabras "Orden:" y "Retiro" (y "Retiro diferido", que
 * mandan los webhooks) dejando el código de la orden, el trabajo y el número de retiro:
 * "DTF-20703 (ck) RW-26043". No toca la base: es solo presentación, así los documentos
 * ya emitidos se reimprimen igual que los nuevos.
 *
 * Tercera línea con el nombre del cliente: cuando el cobro sale de la caja de mostrador,
 * el carrito manda el retiro como un ítem cuya descripción (TransaccionDetalle.TdeDescripcion)
 * es el NOMBRE DEL CLIENTE. El resolvedor (contabilidadCore.resolverLineasDetalle) solo usa
 * ese texto como último recurso, cuando no encuentra la línea del pedido — y no la
 * encuentra porque cruza LEFT(OrdCodigoOrden) ("DTF-20703") contra PedidosCobranza.NoDocERP
 * ("20703"): con prefijo nunca coinciden. Por eso el nombre del cliente termina pegado en
 * la descripción. Se saca al imprimir comparándolo con los nombres del documento
 * (`nombresCliente`); cualquier otro texto se respeta.
 */
const normalizar = (s) => String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function descripcionLineaCorta(dscItem, nombresCliente = []) {
    if (!dscItem) return '';
    const nombres = (Array.isArray(nombresCliente) ? nombresCliente : [nombresCliente])
        .map(normalizar)
        .filter(Boolean);
    return String(dscItem)
        .split(/\r?\n/)
        .map(l => l
            .replace(/^\s*Orden:\s*/i, '')
            .replace(/\s*-\s*Retiro\s+(RW-\d+)/i, ' $1')
            .replace(/^\s*Retiro\s+diferido\s+(RW-\d+)/i, '$1')
            .replace(/^\s*Retiro\s+(RW-\d+)/i, '$1')
            .trim())
        .filter(Boolean)
        .filter(l => !nombres.includes(normalizar(l)))
        .join('\n');
}
