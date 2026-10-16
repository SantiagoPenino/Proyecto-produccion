/**
 * deudasVencidas.job.js
 * ────────────────────────────────────────────────────────────────────────────
 * CRON semanal (jueves a la noche) — mantenimiento de deudas y ciclos:
 *   1. Marca como VENCIDO las DeudaDocumento cuyo vencimiento ya pasó.
 *   2. Abre un ciclo a los clientes Semanales que se quedaron sin ciclo abierto.
 *
 * Hasta el 16/10/2026 se llamaba estadosCuenta.job y además armaba la cola de estados de
 * cuenta para mandar por mail (ColaEstadosCuenta). Esa cola nunca se usó (12.652 envíos
 * PENDIENTE, ninguno mandado): se sacó, y quedaron solo estas dos tareas, con el mismo horario.
 *
 * Variables de entorno (.env) — mantienen el nombre viejo para no cambiar el horario de prod:
 *   CONT_ESTADOS_HORA    → hora   (default: "23")
 *   CONT_ESTADOS_MINUTO  → minuto (default: "59")
 *   CONT_ESTADOS_DIA     → día de la semana (default: "4" = jueves)
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const { getPool } = require('../config/db');
const logger      = require('../utils/logger');
const svc         = require('../services/contabilidadService');

const HORA_EJECUCION   = process.env.CONT_ESTADOS_HORA    || '23';
const MINUTO_EJECUCION = process.env.CONT_ESTADOS_MINUTO  || '59';
const DIA_SEMANA       = process.env.CONT_ESTADOS_DIA     || '4'; // 4 = Jueves

/**
 * marcarDeudasVencidas
 * Actualiza a 'VENCIDO' las DeudaDocumento cuya DDeFechaVencimiento ya pasó.
 * Un resto de menos de un centavo no es deuda: no se vence (30/09/2026, 26 deudas "vencidas"
 * por 0,0001–0,0088 con el documento ya cobrado).
 */
async function marcarDeudasVencidas(pool) {
  try {
    const result = await pool.request().query(`
      UPDATE dbo.DeudaDocumento
      SET    DDeEstado = 'VENCIDO'
      WHERE  DDeEstado = 'PENDIENTE'
        AND  DDeImportePendiente >= 0.01
        AND  DDeFechaVencimiento < CAST(GETDATE() AS DATE)
    `);
    if (result.rowsAffected[0] > 0) {
      logger.info(`[DEUDAS-VENCIDAS] ${result.rowsAffected[0]} deuda(s) marcadas como VENCIDO`);
    }
  } catch (err) {
    logger.warn(`[DEUDAS-VENCIDAS] Error marcando deudas vencidas: ${err.message}`);
  }
}

/**
 * asegurarCiclosSemanalesAbiertos
 * Detecta clientes que tienen TipoCliente = 2 (Semanal) pero no tienen
 * un ciclo abierto, y se los abre automáticamente.
 */
async function asegurarCiclosSemanalesAbiertos(pool) {
  try {
    const result = await pool.request().query(`
      SELECT c.CliIdCliente, cc.CueIdCuenta
      FROM dbo.Clientes c WITH(NOLOCK)
      JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CliIdCliente = c.CliIdCliente
      LEFT JOIN dbo.CiclosCredito cic WITH(NOLOCK) ON cic.CueIdCuenta = cc.CueIdCuenta AND cic.CicEstado = 'ABIERTO'
      WHERE c.TClIdTipoCliente = 2
        AND cc.CueActiva = 1
        AND cic.CicIdCiclo IS NULL
        AND cc.CueTipo IN ('UYU', 'USD', 'ARS')
    `);

    const clientes = result.recordset;
    if (clientes.length === 0) return;

    logger.info(`[DEUDAS-VENCIDAS] Detectados ${clientes.length} clientes Semanales sin ciclo abierto. Abriendo automáticamente...`);

    for (const c of clientes) {
      await svc.abrirCicloPorCuenta({ CueIdCuenta: c.CueIdCuenta, CliIdCliente: c.CliIdCliente, UsuarioAlta: 1 });
    }
  } catch (err) {
    logger.warn(`[DEUDAS-VENCIDAS] Error asegurando ciclos semanales: ${err.message}`);
  }
}

function startDeudasVencidasJob() {
  const cron = require('node-cron');

  // Formato: minuto hora diaDelMes mes diaDeLaSemana
  const expresionCron = `${MINUTO_EJECUCION} ${HORA_EJECUCION} * * ${DIA_SEMANA}`;

  cron.schedule(expresionCron, async () => {
    try {
      const pool = await getPool();
      await marcarDeudasVencidas(pool);
      await asegurarCiclosSemanalesAbiertos(pool);
    } catch (err) {
      logger.error(`[DEUDAS-VENCIDAS] ❌ Error: ${err.message}`);
    }
  }, { timezone: 'America/Montevideo' });

  logger.info(`⏱️ [CRON] DeudasVencidas activado: ${expresionCron} (America/Montevideo)`);
}

module.exports = {
  startDeudasVencidasJob,
};
