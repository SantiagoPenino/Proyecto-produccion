/**
 * LIMPIEZA DE ÓRDENES ZOMBIE ('Cargando...')
 * ──────────────────────────────────────────────────────────────────────────
 * Un pedido web nace en Estado 'Cargando...' y se activa cuando terminan de
 * subir sus archivos. Si el cliente abandona (cierra el navegador, se corta
 * la subida), la orden queda zombie para siempre. Este job la CANCELA
 * automáticamente cuando lleva más de ZOMBIE_CARGANDO_MAX_MIN minutos
 * (default 30) sin actividad — no se borra nada: queda en historial como
 * Cancelado con el motivo en DetallesCancelacion.
 *
 * Protecciones:
 *  - NO toca pedidos de diseñador retenidos (AprobacionPendiente = 1): esos
 *    viven en 'Cargando...' a propósito hasta que el cliente los aprueba (F4).
 *  - "Sin actividad" = tampoco completó NINGÚN archivo en la ventana
 *    (ArchivosOrden.FechaSubida se actualiza al terminar cada subida), así una
 *    orden que sigue subiendo archivos grandes no se cancela a mitad de camino.
 *  - Devuelve los metros de Tela de Cliente consumidos (helper idempotente).
 *  - Re-chequea el estado DENTRO de la transacción (UPDLOCK) por si la orden
 *    se activó justo en el medio.
 */
const cron = require('node-cron');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { devolverMetrosTelaCliente } = require('../utils/telaClienteDevolucion');
const { changeOrderState } = require('../services/stateManagerService');

const MAX_MIN = parseInt(process.env.ZOMBIE_CARGANDO_MAX_MIN || '30', 10);

async function limpiarOrdenesCargando(io) {
    const pool = await getPool();

    // La columna F4 puede no existir aún en esta base — filtrar solo si existe
    const colRes = await pool.request().query("SELECT COL_LENGTH('dbo.Ordenes','AprobacionPendiente') AS L");
    const filtroAprob = colRes.recordset[0]?.L ? 'AND ISNULL(o.AprobacionPendiente, 0) = 0' : '';

    const cand = await pool.request()
        .input('Min', sql.Int, MAX_MIN)
        .query(`
            SELECT o.OrdenID, o.CodigoOrden
            FROM dbo.Ordenes o WITH (NOLOCK)
            WHERE o.Estado = 'Cargando...'
              AND o.FechaIngreso < DATEADD(MINUTE, -@Min, GETDATE())
              ${filtroAprob}
              AND NOT EXISTS (
                  SELECT 1 FROM dbo.ArchivosOrden ao WITH (NOLOCK)
                  WHERE ao.OrdenID = o.OrdenID
                    AND ao.FechaSubida > DATEADD(MINUTE, -@Min, GETDATE())
              )
        `);
    if (!cand.recordset.length) return 0;

    // Lo que ve el CLIENTE en el portal (DetallesCancelacion) vs el detalle técnico (Observaciones/historial)
    const razonCliente = 'No se completó la subida';
    const razonTecnica = `Cancelada automáticamente: superó los ${MAX_MIN} min en 'Cargando...' sin completar la subida`;
    let canceladas = 0;

    for (const ord of cand.recordset) {
        const tx = new sql.Transaction(pool);
        try {
            await tx.begin();

            // Re-chequear estado con lock: si se activó (o la retuvieron) mientras corría el job, saltearla
            const chk = await new sql.Request(tx)
                .input('OID', sql.Int, ord.OrdenID)
                .query("SELECT Estado FROM dbo.Ordenes WITH (UPDLOCK, ROWLOCK) WHERE OrdenID = @OID AND Estado = 'Cargando...'");
            if (!chk.recordset.length) {
                await tx.rollback();
                continue;
            }

            // Tela de Cliente: devolver lo consumido (idempotente, no-op si no consumió)
            await devolverMetrosTelaCliente(tx, ord.OrdenID, `Devolución por cancelación automática Orden ${ord.OrdenID}`, 1);

            // Motivo + archivos cancelados (mismo criterio que cancelOrder)
            await new sql.Request(tx)
                .input('OID', sql.Int, ord.OrdenID)
                .input('DetCli', sql.NVarChar(300), razonCliente)
                .input('DetTec', sql.NVarChar(300), razonTecnica)
                .query(`
                    UPDATE dbo.Ordenes
                    SET Observaciones = CONCAT(ISNULL(Observaciones,''), ' [', @DetTec, ']'),
                        DetallesCancelacion = @DetCli
                    WHERE OrdenID = @OID;

                    UPDATE dbo.ArchivosOrden
                    SET EstadoArchivo = 'CANCELADO',
                        Observaciones = CONCAT(ISNULL(Observaciones,''), ' [ORDEN CANCELADA AUTO]')
                    WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO';
                `);

            // Estado + historial vía servicio central (guarda extra por las dudas)
            await changeOrderState(tx, {
                target : { type: 'ORDER', id: ord.OrdenID },
                estado : 'Cancelado',
                userObj: 'Sistema',
                detalle: razonTecnica,
                guard  : "Estado = 'Cargando...'",
                io,
            });

            await tx.commit();
            canceladas++;
            logger.info(`🧹 [ZombieCleanup] Orden ${ord.CodigoOrden} (ID ${ord.OrdenID}) CANCELADA: +${MAX_MIN} min en 'Cargando...' sin actividad.`);
        } catch (e) {
            try { await tx.rollback(); } catch (_) { /* noop */ }
            logger.error(`[ZombieCleanup] Error cancelando orden ${ord.OrdenID}: ${e.message}`);
        }
    }

    if (canceladas > 0 && io) {
        io.emit('server:ordersUpdated', { count: canceladas, source: 'zombie-cleanup' });
    }
    return canceladas;
}

function startZombieCleanupJob(io) {
    // Cada 10 minutos; el umbral de antigüedad lo da ZOMBIE_CARGANDO_MAX_MIN (default 30)
    cron.schedule('*/10 * * * *', () => {
        limpiarOrdenesCargando(io).catch(e => logger.error('[ZombieCleanup] Error del job:', e.message));
    });
    logger.info(`⏱️ [CRON] Cancelación de órdenes 'Cargando...' > ${MAX_MIN} min ACTIVADA (corre cada 10 min).`);
}

module.exports = { startZombieCleanupJob, limpiarOrdenesCargando };
