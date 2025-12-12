const { getPool, sql } = require('../config/db');

// 1. OBTENER TABLERO KANBAN
exports.getBoardData = async (req, res) => {
    let { area } = req.query;
    try {
        if (area && area.toLowerCase().startsWith('planilla-')) {
            area = area.replace('planilla-', '').toUpperCase();
        }
        if (area === 'SUBLIMACION') area = 'SUB';
        if (area === 'BORDADO') area = 'BORD';

        const pool = await getPool();

        // A. TRAER ROLLOS ACTIVOS
        const rollsRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query("SELECT * FROM dbo.Rollos WHERE AreaID = @AreaID AND Estado != 'Cerrado'");

        // B. TRAER ÓRDENES (Con todos los campos necesarios)
        const ordersRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT 
                    OrdenID, CodigoOrden, Cliente, DescripcionTrabajo, Magnitud, 
                    Material, Variante, RolloID, Prioridad, Estado, FechaIngreso
                FROM dbo.Ordenes 
                WHERE AreaID = @AreaID 
                AND (RolloID IS NOT NULL OR Estado = 'Pendiente')
                AND Estado != 'Entregado' AND Estado != 'Finalizado' AND Estado != 'Cancelado'
            `);

        const rolls = rollsRes.recordset.map(r => ({
            id: r.RolloID,
            name: r.Nombre || `Lote ${r.RolloID}`,
            capacity: r.CapacidadMaxima || 100,
            color: r.ColorHex || '#cbd5e1',
            status: r.Estado,
            machineId: r.MaquinaID,
            currentUsage: 0,
            orders: []
        }));

        const pendingOrders = [];

        ordersRes.recordset.forEach(o => {
            const magStr = String(o.Magnitud || '0');
            const magVal = parseFloat(magStr.replace(/[^\d.]/g, '') || 0);

            const orderObj = {
                id: o.OrdenID,
                code: o.CodigoOrden,
                client: o.Cliente,
                desc: o.DescripcionTrabajo,
                magnitude: magVal,
                magnitudeStr: o.Magnitud,
                material: o.Material,
                variantCode: o.Variante,
                entryDate: o.FechaIngreso,
                priority: o.Prioridad,
                status: o.Estado,
                rollId: o.RolloID
            };

            if (o.RolloID) {
                const roll = rolls.find(r => r.id === o.RolloID);
                if (roll) {
                    roll.orders.push(orderObj);
                    roll.currentUsage += magVal;
                }
            } else {
                pendingOrders.push(orderObj);
            }
        });

        res.json({ rolls, pendingOrders });

    } catch (err) {
        console.error("Error obteniendo tablero:", err);
        res.status(500).json({ error: err.message });
    }
};

// 2. MOVER ORDEN (CORREGIDO PARA MULTI-SELECCIÓN)
exports.moveOrder = async (req, res) => {
    const { orderIds, orderId, targetRollId } = req.body;
    
    // --- LÓGICA DE NORMALIZACIÓN SEGURA ---
    // Detectamos si nos enviaron un array o un solo valor y lo unificamos
    let idsToMove = [];

    if (Array.isArray(orderIds)) {
        idsToMove = orderIds; // Si viene en la prop correcta como array
    } else if (Array.isArray(orderId)) {
        idsToMove = orderId;  // Si viene en orderId pero ES un array (esto pasaba antes)
    } else if (orderId) {
        idsToMove = [orderId]; // Si es un valor único, lo convertimos a array
    }

    try {
        const pool = await getPool();

        // 1. VALIDACIÓN DE BLOQUEO
        if (idsToMove.length > 0) {
            // Nota: Para optimizar, en lugar de N consultas, hacemos una.
            // Pero por seguridad mantenemos el loop simple por ahora.
            for (const id of idsToMove) {
                const checkLock = await pool.request()
                    .input('OID', sql.Int, id)
                    .query(`
                        SELECT r.Nombre, r.Estado 
                        FROM dbo.Ordenes o
                        INNER JOIN dbo.Rollos r ON o.RolloID = r.RolloID
                        WHERE o.OrdenID = @OID
                    `);
                
                const currentRoll = checkLock.recordset[0];
                if (currentRoll && (currentRoll.Estado === 'Cerrado' || currentRoll.Estado === 'Producción')) {
                    return res.status(400).json({
                        error: `⛔ El lote '${currentRoll.Nombre}' está activo/cerrado. No se pueden sacar órdenes.`
                    });
                }
            }
        }

        // 2. ACTUALIZACIÓN TRANSACCIONAL
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        for (const id of idsToMove) {
            await new sql.Request(transaction)
                .input('OrdenID', sql.Int, id)
                .input('RolloID', sql.VarChar(20), targetRollId || null)
                .query(`
                    UPDATE dbo.Ordenes 
                    SET 
                        RolloID = @RolloID,
                        
                        -- Heredar máquina
                        MaquinaID = CASE 
                            WHEN @RolloID IS NULL THEN NULL 
                            ELSE (SELECT MaquinaID FROM dbo.Rollos WHERE RolloID = @RolloID) 
                        END,

                        -- Estado
                        Estado = CASE 
                            WHEN @RolloID IS NULL THEN 'Pendiente'
                            ELSE 
                                CASE 
                                    WHEN EXISTS(SELECT 1 FROM dbo.Rollos WHERE RolloID = @RolloID AND Estado = 'Producción') 
                                    THEN 'Imprimiendo' 
                                    ELSE 'En Lote' 
                                END
                            END

                    WHERE OrdenID = @OrdenID
                `);
        }

        await transaction.commit();
        res.json({ success: true });

    } catch (err) {
        if (err.number === 2627) { // Error de clave duplicada u otros SQL errors
             console.error("Error SQL:", err);
        }
        console.error("Error moviendo orden:", err);
        res.status(500).json({ error: err.message });
    }
};

// 3. CREAR NUEVO ROLLO
exports.createRoll = async (req, res) => {
    const { areaId, name, capacity, color } = req.body;

    try {
        const pool = await getPool();
        const rollId = `R-${Date.now().toString().slice(-6)}`;

        await pool.request()
            .input('RolloID', sql.VarChar(20), rollId)
            .input('Nombre', sql.NVarChar(100), name || `Lote ${rollId}`)
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Capacidad', sql.Decimal(10, 2), capacity || 100)
            .input('Color', sql.VarChar(10), color || '#3b82f6')
            .query(`
                INSERT INTO dbo.Rollos (RolloID, Nombre, AreaID, CapacidadMaxima, ColorHex, Estado)
                VALUES (@RolloID, @Nombre, @AreaID, @Capacidad, @Color, 'Abierto')
            `);

        res.json({ success: true, rollId, message: 'Rollo creado' });
    } catch (err) {
        console.error("Error creando rollo:", err);
        res.status(500).json({ error: err.message });
    }
};