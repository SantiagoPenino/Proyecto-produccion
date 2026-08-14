const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');
const { calcularSituacion, upsertSnapshotDiario } = require('../controllers/planificacionController');

// Guarda, una vez por día, la foto de capacidad/backlog de cada área en
// HistoricoCapacidadDiaria — para poder ver la tendencia (¿el backlog crece o baja día a día?)
// en vez de perder el dato apenas cambia. Corre para todas las áreas que tengan al menos una
// máquina con Velocidad Real cargada (Configuración → Equipos); las que no, se saltean solas
// (calcularSituacion devuelve tieneCapacidad:false y upsertSnapshotDiario no escribe nada).
async function capturarSnapshotDiario() {
    const pool = await getPool();
    const hoy = new Date().toISOString().slice(0, 10);

    const areasRes = await pool.request()
        .query("SELECT DISTINCT AreaID FROM dbo.ConfigEquipos WHERE Activo = 1 AND VelocidadValor IS NOT NULL");
    const areas = areasRes.recordset.map(r => r.AreaID);

    logger.info(`[capacidad-diaria] Capturando snapshot de ${hoy} para ${areas.length} área(s): ${areas.join(', ')}`);

    for (const area of areas) {
        try {
            const situacion = await calcularSituacion(pool, area, { desde: hoy, dias: 1 });
            if (!situacion.tieneCapacidad) continue;
            await upsertSnapshotDiario(pool, area, hoy, situacion);
            logger.info(`[capacidad-diaria] ${area}: capacidad=${situacion.capacidadDiaHoy} ${situacion.unidad}, pendiente=${situacion.cargaPendienteTotal} (urgente ${situacion.cargaPendienteUrgente})`);
        } catch (e) {
            logger.error(`[capacidad-diaria] Error en área ${area}:`, e.message);
        }
    }
}

module.exports = { capturarSnapshotDiario };
