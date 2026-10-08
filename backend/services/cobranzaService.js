/**
 * cobranzaService.js — Sincroniza PedidosCobranza con los pagos reales.
 *
 * PedidosCobranza es la vista de cobranza que leen la Caja (pendientes),
 * el portal (badge PAGADO en retiros) y el tótem (decide "pasar por caja").
 * Históricamente NINGÚN flujo de pago la actualizaba: todo quedaba
 * 'Pendiente' para siempre (riesgo de doble cobro, caso DTF-5728).
 *
 * marcarCobranzaPagada se llama desde los caminos vivos que registran pago:
 *   - cajaService.procesarTransaccion (Caja Central + webhooks Handy/MP)
 *   - retiroService.registrarPago (webRetiros)
 * marcarCobranzaPendiente es el inverso, para la anulación de transacciones.
 *
 * Ambas son best-effort: nunca lanzan (un fallo acá no debe tirar el pago).
 */
const { sql } = require('../config/db');
const logger = require('../utils/logger');

// PedidosCobranza.NoDocERP guarda el código base (ej. SUB-4727); en
// OrdenesDeposito el código puede venir con sufijo multiparte (SUB-4727 (2/2)).
// Este fragmento normaliza el código de la orden al código base.
const SQL_CODIGO_BASE = `
    LTRIM(RTRIM(CASE WHEN CHARINDEX(' (', od.OrdCodigoOrden) > 0
        THEN LEFT(od.OrdCodigoOrden, CHARINDEX(' (', od.OrdCodigoOrden) - 1)
        ELSE od.OrdCodigoOrden END))`;

const soloIdsValidos = (ordIds) =>
    (ordIds || []).map(n => parseInt(n, 10)).filter(n => Number.isInteger(n) && n > 0);

const makeRequest = (db) =>
    typeof db.request === 'function' ? db.request() : new sql.Request(db);

// Incidente 07/10/2026: una transacción abierta en PedidosCobranza dejó esperando a este
// UPDATE 120 s en cada cobro; el timeout abortaba la transacción de afuera (caja, webhooks
// MP/Handy) y los pagos quedaban sin registrar. Ahora:
//  - LOCK_TIMEOUT 5 s: si hay bloqueo, el UPDATE se saltea SIN tirar excepción (TRY/CATCH en
//    T-SQL) y la transacción de afuera sigue viva. Vuelve a -1 (default) en el mismo batch
//    porque la conexión vuelve al pool y otra consulta lo heredaría.
//  - Sin funciones sobre las columnas → usa IX_PedidosCobranza_NoDocERP en vez de recorrer la
//    tabla entera (antes cualquier fila bloqueada, de cualquier pedido, lo frenaba).
//    Collation Modern_Spanish_CI_AS: 'Pendiente' = 'PENDIENTE' y el '=' ignora espacios finales
//    (verificado: no hay valores con espacios adelante).
async function updateConEsperaCorta(db, ids, updateSql) {
    const request = makeRequest(db);
    ids.forEach((id, i) => request.input(`oid${i}`, sql.Int, id));
    const inClause = ids.map((_, i) => `@oid${i}`).join(',');

    const res = await request.query(`
        SET LOCK_TIMEOUT 5000;
        DECLARE @n INT = 0, @errNum INT = 0, @errMsg NVARCHAR(4000) = NULL;
        BEGIN TRY
            ${updateSql(inClause)}
            SET @n = @@ROWCOUNT;
        END TRY
        BEGIN CATCH
            SELECT @errNum = ERROR_NUMBER(), @errMsg = ERROR_MESSAGE();
        END CATCH
        SET LOCK_TIMEOUT -1;
        SELECT @n AS Filas, @errNum AS ErrNum, @errMsg AS ErrMsg;
    `);
    return res.recordset[0] || { Filas: 0, ErrNum: 0, ErrMsg: null };
}

const updateCobranza = (estadoNuevo, estadoActual, fechaPago) => (inClause) => `
            UPDATE pc
            SET pc.EstadoCobro = '${estadoNuevo}',
                pc.FechaPago   = ${fechaPago}
            FROM dbo.PedidosCobranza pc
            WHERE pc.EstadoCobro = '${estadoActual}'
              AND pc.NoDocERP IN (
                    SELECT ${SQL_CODIGO_BASE}
                    FROM dbo.OrdenesDeposito od
                    WHERE od.OrdIdOrden IN (${inClause})
              );`;

/**
 * Marca 'Pagado' en PedidosCobranza los pedidos de las OrdenesDeposito dadas.
 * Solo pisa filas en 'Pendiente': no toca los estados del flujo WMS ecommerce
 * (EN_PREPARACION/PREPARADO/ENTREGADO/... de los pedidos VEN-) ni re-pisa Pagado.
 *
 * @param {Transaction|Pool} db  — transacción activa (o pool)
 * @param {Array<number>} ordIds — OrdIdOrden de OrdenesDeposito recién pagadas
 */
async function marcarCobranzaPagada(db, ordIds) {
    const ids = soloIdsValidos(ordIds);
    if (!ids.length) return;

    try {
        const r = await updateConEsperaCorta(db, ids, updateCobranza('Pagado', 'Pendiente', 'GETDATE()'));
        if (r.ErrNum) {
            logger.warn(`[COBRANZA] No se marcó Pagado (órdenes ${ids.join(',')}) — ${r.ErrNum === 1222 ? 'bloqueo > 5 s, se saltea' : `${r.ErrNum}: ${r.ErrMsg}`}`);
        } else if (r.Filas > 0) {
            logger.info(`[COBRANZA] ${r.Filas} pedido(s) marcados Pagado (órdenes: ${ids.join(',')})`);
        }
    } catch (err) {
        logger.error(`[COBRANZA] Error marcando Pagado (órdenes ${ids.join(',')}): ${err.message}`);
    }
}

/**
 * Inverso: al anular un pago, la cobranza vuelve de 'Pagado' a 'Pendiente'.
 * Solo pisa filas en 'Pagado' para no interferir con el flujo WMS.
 */
async function marcarCobranzaPendiente(db, ordIds) {
    const ids = soloIdsValidos(ordIds);
    if (!ids.length) return;

    try {
        const r = await updateConEsperaCorta(db, ids, updateCobranza('Pendiente', 'Pagado', 'NULL'));
        if (r.ErrNum) {
            logger.warn(`[COBRANZA] No se revirtió a Pendiente (órdenes ${ids.join(',')}) — ${r.ErrNum === 1222 ? 'bloqueo > 5 s, se saltea' : `${r.ErrNum}: ${r.ErrMsg}`}`);
        } else if (r.Filas > 0) {
            logger.info(`[COBRANZA] ${r.Filas} pedido(s) revertidos a Pendiente (órdenes: ${ids.join(',')})`);
        }
    } catch (err) {
        logger.error(`[COBRANZA] Error revirtiendo a Pendiente (órdenes ${ids.join(',')}): ${err.message}`);
    }
}

module.exports = { marcarCobranzaPagada, marcarCobranzaPendiente };
