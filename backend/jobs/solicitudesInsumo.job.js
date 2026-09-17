// Spec 39 — Solicitudes de insumo del cliente: una vez por día, las que vencieron sin respuesta
// (NUEVA / NOTIFICADA con Vencimiento pasado) pasan a SIN_RESPUESTA para que Administración las
// resuelva. Mismo patrón que cuadreSaldos.job.js (setTimeout auto-reprogramado + jobRegistry).
const logger = require('../utils/logger');
const HORA = 7, MINUTO = 0;
const ID = 'solicitudes-insumo-vencidas';

async function run() {
    const ctrl = require('../controllers/solicitudesInsumoController');
    const ids = await ctrl.marcarVencidas();
    const msg = ids.length ? `${ids.length} solicitud(es) pasaron a SIN_RESPUESTA: #${ids.join(', #')}` : 'Sin solicitudes vencidas';
    logger.info(`[${ID}] ${msg}`);
    return msg;
}

function startSolicitudesInsumoJob() {
    const reg = require('./jobRegistry');
    if (!reg.getAll().some(j => j.id === ID)) {
        reg.registrar(ID, {
            nombre: 'Solicitudes de insumo vencidas',
            descripcion: 'Marca SIN_RESPUESTA las solicitudes de insumo del cliente que pasaron el plazo (PLAZO_SOLICITUD_INSUMO_DIAS) sin decisión.',
            schedule: `${String(HORA).padStart(2, '0')}:${String(MINUTO).padStart(2, '0')} hs diarios`,
        });
    }
    reg.setFn(ID, run);
    const ejecutar = async () => {
        reg.marcarInicio(ID);
        try { reg.marcarOk(ID, await run()); }
        catch (e) { reg.marcarError(ID, e); logger.error(`[${ID}] ❌ Error:`, e.message); }
    };
    function programar() {
        const ahora = new Date();
        const proxima = new Date(ahora);
        proxima.setHours(HORA, MINUTO, 0, 0);
        if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
        const ms = proxima - ahora;
        reg.setProximaEjecucion(ID, proxima);
        logger.info(`⏱️ [${ID}] Próxima corrida ${proxima.toLocaleString('es-UY')} (en ${Math.round(ms / 60000)} min).`);
        setTimeout(async () => { await ejecutar(); programar(); }, ms);
    }
    programar();
}

module.exports = { run, startSolicitudesInsumoJob };
