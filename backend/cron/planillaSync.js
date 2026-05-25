const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const axios = require('axios');
const cron = require('node-cron');
const { getPool, sql } = require('../config/db');
const { isProcessActive, updateProcessLog } = require('../controllers/configuracionesController');
const logger = require('../utils/logger');

// --- CONFIGURACIÓN ---
const PLANILLA_URL = process.env.PLANILLA_SCRIPT_URL;
const RUN_EVERY_X_MINUTES = 5;

// --- FUNCIÓN DE SINCRONIZACIÓN ---
async function syncPlanillaArea(areaId, procesoID) {
    // 1. CHEQUEO DINÁMICO DESDE BASE DE DATOS
    const isActive = await isProcessActive(procesoID);
    if (!isActive) {
        // Silencioso para no saturar logs si está desactivado a propósito
        return;
    }

    logger.info(`[PlanillaSync-${areaId}] Iniciando sincronización a las ${new Date().toLocaleTimeString()}...`);

    if (!PLANILLA_URL) {
        logger.warn(`[PlanillaSync-${areaId}] No hay URL configurada en .env (PLANILLA_SCRIPT_URL). Omitiendo.`);
        return;
    }

    try {
        // 2. OBTENER FILAS NUEVAS APUNTANDO AL SCRIPT, con parametro 'area' y un Timeout explícito de 30s
        const res = await axios.get(`${PLANILLA_URL}?area=${areaId}`, { timeout: 60000 }); // 60 segundos
        const data = res.data;

        // DEBUG: VER QUÉ RESPONDE LA PLANILLA
        // logger.info(`[PlanillaSync-${areaId} DEBUG] Respuesta:`, JSON.stringify(data).substring(0, 200) + "...");

        if (data.status === "NO_NEW_DATA" || data.status === "NO_DATA") {
            return;
        }

        if (data.status === "OK" && data.data && data.data.length > 0) {
            logger.info(`[PlanillaSync-${areaId}] Recibidos ${data.data.length} pedidos nuevos.`);

            // 3. PROCESAR CADA PEDIDO
            for (const pedido of data.data) {
                try {
                    // LLAMADA LOCAL A LA API DE INTEGRACIÓN con Timeout de 30s
                    const port = process.env.PORT || 5000;
                    await axios.post(`http://localhost:${port}/api/web-orders/integration/create`, pedido, {
                        headers: { 'x-api-key': process.env.INTEGRATION_API_KEY || 'macrosoft-secret-key' },
                        timeout: 30000
                    });

                    logger.info(`✅ [PlanillaSync-${areaId}] Pedido fila ${pedido.rowNumber} creado OK.`);

                } catch (errPedido) {
                    logger.error(`❌ [PlanillaSync-${areaId}] Error fila ${pedido.rowNumber}:`, errPedido.response?.data || errPedido.message);
                }
            }

            logger.info(`[PlanillaSync-${areaId}] Lote procesado. Última fila: ${data.processedUntil}`);
            await updateProcessLog(procesoID, 'OK', `Recibidos y procesados ${data.data.length} pedidos. Última fila: ${data.processedUntil}`);
        } else {
            // Actializar la ultima ejecucion igual aunque no haya datos nuevos (Para saber que sí corrió)
            await updateProcessLog(procesoID, 'OK', 'Planilla consultada. Sin datos nuevos.');
        }

    } catch (error) {
        logger.error(`[PlanillaSync-${areaId}] Error de conexión:`, error.message);
        await updateProcessLog(procesoID, 'ERROR', `Error conexión: ${error.message}`);
    }
}

async function syncAllPlanillas() {
    // Al usar Promise.all, Node dispara las dos tareas exactamente al mismo tiempo
    await Promise.all([
        syncPlanillaArea('DF', 'SYNC_PLANILLA_SHEETS_DF'),
        syncPlanillaArea('SB', 'SYNC_PLANILLA_SHEETS_SUB')
    ]);
}
// --- ACTIVAR CRON ---
// Se ejecuta cada 5 minutos
cron.schedule(`*/${RUN_EVERY_X_MINUTES} * * * *`, () => {
    // Wrap in setImmediate to avoid blocking node-cron's internal timing loop
    setImmediate(() => {
        syncAllPlanillas().catch(err => logger.error("Cron Error Error:", err));
    });
});

// Ejecutar INMEDIATAMENTE al iniciar (tras 5s de espera para DB)
setTimeout(() => {
    logger.info("[PlanillaSync] Ejecutando sincronización inicial...");
    syncAllPlanillas().catch(err => logger.error(err));
}, 5000);

logger.info(`[PlanillaSync] Cron cargado (Intervalo: ${RUN_EVERY_X_MINUTES}m). La activación depende de ConfiguracionesSync en DB.`);

module.exports = { syncAllPlanillas };
