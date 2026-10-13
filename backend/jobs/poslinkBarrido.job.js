// POSLink — barrido de cobros con tarjeta (docs/poslink-implementacion-plan.md §4.4 c).
// Cada 90 s: polea los cobros que nadie está poleando (se reinició el servidor, se cerró la
// pantalla), cierra los registros que murieron a mitad de camino y, cada 10 min, concilia el
// lote abierto de cada terminal contra lo que el sistema tiene registrado.
// Solo arranca si POSLINK_URL y POSLINK_SYSTEM_ID están en el .env.
// Mismo patrón que solicitudesInsumo.job.js (setTimeout auto-reprogramado + jobRegistry).
const logger = require('../utils/logger');
const ID = 'poslink-barrido';
const INTERVALO_MS = 90 * 1000;

async function run() {
    const { barrido } = require('../services/poslink/poslinkService');
    return barrido();
}

function startPoslinkBarridoJob() {
    const { estaConfigurado } = require('../services/poslink/poslinkClient');
    if (!estaConfigurado()) {
        logger.info(`ℹ️ [${ID}] POSLink no configurado: el barrido no arranca.`);
        return;
    }
    const reg = require('./jobRegistry');
    if (!reg.getAll().some(j => j.id === ID)) {
        reg.registrar(ID, {
            nombre: 'Cobros con tarjeta (POSLink)',
            descripcion: 'Sigue los cobros con tarjeta que quedaron sin resolver, registra los aprobados y concilia el lote de cada terminal.',
            schedule: 'Cada 90 s',
        });
    }
    reg.setFn(ID, run);
    let corriendo = false;
    const ejecutar = async () => {
        if (corriendo) return; // un barrido lento no se pisa con el siguiente
        corriendo = true;
        reg.marcarInicio(ID);
        try { reg.marcarOk(ID, await run()); }
        catch (e) { reg.marcarError(ID, e); logger.error(`[${ID}] ❌ Error:`, e.message); }
        finally { corriendo = false; }
    };
    function programar() {
        reg.setProximaEjecucion(ID, new Date(Date.now() + INTERVALO_MS));
        setTimeout(async () => { await ejecutar(); programar(); }, INTERVALO_MS);
    }
    programar();
    logger.info(`⏱️ [${ID}] Barrido de cobros con tarjeta cada ${INTERVALO_MS / 1000} s.`);
}

module.exports = { run, startPoslinkBarridoJob };
