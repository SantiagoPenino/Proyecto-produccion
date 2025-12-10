const { getPool, sql } = require('../config/db');

// ... (getProductionBoard SE QUEDA IGUAL, NO LO CAMBIES) ...
exports.getProductionBoard = async (req, res) => {
    const { area } = req.query; 
    try {
        const pool = await getPool();

        // A. OBTENER MÁQUINAS
        const machinesRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT EquipoID as id, Nombre as name, Estado as status, Capacidad as capacity 
                FROM dbo.ConfigEquipos 
                WHERE AreaID = @AreaID AND Activo = 1
            `);

        // B. OBTENER ROLLOS ACTIVOS
        const rollsRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT r.RolloID, r.Nombre, r.Estado, r.MaquinaID, r.CapacidadMaxima, r.ColorHex, r.FechaInicioProduccion
                FROM dbo.Rollos r
                WHERE r.AreaID = @AreaID AND r.Estado NOT IN ('Cerrado', 'Entregado')
            `);

        // C. OBTENER ÓRDENES
        const ordersRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT OrdenID, Cliente, DescripcionTrabajo, Magnitud, RolloID, Prioridad, Estado, ArchivosMedidos
                FROM dbo.Ordenes 
                WHERE AreaID = @AreaID 
                AND (RolloID IS NOT NULL OR Estado = 'Pendiente')
                AND Estado != 'Entregado'
            `);

        // --- PROCESAMIENTO ---
        
        const machines = machinesRes.recordset.map(m => ({
            id: m.id, name: m.name, status: m.status || 'OK', capacity: m.capacity, rolls: []
        }));

        const pendingRolls = [];

        rollsRes.recordset.forEach(r => {
            const ordersInRoll = ordersRes.recordset.filter(o => o.RolloID === r.RolloID);
            
            const currentUsage = ordersInRoll.reduce((acc, o) => {
                const val = parseFloat(String(o.Magnitud || '0').replace(/[^\d.]/g, '')) || 0;
                return acc + val;
            }, 0);

            const mappedOrders = ordersInRoll.map(o => ({
                id: o.OrdenID, client: o.Cliente, desc: o.DescripcionTrabajo, magnitude: o.Magnitud, 
                priority: o.Prioridad, status: o.Estado, isMeasured: !!o.ArchivosMedidos
            }));

            const rollObj = {
                id: r.RolloID, name: r.Nombre, status: r.Estado, color: r.ColorHex, 
                capacity: r.CapacidadMaxima, usage: currentUsage, ordersCount: ordersInRoll.length, 
                startTime: r.FechaInicioProduccion, orders: mappedOrders
            };

            // LÓGICA DE UBICACIÓN Y FILTRADO
            if (r.MaquinaID) {
                // Si tiene máquina asignada, lo mostramos SIEMPRE (aunque esté vacío, porque ya está montado)
                const machine = machines.find(m => m.id === r.MaquinaID);
                if (machine) {
                    machine.rolls.push(rollObj);
                } else {
                    // Si la máquina no existe (error de datos), lo tratamos como pendiente
                    // SOLO SI TIENE ÓRDENES
                    if (rollObj.orders.length > 0) pendingRolls.push(rollObj);
                }
            } else {
                // Si está pendiente (sin máquina)
                // 👇 CAMBIO AQUÍ: Solo mostrar si TIENE ÓRDENES
                if (rollObj.orders.length > 0) {
                    pendingRolls.push(rollObj);
                }
            }
        });

        res.json({ machines, pendingRolls });

    } catch (err) {
        console.error("❌ Error getProductionBoard:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 2. ASIGNAR ROLLO (Drag & Drop) - CON BITÁCORA
// =====================================================================
exports.assignRollToMachine = async (req, res) => {
    const { rollId, machineId } = req.body; 

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // CASO A: MONTAR EN MÁQUINA
        if (machineId) {
            // Validación de ocupación...
            const checkMachine = await new sql.Request(transaction)
                .input('MaqID', sql.Int, machineId)
                .query("SELECT Count(*) as count FROM dbo.Rollos WHERE MaquinaID = @MaqID AND Estado = 'Producción'");
            
            if (checkMachine.recordset[0].count > 0) {
                throw new Error("⛔ Esta máquina ya tiene un lote en producción.");
            }

            // Actualizar Rollo
            await new sql.Request(transaction)
                .input('RolloID', sql.VarChar(20), rollId)
                .input('MaquinaID', sql.Int, machineId)
                .query(`
                    UPDATE dbo.Rollos 
                    SET MaquinaID = @MaquinaID, Estado = 'Producción', 
                        FechaInicioProduccion = ISNULL(FechaInicioProduccion, GETDATE())
                    WHERE RolloID = @RolloID
                `);

            // Actualizar Órdenes (Heredan máquina)
            await new sql.Request(transaction)
                .input('RolloID', sql.VarChar(20), rollId)
                .input('MaquinaID', sql.Int, machineId)
                .query(`
                    UPDATE dbo.Ordenes 
                    SET Estado = 'Imprimiendo', MaquinaID = @MaquinaID
                    WHERE RolloID = @RolloID AND Estado NOT IN ('Finalizado', 'Entregado')
                `);
        } 
        
        // CASO B: DESMONTAR (BAJAR DE LA MÁQUINA)
        else {
            // Actualizar Rollo (Quitar máquina)
            await new sql.Request(transaction)
                .input('RolloID', sql.VarChar(20), rollId)
                .query(`
                    UPDATE dbo.Rollos 
                    SET MaquinaID = NULL, Estado = 'Abierto' -- Vuelve a estado editable
                    WHERE RolloID = @RolloID
                `);

            // Actualizar Órdenes (LIMPIEZA DE CAMPO MAQUINAID)
            await new sql.Request(transaction)
                .input('RolloID', sql.VarChar(20), rollId)
                .query(`
                    UPDATE dbo.Ordenes 
                    SET Estado = 'En Lote', 
                        MaquinaID = NULL -- <--- AQUÍ SE LIMPIA EL CAMPO
                    WHERE RolloID = @RolloID AND Estado NOT IN ('Finalizado', 'Entregado')
                `);
        }

        await transaction.commit();
        res.json({ success: true });

    } catch (err) {
        if (transaction) await transaction.rollback();
        const status = err.message.includes('⛔') ? 400 : 500;
        res.status(status).json({ error: err.message });
    }
};

// =====================================================================
// 3. START / STOP (El Corazón de las Métricas)
// =====================================================================
exports.toggleRollStatus = async (req, res) => {
    const { rollId, action } = req.body; // 'start' | 'stop'
    
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Obtener ID de la máquina actual del rollo
        const rollData = await new sql.Request(transaction)
            .input('RID', sql.VarChar(20), rollId)
            .query("SELECT MaquinaID FROM dbo.Rollos WHERE RolloID = @RID");
            
        const maquinaId = rollData.recordset[0]?.MaquinaID;

        if (action === 'start') {
            if (!maquinaId) throw new Error("El rollo no está montado en ninguna máquina.");

            // 1. Actualizar Rollo
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("UPDATE dbo.Rollos SET Estado = 'Producción', FechaInicioProduccion = ISNULL(FechaInicioProduccion, GETDATE()) WHERE RolloID = @RID");

            // 2. ABRIR BITÁCORA (Registrar inicio de tiempo)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .input('MID', sql.Int, maquinaId)
                .query("INSERT INTO dbo.BitacoraProduccion (RolloID, MaquinaID, FechaInicio) VALUES (@RID, @MID, GETDATE())");

            // 3. Órdenes -> Imprimiendo
            await new sql.Request(transaction).input('RID', rollId)
                .query("UPDATE dbo.Ordenes SET Estado = 'Imprimiendo', MaquinaID = (SELECT MaquinaID FROM dbo.Rollos WHERE RolloID=@RID) WHERE RolloID = @RID AND Estado NOT IN ('Finalizado','Entregado')");

        } else { // STOP
            // 1. Actualizar Rollo
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("UPDATE dbo.Rollos SET Estado = 'Pausado' WHERE RolloID = @RID");

            // 2. CERRAR BITÁCORA (Registrar fin de tiempo)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE RolloID = @RID AND FechaFin IS NULL");

            // 3. Órdenes -> Pausado
            await new sql.Request(transaction).input('RID', rollId)
                .query("UPDATE dbo.Ordenes SET Estado = 'En Lote' WHERE RolloID = @RID AND Estado NOT IN ('Finalizado','Entregado')");
        }

        await transaction.commit();
        res.json({ success: true, status: action === 'start' ? 'Producción' : 'Pausado' });

    } catch (err) {
        if (transaction) await transaction.rollback();
        res.status(500).json({ error: err.message });
    }
};

// ... (exports.closeRoll se mantiene igual, pero agregando cierre de bitácora)
exports.closeRoll = async (req, res) => {
    const { rollId } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        // CERRAR CUALQUIER TIEMPO ABIERTO
        await new sql.Request(transaction).input('RID', rollId)
            .query("UPDATE dbo.BitacoraProduccion SET FechaFin = GETDATE() WHERE RolloID = @RID AND FechaFin IS NULL");

        // CERRAR ROLLO Y ORDENES
        await new sql.Request(transaction).input('RID', rollId)
            .query("UPDATE dbo.Rollos SET Estado = 'Cerrado', FechaFinProduccion = GETDATE() WHERE RolloID = @RID");
            
        await new sql.Request(transaction).input('RID', rollId)
            .query("UPDATE dbo.Ordenes SET Estado = 'Finalizado' WHERE RolloID = @RID");

        await transaction.commit();
        res.json({ success: true });
    } catch (e) {
        if (transaction) await transaction.rollback();
        res.status(500).json({ error: e.message });
    }
};