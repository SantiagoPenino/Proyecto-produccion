const { getPool, sql } = require('../config/db');

// 1. Obtener Tablero
exports.getBoardData = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();

        // Rollos activos
        const rollsRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query("SELECT * FROM dbo.Rollos WHERE AreaID = @AreaID AND Estado != 'Cerrado'");

        // Órdenes pendientes o en rollo
        const ordersRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT OrdenID, Cliente, DescripcionTrabajo, Magnitud, RolloID, Prioridad, Estado 
                FROM dbo.Ordenes 
                WHERE AreaID = @AreaID 
                AND (RolloID IS NOT NULL OR Estado = 'Pendiente')
                AND Estado != 'Entregado'
            `);

        const rolls = rollsRes.recordset.map(r => ({
            id: r.RolloID,
            name: r.Nombre || `Lote ${r.RolloID}`,
            capacity: r.CapacidadMaxima || 100,
            color: r.ColorHex || '#cbd5e1',
            currentUsage: 0,
            orders: []
        }));

        const pendingOrders = [];

        ordersRes.recordset.forEach(o => {
            const magStr = String(o.Magnitud || '0');
            const magVal = parseFloat(magStr.replace(/[^\d.]/g, '') || 0);

            const orderObj = {
                id: o.OrdenID,
                client: o.Cliente,
                desc: o.DescripcionTrabajo,
                magnitude: magVal,
                magnitudeStr: o.Magnitud,
                priority: o.Prioridad,
                status: o.Estado
            };

            if (o.RolloID) {
                const roll = rolls.find(r => r.id === o.RolloID);
                if (roll) {
                    roll.orders.push(orderObj);
                    roll.currentUsage += magVal;
                } else {
                    pendingOrders.push(orderObj);
                }
            } else {
                pendingOrders.push(orderObj);
            }
        });

        res.json({ rolls, pendingOrders });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Mover Orden
exports.moveOrder = async (req, res) => {
    const { orderId, targetRollId } = req.body;

    try {
        const pool = await getPool();

        // 1. VALIDACIÓN DE BLOQUEO (Seguridad)
        // Verificar si la orden pertenece actualmente a un Rollo que está CERRADO o en PRODUCCIÓN
        // (Solo permitimos mover si el rollo actual está Abierto o Pausado, o si la orden estaba suelta)
        const checkLock = await pool.request()
            .input('OrdenID', sql.Int, orderId)
            .query(`
                SELECT r.Nombre, r.Estado 
                FROM dbo.Ordenes o
                INNER JOIN dbo.Rollos r ON o.RolloID = r.RolloID
                WHERE o.OrdenID = @OrdenID
            `);

        const currentRoll = checkLock.recordset[0];
        if (currentRoll && (currentRoll.Estado === 'Cerrado' || currentRoll.Estado === 'Producción')) {
            return res.status(400).json({
                error: `⛔ El lote '${currentRoll.Nombre}' está activo o cerrado. No se pueden sacar órdenes.`
            });
        }

        // 2. ACTUALIZACIÓN INTELIGENTE
        // Si targetRollId es NULL (volver a pendientes) -> Limpiamos Rollo y Máquina.
        // Si targetRollId tiene valor -> Asignamos Rollo y HEREDAMOS la Máquina de ese rollo (si tiene).
        await pool.request()
            .input('OrdenID', sql.Int, orderId)
            .input('RolloID', sql.VarChar(20), targetRollId || null)
            .query(`
                UPDATE dbo.Ordenes 
                SET 
                    RolloID = @RolloID,
                    
                    -- Si sacamos del rollo, limpiamos máquina.
                    -- Si metemos al rollo, heredamos la máquina que tenga ese rollo.
                    MaquinaID = CASE 
                        WHEN @RolloID IS NULL THEN NULL 
                        ELSE (SELECT MaquinaID FROM dbo.Rollos WHERE RolloID = @RolloID) 
                    END,

                    -- Estado: Si va a pendiente -> 'Pendiente'. 
                    -- Si va a rollo -> 'En Lote' (o 'Imprimiendo' si el rollo ya está corriendo).
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

        // (Opcional: aquí podrías recalcular totales del rollo si guardas sumatorias en la tabla madre)

        res.json({ success: true });

    } catch (err) {
        console.error("Error moviendo orden:", err);
        res.status(500).json({ error: err.message });
    }
};
// 3. CREAR NUEVO ROLLO (¡ESTO ES LO QUE FALTABA!)
exports.createRoll = async (req, res) => {
    const { areaId, name, capacity, color } = req.body;

    try {
        const pool = await getPool();
        // ID único corto basado en timestamp
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