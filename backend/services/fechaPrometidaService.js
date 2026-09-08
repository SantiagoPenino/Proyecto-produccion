// =============================================================================
// Servicio único para poner las DOS fechas de una orden nueva, en este orden
// (pedido explícito del usuario 8-sep-2026):
//
//   1) FechaEstimadaEntrega — el PLAN fijo del área (ej. "DTF = 2 días"),
//      vía sp_CalcularFechaEntrega. No mira carga de trabajo, solo el
//      horario laboral y los feriados (ya corregido para no caer en
//      fin de semana en el caso "mismo día").
//
//   2) FechaCompromiso — la promesa REAL, mirando la agenda/cola de ese
//      área (cuánto trabajo hay adelante, capacidad diaria real). Puede
//      ser más larga que el plan si hay volumen (ej. plan 2 días, pero
//      con la cola llena la agenda da 3 o 4). NUNCA es más corta que el
//      plan, aunque la cola esté vacía — eso es una regla de negocio
//      confirmada por el usuario, no un límite técnico del motor de agenda.
//
// Si el área todavía no tiene la velocidad de sus máquinas cargada en
// Configuración → Equipos (hoy: Impresión Directa, Corte, Costura), el motor
// de agenda no puede proyectar nada — en ese caso FechaCompromiso queda
// igual al plan (FechaEstimadaEntrega), nunca vacía.
//
// Se llama UNA vez por orden, recién creada, desde cualquier punto de alta
// (portal, sync con el ERP, formulario interno, tienda, WMS, prendas...).
// No hace nada si la orden no existe.
// =============================================================================
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const { calcularFechaCompromiso } = require('../controllers/planificacionController');

/**
 * @param {import('mssql').ConnectionPool | import('mssql').Transaction} poolOrTx
 * @param {number} ordenId
 * @returns {Promise<{ fechaEstimadaEntrega: Date|null, fechaCompromiso: Date|null }>}
 */
async function calcularFechasOrden(poolOrTx, ordenId) {
    try {
        // 1) Plan fijo — siempre corre primero, para todas las áreas.
        const r1 = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).execute('sp_CalcularFechaEntrega');
        const fechaEstimadaEntrega = r1.recordset?.[0]?.NuevaFechaEntrega ? new Date(r1.recordset[0].NuevaFechaEntrega) : null;

        // 2) Datos de la orden para poder simular la cola.
        const rOrden = await new sql.Request(poolOrTx).input('OrdenID', sql.Int, ordenId).query(`
            SELECT AreaID, Prioridad, TRY_CAST(Magnitud AS DECIMAL(18,2)) AS Magnitud
            FROM dbo.Ordenes WHERE OrdenID = @OrdenID`);
        const orden = rOrden.recordset[0];
        if (!orden) return { fechaEstimadaEntrega, fechaCompromiso: fechaEstimadaEntrega };

        // Colchón de días antes de empezar a consumir capacidad (hoy solo tiene sentido
        // configurado para Bordado — preparación de matriz; el resto usa 0, ver comentario
        // arriba de calcularFechaCompromiso en planificacionController.js).
        let diasColchon = 0;
        if (orden.AreaID === 'EMB') {
            const conf = await new sql.Request(poolOrTx).query(
                "SELECT Valor FROM dbo.ConfiguracionGlobal WHERE Clave = 'EMB_DIAS_PREPARACION_MATRIZ'");
            diasColchon = conf.recordset.length ? (parseInt(conf.recordset[0].Valor, 10) || 0) : 0;
        }

        // 3) Motor de agenda: proyección real según la cola actual del área.
        //    calcularFechaCompromiso necesita el pool "de verdad" (hace varias queries propias
        //    en paralelo); si nos pasaron una transacción, usamos su .parent (mismo pool).
        const poolReal = poolOrTx.parent || poolOrTx;
        const [proyectadaStr] = await calcularFechaCompromiso(
            poolReal, orden.AreaID, [{ magnitud: orden.Magnitud || 0, prioridad: orden.Prioridad }], diasColchon);

        // 4) FechaCompromiso = lo que dé la agenda, pero NUNCA antes que el plan (regla de
        //    negocio confirmada 8-sep-2026). Sin proyección posible (área sin capacidad
        //    cargada) → igual al plan.
        let fechaCompromiso = fechaEstimadaEntrega;
        if (proyectadaStr) {
            const proyectada = new Date(proyectadaStr + 'T00:00:00');
            if (!fechaEstimadaEntrega || proyectada > fechaEstimadaEntrega) fechaCompromiso = proyectada;
        }

        await new sql.Request(poolOrTx)
            .input('OrdenID', sql.Int, ordenId)
            .input('Fecha', sql.DateTime, fechaCompromiso)
            .query('UPDATE dbo.Ordenes SET FechaCompromiso = @Fecha WHERE OrdenID = @OrdenID');

        return { fechaEstimadaEntrega, fechaCompromiso };
    } catch (err) {
        logger.error(`[FECHA-PROMETIDA] calcularFechasOrden falló para OrdenID ${ordenId}: ${err.message}`);
        return { fechaEstimadaEntrega: null, fechaCompromiso: null };
    }
}

module.exports = { calcularFechasOrden };
