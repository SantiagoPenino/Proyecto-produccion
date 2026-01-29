const { getPool, sql } = require('../config/db');

exports.getBoard = async (req, res) => {
    let { area } = req.query;
    console.log("--- Cargando Tablero para Área:", area);
    // if (area === 'DF') area = 'DTF'; // DISABLED: User requested no forced conversion

    try {
        const POOL = await getPool();

        // 1. Obtener Máquinas (Columnas reales: EquipoID, Nombre, EstadoProceso)
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
            `);

        const machines = machinesRes.recordset;

        // 2. Obtener Rollos
        const rollsRes = await POOL.request()
            .input('Area', sql.VarChar, area)
            .query(`
                SELECT 
                    RolloID as id, 
                    RolloID as rollCode, 
                    Nombre as name, 
                    Estado as status, 
                    MaquinaID as machineId,
                    ISNULL(MetrosTotales, 0) as usage,
                    ISNULL(CapacidadMaxima, 0) as capacity,
                    ColorHex as color,
                    ISNULL(TotalOrdenes, 0) as ordersCount
                FROM dbo.[Rollos] 
                WHERE AreaID = @Area AND Estado NOT IN ('Cerrado', 'Finalizado')
            `);

        // Inicializamos usage a 0 para recalcularlo basado en órdenes reales
        let allRolls = rollsRes.recordset.map(r => ({ ...r, orders: [], usage: 0 }));

        // 3. Obtener Órdenes de esos Rollos
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

        // 4. Asignar Órdenes y SUMAR Metros
        const orders = ordersRes.recordset;
        orders.forEach(order => {
            const roll = allRolls.find(r => String(r.id) === String(order.rollId));
            if (roll) {
                // Mejora robusta para parseo de Magnitud (soporta "2,5 m", "2.5m", "100 u")
                const rawMag = String(order.magnitude || '0').replace(',', '.');
                const mag = parseFloat(rawMag.replace(/[^\d.]/g, '')) || 0;

                roll.orders.push({
                    ...order,
                    desc: order.descr,
                    magnitude: mag // Enviamos el valor numérico limpio al front
                });

                // Sumamos al uso total del rollo
                roll.usage += mag;

                // Actualizamos el contador real de órdenes en memoria
                roll.ordersCount = roll.orders.length;
            }
        });

        // 4.5 Calcular Material Predominante (Lógica compartida con rollsController)
        allRolls.forEach(r => {
            const ignored = ['SIN MATERIAL ESPECIFICADO', 'SIN MATERIAL', 'NINGUNO', 'N/A', 'VARIOS'];

            const rawMaterials = r.orders.map(o => (o.material || '').trim());
            const validMaterials = rawMaterials.filter(m => m && !ignored.includes(m.toUpperCase()));
            const uniqueMaterials = [...new Set(validMaterials)];

            if (uniqueMaterials.length === 0) r.material = '-';
            else if (uniqueMaterials.length === 1) r.material = uniqueMaterials[0];
            else r.material = 'Varios Materiales';
        });

        // 5. Unir los datos para el Frontend
        const finalMachines = machines.map(m => {
            const assignedRolls = allRolls.filter(r => String(r.machineId) === String(m.id));
            return {
                ...m,
                rolls: assignedRolls,
                // Si hay algún rollo en estado 'En maquina', la máquina está ocupada
                isBusy: assignedRolls.some(r => r.status.includes('En maquina'))
            };
        });

        // Rollos que no tienen MaquinaID asignado
        // Rollos que no tienen MaquinaID asignado (Mesa de Armado)
        const pendingRolls = allRolls.filter(r =>
            !r.machineId ||
            String(r.machineId).toUpperCase() === 'NULL' ||
            String(r.machineId).trim() === '' ||
            String(r.machineId) === '0'
        );

        res.json({ machines: finalMachines, pendingRolls });

    } catch (err) {
        console.error("❌ ERROR SQL:", err.message);
        res.status(500).json({ error: err.message });
    }
};

const { registrarAuditoria, registrarHistorialOrden } = require('../services/trackingService');

// ... existing getBoard ...

exports.assignRoll = async (req, res) => {
    const { rollId, rollIds, machineId } = req.body;
    // Attempt to get user info, fallback to 1 or null
    const userId = req.user ? req.user.id : (req.body.userId || 1);
    const ip = req.ip || req.connection.remoteAddress;

    // Normalize to array
    let targets = [];
    if (rollIds && Array.isArray(rollIds)) {
        targets = rollIds;
    } else if (rollId) {
        targets = [rollId];
    }

    if (targets.length === 0) {
        return res.status(400).json({ error: "No se indicaron rollos para asignar." });
    }

    console.log(`[assignRoll-Kanban] Request received. Rolls: [${targets.join(', ')}], MachineID: ${machineId}`);

    let transaction;
    try {
        const pool = await getPool();
        transaction = new sql.Transaction(pool);
        await transaction.begin();

        // 1. Obtener EstadoProceso de la Máquina (aunque por regla ponemos En cola Eq)
        let machineStatus = 'En cola Eq';
        const mid = machineId || null;

        for (const currentRollId of targets) {
            // 2. Actualizar Rollo
            const reqRoll = new sql.Request(transaction);
            await reqRoll.input('RID', sql.Int, currentRollId)
                .input('MID', sql.Int, mid)
                .query(`UPDATE dbo.Rollos SET MaquinaID = @MID, Estado = 'En cola' WHERE RolloID = @RID`);

            // 3. Obtener Ordenes afectadas para Historial
            const reqGetOrders = new sql.Request(transaction);
            const ordersCheck = await reqGetOrders.input('RID', sql.Int, currentRollId)
                .query("SELECT OrdenID FROM dbo.Ordenes WHERE RolloID = @RID");

            const affectedOrderIds = ordersCheck.recordset.map(o => o.OrdenID);

            // 4. Actualizar Ordenes
            const reqOrders = new sql.Request(transaction);
            await reqOrders.input('MID', sql.Int, mid)
                .input('StatusArea', sql.VarChar, machineStatus)
                .input('RID', sql.Int, currentRollId)
                .query(`UPDATE dbo.Ordenes SET MaquinaID = @MID, EstadoenArea = @StatusArea WHERE RolloID = @RID`);

            // 5. Registrar Historial y Auditoria
            for (const oid of affectedOrderIds) {
                await registrarHistorialOrden(transaction, oid, machineStatus, userId, `Asignado a Maquina #${machineId}`);
            }
        }

        await registrarAuditoria(transaction, userId, 'ASIGNACION_MASIVA', `${targets.length} rollos asignados a Maquina ${machineId}`, ip);

        await transaction.commit();
        res.json({ success: true, machineStatus });
    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("❌ ERROR AL ASIGNAR (Kanban):", err.message);
        res.status(500).json({ error: err.message });
    }
};

exports.unassignRoll = async (req, res) => {
    const { rollId } = req.body;
    const userId = req.user ? req.user.id : (req.body.userId || 1);
    const ip = req.ip || req.connection.remoteAddress;

    console.log(`[unassignRoll-Kanban] Request received. RollID: ${rollId}`);
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        const request = new sql.Request(transaction);

        // 1. Desmontar Rollo
        await request.input('RID', sql.Int, rollId)
            .query(`UPDATE dbo.Rollos SET MaquinaID = NULL, Estado = 'Abierto' WHERE RolloID = @RID`);

        // 2. Obtener Ordenes para Historial
        const reqGetOrders = new sql.Request(transaction);
        const ordersCheck = await reqGetOrders.input('RID', sql.Int, rollId)
            .query("SELECT OrdenID FROM dbo.Ordenes WHERE RolloID = @RID");

        const affectedOrderIds = ordersCheck.recordset.map(o => o.OrdenID);

        // 3. Actualizar Ordenes
        const reqOrders = new sql.Request(transaction);
        await reqOrders.input('RID', sql.Int, rollId)
            .query(`UPDATE dbo.Ordenes SET MaquinaID = NULL, EstadoenArea = 'En Rollo' WHERE RolloID = @RID`);

        // 4. Registrar Historial y Auditoria
        for (const oid of affectedOrderIds) {
            await registrarHistorialOrden(transaction, oid, 'En Rollo', userId, 'Desmontado de Maquina');
        }
        await registrarAuditoria(transaction, userId, 'DESMONTAJE_ROLLO', `Rollo ${rollId} desmontado`, ip);

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        console.error("❌ ERROR AL DESASIGNAR:", err.message);
        res.status(500).json({ error: err.message });
    }
};