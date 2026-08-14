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

/**
 * @param {number|null} docId  Documento a clasificar. `null` = todas las líneas
 *   que hayan quedado sin área (para flujos que crean varios documentos en la
 *   misma operación, como el cobro de deuda que factura pedido por pedido).
 * @param {object|null} transaction  Transacción abierta, si el llamador tiene una.
 */
const estamparAreaLineas = async (docId = null, transaction = null) => {
    try {
        const request = transaction
            ? new sql.Request(transaction)
            : (await getPool()).request();
        await request
            .input('DocIdDocumento', sql.Int, docId || null)
            .execute('dbo.SP_EstamparAreaLineasDocumento');
        return true;
    } catch (err) {
        // No propaga: el área es un dato de reporte, no puede tumbar una venta.
        logger.warn(`[AREA-LINEA] No se pudo estampar el área ${docId ? 'del documento ' + docId : '(pendientes)'}: ${err.message}`);
        return false;
    }
};

/** Corre la clasificación sobre TODAS las líneas que quedaron sin área. */
const estamparAreaPendientes = async () => {
    try {
        const pool = await getPool();
        await pool.request().execute('dbo.SP_EstamparAreaLineasDocumento');
        return true;
    } catch (err) {
        logger.warn(`[AREA-LINEA] Backfill de áreas pendientes falló: ${err.message}`);
        return false;
    }
};

module.exports = { estamparAreaLineas, estamparAreaPendientes };
