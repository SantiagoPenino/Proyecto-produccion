const { syncOrdersLogic }       = require('./controllers/RestSyncController');
const contabilidadReconciliacion = require('./jobs/contabilidadReconciliacionJob');
const { getPool }               = require('./config/db');
const logger                    = require('./utils/logger');
const reg                        = require('./jobs/jobRegistry');

// ─── Registrar todos los jobs conocidos ─────────────────────────────────────
reg.registrar('sync-erp', {
    nombre:      'Sincronización ERP',
    descripcion: 'Trae órdenes nuevas desde el ERP e integra precios y líneas de cobranza.',
    schedule:    'Cada N segundos (configurable en BD)',
});

reg.registrar('reconciliacion-contable', {
    nombre:      'Reconciliación Contable WMS',
    descripcion: 'Detecta y repara órdenes en DEPOSITO sin MontoContabilizado.',
    schedule:    '09:00 y 21:00 hs diarios',
});

reg.registrar('estados-cuenta', {
    nombre:      'Generación Estados de Cuenta',
    descripcion: 'Genera los estados de cuenta semanales para todos los clientes con deuda o ciclo abierto.',
    schedule:    'Viernes a las 00:00 hs',
});

reg.registrar('capacidad-diaria', {
    nombre:      'Snapshot Diario de Capacidad',
    descripcion: 'Guarda la foto de capacidad/backlog (total y urgente) de cada área en HistoricoCapacidadDiaria.',
    schedule:    '06:00 hs diarios',
});

// ─── Función helper para correr con registro ─────────────────────────────────
async function runJob(id, fn) {
    reg.marcarInicio(id);
    try {
        await fn();
        reg.marcarOk(id);
    } catch (e) {
        reg.marcarError(id, e);
        logger.error(`[JOB:${id}] ❌ Error:`, e.message);
    }
}

// ─── Scheduler principal ─────────────────────────────────────────────────────
async function startAutoSync(io) {
    try {
        const pool = await getPool();

        // ── 1. SYNC ERP (intervalo configurable desde BD) ──────────────────
        const res = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'TIEMPOTRAEORDEN'");
        const tiempoStr  = res.recordset[0]?.Valor || '00:00:30';
        const partes     = tiempoStr.split(':').map(Number);
        const intervalMs = ((partes[0] * 3600) + (partes[1] * 60) + partes[2]) * 1000;

        logger.info(`⏱️ [sync-erp] Sincronización cada: ${tiempoStr} (${intervalMs}ms)`);

        const syncFn = () => syncOrdersLogic(io);
        reg.setFn('sync-erp', syncFn);
        checkAndSync(io); // primera ejecución inmediata
        setInterval(() => checkAndSync(io), intervalMs);

        // ── 2. RECONCILIACIÓN CONTABLE — 09:00 y 21:00 ────────────────────
        const reconcFn = () => contabilidadReconciliacion.run();
        reg.setFn('reconciliacion-contable', reconcFn);

        function programarReconciliacion() {
            const ahora = new Date();
            let msHastaProxima = Infinity;
            for (const hora of [9, 21]) {
                const proxima = new Date(ahora);
                proxima.setHours(hora, 0, 0, 0);
                if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
                const diff = proxima - ahora;
                if (diff < msHastaProxima) {
                    msHastaProxima = diff;
                    reg.setProximaEjecucion('reconciliacion-contable', proxima);
                }
            }
            logger.info(`⏱️ [reconciliacion-contable] Próxima en ${Math.round(msHastaProxima / 60000)} min.`);
            setTimeout(async () => {
                await runJob('reconciliacion-contable', reconcFn);
                programarReconciliacion();
            }, msHastaProxima);
        }
        programarReconciliacion();

        // ── 3. ESTADOS DE CUENTA — Viernes 00:00 hs ───────────────────────
        const estadosCuentaBatch = require('./jobs/estadosCuenta.job');
        const estadosFn = () => estadosCuentaBatch.runEstadosCuentaBatch();
        reg.setFn('estados-cuenta', estadosFn);

        function programarEstadosCuenta() {
            const ahora      = new Date();
            const VIERNES    = 5;
            const proxVie    = new Date(ahora);
            const diasHasta  = (VIERNES - ahora.getDay() + 7) % 7 || 7;
            proxVie.setDate(proxVie.getDate() + diasHasta);
            proxVie.setHours(0, 0, 0, 0);

            const msHasta = proxVie - ahora;
            reg.setProximaEjecucion('estados-cuenta', proxVie);
            logger.info(`⏱️ [estados-cuenta] Próxima generación: ${proxVie.toLocaleString('es-UY')} (en ${Math.round(msHasta / 3600000)} hs)`);

            setTimeout(async () => {
                await runJob('estados-cuenta', estadosFn);
                programarEstadosCuenta();
            }, msHasta);
        }
        programarEstadosCuenta();

        // ── 4. SNAPSHOT DIARIO DE CAPACIDAD — 06:00 hs ─────────────────────
        const capacidadDiariaJob = require('./jobs/capacidadDiaria.job');
        const capacidadFn = () => capacidadDiariaJob.capturarSnapshotDiario();
        reg.setFn('capacidad-diaria', capacidadFn);

        function programarCapacidadDiaria() {
            const ahora = new Date();
            const proxima = new Date(ahora);
            proxima.setHours(6, 0, 0, 0);
            if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);

            const msHasta = proxima - ahora;
            reg.setProximaEjecucion('capacidad-diaria', proxima);
            logger.info(`⏱️ [capacidad-diaria] Próxima captura: ${proxima.toLocaleString('es-UY')} (en ${Math.round(msHasta / 60000)} min).`);

            setTimeout(async () => {
                await runJob('capacidad-diaria', capacidadFn);
                programarCapacidadDiaria();
            }, msHasta);
        }
        programarCapacidadDiaria();

    } catch (error) {
        logger.error('❌ Error en startAutoSync:', error.message);
    }
}

// ─── Control de concurrencia para sync ERP ───────────────────────────────────
let isSyncing = false;

async function checkAndSync(io) {
    if (isSyncing) {
        logger.warn('⚠️ [sync-erp] Ciclo omitido: sincronización anterior aún en curso.');
        return;
    }
    isSyncing = true;
    reg.marcarInicio('sync-erp');
    try {
        await syncOrdersLogic(io);
        reg.marcarOk('sync-erp');
    } catch (err) {
        reg.marcarError('sync-erp', err);
        logger.error('⚠️ [sync-erp] Error en ciclo automático:', err.message);
    } finally {
        isSyncing = false;
    }
}

module.exports = { startAutoSync };