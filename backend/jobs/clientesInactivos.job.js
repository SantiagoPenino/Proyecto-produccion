// Clientes inactivos (23/10/2026): una vez por día, el cliente con más de 60 días sin pedidos ni compras queda
// INACTIVO y sin vendedor, y el INACTIVO que volvió a comprar pasa a ACTIVO. Reglas y fuentes de la actividad en
// services/clientesInactivosService.js. Mismo patrón que solicitudesInsumo.job.js (setTimeout + jobRegistry).
const logger = require('../utils/logger');
const HORA = 5, MINUTO = 0;
const ID = 'clientes-inactivos';

async function run() {
    const svc = require('../services/clientesInactivosService');
    const { inactivados, reactivados } = await svc.procesar();
    const msg = (inactivados || reactivados)
        ? `${inactivados} cliente(s) pasaron a INACTIVO sin vendedor · ${reactivados} volvieron a ACTIVO`
        : 'Sin cambios';
    logger.info(`[${ID}] ${msg}`);
    return msg;
}

function startClientesInactivosJob() {
    const reg = require('./jobRegistry');
    if (!reg.getAll().some(j => j.id === ID)) {
        reg.registrar(ID, {
            nombre: 'Clientes inactivos',
            descripcion: 'Marca INACTIVO y sin vendedor al cliente con más de 60 días sin pedidos ni compras (órdenes, depósito, salón y documentos de venta). El INACTIVO que vuelve a comprar pasa a ACTIVO. BLOQUEADO no se toca. Cada cambio queda en ClientesInactividadLog con el vendedor anterior.',
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

module.exports = { run, startClientesInactivosJob };
