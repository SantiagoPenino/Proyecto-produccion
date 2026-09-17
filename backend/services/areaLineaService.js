'use strict';
/**
 * areaLineaService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Estampa el ÁREA (y la variante y el artículo) en las líneas de un documento
 * contable, para que la venta sepa a qué área/sector pertenece sin tener que
 * adivinarlo al leer.
 *
 * Se llama DESPUÉS de crear las líneas del documento, una sola vez por
 * documento. Toda la lógica vive en dbo.SP_EstamparAreaLineasDocumento
 * (add_SP_EstamparAreaLineas.sql), que aplica la cascada:
 *   1. La ORDEN    → Ordenes.AreaID (+ variante + artículo)
 *   2. El ARTÍCULO → ArticuloClasificacion (venta de mostrador sin orden)
 *   3. El PREFIJO  → compatibilidad con códigos sueltos ('DTF', 'SUB')
 * Solo completa las líneas con área NULL: es idempotente, se puede reintentar.
 *
 * NUNCA rompe el flujo que lo llama: si el SP no existe todavía (deploy previo
 * al SQL) o falla, se loguea y sigue — el documento ya está bien creado, el
 * área es un dato de reporte que se puede recuperar después corriendo el SP
 * sin parámetros.
 */

const sql = require('mssql');
const { getPool } = require('../config/db');
const logger = require('../utils/logger');

const ejecutarSP = async (docId) => {
    try {
        await (await getPool()).request()
            .input('DocIdDocumento', sql.Int, docId || null)
            .execute('dbo.SP_EstamparAreaLineasDocumento');
        return true;
    } catch (err) {
        // No propaga: el área es un dato de reporte, no puede tumbar una venta.
        logger.warn(`[AREA-LINEA] No se pudo estampar el área ${docId ? 'del documento ' + docId : '(pendientes)'}: ${err.message}`);
        return false;
    }
};

// Transacción → documentos que esperan su commit para estamparse (null = todas las pendientes).
const pendientesPorTransaccion = new WeakMap();

/**
 * @param {number|null} docId  Documento a clasificar. `null` = todas las líneas
 *   que hayan quedado sin área (para flujos que crean varios documentos en la
 *   misma operación, como el cobro de deuda que factura pedido por pedido).
 * @param {object|null} transaction  Transacción abierta, si el llamador tiene una.
 *
 * Con transacción, el SP NO corre adentro: queda anotado y corre recién cuando la
 * transacción confirma. Adentro causaba los deadlock 1205 al editar comprobantes
 * (16/09/2026): para encontrar las líneas sin área el SP recorre TODAS las pendientes,
 * incluidas las recién insertadas por otras transacciones todavía abiertas, así que dos
 * operaciones simultáneas (editar un comprobante y un cobro de caja) quedaban esperando
 * cada una las líneas de la otra. Si la transacción se revierte no corre nada, que es lo
 * correcto: no quedaron líneas. Si el SP falla después del commit, las líneas quedan sin
 * área y las completa la próxima llamada sin documento (todo cobro de caja la hace).
 */
const estamparAreaLineas = async (docId = null, transaction = null) => {
    // Sin transacción, o con una que ya terminó o no empezó, se corre en el momento.
    // `_acquiredConnection` es interno de mssql 9: vive entre begin y commit/rollback.
    // Si una versión futura lo quita, esto cae en correr afuera de la transacción, que
    // igual es seguro (espera a que la transacción del llamador confirme).
    if (!transaction || !transaction._acquiredConnection) return ejecutarSP(docId);

    let pendientes = pendientesPorTransaccion.get(transaction);
    if (!pendientes) {
        pendientes = new Set();
        pendientesPorTransaccion.set(transaction, pendientes);
        transaction.once('commit', () => {
            // Una llamada sin documento ya cubre todas las líneas pendientes.
            const docs = pendientes.has(null) ? [null] : [...pendientes];
            // En serie: así no compiten entre ellas por las mismas líneas.
            (async () => { for (const d of docs) await ejecutarSP(d); })();
        });
    }
    pendientes.add(docId || null);
    return true;
};

/** Corre la clasificación sobre TODAS las líneas que quedaron sin área. */
const estamparAreaPendientes = () => ejecutarSP(null);

module.exports = { estamparAreaLineas, estamparAreaPendientes };
