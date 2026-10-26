// Ciclo en planta (26/10/2026, plan INF-SIS-2026-04): cada 10 minutos calcula el ciclo de las órdenes que pasaron a
// Pronto (horas laborales de su área desde que entraron, sin la espera del cliente) y lo guarda en
// dbo.OrdenesCicloPlanta. La primera corrida calcula todo desde el 01/07/2026. Reglas en services/cicloPlantaService.js.
// Mismo patrón que consultasVencimiento.job.js (node-cron + jobRegistry).
'use strict';

const { getPool } = require('../config/db');
const logger = require('../utils/logger');

const CADA_MINUTOS = 10;
const JOB_ID = 'ciclo-planta';

/** @returns {Promise<string>} resumen para la tarjeta de /admin/cron */
async function run() {
    const svc = require('../services/cicloPlantaService');
    const r = await svc.procesarPendientes(await getPool());
    if (r.sinTabla) return 'Falta la tabla OrdenesCicloPlanta (backend/scripts/PROD_ordenes_ciclo_planta.sql).';
    if (!r.calculadas && !r.borradas) return 'Sin órdenes nuevas.';
    const msg = `${r.calculadas} orden(es) calculada(s)${r.borradas ? ` · ${r.borradas} quitada(s) (canceladas o sin Pronto)` : ''}`;
    logger.info(`[${JOB_ID}] ${msg}`);
    return msg;
}

function startCicloPlantaJob() {
    const cron = require('node-cron');
    const reg = require('./jobRegistry');

    if (!reg.getAll().some(j => j.id === JOB_ID)) {
        reg.registrar(JOB_ID, {
            nombre: 'Ciclo en planta',
            descripcion: 'Calcula el ciclo de cada orden que pasa a Pronto: las horas laborales de su área (Horario laboral, sin feriados) desde que entró hasta que quedó pronta, sin contar la espera del cliente. Con eso sale el tiempo de respuesta que muestra cada área.',
            schedule: `Cada ${CADA_MINUTOS} minutos`,
        });
    }
    reg.setFn(JOB_ID, run);

    const ejecutar = async () => {
        reg.marcarInicio(JOB_ID);
        try { reg.marcarOk(JOB_ID, await run()); }
        catch (e) { reg.marcarError(JOB_ID, e); logger.error(`[${JOB_ID}] ❌ Error: ${e.message}`); }
        reg.setProximaEjecucion(JOB_ID, new Date(Date.now() + CADA_MINUTOS * 60000));
    };

    cron.schedule(`*/${CADA_MINUTOS} * * * *`, ejecutar, { timezone: 'America/Montevideo' });
    reg.setProximaEjecucion(JOB_ID, new Date(Date.now() + CADA_MINUTOS * 60000));
    logger.info(`⏱️ [CRON] Ciclo en planta activado: cada ${CADA_MINUTOS} min.`);
}

module.exports = { run, startCicloPlantaJob };
