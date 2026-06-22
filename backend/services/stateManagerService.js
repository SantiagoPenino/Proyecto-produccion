/**
 * stateManagerService.js
 * ──────────────────────────────────────────────────────────────────────────
 * Servicio centralizado para actualizar el Estado y EstadoenArea de las
 * Ordenes, calcular el Estado General padre desde ConfigEstados y registrar
 * automaticamente el HistorialOrdenes.
 *
 * Uso:
 *   const { changeOrderState } = require('../services/stateManagerService');
 *
 *   await changeOrderState(transaction, {
 *       target   : { type: 'ORDER', id: 1234 },   // o { type: 'ROLL', id: 120 }
 *       estado   : 'En Maquina',
 *       userObj  : req.user,
 *       detalle  : 'Asignado a Maquina {maquina}', // {maquina} y {rollo} se reemplazan
 *       maquinaId: 7,
 *       rolloId  : 120,
 *   });
 */

const sql = require('mssql');
const logger = require('../utils/logger');

/**
 * Extrae nombre (texto) e ID (numero) del usuario de forma segura.
 * Lanza un error descriptivo si no se puede determinar el usuario.
 */
function extractUser(userObj) {
    if (!userObj) {
        throw new Error('Usuario no autenticado o no proporcionado');
    }

    // Identificador canónico para el historial: SIEMPRE el username primero (consistencia en todo el sistema),
    // y solo si no hay, se cae al Nombre completo y por último al id.
    const userName = typeof userObj === 'object'
        ? (userObj.username || userObj.Username || userObj.usuario || userObj.Usuario
           || userObj.Nombre || userObj.nombre || userObj.name
           || String(userObj.id || userObj.UsuarioID || ''))
        : String(userObj);

    const userIdNum = typeof userObj === 'object'
        ? parseInt(userObj.UsuarioID || userObj.id || 0)
        : parseInt(userObj) || 0;

    if (!userName || userName === 'undefined') {
        throw new Error(`Datos de usuario invalidos (Nombre: "${userName}")`);
    }

    return { userName, userIdNum };
}

/**
 * Busca en ConfigEstados el nombre del Estado General (padre) para un
 * Estado de Area dado. Retorna null si no tiene padre definido.
 */
async function fetchEstadoPadre(transaction, estadoArea) {
    if (!estadoArea) return null;
    
    // Si pasamos un estado raíz (Pendiente, Cancelado, Terminado, etc)
    const res = await new sql.Request(transaction)
        .input('EArea', sql.VarChar(50), estadoArea)
        .query(`
            SELECT TOP 1 Padre.Nombre AS EstadoGeneral
            FROM   dbo.ConfigEstados Hijo
            INNER JOIN dbo.ConfigEstados Padre ON Hijo.EstadoPadreID = Padre.EstadoID
            WHERE  Hijo.Nombre    = @EArea
              AND  Hijo.TipoEstado IN ('ESTADOENAREA', 'ESTADOLOGISTICA')
        `);
    return res.recordset.length > 0 ? res.recordset[0].EstadoGeneral : null;
}

/**
 * Obtiene el nombre de un Rollo dado su RolloID.
 */
async function fetchNombreRollo(transaction, rolloId) {
    if (!rolloId) return null;
    const res = await new sql.Request(transaction)
        .input('RID', sql.VarChar(50), String(rolloId))
        .query('SELECT TOP 1 Nombre FROM dbo.Rollos WHERE CAST(RolloID AS VARCHAR(50)) = @RID');
    return res.recordset.length > 0 ? res.recordset[0].Nombre : `Lote #${rolloId}`;
}

/**
 * Obtiene el nombre de una Maquina dado su EquipoID.
 */
async function fetchNombreMaquina(transaction, maquinaId) {
    if (!maquinaId) return null;
    const res = await new sql.Request(transaction)
        .input('MID', sql.Int, parseInt(maquinaId))
        .query('SELECT TOP 1 Nombre FROM dbo.ConfigEquipos WHERE EquipoID = @MID');
    return res.recordset.length > 0 ? res.recordset[0].Nombre : `Maquina #${maquinaId}`;
}

/**
 * Registra una fila en HistorialOrdenes.
 */
async function insertarHistorial(transaction, ordenId, estado, userName, detalle) {
    await new sql.Request(transaction)
        .input('OID',  sql.Int,           ordenId)
        .input('Est',  sql.VarChar(50),   estado)
        .input('Usr',  sql.VarChar(100),  String(userName).substring(0, 99))
        .input('Det',  sql.NVarChar(500), String(detalle || '').substring(0, 499))
        .query(`
            INSERT INTO dbo.HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
            VALUES (@OID, @Est, GETDATE(), GETDATE(), @Usr, @Det)
        `);
}

/**
 * changeOrderState  -  Funcion principal del servicio
 *
 * @param {object}  transaction  - Transaccion SQL activa.
 * @param {object}  opts
 * @param {object}  opts.target    - { type: 'ORDER', id: <OrdenID> }
 *                                   { type: 'ROLL',  id: <RolloID> }
 * @param {string}  opts.estado    - Nombre del EstadoenArea (ej. 'En Maquina').
 * @param {object}  opts.userObj   - Objeto de usuario (req.user o similar).
 * @param {string}  [opts.detalle] - Texto descriptivo. Acepta {rollo} y {maquina}.
 * @param {number}  [opts.rolloId]   - ID del rollo para resolver token {rollo}.
 * @param {number}  [opts.maquinaId] - ID de la maquina para resolver token {maquina}.
 *
 * @returns {Promise<{ userName, userIdNum, estadoGeneral, ordenesAfectadas[] }>}
 */
async function changeOrderState(transaction, opts) {
    const { target, estado, userObj, rolloId, maquinaId, io, guard, extraSet } = opts;
    let { detalle } = opts;

    // 1. Extraer usuario (lanza si falta)
    const { userName, userIdNum } = extractUser(userObj);

    // 2. Resolver tokens {rollo} y {maquina} en el detalle
    if (detalle && (detalle.includes('{rollo}') || detalle.includes('{maquina}'))) {
        let nombreRollo = null;
        let nombreMaquina = null;
        if (rolloId) {
            nombreRollo = await fetchNombreRollo(transaction, rolloId);
        }
        if (maquinaId) {
            nombreMaquina = await fetchNombreMaquina(transaction, maquinaId);
        }
        if (nombreRollo)   detalle = detalle.replace(/\{rollo\}/g,   nombreRollo);
        if (nombreMaquina) detalle = detalle.replace(/\{maquina\}/g, nombreMaquina);
    }

    // 3. Buscar Estado General (padre) en ConfigEstados.
    //    REGLA: el Estado general SIEMPRE se deriva del EstadoenArea (su padre). Nunca se setea "puro".
    const estadoGeneral = await fetchEstadoPadre(transaction, estado);

    // 4. Actualizar tabla Ordenes segun el tipo de target
    //    Soporta: ORDER (por OrdenID), ROLL (por RolloID), CODE (por CodigoOrden).
    //    opts.guard   -> condicion SQL FIJA extra para el WHERE (ej. "Estado = 'Cargando...'"). NUNCA input de usuario.
    //    opts.extraSet-> columnas adicionales a setear en el mismo UPDATE (ej. { EstadoLogistica: '...', UbicacionActual: '...' }).
    let ordenesAfectadas = [];

    let whereCol, tidType;
    if (target.type === 'ORDER')     { whereCol = 'OrdenID = @TID';                      tidType = sql.Int; }
    else if (target.type === 'ROLL') { whereCol = 'CAST(RolloID AS VARCHAR(50)) = @TID'; tidType = sql.VarChar(50); }
    else if (target.type === 'CODE') { whereCol = 'CodigoOrden = @TID';                  tidType = sql.NVarChar(50); }
    else { throw new Error(`target.type desconocido: "${target.type}". Usar 'ORDER', 'ROLL' o 'CODE'.`); }

    const tidVal = (target.type === 'ROLL') ? String(target.id) : target.id;
    let whereClause = whereCol;
    if (guard) whereClause += ` AND (${guard})`;

    // 4a. Obtener las ordenes afectadas ANTES (respeta la guarda y sirve para el historial)
    const idsRes = await new sql.Request(transaction)
        .input('TID', tidType, tidVal)
        .query(`SELECT OrdenID FROM dbo.Ordenes WHERE ${whereClause}`);
    ordenesAfectadas = idsRes.recordset.map(o => o.OrdenID);

    // 4b. Construir y ejecutar el UPDATE solo si hay ordenes que cumplen
    if (ordenesAfectadas.length > 0) {
        const setParts = [];
        const upd = new sql.Request(transaction).input('TID', tidType, tidVal);
        if (estadoGeneral) { setParts.push('Estado = @EG'); upd.input('EG', sql.VarChar(50), estadoGeneral); }
        setParts.push('EstadoenArea = @EA'); upd.input('EA', sql.VarChar(50), estado);
        if (extraSet && typeof extraSet === 'object') {
            let i = 0;
            for (const [col, val] of Object.entries(extraSet)) {
                const p = `X${i++}`;
                setParts.push(`${col} = @${p}`);   // col es fijo del codigo (no input de usuario)
                if (val === null || val === undefined) upd.input(p, sql.NVarChar, null);
                else upd.input(p, val);
            }
        }
        if (setParts.length > 0) {
            await upd.query(`UPDATE dbo.Ordenes SET ${setParts.join(', ')} WHERE ${whereClause}`);
        }
    }

    // 5. Registrar historial para cada orden afectada
    for (const oid of ordenesAfectadas) {
        await insertarHistorial(transaction, oid, estado, userName, detalle || `Estado actualizado a ${estado}`);
    }

    logger.info(`[StateManager] ${target.type} ${target.id} => ${estado} (General: ${estadoGeneral || 'sin cambio'}) | Usuario: ${userName} | Ordenes: ${ordenesAfectadas.length}`);

    if (io && ordenesAfectadas.length > 0) {
        for (const oid of ordenesAfectadas) {
            io.emit('server:order_updated', { orderId: oid, status: estadoGeneral || estado, estadoenArea: estado });
        }
        io.emit('server:ordersUpdated', { count: ordenesAfectadas.length });
    }

    return { userName, userIdNum, estadoGeneral, ordenesAfectadas };
}

module.exports = {
    changeOrderState,
    extractUser,
    fetchNombreRollo,
    fetchNombreMaquina,
};
