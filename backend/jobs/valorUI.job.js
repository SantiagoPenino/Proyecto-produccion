const logger = require('../utils/logger');
const { actualizarValorUI } = require('../services/valorUIService');

// Valor de la UI para el tope del e-Ticket (ver services/valorUIService): la del 31/12 del año
// anterior, del BCU. Cambia una vez por año, así que al arrancar y dos veces por día solo se fija
// si ya está guardada la de esa fecha; el BCU se consulta únicamente cuando falta (el 1/1, o si
// la vez anterior no contestó).
function startValorUIJob() {
    const cron = require('node-cron');
    const correr = () => actualizarValorUI()
        .catch(err => logger.warn(`[VALOR UI] No se pudo traer la UI del BCU (queda el valor anterior): ${err.message}`));

    setTimeout(correr, 20000);
    cron.schedule('20 0 * * *', correr, { timezone: 'America/Montevideo' });
    cron.schedule('25 9 * * *', correr, { timezone: 'America/Montevideo' });

    logger.info('⏱️ [CRON] Valor de la UI (BCU): Activado (al arrancar, 00:20 y 09:25).');
}

module.exports = { startValorUIJob };
