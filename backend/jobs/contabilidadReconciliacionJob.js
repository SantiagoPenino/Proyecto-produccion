/**
 * contabilidadReconciliacionJob.js
 * 
 * Job automático que detecta y repara órdenes en DEPOSITO sin contabilizar.
 * Se registra en scheduler.js para correr periódicamente.
 * 
 * LÓGICA:
 *   - Busca en OrdenesDeposito donde MontoContabilizado IS NULL
 *   - Re-ejecuta el motor contable para cada una encontrada
 *   - Registra resultado en logs para trazabilidad
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const contabilidadService = require('../services/contabilidadService');

let isRunning = false;

async function run() {
    if (isRunning) {
        logger.warn('[ReconciliacionCtb] Job anterior aún en curso, omitiendo ciclo.');
        return;
    }
    isRunning = true;

    try {
        const pool = await getPool();

        // Detectar inconsistencias: en depósito pero sin contabilizar
        const res = await pool.request().query(`
            SELECT 
                od.OrdCodigoOrden      AS CodigoOrden,
                pc.ID                  AS PCId,
                pc.MontoTotal,
                pc.Moneda,
                o.OrdenID,
                o.CliIdCliente,
                o.DescripcionTrabajo
            FROM OrdenesDeposito od
            INNER JOIN PedidosCobranza pc 
                ON LTRIM(RTRIM(pc.NoDocERP)) = LTRIM(RTRIM(od.OrdCodigoOrden))
            INNER JOIN Ordenes o 
                ON LTRIM(RTRIM(o.NoDocERP)) = LTRIM(RTRIM(pc.NoDocERP))
            WHERE od.OrdEstadoActual = 1
              AND pc.MontoContabilizado IS NULL
            ORDER BY od.OrdFechaIngresoOrden ASC
        `);

        const rows = res.recordset;

        if (rows.length === 0) {
            // Todo OK, no loguear para no saturar
            return;
        }

        logger.warn(`[ReconciliacionCtb] ⚠️  ${rows.length} orden(es) sin contabilizar detectadas. Iniciando reparación...`);

        let reparadas = 0;
        let fallidas = 0;

        for (const row of rows) {
            const tag = `[ReconciliacionCtb] [${row.CodigoOrden}]`;
            try {
                // Obtener detalles de cobranza
                const detRes = await pool.request()
                    .input('PID', sql.Int, row.PCId)
                    .query('SELECT Cantidad, Subtotal AS TotalLinea, ProIdProducto AS IDProdReact FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID');

                const detalles = detRes.recordset;
                if (detalles.length === 0) {
                    logger.warn(`${tag} Sin detalles en PedidosCobranzaDetalle, no se puede reparar.`);
                    fallidas++;
                    continue;
                }

                const totalMetros = detalles.reduce((acc, d) => acc + (parseFloat(d.Cantidad) || 0), 0);
                const currentMonto = parseFloat(row.MontoTotal) || 0;
                const finalMonId = row.Moneda === 'USD' ? 2 : 1;

                for (const d of detalles) {
                    const lineImp = parseFloat(d.TotalLinea) || 0;
                    const lineQty = parseFloat(d.Cantidad) || 0;

                    // Verificar plan activo
                    let planMetrosDisp = 0;
                    let planIdCtb = null;
                    if (d.IDProdReact && row.CliIdCliente) {
                         const planRes = await pool.request()
                             .input('Cli', sql.Int, row.CliIdCliente)
                             .input('Pro', sql.Int, d.IDProdReact)
                             .query(`SELECT TOP 1 pm.PlaIdPlan,
                                          ISNULL(pm.PlaCantidadTotal, 0) - ISNULL(pm.PlaCantidadUsada, 0) AS MetrosDisponibles
                                      FROM dbo.PlanesMetros pm WITH(NOLOCK)
                                      WHERE pm.CliIdCliente = @Cli 
                                        AND pm.PlaActivo = 1
                                        AND (pm.PlaFechaVencimiento IS NULL OR pm.PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                                        AND (
                                          pm.ProIdProducto = @Pro
                                          OR EXISTS (
                                            SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                                            WHERE pap.PlaIdPlan = pm.PlaIdPlan
                                              AND pap.ProIdProducto = @Pro
                                          )
                                        )
                                      ORDER BY pm.PlaFechaVencimiento ASC`);
                        if (planRes.recordset.length > 0) {
                            planMetrosDisp = parseFloat(planRes.recordset[0].MetrosDisponibles) || 0;
                            planIdCtb = planRes.recordset[0].PlaIdPlan;
                        }
                    }

                    const hayPlan = planIdCtb !== null && planMetrosDisp > 0;

                    if (hayPlan && lineQty <= planMetrosDisp) {
                        await contabilidadService.procesarEventoContable('ENTREGA', {
                            OrdIdOrden: row.OrdenID, CliIdCliente: row.CliIdCliente,
                            Cantidad: lineQty, Importe: 0,
                            CodigoOrden: row.CodigoOrden, NombreTrabajo: `[AUTO-REPAIR] ${row.DescripcionTrabajo}`,
                            UsuarioAlta: 1, MonIdMoneda: finalMonId
                        });
                    } else if (hayPlan && planMetrosDisp > 0 && lineQty > planMetrosDisp) {
                        const metrosRest = lineQty - planMetrosDisp;
                        const importeExc = parseFloat((lineImp * (metrosRest / lineQty)).toFixed(2));
                        await contabilidadService.procesarEventoContable('ENTREGA', {
                            OrdIdOrden: row.OrdenID, CliIdCliente: row.CliIdCliente,
                            Cantidad: planMetrosDisp, Importe: 0,
                            CodigoOrden: row.CodigoOrden, NombreTrabajo: `[AUTO-REPAIR-PREPAGO] ${row.DescripcionTrabajo}`,
                            UsuarioAlta: 1, MonIdMoneda: finalMonId
                        });
                        if (importeExc > 0 || metrosRest > 0) {
                            await contabilidadService.procesarEventoContable('ORDEN', {
                                OrdIdOrden: row.OrdenID, CliIdCliente: row.CliIdCliente,
                                Cantidad: metrosRest, Importe: importeExc,
                                CodigoOrden: row.CodigoOrden, NombreTrabajo: `[AUTO-REPAIR-EXC] ${row.DescripcionTrabajo}`,
                                UsuarioAlta: 1, MonIdMoneda: finalMonId
                            });
                        }
                    } else if (lineImp > 0) {
                        await contabilidadService.procesarEventoContable('ORDEN', {
                            OrdIdOrden: row.OrdenID, CliIdCliente: row.CliIdCliente,
                            Cantidad: lineQty, Importe: lineImp,
                            CodigoOrden: row.CodigoOrden, NombreTrabajo: `[AUTO-REPAIR] ${row.DescripcionTrabajo}`,
                            UsuarioAlta: 1, MonIdMoneda: finalMonId
                        });
                    }
                }

                // Marca como contabilizada
                await pool.request()
                    .input('M',   sql.Decimal(18, 2), currentMonto)
                    .input('Met', sql.Decimal(18, 2), totalMetros)
                    .input('PID', sql.Int, row.PCId)
                    .query('UPDATE PedidosCobranza SET MontoContabilizado = @M, MetrosContabilizados = @Met WHERE ID = @PID');

                logger.info(`${tag} ✅ Reparada exitosamente (monto=$${currentMonto}, metros=${totalMetros})`);
                reparadas++;

            } catch (err) {
                logger.error(`${tag} ❌ Falló la reparación automática:`, err.message);
                fallidas++;
            }
        }

        logger.warn(`[ReconciliacionCtb] Ciclo finalizado — Reparadas: ${reparadas} | Fallidas: ${fallidas}`);

    } catch (err) {
        logger.error('[ReconciliacionCtb] Error general en job:', err.message);
    } finally {
        isRunning = false;
    }
}

module.exports = { run };
