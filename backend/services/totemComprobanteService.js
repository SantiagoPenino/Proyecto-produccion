'use strict';
/**
 * e-Ticket de los cobros del tótem (INF-SIS-2026-18).
 *
 *  · Se manda solo a DGI apenas queda registrado el cobro (POS o MercadoPago): el tótem lo imprime
 *    con QR y CAE. Si SISNET falla, el documento queda PENDIENTE en la Bandeja CFE, como siempre.
 *  · Todo PDF de un comprobante pagado en el tótem sale en 80 mm: getDetalleFactura le suma
 *    `DeTotem` (esComprobanteDeTotem) y el front elige el formato con eso.
 *
 * Un documento es «del tótem» si salió de:
 *  · un cobro con el POS de un tótem: PosTransacciones VENTA con PtxTerminalTipo 'TOTEM' y la misma
 *    transacción de caja (PtxTcaIdTransaccion = TcaIdTransaccion del documento);
 *  · un pago de MercadoPago hecho desde el tótem: la transacción de caja dice «Cobro MercadoPago (Tx: X)»
 *    y MercadoPagoTransactions X tiene OrdersJson.type = 'totem-mp' (lo arma totemMpService).
 * Las notas de crédito (DocIdDocumentoRef) nunca: las hace Finanzas desde la caja.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const LOG = '[TÓTEM CFE]';

/** Manda el documento a DGI sin frenar a quien llama (el registro del cobro ya terminó). */
function emitirEnSegundoPlano(docId, contexto) {
    if (!docId) return;
    setImmediate(async () => {
        try {
            const pos = require('./poslink/poslinkService');
            const { emitirDocumento } = require('../controllers/cfeController');
            // Mismo camino que la Bandeja (enviarADGI): si el cobro reservó número, se emite con ese.
            const reserva = await pos.caeReservadoDeDocumento(docId);
            const r = await emitirDocumento(docId, { wsCAE: reserva?.wsCAE || null });
            if (reserva) await pos.marcarCaeUsado(reserva.ptxId, Number(docId));
            logger.info(`${LOG} ${contexto}: doc ${docId} aceptado por DGI (${r.numeroOficial}).`);
        } catch (e) {
            logger.warn(`${LOG} ${contexto}: el doc ${docId} no se pudo mandar a DGI (${e.message}). Queda en la Bandeja CFE para mandarlo desde ahí.`);
        }
    });
}

/** Documento del cobro de un tótem con POS (la fila de PosTransacciones ya REGISTRADA). */
async function documentoDeCobroPos(pool, fila) {
    if (!fila?.PtxTcaIdTransaccion) return null;
    const r = await pool.request().input('T', sql.Int, fila.PtxTcaIdTransaccion).query(`
        SELECT TOP 1 DocIdDocumento FROM dbo.DocumentosContables WITH(NOLOCK)
        WHERE TcaIdTransaccion = @T AND DocIdDocumentoRef IS NULL AND CfeEstado IS NOT NULL
        ORDER BY DocIdDocumento`);
    return r.recordset[0]?.DocIdDocumento || null;
}

/**
 * Lo llama poslinkService al registrar un cobro: si es una venta de tótem, manda su e-Ticket a DGI.
 * La factura con número reservado (rebaja de IVA) la emite emitirFacturaReservada: acá no se toca.
 */
async function alRegistrarCobroPos(pool, fila) {
    if (fila?.PteTipo !== 'TOTEM' || fila.PtxTipo !== 'VENTA') return;
    if (fila.PtxCaeJson && fila.PtxCaeEstado === 'RESERVADO') return;
    const docId = await documentoDeCobroPos(pool, fila);
    if (!docId) {
        logger.warn(`${LOG} Cobro #${fila.PtxId} del tótem registrado sin documento fiscal: no hay e-Ticket que mandar.`);
        return;
    }
    await pool.request().input('Id', sql.BigInt, fila.PtxId).input('Doc', sql.Int, docId)
        .query('UPDATE dbo.PosTransacciones SET PtxDocIdDocumento = @Doc WHERE PtxId = @Id AND PtxDocIdDocumento IS NULL');
    emitirEnSegundoPlano(docId, `Cobro POS #${fila.PtxId} (${fila.PteEtiqueta})`);
}

/** Lo llama el aviso de MercadoPago al registrar un pago: si se pagó desde el tótem, manda su e-Ticket. */
function alRegistrarPagoMp(storedData, docIdDocumento, txId) {
    if (storedData?.type !== 'totem-mp' || !docIdDocumento) return;
    emitirEnSegundoPlano(docIdDocumento, `Pago MercadoPago del tótem ${txId}`);
}

/** ¿El documento se pagó en el tótem? `doc` trae DocIdDocumento, TcaIdTransaccion y DocIdDocumentoRef. */
async function esComprobanteDeTotem(pool, doc) {
    if (!doc?.TcaIdTransaccion || doc.DocIdDocumentoRef) return false;
    // POS: la tabla existe solo donde se instaló POSLink.
    const hayPos = (await pool.request().query(`SELECT COL_LENGTH('dbo.PosTransacciones', 'PtxTerminalTipo') AS c`)).recordset[0].c != null;
    if (hayPos) {
        const p = await pool.request().input('T', sql.Int, doc.TcaIdTransaccion).query(`
            SELECT TOP 1 1 AS si FROM dbo.PosTransacciones p WITH(NOLOCK)
            LEFT JOIN dbo.PosTerminales t WITH(NOLOCK) ON t.PteIdTerminal = p.PtxIdTerminal
            WHERE p.PtxTcaIdTransaccion = @T AND p.PtxTipo = 'VENTA'
              AND COALESCE(p.PtxTerminalTipo, t.PteTipo) = 'TOTEM'`);
        if (p.recordset.length) return true;
    }
    // MercadoPago: el TransactionId está en las observaciones de la transacción de caja.
    const t = await pool.request().input('T', sql.Int, doc.TcaIdTransaccion)
        .query('SELECT TcaObservaciones FROM dbo.TransaccionesCaja WITH(NOLOCK) WHERE TcaIdTransaccion = @T');
    const m = String(t.recordset[0]?.TcaObservaciones || '').match(/^Cobro MercadoPago \(Tx: ([^)]+)\)/);
    if (!m) return false;
    const mp = await pool.request().input('Tx', sql.VarChar(100), m[1])
        .query('SELECT OrdersJson FROM dbo.MercadoPagoTransactions WITH(NOLOCK) WHERE TransactionId = @Tx');
    let datos = {};
    try { datos = JSON.parse(mp.recordset[0]?.OrdersJson || '{}'); } catch (e) { datos = {}; }
    return datos.type === 'totem-mp';
}

// Lo que el tótem necesita para imprimir el e-Ticket: lo mismo que lee el A4 (pdfGenerator), sin pagos,
// imputaciones ni el mail del cliente.
const CAMPOS_TICKET = [
    'DocIdDocumento', 'DocTipo', 'DocSerie', 'DocNumero', 'DocPagado', 'DocFechaEmision', 'MonIdMoneda',
    'DocSubtotal', 'DocImpuestos', 'DocTotal', 'DocObservaciones', 'DocDiasVencimiento',
    'DocCliNombre', 'DocCliNombreFantasia', 'DocCliDireccion', 'DocCliCiudad', 'DocCliDocumento',
    'CliIdCliente', 'CliRUT', 'CliRazonSocial', 'CliNombreFantasia', 'StringIDCliente', 'CliTelefono', 'CliFamilia',
    'CfeEstado', 'CfeNumeroOficial', 'CfeCAE', 'CfeUrlImpresion', 'CodigoEfact',
    'SecNroResolucion', 'SecRangoDesde', 'SecRangoHasta', 'SecFechaVencimientoCAE', 'CfeUrlVerificacion', 'CfeTextoIvaDia',
    'EmpRuc', 'EmpRazonSocial', 'EmpNombreFantasia', 'EmpDireccion', 'EmpCiudad', 'EmpTelefono', 'EmpLogoUrl',
    'VendedorNombre', 'VendedorId', 'DocTotalUnidades', 'DeTotem',
];

/** El detalle del documento como lo arma la Bandeja (getDetalleFactura), recortado para el ticket. */
async function datosParaTicket(docId) {
    const { getDetalleFactura } = require('../controllers/cfeController');
    const out = await new Promise((resolve) => {
        const fakeRes = { code: 200, status(c) { this.code = c; return this; }, json(o) { resolve({ code: this.code, ...o }); } };
        getDetalleFactura({ params: { id: docId } }, fakeRes);
    });
    if (out.code !== 200 || !out.doc) throw new Error(out.error || 'No se pudo leer el comprobante.');
    const doc = {};
    for (const k of CAMPOS_TICKET) if (out.doc[k] !== undefined) doc[k] = out.doc[k];
    return { doc, detalles: out.detalles || [] };
}

/**
 * Estado del e-Ticket de un documento para el tótem: { listo: false } mientras DGI no lo aceptó;
 * { listo: true, doc, detalles } cuando ya tiene CAE; { listo: false, sinComprobante: true } si el
 * cobro no generó documento fiscal.
 */
async function eTicketParaTotem(pool, docId) {
    if (!docId) return { listo: false, sinComprobante: true };
    const r = await pool.request().input('D', sql.Int, docId)
        .query('SELECT CfeEstado FROM dbo.DocumentosContables WITH(NOLOCK) WHERE DocIdDocumento = @D');
    if (r.recordset[0]?.CfeEstado !== 'ACEPTADO_DGI') return { listo: false };
    return { listo: true, ...(await datosParaTicket(docId)) };
}

/** e-Ticket de un cobro con POS de tótem (fila de PosTransacciones). */
async function eTicketDeCobroPos(fila) {
    const pool = await getPool();
    return eTicketParaTotem(pool, fila.PtxDocIdDocumento || await documentoDeCobroPos(pool, fila));
}

/** e-Ticket de un pago de MercadoPago del tótem; null si el TransactionId no es un pago del tótem. */
async function eTicketDePagoMp(transactionId) {
    const pool = await getPool();
    const t = await pool.request().input('Tx', sql.VarChar(100), String(transactionId))
        .query('SELECT OrdersJson FROM dbo.MercadoPagoTransactions WITH(NOLOCK) WHERE TransactionId = @Tx');
    if (!t.recordset.length) return null;
    let datos = {};
    try { datos = JSON.parse(t.recordset[0].OrdersJson || '{}'); } catch (e) { datos = {}; }
    if (datos.type !== 'totem-mp') return null;
    const d = await pool.request().input('Patron', sql.NVarChar(200), `Cobro MercadoPago (Tx: ${transactionId})%`).query(`
        SELECT TOP 1 dc.DocIdDocumento
        FROM dbo.TransaccionesCaja tc WITH(NOLOCK)
        JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.TcaIdTransaccion = tc.TcaIdTransaccion
        WHERE tc.TcaObservaciones LIKE @Patron AND dc.DocIdDocumentoRef IS NULL AND dc.CfeEstado IS NOT NULL
        ORDER BY dc.DocIdDocumento`);
    return eTicketParaTotem(pool, d.recordset[0]?.DocIdDocumento || null);
}

module.exports = {
    alRegistrarCobroPos,
    alRegistrarPagoMp,
    esComprobanteDeTotem,
    eTicketDeCobroPos,
    eTicketDePagoMp,
};
