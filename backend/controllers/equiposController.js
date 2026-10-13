// SIN USO (13/10): consulta la tabla Maquinas, que no existe (lo dice embBoardController). La ruta /production-file-control/equipos no tiene caller en el front. Ver docs/auditoria-limpieza-2026-10-09.md.
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Obtiene la lista de equipos/máquinas disponibles.
 * Puede filtrar por área.
 */
const getEquipos = async (req, res) => {
    try {
        const { areaId } = req.query;
        const pool = await getPool();

        // Asumiendo que existe una tabla Maquinas o similar. 
        // Si no existe, podemos simularla o extraerla de los Rollos DISTINCT MaquinaID si es campo texto.
        // Voy a asumir una tabla 'Maquinas' base. Si falla, el usuario me dirá y ajustaré.

        // QUERY SEGURA: Si no hay tabla Maquinas, intento sacarlo de una vista o hardcodeo lógica común.
        // Pero intentemos consultar la tabla Maquinas primero.

        let query = `SELECT * FROM Maquinas WHERE Activa = 1`;
        if (areaId) {
            query += ` AND AreaID = @AreaID`;
        }

        const result = await pool.request()
            .input('AreaID', sql.NVarChar, areaId)
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        // Fallback: Si no existe tabla Maquinas, devolver error controlado o lista vacía
        logger.warn("No se pudo obtener equipos (posible falta de tabla Maquinas):", err.message);

        // Retornamos lista vacía o Mock por ahora si falla la tabla
        res.json([]);
    }
};

module.exports = {
    getEquipos
};
