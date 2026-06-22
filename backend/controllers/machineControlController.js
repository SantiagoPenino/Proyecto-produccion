const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Obtener Slots de una Máquina
exports.getMachineSlots = async (req, res) => {
    const { machineId } = req.params;
    try {
        const pool = await getPool();

        // Obtener Slots configurados
        const result = await pool.request()
            .input('EID', sql.Int, machineId)
            .query(`
                SELECT 
                    s.SlotID, s.Nombre, s.Tipo, s.OrdenVisual,
                    s.BobinaMontadaID,
                    b.CodigoEtiqueta, b.MetrosRestantes,
                    i.Nombre as NombreInsumoMontado
                FROM SlotsMaquina s
                LEFT JOIN InventarioBobinas b ON s.BobinaMontadaID = b.BobinaID
                LEFT JOIN Insumos i ON b.InsumoID = i.InsumoID
                WHERE s.EquipoID = @EID
                ORDER BY s.OrdenVisual ASC
            `);

        res.json(result.recordset);
    } catch (err) {
        logger.error("Error getting slots:", err);
        res.status(500).json({ error: err.message });
    }
};

// Acciones sobre Slots (Montar, Desmontar, Recargar)
exports.handleSlotAction = async (req, res) => {
    const { machineId, slotId } = req.params;
    const { action, bobinaId, insumoId, cantidad, comment } = req.body;
    // action: 'MOUNT', 'UNMOUNT', 'REFILL'

    const userObj = req.user || req.body.usuario || req.body.userId;
        if (!userObj) return res.status(400).json({ error: "Usuario no autenticado o no proporcionado" });
        const userName = typeof userObj === 'object' ? (userObj.Nombre || userObj.nombre || userObj.name || userObj.username || String(userObj.id || userObj.UsuarioID)) : String(userObj);
        const userIdNum = typeof userObj === 'object' ? (userObj.UsuarioID || userObj.id) : parseInt(userObj);
        if (!userName || !userIdNum || isNaN(userIdNum) || userName === 'undefined') return res.status(400).json({ error: "Datos de usuario inválidos" });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Validar Slot
            const slotCheck = await new sql.Request(transaction)
                .input('SID', sql.Int, slotId)
                .query("SELECT * FROM SlotsMaquina WHERE SlotID = @SID");

            if (slotCheck.recordset.length === 0) throw new Error("Slot no encontrado");
            const slot = slotCheck.recordset[0];

            if (String(slot.EquipoID) !== String(machineId)) throw new Error("Slot no pertenece a esta máquina");

            // --- LÓGICA DE BOBINAS ---
            if (slot.Tipo === 'BOBINA') {
                if (action === 'MOUNT') {
                    if (!bobinaId) throw new Error("Se requiere BobinaID para montar");

                    // 1. Verificar si ya hay algo montado
                    if (slot.BobinaMontadaID) throw new Error("Ya hay una bobina montada. Desmontela primero.");

                    // RESOLVER ID REAL (Soporte escaner)
                    let realBobinaId = bobinaId;

                    // Si parece un código de etiqueta (string o contiene letras)
                    const isLabelCode = isNaN(bobinaId) || (typeof bobinaId === 'string' && bobinaId.length > 5);

                    if (isLabelCode) {
                        const search = await new sql.Request(transaction)
                            .input('Code', sql.VarChar(50), bobinaId)
                            .query("SELECT BobinaID, Estado FROM InventarioBobinas WHERE CodigoEtiqueta = @Code");

                        if (search.recordset.length === 0) throw new Error("Etiqueta de bobina no encontrada: " + bobinaId);
                        realBobinaId = search.recordset[0].BobinaID;
                    }

                    // 2. Verificar Bobina Nueva (con ID resuelto)
                    const bobCheck = await new sql.Request(transaction)
                        .input('BID', sql.Int, realBobinaId)
                        .query("SELECT Estado FROM InventarioBobinas WHERE BobinaID = @BID");

                    if (bobCheck.recordset.length === 0) throw new Error("Bobina no existe");
                    if (bobCheck.recordset[0].Estado !== 'Disponible') throw new Error("La bobina no está Disponible (Estado actual: " + bobCheck.recordset[0].Estado + ")");

                    // 3. Montar (Update Slot + Update Bobina + Log)
                    await new sql.Request(transaction)
                        .input('SID', sql.Int, slotId)
                        .input('BID', sql.Int, realBobinaId)
                        .query("UPDATE SlotsMaquina SET BobinaMontadaID = @BID, FechaMontaje = GETDATE() WHERE SlotID = @SID");

                    await new sql.Request(transaction)
                        .input('BID', sql.Int, realBobinaId)
                        .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");

                    await logAction(transaction, slotId, machineId, userIdNum, 'MONTAJE', null, realBobinaId, null, comment);

                } else if (action === 'UNMOUNT') {
                    if (!slot.BobinaMontadaID) throw new Error("No hay bobina montada para desmontar.");

                    const oldBobinaId = slot.BobinaMontadaID;
                    const estadoFinal = req.body.estadoFinal || 'Disponible'; // 'Disponible' o 'Agotado'

                    // 1. Desmontar (Update Slot + Update Bobina + Log)
                    await new sql.Request(transaction)
                        .input('SID', sql.Int, slotId)
                        .query("UPDATE SlotsMaquina SET BobinaMontadaID = NULL, FechaMontaje = NULL WHERE SlotID = @SID");

                    await new sql.Request(transaction)
                        .input('BID', sql.Int, oldBobinaId)
                        .input('Est', sql.VarChar(20), estadoFinal)
                        .query("UPDATE InventarioBobinas SET Estado = @Est WHERE BobinaID = @BID");

                    await logAction(transaction, slotId, machineId, userIdNum, 'DESMONTAJE', null, oldBobinaId, null, comment || `Estado final: ${estadoFinal}`);
                }
            }
            // --- LÓGICA DE CONSUMIBLES (TINTAS) ---
            else if (slot.Tipo === 'CONSUMIBLE') {
                if (action === 'REFILL') {
                    if (!cantidad) throw new Error("Se requiere cantidad para recargar");

                    // Solo registramos el evento en bitácora
                    // Opcionalmente podríamos descontar de un inventario maestro de "Botellas" si existiera.
                    // Por ahora, bitácora.

                    await logAction(transaction, slotId, machineId, userIdNum, 'RECARGA', insumoId, null, cantidad, comment);
                }
            }

            await transaction.commit();
            res.json({ success: true, message: "Acción realizada correctamente" });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (err) {
        logger.error("Error slot action:", err);
        res.status(500).json({ error: err.message });
    }
};


// Helper interno para log
async function logAction(transaction, slotId, teamId, userId, action, insumoId, bobinaId, cantidad, comment) {
    await new sql.Request(transaction)
        .input('SID', sql.Int, slotId)
        .input('EID', sql.Int, teamId)
        .input('UID', sql.Int, userIdNum)
        .input('Acc', sql.NVarChar(50), action)
        .input('IID', sql.Int, insumoId || null)
        .input('BID', sql.Int, bobinaId || null)
        .input('Cant', sql.Decimal(10, 2), cantidad || null)
        .input('Com', sql.NVarChar(sql.MAX), comment || null)
        .query(`
            INSERT INTO BitacoraInsumosMaquina (SlotID, EquipoID, UsuarioID, accion, InsumoID, BobinaID, Cantidad, Comentario)
            VALUES (@SID, @EID, @UID, @Acc, @IID, @BID, @Cant, @Com)
        `);
}

// Obtener Bobinas Disponibles para montar (Sugerencias)
exports.getAvailableBobbins = async (req, res) => {
    const { machineId } = req.params;
    try {
        const pool = await getPool();

        // 1. Obtener Area de la Maquina
        const machineRes = await pool.request()
            .input('MID', sql.Int, machineId)
            .query("SELECT AreaID FROM ConfigEquipos WHERE EquipoID = @MID");

        let areaId = null;
        if (machineRes.recordset.length > 0) {
            areaId = machineRes.recordset[0].AreaID;
        }

        // 2. Query Base
        let query = `
            SELECT TOP 50 
                b.BobinaID, b.CodigoEtiqueta, b.MetrosRestantes, b.FechaIngreso,
                i.Nombre as Material
            FROM InventarioBobinas b
            LEFT JOIN Insumos i ON b.InsumoID = i.InsumoID
            WHERE b.Estado = 'Disponible' 
            AND b.MetrosRestantes > 1
        `;

        const request = pool.request();

        // 3. Filtros Inteligentes según Área
        // Si hay área definida, priorizamos bobinas de esa área, pero no excluyimos tajantemente por si acaso.
        // Mejor enfoque: Filtrar por AreaID si existe en la bobina, O coincidencia de nombre.

        if (areaId) {
            // Mapping de Areas similares
            let searchArea = areaId;
            if (areaId === 'DF') searchArea = 'DTF';

            // Filtramos estrictamente si la bobina tiene AreaID
            // Si la bobina no tiene AreaID (NULL), la mostramos como genérica? Mejor intentar filtrar.
            query += ` AND (b.AreaID LIKE @Area OR i.Categoria LIKE '%' + @Area + '%' OR i.Nombre LIKE '%' + @Area + '%')`;
            request.input('Area', sql.VarChar(50), `%${searchArea}%`);
        }

        query += " ORDER BY b.FechaIngreso DESC";

        const result = await request.query(query);
        res.json(result.recordset);

    } catch (err) {
        logger.error("Error getting available bobbins:", err);
        res.status(500).json({ error: err.message });
    }
};
