/**
 * Acciones sobre la ORDEN en depósito que comparten la pantalla de auditoría y el Registro de Casos.
 * El cuerpo de ejecutarAccionOrdenes es el código que vivía en auditDepositoController.performAction, movido tal cual
 * (ENTREGADO: estado 9 + retiro entregado + estante liberado + bultos despachados + estado global; A_DEPOSITO: estado 7,
 * retiro pendiente, bultos despachados y auto-aprobación por anticipo). Acepta una transacción externa para que el
 * registro de casos cambie la orden y el caso en una sola transacción.
 */
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { calcularSaldoEfectivo, aplicarAnticipoAOrden } = require('../services/anticipoService');

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * @param {string[]} codigos  códigos de OrdenesDeposito.OrdCodigoOrden
 * @param {'ENTREGADO'|'A_DEPOSITO'} accion
 * @param {number} usuarioId  Usuarios.IdUsuario (sin fallback)
 * @param {object} [userObj]  req.user (para el estado global de la orden de producción)
 * @param {object} [io]       socket.io (opcional)
 * @param {object} [tranExterna] transacción mssql ya abierta: no se abre ni se confirma acá
 */
async function ejecutarAccionOrdenes({ codigos, accion, usuarioId, userObj = null, io = null, tranExterna = null }) {
    if (!Array.isArray(codigos) || codigos.length === 0) throw httpError(400, 'Sin códigos para procesar.');
    if (!usuarioId) throw httpError(401, 'Usuario no identificado.');
    if (!io) io = { emit: () => {} }; // sin socket (scripts / registro de casos) no se emite nada
    const pool = await getPool();
    const tran = tranExterna || pool.transaction();
    if (!tranExterna) await tran.begin();

    try {
      // 9 = Entregado. 
      // 5 = Listo (Pendiente de pago). 8 = Listo (Pagado).
      // Evaluaremos 5 u 8 basado en si PagIdPago est nulo al hacer el UPDATE (mejor slo asignar un estado de depsito acorde).
      const sqlCodes = codigos.map(c => `'${String(c).trim().replace(/'/g, "''")}'`).join(','); // comillas escapadas: los códigos vienen del body

      if (accion === 'ENTREGADO') {
        // OrdenesDeposito -> 9 (Entregado)
        await tran.request().query(`
          UPDATE dbo.OrdenesDeposito
          SET OrdEstadoActual = 9, OrdFechaEstadoActual = GETDATE()
          WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT OrdIdOrden, 9, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        
        // Sincronizar con Estado global en Ordenes
        try {
            const mainOrdersRes = await tran.request().query(`
                SELECT OrdenID FROM Ordenes WITH(NOLOCK) WHERE CodigoOrden IN (${sqlCodes}) OR NoDocERP IN (${sqlCodes})
            `);
            if (mainOrdersRes.recordset.length > 0) {
                const { changeOrderState } = require('../services/stateManagerService');
                for (const row of mainOrdersRes.recordset) {
                    await changeOrderState(tran, {
                        target: { type: 'ORDER', id: row.OrdenID },
                        estado: 'Entregado',
                        userObj: userObj || 'Sistema',
                        detalle: 'Estado global sincronizado (Entregado en depósito)',
                        io
                    });
                }
            }
        } catch (syncErr) {
            console.error('Error sincronizando estado global a Entregado en auditDeposito:', syncErr);
        }

        // OrdenesRetiro -> 5 (Entregado)
        await tran.request().query(`
          UPDATE r
          SET r.OReEstadoActual = 5, r.OReFechaEstadoActual = GETDATE(), r.ORePasarPorCaja = 0
          FROM dbo.OrdenesRetiro r
          INNER JOIN dbo.OrdenesDeposito d ON r.OReIdOrdenRetiro = d.OReIdOrdenRetiro
          WHERE d.OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT DISTINCT d.OReIdOrdenRetiro, 5, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito d
          WHERE d.OrdCodigoOrden IN (${sqlCodes}) AND d.OReIdOrdenRetiro IS NOT NULL
        `);

        // Liberar estantes correspondientes
        await tran.request().query(`
          DELETE FROM dbo.OcupacionEstantes
          WHERE OrdenRetiro IN (
              SELECT DISTINCT COALESCE(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR)
              FROM dbo.OrdenesRetiro r
              INNER JOIN dbo.OrdenesDeposito d ON r.OReIdOrdenRetiro = d.OReIdOrdenRetiro
              WHERE d.OrdCodigoOrden IN (${sqlCodes}) AND d.OReIdOrdenRetiro IS NOT NULL
          )
        `);

        // Marcar bultos como DESPACHADO
        await tran.request().query(`
          UPDATE lb
          SET lb.Estado = 'DESPACHADO'
          FROM dbo.Logistica_Bultos lb
          INNER JOIN dbo.Ordenes o ON o.OrdenID = lb.OrdenID
          WHERE o.CodigoOrden IN (${sqlCodes})
          AND lb.Estado NOT IN ('DESPACHADO', 'PERDIDO')
        `);

        if (!tranExterna) await tran.commit();
        return { message: `${codigos.length} órdenes entregadas con éxito.` };

      } else if (accion === 'A_DEPOSITO') {
        // ── 1. Actualizar OrdenesDeposito → estado 7 ────────────────────────────
        await tran.request().query(`
          UPDATE dbo.OrdenesDeposito
          SET OrdEstadoActual = 7, OrdFechaEstadoActual = GETDATE()
          WHERE OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT OrdIdOrden, 7, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden IN (${sqlCodes})
        `);

        // ── 2. OrdenesRetiro: estado provisional según si ya tenía pago ──────────
        await tran.request().query(`
          UPDATE r
          SET r.OReEstadoActual = CASE WHEN r.PagIdPago IS NOT NULL THEN 8 ELSE 7 END,
              r.OReFechaEstadoActual = GETDATE()
          FROM dbo.OrdenesRetiro r
          INNER JOIN dbo.OrdenesDeposito d ON r.OReIdOrdenRetiro = d.OReIdOrdenRetiro
          WHERE d.OrdCodigoOrden IN (${sqlCodes})
        `);
        await tran.request().query(`
          INSERT INTO dbo.HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
          SELECT DISTINCT d.OReIdOrdenRetiro, CASE WHEN r.PagIdPago IS NOT NULL THEN 8 ELSE 7 END, GETDATE(), ${usuarioId}
          FROM dbo.OrdenesDeposito d
          INNER JOIN dbo.OrdenesRetiro r ON d.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          WHERE d.OrdCodigoOrden IN (${sqlCodes})
        `);

        // Marcar bultos como DESPACHADO al pasar al depósito (salen del área de producción)
        await tran.request().query(`
          UPDATE lb
          SET lb.Estado = 'DESPACHADO'
          FROM dbo.Logistica_Bultos lb
          INNER JOIN dbo.Ordenes o ON o.OrdenID = lb.OrdenID
          WHERE o.CodigoOrden IN (${sqlCodes})
          AND lb.Estado NOT IN ('DESPACHADO', 'PERDIDO')
        `);

        // ── 3. AUTO-APROBACIÓN POR ANTICIPO ─────────────────────────────────────
        // Para cada OrdenRetiro sin pago, verificar si el cliente tiene saldo
        // efectivo suficiente y, de ser así, imputarlo automáticamente.
        const retirosSinPago = await tran.request().query(`
          SELECT DISTINCT
            r.OReIdOrdenRetiro,
            r.OReCostoTotalOrden,
            o.CliIdCliente,
            o.MonIdMoneda
          FROM dbo.OrdenesRetiro r WITH(NOLOCK)
          INNER JOIN dbo.OrdenesDeposito o WITH(NOLOCK)
                  ON o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          WHERE o.OrdCodigoOrden IN (${sqlCodes})
            AND r.PagIdPago IS NULL
            AND (r.ReferenciaPagoOnline IS NULL OR r.ReferenciaPagoOnline != 'ANTICIPO')
            AND o.CliIdCliente IS NOT NULL
        `);

        const resumenAnticipo = { aprobadas: [], pendientesCaja: [] };

        for (const retiro of retirosSinPago.recordset) {
          const { OReIdOrdenRetiro, OReCostoTotalOrden, CliIdCliente, MonIdMoneda } = retiro;
          const monto    = parseFloat(OReCostoTotalOrden) || 0;
          const monedaId = MonIdMoneda || 1;
          if (monto <= 0 || !CliIdCliente) continue;

          try {
            // Calcular saldo efectivo (descontando órdenes ya comprometidas)
            const pool = await getPool();
            const { cuentaId, saldoEfectivo } = await calcularSaldoEfectivo(CliIdCliente, monedaId, pool);

            if (cuentaId && saldoEfectivo >= monto) {
              // ✅ Saldo suficiente → imputar anticipo
              const { pagIdPago } = await aplicarAnticipoAOrden({
                oReId:     OReIdOrdenRetiro,
                cliId:     CliIdCliente,
                cuentaId,
                monto,
                monedaId,
                usuarioId,
                tran,
              });
              resumenAnticipo.aprobadas.push({
                oReId: OReIdOrdenRetiro,
                monto,
                pagIdPago,
                saldoRestante: parseFloat((saldoEfectivo - monto).toFixed(2)),
              });
              logger.info(`[AUDIT-DEPOSITO] ✅ Anticipo auto-aprobado: OReId=${OReIdOrdenRetiro} Monto=${monto} PagId=${pagIdPago}`);
            } else {
              // ❌ Saldo insuficiente → queda en caja
              resumenAnticipo.pendientesCaja.push({
                oReId:            OReIdOrdenRetiro,
                monto,
                saldoDisponible:  parseFloat((saldoEfectivo || 0).toFixed(2)),
                faltante:         parseFloat((monto - (saldoEfectivo || 0)).toFixed(2)),
              });
              // Asegurarse de que ORePasarPorCaja = 1
              await tran.request()
                .input('OReId', sql.Int, OReIdOrdenRetiro)
                .query('UPDATE dbo.OrdenesRetiro SET ORePasarPorCaja = 1 WHERE OReIdOrdenRetiro = @OReId');
            }
          } catch (eAnt) {
            logger.warn(`[AUDIT-DEPOSITO] Error al evaluar anticipo para OReId=${OReIdOrdenRetiro}: ${eAnt.message}`);
            resumenAnticipo.pendientesCaja.push({ oReId: OReIdOrdenRetiro, monto, error: eAnt.message });
          }
        }

        if (!tranExterna) await tran.commit();
        return { message: `${codigos.length} órdenes actualizadas.`, resumenAnticipo };

      } else {
        throw Object.assign(new Error('Acción inválida.'), { status: 400 });
      }
    } catch (txErr) {
      if (!tranExterna) { try { await tran.rollback(); } catch (_) { /* ya cerrada */ } }
      throw txErr;
    }
}

/**
 * "Avisar nuevamente": estado 12 y el cron de WhatsApp reenvía el aviso. NO toca órdenes resueltas (9/10/11):
 * el 26/06/26 este UPDATE sin guard devolvió a la cola ~60 órdenes YA ENTREGADAS. Deja rastro en el historial.
 */
async function avisarNuevamente({ codigos, usuarioId, tranExterna = null }) {
    if (!Array.isArray(codigos) || codigos.length === 0) throw httpError(400, 'Lista de códigos vacía.');
    if (!usuarioId) throw httpError(401, 'Usuario no identificado.');
    const pool = await getPool();
    const req = (tranExterna || pool).request().input('Usr', sql.Int, usuarioId);
    // IN parametrizado: los códigos vienen del body, nunca concatenarlos al SQL.
    const inCodes = codigos.map((c, i) => { req.input(`c${i}`, sql.VarChar(100), String(c).trim()); return `@c${i}`; }).join(',');
    const r = await req.query(`
          DECLARE @cambios TABLE (OrdIdOrden INT, EstadoViejo INT, EstadoNuevo INT);
          
                    UPDATE dbo.OrdenesDeposito
                    SET OrdEstadoActual = 12, OrdFechaEstadoActual = GETDATE()
                    OUTPUT inserted.OrdIdOrden, deleted.OrdEstadoActual, inserted.OrdEstadoActual INTO @cambios
                    WHERE OrdCodigoOrden IN (${inCodes})
                      AND OrdEstadoActual NOT IN (9, 10, 11);
          
                    INSERT INTO dbo.HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                    SELECT OrdIdOrden, EstadoNuevo, GETDATE(), @Usr
                    FROM @cambios WHERE EstadoViejo <> EstadoNuevo;
          SELECT COUNT(*) AS n FROM @cambios;
        `);
    const cambiadas = r.recordset && r.recordset[0] ? r.recordset[0].n : null;
    return { message: `Estado cambiado a 'Avisar nuevamente' para ${codigos.length} órdenes (las entregadas/canceladas no se tocan).`, cambiadas };
}

module.exports = { ejecutarAccionOrdenes, avisarNuevamente };
