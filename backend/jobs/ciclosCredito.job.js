/**
 * ciclosCredito.job.js
 * ──────────────────────────────────────────────────────────────────────────────
 * CRON que se ejecuta diariamente (por defecto a las 23:55 hs) y:
 *   1. Detecta ciclos ABIERTOS cuya fecha de cierre pasó → los marca VENCIDO
 *   2. Los cierra completamente (calcula totales, genera DocumentoContable)
 *   3. Abre el ciclo siguiente automáticamente
 *
 * Variables de entorno:
 *   CICLOS_CRON_HORA   → hora de ejecución en formato "HH:MM" (default: 23:55)
 *   CICLOS_CRON_ENABLE → "1" para habilitar (default: "1")
 * ──────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const cron   = require('node-cron');
const logger = require('../utils/logger');

let _cronTask = null;

/**
 * parsearHora
 * Convierte "23:55" → { hora: 23, minuto: 55 }
 */
function parsearHora(horaStr = '23:55') {
  const [h, m] = horaStr.split(':').map(Number);
  return { hora: isNaN(h) ? 23 : h, minuto: isNaN(m) ? 55 : m };
}

/**
 * ejecutarCierreCiclos
 * Lógica principal: delega en contabilidadService.cerrarCiclosVencidos
 */
async function ejecutarCierreCiclos() {
  // DESACTIVADO: El cierre de ciclos se hace manualmente desde la UI
  logger.info('[CICLOS-CRON] ℹ️ Cierre automático DESACTIVADO. Use la UI para cerrar ciclos manualmente.');
  return { procesados: 0, errores: 0 };
}

/**
 * iniciarCronCiclos
 * Registra la tarea CRON según la configuración.
 * Si ya existe una tarea, la detiene y reemplaza.
 */
async function iniciarCronCiclos() {
  // Verificar si está habilitado
  const habilitado = (process.env.CICLOS_CRON_ENABLE ?? '1') === '1';
  if (!habilitado) {
    logger.info('[CICLOS-CRON] Deshabilitado por variable de entorno.');
    return;
  }

  // Intentar leer hora desde ConfiguracionGlobal
  let horaStr = process.env.CICLOS_CRON_HORA || '23:55';
  try {
    const { getPool } = require('../config/db');
    const pool = await getPool();
    const res  = await pool.request().query(`
      SELECT Valor FROM ConfiguracionGlobal WITH(NOLOCK) WHERE Clave = 'CICLOS_CRON_HORA'
    `);
    if (res.recordset.length && res.recordset[0].Valor) {
      horaStr = res.recordset[0].Valor;
    }
  } catch {
    // Fallback a la variable de entorno o default
  }

  const { hora, minuto } = parsearHora(horaStr);
  const expresionCron = `${minuto} ${hora} * * *`;

  logger.info(`[CICLOS-CRON] Programado para las ${hora}:${String(minuto).padStart(2,'0')} hs (cron: "${expresionCron}")`);

  if (_cronTask) {
    _cronTask.stop();
    _cronTask = null;
  }

  _cronTask = cron.schedule(expresionCron, async () => {
    logger.info('[CICLOS-CRON] ⏰ Disparando cierre automático de ciclos...');
    await ejecutarCierreCiclos();
  }, {
    timezone: 'America/Montevideo',
  });

  logger.info('[CICLOS-CRON] ✅ CRON registrado.');
}

/**
 * detenerCronCiclos
 * Detiene la tarea CRON activa (útil para tests o reinicio).
 */
function detenerCronCiclos() {
  if (_cronTask) {
    _cronTask.stop();
    _cronTask = null;
    logger.info('[CICLOS-CRON] Detenido.');
  }
}

module.exports = {
  iniciarCronCiclos,
  detenerCronCiclos,
  ejecutarCierreCiclos,  // exportado para uso manual / tests
};
