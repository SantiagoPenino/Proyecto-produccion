const { getPool, sql } = require('../config/db');
const { changeOrderState } = require('../services/stateManagerService');
const { registrarAuditoria } = require('../services/trackingService');
const logger = require('../utils/logger');

exports.getBoard = async (req, res) => {
    let { area } = req.query;
    logger.info("--- Cargando Tablero para Área:", area);

    try {
        const POOL = await getPool();

        const machinesRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT 
                    EquipoID as id, 
                    Nombre as name, 
                    Estado as status, 
                    EstadoProceso as processStatus
                FROM [dbo].[ConfigEquipos] 
                WHERE AreaID = @Area AND Activo = 1
                ORDER BY Nombre ASC
            `);

        const machines = machinesRes.recordset;

        const rollsRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT 
                    r.RolloID as id, 
                    r.RolloID as rollCode, 
                    r.Nombre as name, 
                    r.Estado as status, 
                    r.MaquinaID as machineId,
                    ISNULL(r.MetrosTotales, 0) as usage,
                    ISNULL(r.CapacidadMaxima, 0) as capacity,
                    r.ColorHex as color,
                    ISNULL(r.TotalOrdenes, 0) as ordersCount,
                    u.Nombre AS CreadorNombre, 
                    u.IdUsuario AS CreadorId
                FROM dbo.[Rollos] r
                LEFT JOIN dbo.Usuarios u ON r.UsuarioID = u.IdUsuario
                WHERE r.AreaID = @Area AND r.Estado NOT IN ('Cerrado', 'Finalizado', 'Cancelado')
            `);

        let allRolls = rollsRes.recordset.map(r => ({ 
            ...r, 
            creador: r.CreadorNombre,
            userId: r.CreadorId,
            orders: [], 
            usage: 0 
        }));

        const ordersRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT 
                    o.OrdenID as id,
                    o.CodigoOrden as code,
                    o.Cliente as client,
                    o.DescripcionTrabajo as descr,
                    o.Material as material,
                    o.RolloID as rollId,
                    o.Prioridad as priority,
                    o.Estado as status,
                    o.Magnitud as magnitude,
                    o.Variante as variantCode,
                    (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) as fileCount
                FROM dbo.Ordenes o
                WHERE o.AreaID = @Area 
                  AND o.RolloID IS NOT NULL 
                  AND o.Estado NOT IN ('Finalizado', 'Entregado', 'Cancelado')
            `);

        const orders = ordersRes.recordset;
        orders.forEach(order => {
            const roll = allRolls.find(r => String(r.id) === String(order.rollId));
            if (roll) {
                const rawMag = String(order.magnitude || '0').replace(',', '.');
                const mag = parseFloat(rawMag.replace(/[^\d.]/g, '')) || 0;
                roll.orders.push({ ...order, desc: order.descr, magnitude: mag });
                roll.usage += mag;
                roll.ordersCount = roll.orders.length;
            }
        });

        allRolls.forEach(r => {
            const ignored = ['SIN MATERIAL ESPECIFICADO', 'SIN MATERIAL', 'NINGUNO', 'N/A', 'VARIOS'];
            const rawMaterials = r.orders.map(o => (o.material || '').trim());
            const validMaterials = rawMaterials.filter(m => m && !ignored.includes(m.toUpperCase()));
            const uniqueMaterials = [...new Set(validMaterials)];
            if (uniqueMaterials.length === 0) r.material = '-';
            else if (uniqueMaterials.length === 1) r.material = uniqueMaterials[0];
            else r.material = 'Varios Materiales';
        });

        const finalMachines = machines.map(m => {
            const assignedRolls = allRolls.filter(r => String(r.machineId) === String(m.id));
            return {
                ...m,
                rolls: assignedRolls,
                isBusy: assignedRolls.some(r => r.status.includes('En maquina'))
            };
        });

        const pendingRolls = allRolls.filter(r =>
            !r.machineId ||
            String(r.machineId).toUpperCase() === 'NULL' ||
            String(r.machineId).trim() === '' ||
            String(r.machineId) === '0'
        );

        res.json({ machines: finalMachines, pendingRolls });

    } catch (err) {
        logger.error("❌ ERROR SQL:", err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.assignRoll = async (req, res) => {
    const { rollId, rollIds, machineId } = req.body;
    const userObj = req.user || req.body.usuario || req.body.userId;
    if (!userObj) return res.status(400).json({ error: "Usuario no autenticado o no proporcionado" });
    const ip = req.ip || req.connection.remoteAddress;
    const mid = machineId || null;

    let targets = [];
    if (rollIds && Array.isArray(rollIds)) {
        targets = rollIds;
    } else if (rollId) {
        targets = [rollId];
    }

    if (targets.length === 0) {
        return res.status(400).json({ error: "No se indicaron rollos para asignar." });
    }

    logger.info(`[assignRoll-Kanban] Rolls: [${targets.join(', ')}], MachineID: ${machineId}`);

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        for (const currentRollId of targets) {
            // Actualizar Rollo (gestión de equipo, no de estado)
            await new sql.Request(transaction)
                .input('RID', sql.Int, currentRollId)
                .input('MID', sql.Int, mid)
                .query("UPDATE dbo.Rollos SET MaquinaID = @MID, Estado = 'En cola' WHERE RolloID = @RID");

            // Actualizar solo MaquinaID en Ordenes (Estado/EstadoenArea via stateManager)
            await new sql.Request(transaction)
                .input('MID', sql.Int, mid)
                .input('RID', sql.Int, currentRollId)
                .query('UPDATE dbo.Ordenes SET MaquinaID = @MID WHERE RolloID = @RID');

            // Estado + historial via servicio central
            await changeOrderState(transaction, {
                target   : { type: 'ROLL', id: currentRollId },
                estado   : 'En Maquina',
                userObj  : userObj,
                detalle  : 'Asignado a Maquina {maquina}',
                maquinaId: mid,
                rolloId  : currentRollId,
                io       : req.app.get('socketio'),
                io       : req.app.get('socketio'),
                io       : req.app.get('socketio')
            });
        }

        const { userIdNum } = require('../services/stateManagerService').extractUser(userObj);
        await registrarAuditoria(transaction, userIdNum, 'ASIGNACION_MASIVA', `${targets.length} rollos asignados a Maquina ${machineId}`, ip);

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logger.error("❌ ERROR AL ASIGNAR (Kanban):", err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.unassignRoll = async (req, res) => {
    const { rollId } = req.body;
    const userObj = req.user || req.body.usuario || req.body.userId;
    if (!userObj) return res.status(400).json({ error: "Usuario no autenticado o no proporcionado" });
    const ip = req.ip || req.connection.remoteAddress;

    logger.info(`[unassignRoll-Kanban] RollID: ${rollId}`);
    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Desmontar Rollo (gestión de equipo)
        await new sql.Request(transaction)
            .input('RID', sql.Int, rollId)
            .query("UPDATE dbo.Rollos SET MaquinaID = NULL, Estado = 'Abierto' WHERE RolloID = @RID");

        // 2. Limpiar MaquinaID en Ordenes (gestión de equipo)
        await new sql.Request(transaction)
            .input('RID', sql.Int, rollId)
            .query('UPDATE dbo.Ordenes SET MaquinaID = NULL WHERE RolloID = @RID');

        // 3. Estado + historial via servicio central
        await changeOrderState(transaction, {
            target  : { type: 'ROLL', id: rollId },
            estado  : 'En Lote',
            userObj : userObj,
            detalle : 'Desmontado de Maquina - Lote {rollo}',
            rolloId : rollId,
                io       : req.app.get('socketio'),
                io       : req.app.get('socketio')
            });

        const { userIdNum } = require('../services/stateManagerService').extractUser(userObj);
        await registrarAuditoria(transaction, userIdNum, 'DESMONTAJE_ROLLO', `Rollo ${rollId} desmontado`, ip);

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        if (transaction) await transaction.rollback();
        logger.error("❌ ERROR AL DESASIGNAR:", err.message);
        res.status(500).json({ error: err.message });
    }
};
