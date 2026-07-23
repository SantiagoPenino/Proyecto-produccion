/**
 * Nombre visible del tipo de documento — ÚNICA fuente de verdad.
 *
 * Antes esto estaba duplicado en la bandeja CFE, en el generador de PDF (dos veces) y
 * en el de Excel, cada copia con su propio criterio: la misma nota de crédito salía
 * "E-Ticket NC" en pantalla y "E-Ticket Nota De Cre" en el PDF. Todo lo que muestre un
 * tipo de documento tiene que importar de acá.
 *
 * Ojo con el dato crudo: DocumentosContables.DocTipo es varchar(20) y viene TRUNCADO
 * ("E-Ticket Nota De Credito" se guarda como "E-Ticket Nota De Cre"), así que nunca
 * sirve como rótulo y las comparaciones tienen que tolerar el corte.
 */

// Rótulo del borrador de caja. En la base el DocTipo sigue siendo 'Pedidos Caja': el
// rename real (base + comparaciones) está planificado en docs/PLAN_rename_pedido_caja.md
export const ETIQUETA_BORRADOR = 'Borrador de Factura';

const MAP = {
    // Códigos numéricos DGI
    '07': 'E-Ticket NC',       '08': 'E-Ticket Crédito',
    '10': 'E-Ticket NC',       '01': 'E-Ticket Contado',
    '02': 'E-Factura Crédito', '04': 'E-Factura NC',
    '11': 'E-Ticket ND',       '06': 'E-Factura ND',
    '107': 'E-Ticket Contado', '108': 'E-Ticket Crédito',
    '101': 'E-Factura Contado', '102': 'E-Factura Crédito',
    // Borrador de caja (todas sus formas)
    '40': ETIQUETA_BORRADOR,
    'PedidoCaja': ETIQUETA_BORRADOR,
    'PC': ETIQUETA_BORRADOR,
    'Pedidos Caja': ETIQUETA_BORRADOR,
    'PEDIDO_CAJA': ETIQUETA_BORRADOR,
    'Borrador Factura': ETIQUETA_BORRADOR,
    // Otros tipos
    'FACTURA': 'E-Factura Crédito', 'E-TICKET': 'E-Ticket Contado',
    'FACTURA_CICLO': 'Edo. Cuenta',
    'NOTA_CREDITO': 'E-Ticket NC', 'NOTA_DEBITO': 'E-Ticket ND',
    // Valores tal cual vienen de Config_TiposDocumento.Detalle
    'E-Ticket Contado': 'E-Ticket Contado',
    'E-Ticket Credito': 'E-Ticket Crédito',
    'E-Ticket Crédito': 'E-Ticket Crédito',
    'E-Ticket Nota De Credito': 'E-Ticket NC',
    'E-Ticket Nota De Crédito': 'E-Ticket NC',
    'E-Factura Nota De Credito': 'E-Factura NC',
    'E-Factura Nota De Crédito': 'E-Factura NC',
    'E-Factura Contado': 'E-Factura Contado',
    'E-Factura Credito': 'E-Factura Crédito',
    'E-Factura Crédito': 'E-Factura Crédito',
    // Comprobante del sistema anterior, cargado como referencia de una NC externa
    'E-Ticket Externo': 'E-Ticket Externo',
    'E-Factura Externa': 'E-Factura Externa',
    'E-Ticket Nota De Deb': 'E-Ticket ND',
    'E-Factura Nota De Deb': 'E-Factura ND',
    'Nota de Credito': 'E-Ticket NC',
    'Nota de Crédito': 'E-Ticket NC',
    'Nota de Debito': 'E-Ticket ND',
    'Nota de Débito': 'E-Ticket ND',
};

/**
 * @param {string} tipo  DocTipo del documento (o su código)
 * @param {string} vacio qué devolver si no hay tipo ('—' en pantalla, 'e-Factura' en PDF)
 */
export function getTipoDocName(tipo, vacio = '—') {
    if (!tipo) return vacio;
    const k = String(tipo).trim();
    if (MAP[k]) return MAP[k];

    // Fallback tolerante al truncado de varchar(20)
    const tl = k.toLowerCase();
    if (tl.includes('nota de cre') || tl.includes('nota de cr')) {
        return tl.includes('factura') ? 'E-Factura NC' : 'E-Ticket NC';
    }
    if (tl.includes('nota de deb') || tl.includes('nota de d')) {
        return tl.includes('factura') ? 'E-Factura ND' : 'E-Ticket ND';
    }
    if (tl.includes('pedido') || tl.includes('borrador')) return ETIQUETA_BORRADOR;
    if (tl.includes('e-ticket') || tl.includes('eticket')) {
        return (tl.includes('cred') || tl.includes('créd')) ? 'E-Ticket Crédito' : 'E-Ticket Contado';
    }
    if (tl.includes('e-factura') || tl.includes('efactura')) {
        return (tl.includes('cred') || tl.includes('créd')) ? 'E-Factura Crédito' : 'E-Factura Contado';
    }
    return k;
}
