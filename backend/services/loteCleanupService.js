const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { ESTADOS_AREA_FUERA_DE_LOTE } = require('./stateManagerService');

/**
 * Cierra un lote que quedó sin órdenes ACTIVAS.
 *
 * "Activa" = Estado NOT IN (Finalizado/CANCELADO/Entregado) y EstadoenArea fuera de
 * ESTADOS_AREA_FUERA_DE_LOTE (Pronto, En transito, Recibido en Destino, …). Una orden Retenida
 * (falla pendiente) sigue activa: el lote espera a que vuelva de la reposición.
 *
 * Se corre después de CADA orden que se controla, cancela o finaliza, así que no depende de que
 * el operario tenga el lote seleccionado en Control: en ECOUV se controla orden por orden.
 *
 * Cómo se cierra:
 *  - Con alguna orden no cancelada (el lote se produjo) → 'Finalizado' y bitácora de la máquina
 *    cerrada, como el "finalizar" de la máquina. Conserva MaquinaID para el historial.
 *  - Con todas sus órdenes canceladas → 'Cancelado' y sin máquina (lote que no llegó a producirse).
 * Antes cerraba SIEMPRE como 'Cancelado' y sin cerrar la bitácora: un lote producido entero
 * figuraba cancelado y con la máquina en uso.
 *
 * Correr DESPUÉS del commit de la transacción que cerró la última orden (usa el pool).
 * Es no-op si el lote todavía tiene órdenes vivas o si ya está Finalizado/Cerrado/Cancelado.
 *
 * @param {number|string} rolloId
 * @param {object} [io] - socket.io para emitir lotes:updated
 * @returns {Promise<'finalizado'|'cancelado'|null>} cómo quedó el lote, o null si no se tocó
 */
async function cerrarLoteSiResuelto(rolloId, io) {
    if (!rolloId) return null;
    try {
        const pool = await getPool();
        const res = await pool.request()
            .input('RID', sql.VarChar(50), String(rolloId))
            .query(`
                SELECT
                    SUM(CASE WHEN Estado NOT IN ('Finalizado', 'CANCELADO', 'Entregado')
                              AND ISNULL(EstadoenArea,'') NOT IN ${ESTADOS_AREA_FUERA_DE_LOTE}
                             THEN 1 ELSE 0 END) AS OrdenesActivas,
                    SUM(CASE WHEN Estado <> 'CANCELADO' THEN 1 ELSE 0 END) AS OrdenesNoCanceladas
                FROM dbo.Ordenes
                WHERE CAST(RolloID AS VARCHAR(50)) = @RID
            `);
        if ((res.recordset[0]?.OrdenesActivas || 0) > 0) return null;

        const producido = (res.recordset[0]?.OrdenesNoCanceladas || 0) > 0;
        const upd = await pool.request()
            .input('RID', sql.VarChar(50), String(rolloId))
            .query(producido ? `
                UPDATE dbo.Rollos
                SET Estado = 'Finalizado'
                WHERE CAST(RolloID AS VARCHAR(50)) = @RID
                  AND Estado IN ('Abierto', 'En Cola', 'En maquina', 'Pausado', 'Produccion', 'Imprimiendo');
                IF @@ROWCOUNT > 0
                    UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE()
                    WHERE CAST(RolloID AS VARCHAR(50)) = @RID AND FechaFin IS NULL;
            ` : `
                UPDATE dbo.Rollos
                SET Estado = 'Cancelado', MaquinaID = NULL
                WHERE CAST(RolloID AS VARCHAR(50)) = @RID
                  AND Estado IN ('Abierto', 'En Cola', 'En maquina', 'Pausado', 'Produccion', 'Imprimiendo');
            `);

        // rowsAffected[0] = el UPDATE del lote. 0 si ya estaba Finalizado/Cerrado/Cancelado: no-op.
        if ((upd.rowsAffected[0] || 0) === 0) return null;

        const estado = producido ? 'finalizado' : 'cancelado';
        logger.info(`[loteCleanup] Lote ${rolloId} quedó sin órdenes activas → ${estado} automáticamente.`);
        if (io) io.emit('lotes:updated', { rolloId, action: producido ? 'finished' : 'cancelled' });
        return estado;
    } catch (e) {
        logger.error(`[loteCleanup] Error verificando lote ${rolloId}: ${e.message}`);
        return null;
    }
}

module.exports = { cerrarLoteSiResuelto };
