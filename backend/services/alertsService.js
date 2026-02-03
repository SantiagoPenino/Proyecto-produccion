const { sql, getPool } = require('../config/db');

/**
 * Registra una alerta en IntegrationLogs
 * @param {string} nivel 'INFO', 'WARN', 'ERROR'
 * @param {string} entidad 'PRODUCTO', 'ORDEN', 'CLIENTE', 'SISTEMA'
 * @param {string} mensaje Descripción corta del problema
 * @param {string} referenciaId ID del objeto afectado (ej: CodArticulo)
 * @param {object} datosObjeto Objeto con detalles adicionales (se guardará como JSON)
 */
async function logAlert(nivel, entidad, mensaje, referenciaId = null, datosObjeto = null) {
    try {
        const pool = await getPool();
        const datosJson = datosObjeto ? JSON.stringify(datosObjeto) : null;

        await pool.request()
            .input('Nivel', sql.VarChar(20), nivel)
            .input('Entidad', sql.VarChar(50), entidad)
            .input('Mensaje', sql.NVarChar(sql.MAX), mensaje)
            .input('Ref', sql.VarChar(100), referenciaId)
            .input('Json', sql.NVarChar(sql.MAX), datosJson)
            .query(`
                INSERT INTO IntegrationLogs (Nivel, TipoEntidad, Mensaje, ReferenciaID, DatosJson, Estado)
                VALUES (@Nivel, @Entidad, @Mensaje, @Ref, @Json, 'PENDIENTE')
            `);

        console.log(`[ALERT][${nivel}] ${mensaje}`);
    } catch (e) {
        console.error("Error writing IntegrationLog:", e);
    }
}

module.exports = { logAlert };
