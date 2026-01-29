const { sql } = require('../config/db');

/**
 * Registra una acción en la tabla de Auditoría.
 * Utiliza el procedimiento almacenado sp_RegistrarAccion.
 * 
 * @param {object} transactionOrPool - Objeto Transaction o Pool de conexión
 * @param {number} userId - ID del usuario que realiza la acción
 * @param {string} action - Código de la acción (ej. 'LOGIN', 'UPDATE_ORDER')
 * @param {string} details - Detalles adicionales
 * @param {string} ip - Dirección IP del cliente
 */
async function registrarAuditoria(transactionOrPool, userId, action, details, ip) {
    const request = new sql.Request(transactionOrPool);
    const uid = userId ? parseInt(userId) : null;

    try {
        // Comentamos el SP porque está fallando con 'UsuarioID'. Usamos INSERT directo.
        /* 
        await request
            .input('UserID', sql.Int, uid)
            .input('Action', sql.NVarChar, action)
            .input('Details', sql.NVarChar, details)
            .input('IPAddress', sql.NVarChar, ip || '')
            .execute('sp_RegistrarAccion');
        */

        // INSERT Directo (Más seguro dado el error de columna)
        const fallbackReq = new sql.Request(transactionOrPool);

        await fallbackReq
            .input('IdUsuario', sql.Int, uid)
            .input('Accion', sql.NVarChar, action)
            .input('Detalles', sql.NVarChar, details)
            .input('DireccionIP', sql.NVarChar, ip || '')
            .query(`INSERT INTO Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@IdUsuario, @Accion, @Detalles, @DireccionIP, GETDATE())`);

    } catch (error) {
        console.error("Error al registrar auditoría:", error.message);
        // No lanzamos error para no tumbar la transacción principal
    }
}

/**
 * Registra el cambio de estado en la tabla HistorialOrdenes.
 * Cierra el registro anterior (si existe) y crea uno nuevo.
 * 
 * @param {object} transactionOrPool - Objeto Transaction o Pool de conexión
 * @param {number} ordenId - ID de la orden
 * @param {string} nuevoEstado - Nuevo estado asignado
 * @param {number} usuarioId - ID del usuario
 * @param {string} detalle - Detalle del cambio
 */
async function registrarHistorialOrden(transactionOrPool, ordenId, nuevoEstado, usuarioId, detalle) {
    const uid = usuarioId ? parseInt(usuarioId) : null;

    // 1. Cerrar historial anterior (Update FechaFin)
    const reqUpdate = new sql.Request(transactionOrPool);
    await reqUpdate
        .input('OID', sql.Int, ordenId)
        .query(`
            UPDATE HistorialOrdenes 
            SET FechaFin = GETDATE(), 
                DuracionMinutos = DATEDIFF(minute, FechaInicio, GETDATE())
            WHERE OrdenID = @OID AND FechaFin IS NULL
        `);

    // 2. Insertar nuevo registro histórico (Generando ID manual si no es Identity)
    const reqInsert = new sql.Request(transactionOrPool);
    await reqInsert
        .input('OID', sql.Int, ordenId)
        .input('Estado', sql.NVarChar, nuevoEstado)
        .input('Usuario', sql.Int, uid)
        .input('Detalle', sql.NVarChar, detalle || '')
        .query(`
            INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, Usuario, Detalle)
            VALUES (@OID, @Estado, GETDATE(), @Usuario, @Detalle)
        `);
}

module.exports = {
    registrarAuditoria,
    registrarHistorialOrden
};
