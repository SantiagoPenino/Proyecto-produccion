const { getPool, sql } = require('../config/db');

// ==========================================
// 1. OBTENER TABLERO KANBAN (GET)
// ==========================================
// 1. OBTENER TABLERO KANBAN
exports.getBoardData = async (req, res) => {
    let { area } = req.query;
    try {
        if (!area) return res.status(400).json({ error: "Area requerida" });
        if (area.toLowerCase().startsWith('planilla-')) {
            area = area.replace('planilla-', '').toUpperCase();
        }
        // if (area === 'DF') area = 'DTF'; // DISABLED: User requested no forced conversion

        console.log(`[getBoardData] Buscando rollos para Area: '${area}'`);
        console.log("[getBoardData] 🔴 EJECUTANDO SQL CON @AreaID =", area);
        // Se asume que area viene limpia (AreaKey) desde el frontend

        const pool = await getPool();

        // A. TRAER ROLLOS ACTIVOS
        const rollsRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query("SELECT * FROM dbo.Rollos WHERE AreaID = @AreaID AND Estado != 'Cerrado'");

        // B. TRAER ÓRDENES (Consulta Completa con Conteo de Archivos)
        const ordersRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT 
                    o.OrdenID, 
                    o.CodigoOrden, 
                    o.Cliente, 
                    o.DescripcionTrabajo, 
                    o.Magnitud, 
                    o.Material, 
                    o.Variante, 
                    o.RolloID, 
                    o.Prioridad, 
                    o.Estado, 
                    o.FechaIngreso, 
                    o.Secuencia,
                    o.Tinta, -- ✅ AGREGADO
                    
                    -- ✅ SUBCONSULTA PARA CONTAR ARCHIVOS (Usando tu tabla dbo.ArchivosOrden)
                    (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) AS CantidadArchivos

                FROM dbo.Ordenes o 
                WHERE o.AreaID = @AreaID
                AND o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado', 'Pronto')
                
                -- Ordenamos por Secuencia para mantener el orden del Drag & Drop
                ORDER BY ISNULL(o.Secuencia, 999999), o.OrdenID ASC
            `);

        // Mapeo de Rollos
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

        // Mapeo de Órdenes
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
                rollId: o.RolloID,
                sequence: o.Secuencia,
                ink: o.Tinta, // ✅ Mapeado

                // ✅ AQUÍ ASIGNAMOS LA CANTIDAD DE ARCHIVOS
                fileCount: o.CantidadArchivos || 0
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

        // Calcular resumen de material para cada rollo
        rolls.forEach(r => {
            // Normalizamos y filtramos materiales nulos o placeholders
            const ignored = ['SIN MATERIAL ESPECIFICADO', 'SIN MATERIAL', 'NINGUNO', 'N/A', 'VARIOS'];

            const rawMaterials = r.orders.map(o => (o.material || '').trim());
            const validMaterials = rawMaterials.filter(m => m && !ignored.includes(m.toUpperCase()));
            const uniqueMaterials = [...new Set(validMaterials)];

            if (uniqueMaterials.length === 0) r.material = '-'; // Si no hay materiales validos
            else if (uniqueMaterials.length === 1) r.material = uniqueMaterials[0];
            else r.material = 'Varios Materiales';

            // DEBUG LOG for Roll 8
            if (String(r.id).includes('8') || r.name.includes('8')) {
                console.log(`------ DEBUG ROLL ${r.id} (${r.name}) ------`);
                r.orders.forEach(o => console.log(`   [Ord ${o.code}] Mat: '${o.material}'`));
                console.log(`   -> Unique Valid: ${JSON.stringify(uniqueMaterials)}`);
                console.log(`   -> Final: '${r.material}'`);
                console.log('---------------------------------------------');
            }
        });

        res.json({ rolls, pendingOrders });

    } catch (err) {
        console.error("Error obteniendo tablero:", err);
        res.status(500).json({ error: err.message });
    }
};
// ==========================================
// 2. MOVER ORDEN ENTRE ROLLOS (POST)
// ==========================================
exports.moveOrder = async (req, res) => {
    const { orderIds, orderId, targetRollId } = req.body;

    // Normalización: siempre trabajamos con un array
    let idsToMove = [];
    if (Array.isArray(orderIds)) idsToMove = orderIds;
    else if (Array.isArray(orderId)) idsToMove = orderId;
    else if (orderId) idsToMove = [orderId];

    try {
        const pool = await getPool();

        // 1. Validar que el rollo de origen no esté bloqueado (opcional, pero recomendado)
        if (idsToMove.length > 0) {
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

        // 2. Transacción para mover las órdenes
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            for (const id of idsToMove) {
                await new sql.Request(transaction)
                    .input('OrdenID', sql.Int, id)
                    .input('RolloID', sql.VarChar(20), targetRollId || null)
                    .query(`
                        UPDATE dbo.Ordenes 
                        SET 
                            RolloID = @RolloID,
                            -- Si se mueve a "Pendientes" (null), la secuencia se reinicia a NULL
                            Secuencia = CASE WHEN @RolloID IS NULL THEN NULL ELSE Secuencia END,
                            
                            -- Heredar máquina del nuevo rollo
                            MaquinaID = CASE 
                                WHEN @RolloID IS NULL THEN NULL 
                                ELSE (SELECT MaquinaID FROM dbo.Rollos WHERE RolloID = @RolloID) 
                            END,

                            -- Actualizar estado según el estado del rollo destino
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


            // 3. AUTO-CLEANUP: Verificar si quedamos rollos vacíos y cancelarlos
            // Obtenemos los IDs de los rollos afectados por el movimiento (los "orígenes" que ahora podrían estar vacíos)
            // Ojo: No tenemos el origen explícito en el body, así que hacemos un barrido rápido de rollos abiertos sin órdenes.

            // Estrategia más segura: Buscar rollos activos que tengan 0 órdenes asociadas y cancelarlos + desmontarlos.
            await new sql.Request(transaction).query(`
                UPDATE dbo.Rollos
                SET Estado = 'Cancelado',
                    MaquinaID = NULL
                WHERE Estado IN ('Abierto', 'En Cola', 'En maquina', 'Pausado')
                AND (SELECT COUNT(*) FROM dbo.Ordenes WHERE RolloID = dbo.Rollos.RolloID) = 0
            `);

            await transaction.commit();
            res.json({ success: true });

        } catch (innerErr) {
            await transaction.rollback();
            console.error("Rollback ejecutado por error interno:", innerErr);
            throw innerErr;
        }

    } catch (err) {
        console.error("Error moviendo orden:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. CREAR NUEVO ROLLO (POST)
// ==========================================
exports.createRoll = async (req, res) => {
    let { areaId, name, capacity, color, bobinaId } = req.body;
    // if (areaId === 'DF') areaId = 'DTF'; // DISABLED: User requested to keep DF

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Generar ID único tipo "R-987654"
            const rollId = `R-${Date.now().toString().slice(-6)}`;

            // 1. Si viene BobinaID, la gestionamos
            if (bobinaId) {
                // Verificar y reservar
                const bobinaCheck = await new sql.Request(transaction)
                    .input('BID', sql.Int, bobinaId)
                    .query("SELECT BobinaID, MetrosRestantes FROM InventarioBobinas WHERE BobinaID = @BID AND Estado = 'Disponible'");

                if (bobinaCheck.recordset.length === 0) {
                    throw new Error("La bobina seleccionada ya no está disponible o no existe.");
                }

                // Actualizar estado bobina
                await new sql.Request(transaction)
                    .input('BID', sql.Int, bobinaId)
                    .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");

                // Si no se pasó capacidad explícita, usamos la de la bobina
                if (!capacity) {
                    capacity = bobinaCheck.recordset[0].MetrosRestantes;
                }
            }

            // 2. Crear Rollo
            await new sql.Request(transaction)
                .input('RolloID', sql.VarChar(20), rollId)
                .input('Nombre', sql.NVarChar(100), name || `Lote ${rollId}`)
                .input('AreaID', sql.VarChar(20), areaId)
                .input('Capacidad', sql.Decimal(10, 2), capacity || 100)
                .input('Color', sql.VarChar(10), color || '#3b82f6')
                .input('BobinaID', sql.Int, bobinaId || null)
                .query(`
                    SET IDENTITY_INSERT dbo.Rollos ON;
                    INSERT INTO dbo.Rollos (RolloID, Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, MaquinaID, FechaCreacion, BobinaID)
                    VALUES (@RolloID, @Nombre, @AreaID, @Capacidad, @Color, 'Abierto', NULL, GETDATE(), @BobinaID);
                    SET IDENTITY_INSERT dbo.Rollos OFF;
                `);

            await transaction.commit();
            res.json({ success: true, rollId, message: 'Rollo creado exitosamente' });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Error creando rollo:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4. REORDENAR ÓRDENES DENTRO DE UN ROLLO (POST)
// ==========================================
exports.reorderOrders = async (req, res) => {
    const { rollId, orderIds } = req.body;
    // orderIds espera un array ej: [105, 102, 108] en el orden deseado

    if (!rollId || !Array.isArray(orderIds)) {
        return res.status(400).json({ error: "Datos inválidos: rollId y orderIds requeridos" });
    }

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Iteramos sobre el array que envió el frontend.
            // El índice (i) + 1 será la nueva secuencia.
            for (let i = 0; i < orderIds.length; i++) {
                const orderId = orderIds[i];
                const newSequence = i + 1;

                await new sql.Request(transaction)
                    .input('Secuencia', sql.Int, newSequence)
                    .input('OID', sql.Int, orderId)
                    // CORRECCIÓN: Usamos VarChar(20) porque tus IDs de rollo son strings (ej 'R-123456')
                    .input('RolloID', sql.VarChar(20), rollId)
                    .query(`
                        UPDATE dbo.Ordenes 
                        SET Secuencia = @Secuencia 
                        WHERE OrdenID = @OID AND RolloID = @RolloID
                    `);
            }

            await transaction.commit();
            res.json({ success: true, message: "Orden actualizado correctamente" });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (error) {
        console.error("Error reordenando:", error);
        res.status(500).json({ error: error.message });
    }
};
// ... (Tus otras funciones getBoardData, moveOrder, etc.)

// 5. ACTUALIZAR DETALLES GENERALE DEL ROLLO (Nombre, Color, Bobina, Capacidad)
exports.updateRollGeneral = async (req, res) => {
    // Frontend sends 'BobinaID' (PascalCase) usually, but we check both just in case
    let { rollId, name, color, BobinaID, bobinaId, capacity } = req.body;

    // Normalize bobinaId
    if (BobinaID !== undefined) bobinaId = BobinaID;

    // Si viene solo rollId sin nada que actualizar, retornamos error
    if (!rollId) return res.status(400).json({ error: "Falta rollId" });

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Construir Query Dinámica según lo que venga
            const updates = [];
            const request = new sql.Request(transaction);
            request.input('RID', sql.VarChar(50), String(rollId));

            if (name !== undefined) {
                updates.push("Nombre = @Nombre");
                request.input('Nombre', sql.NVarChar(100), name);
            }
            if (color !== undefined) {
                updates.push("ColorHex = @Color");
                request.input('Color', sql.VarChar(20), color);
            }
            if (capacity !== undefined) {
                updates.push("CapacidadMaxima = @Capacidad");
                request.input('Capacidad', sql.Decimal(10, 2), capacity);
            }

            // Lógica Especial Bobina
            if (bobinaId !== undefined) {
                updates.push("BobinaID = @BobinaID");
                request.input('BobinaID', sql.Int, bobinaId ? Number(bobinaId) : null);

                // Si asignamos bobina, verificar disponibilidad y actualizar inventario (si era null antes)
                // Para simplificar hoy: solo validamos existencia si no es null
                if (bobinaId) {
                    const check = await new sql.Request(transaction)
                        .input('BID', sql.Int, Number(bobinaId))
                        .query("SELECT MetrosRestantes FROM InventarioBobinas WHERE BobinaID = @BID");

                    if (check.recordset.length === 0) throw new Error("Bobina no existe");

                    // Marcar como En Uso
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, Number(bobinaId))
                        .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID AND Estado = 'Disponible'");
                }
            }

            if (updates.length > 0) {
                const query = `UPDATE dbo.Rollos SET ${updates.join(', ')} WHERE CAST(RolloID AS VARCHAR(50)) = @RID`;
                await request.query(query);

                // ✅ Si se actualizó la bobina, propagar a las órdenes del rollo
                if (bobinaId !== undefined) {
                    await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), String(rollId))
                        .input('BID', sql.Int, Number(bobinaId))
                        .query("UPDATE dbo.Ordenes SET BobinaID = @BID WHERE CAST(RolloID AS VARCHAR(50)) = @RID");
                }
            }

            await transaction.commit();
            res.json({ success: true, message: "Rollo actualizado" });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Error actualizando rollo:", err);
        res.status(500).json({ error: err.message });
    }
};

// COMPATIBILIDAD VIEJA (UpdateName solamente) - Se mantiene redirigida o independiente
exports.updateRollName = exports.updateRollGeneral;

// ==========================================
// 5.b INTERCAMBIO DE BOBINA (SWAP)
// ==========================================
exports.swapBobina = async (req, res) => {
    const { rollId, oldBobinaId, newBobinaId, actionOld } = req.body;
    // actionOld: 'exhausted' (se acabó, poner a 0) | 'return' (devolver al stock con lo que tenga)

    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. GESTIONAR BOBINA VIEJA (Si existe)
            if (oldBobinaId) {
                // Obtener datos actuales para log
                const oldData = await new sql.Request(transaction)
                    .input('BID', sql.Int, oldBobinaId)
                    .query("SELECT MetrosRestantes, InsumoID, CodigoEtiqueta FROM InventarioBobinas WHERE BobinaID = @BID");

                if (oldData.recordset.length > 0) {
                    const { MetrosRestantes, InsumoID, CodigoEtiqueta } = oldData.recordset[0];
                    const { wasteMeters, wasteReason } = req.body; // Nuevos parámetros

                    let nuevoEstado = 'Disponible';
                    let metrosActuales = MetrosRestantes;

                    // 1.a Registrar Desperdicio/Fallo si existe
                    if (wasteMeters && wasteMeters > 0) {
                        metrosActuales = Math.max(0, metrosActuales - Number(wasteMeters));

                        await new sql.Request(transaction)
                            .input('IID', sql.Int, InsumoID)
                            .input('Cant', sql.Decimal(10, 2), wasteMeters)
                            .input('Ref', sql.NVarChar(200), `Fallo/Merma en Rollo ${rollId} (Bobina ${CodigoEtiqueta}): ${wasteReason || 'Sin motivo'}`)
                            .input('UID', sql.Int, userId)
                            .input('BID', sql.Int, oldBobinaId)
                            .query("INSERT INTO MovimientosInsumos (InsumoID, TipoMovimiento, Cantidad, Referencia, UsuarioID, BobinaID) VALUES (@IID, 'MERMA_REIMPRESION', @Cant, @Ref, @UID, @BID)");
                    }

                    let metrosFinales = metrosActuales;
                    let consumoRegistrado = 0;

                    if (actionOld === 'exhausted') {
                        nuevoEstado = 'Agotado';
                        consumoRegistrado = metrosActuales; // El resto se consumió en producción (o se tiró sin marcar como merma específica)
                        metrosFinales = 0;
                    }
                    // Si es 'return', metrosFinales ya es metrosActuales (Restantes - Waste)

                    // Actualizar Bobina Vieja
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, oldBobinaId)
                        .input('St', sql.VarChar(20), nuevoEstado)
                        .input('Met', sql.Decimal(10, 2), metrosFinales)
                        .query(`
                            UPDATE InventarioBobinas 
                            SET Estado = @St, MetrosRestantes = @Met,
                                FechaAgotado = CASE WHEN @St='Agotado' THEN GETDATE() ELSE NULL END
                            WHERE BobinaID = @BID
                        `);

                    // Registrar Consumo "Normal" (Producción) si hubo consumo total y no fue todo merma
                    if (consumoRegistrado > 0) {
                        await new sql.Request(transaction)
                            .input('IID', sql.Int, InsumoID)
                            .input('Cant', sql.Decimal(10, 2), consumoRegistrado)
                            .input('Ref', sql.NVarChar(200), `Consumo Final en Rollo ${rollId} (Bobina ${CodigoEtiqueta})`)
                            .input('UID', sql.Int, userId)
                            .input('BID', sql.Int, oldBobinaId)
                            .query("INSERT INTO MovimientosInsumos (InsumoID, TipoMovimiento, Cantidad, Referencia, UsuarioID, BobinaID) VALUES (@IID, 'CONSUMO', @Cant, @Ref, @UID, @BID)");
                    }
                }
            }

            // 2. ASIGNAR BOBINA NUEVA
            // Verificar nueva
            const checkNew = await new sql.Request(transaction)
                .input('BID', sql.Int, newBobinaId)
                .query("SELECT Estado FROM InventarioBobinas WHERE BobinaID = @BID");

            if (checkNew.recordset.length === 0) throw new Error("Bobina nueva no existe");

            // Marcar Nueva como En Uso
            await new sql.Request(transaction)
                .input('BID', sql.Int, newBobinaId)
                .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");

            // 3. ACTUALIZAR ROLLO
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .input('BID', sql.Int, newBobinaId)
                .query("UPDATE Rollos SET BobinaID = @BID WHERE RolloID = @RID");

            // 4. PROPAGAR CAMBIO A ÓRDENES (Sincronización)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .input('BID', sql.Int, newBobinaId)
                .query("UPDATE dbo.Ordenes SET BobinaID = @BID WHERE RolloID = @RID");

            await transaction.commit();
            res.json({ success: true, message: "Cambio de bobina registrado exitosamente." });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error swapBobina:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 6. DESARMAR ROLLO (DEVOLVER TODO)
// ==========================================
exports.dismantleRoll = async (req, res) => {
    const { rollId } = req.body;
    if (!rollId) return res.status(400).json({ error: "Falta rollId" });

    console.log(`[dismantleRoll] Desarmando rollo: ${rollId}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Liberar Ordenes (Vuelta a Pendientes)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(50), rollId.toString())
                .query(`
                    UPDATE dbo.Ordenes 
                    SET 
                        RolloID = NULL, 
                        BobinaID = NULL, -- ✅ Limpiar BobinaID
                        MaquinaID = NULL,
                        Secuencia = NULL, 
                        Estado = 'Pendiente', 
                        EstadoenArea = 'Pendiente'
                    WHERE CAST(RolloID AS VARCHAR(50)) = @RID
                    AND Estado != 'Finalizado' 
                `);

            // 2. Cancelar el Rollo y Liberar Máquina
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(50), rollId.toString())
                .query(`
                    UPDATE dbo.Rollos 
                    SET Estado = 'Cancelado',
                        MaquinaID = NULL
                    WHERE CAST(RolloID AS VARCHAR(50)) = @RID
                `);

            await transaction.commit();
            res.json({ success: true, message: "Rollo desarmado." });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) {
        console.error("Error desarmando rollo:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 8. SPLIT ROLLO (CORTE DE LOTE POR CAMBIO DE BOBINA)
// ==========================================
exports.splitRoll = async (req, res) => {
    const { rollId, lastOrderId, newBobinaId } = req.body;
    // rollId: Rollo actual
    // lastOrderId: ÚLTIMA orden que se imprimió correctamente con la bobina vieja
    // newBobinaId: Bobina para el NUEVO rollo (donde irán las ordenes restantes)

    if (!rollId || !lastOrderId) {
        return res.status(400).json({ error: "Falta rollId o lastOrderId" });
    }

    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. OBTENER INFORMACIÓN DEL ROLLO ACTUAL
            const rollRes = await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("SELECT * FROM Rollos WHERE RolloID = @RID");

            if (rollRes.recordset.length === 0) throw new Error("Rollo no encontrado");
            const oldRoll = rollRes.recordset[0];

            // 2. CREAR NUEVO ROLLO (Clonando datos básicos)
            // Generar nuevo ID
            const newRollId = `R-${Date.now().toString().slice(-6)}-B`;
            const newRollName = `${oldRoll.Nombre} (Parte 2)`;

            // Si hay nueva bobina, la marcamos en uso
            if (newBobinaId) {
                await new sql.Request(transaction)
                    .input('BID', sql.Int, newBobinaId)
                    .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");
            }

            // Insertar Nuevo Rollo
            await new sql.Request(transaction)
                .input('ID', sql.VarChar(20), newRollId)
                .input('Nom', sql.NVarChar(100), newRollName)
                .input('Area', sql.VarChar(20), oldRoll.AreaID)
                .input('Cap', sql.Decimal(10, 2), oldRoll.CapacidadMaxima)
                .input('Col', sql.VarChar(10), oldRoll.ColorHex || '#cbd5e1')
                .input('BID', sql.Int, newBobinaId || null) // Nueva bobina o null
                .query(`
                    INSERT INTO Rollos (RolloID, Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, FechaCreacion, BobinaID)
                    VALUES (@ID, @Nom, @Area, @Cap, @Col, 'Abierto', GETDATE(), @BID)
                `);

            // 3. MOVER ÓRDENES RESTANTES AL NUEVO ROLLO
            // Seleccionamos las ordenes del rollo actual cuya secuencia sea MAYOR a la de lastOrderId
            const seqRes = await new sql.Request(transaction)
                .input('OID', sql.Int, lastOrderId)
                .query("SELECT Secuencia FROM Ordenes WHERE OrdenID = @OID");

            const cutOffSeq = seqRes.recordset[0]?.Secuencia || 0;

            await new sql.Request(transaction)
                .input('OldID', sql.VarChar(20), rollId)
                .input('NewID', sql.VarChar(20), newRollId)
                .input('NewBob', sql.Int, newBobinaId || null)
                .input('CutSeq', sql.Int, cutOffSeq)
                .query(`
                    UPDATE Ordenes 
                    SET RolloID = @NewID,
                        Estado = 'Pendiente', -- Vuelven a estado inicial del lote nuevo
                        EstadoenArea = 'En Lote',
                        MaquinaID = NULL -- Se desasignan de la máquina actual
                    WHERE RolloID = @OldID 
                    AND (Secuencia > @CutSeq OR (Secuencia IS NULL AND OrdenID > ${lastOrderId}))
                `);

            // 4. ACTUALIZAR ROLLO VIEJO (FINALIZAR)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("UPDATE Rollos SET Estado = 'Finalizado', MaquinaID = NULL WHERE RolloID = @RID");

            // Marcar ordenes viejas como finalizadas/impresas
            // IMPORTANTE: Solo las que quedaron en el rollo viejo (las que tienen secuencia <= cutOffSeq)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("UPDATE Ordenes SET Estado = 'Finalizado' WHERE RolloID = @RID");

            await transaction.commit();
            res.json({ success: true, newRollId, message: "Lote dividido correctamente." });

        } catch (inner) {
            await transaction.rollback();
            console.error("Rollback splitRoll:", inner);
            throw inner;
        }

    } catch (err) {
        console.error("Error splitRoll:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 6. MÉTRICAS DE ROLLO (Consolidado de rollosController)
// ==========================================
// ... existing code ...

// ==========================================
// 6. MÉTRICAS DE ROLLO (Consolidado de rollosController)
// ==========================================
exports.getRolloMetrics = async (req, res) => {
    try {
        const { rolloId } = req.params;
        if (!rolloId) return res.status(400).json({ error: 'Falta rolloId' });

        const pool = await getPool();

        // 1. Datos Básicos del Rollo (JOIN con ConfigEquipos para el nombre)
        const rolloResult = await pool.request()
            .input('RolloID', sql.VarChar(50), rolloId) // Usamos VarChar para soportar IDs tipo "R-123" o numéricos
            .query(`
                SELECT Top 1 
                    r.RolloID, 
                    r.Nombre, 
                    r.Estado, 
                    r.MaquinaID,
                    ce.Nombre as NombreMaquina
                FROM dbo.Rollos r
                LEFT JOIN dbo.ConfigEquipos ce ON r.MaquinaID = ce.EquipoID
                WHERE CAST(r.RolloID AS VARCHAR(50)) = @RolloID OR r.Nombre = @RolloID
            `);

        const rolloData = rolloResult.recordset[0];
        if (!rolloData) return res.status(404).json({ error: 'Rollo no encontrado' });

        const realRolloId = rolloData.RolloID;

        // 2. Métricas Agregadas (UNA SOLA CONSULTA OPTIMIZADA)
        const metricsRes = await pool.request()
            .input('RID', sql.VarChar(50), realRolloId.toString())
            .query(`
                SELECT 
                    -- Contadores de Ordenes
                    COUNT(DISTINCT O.OrdenID) as TotalOrders,
                    SUM(CASE WHEN O.Estado IN ('Completo', 'Finalizado', 'PRONTO', 'PRONTO SECTOR') THEN 1 ELSE 0 END) as CompletedOrders,
                    SUM(CASE WHEN O.Estado IN ('Falla', 'FALLA') THEN 1 ELSE 0 END) as FailOrders,

                    -- Contadores de Archivos
                    COUNT(AO.ArchivoID) as TotalFiles,
                    SUM(CASE WHEN AO.EstadoArchivo IN ('OK', 'Finalizado') THEN 1 ELSE 0 END) as OKFiles,
                    SUM(CASE WHEN AO.EstadoArchivo IN ('FALLA', 'Falla') THEN 1 ELSE 0 END) as FailFiles,
                    
                    -- Suma de Metros PLANIFICADOS (Total del Lote sumando magnitudes de ordenes)
                    SUM(TRY_CAST(O.Magnitud AS DECIMAL(10,2))) as MetrosTotalesLote,
                    
                    -- Suma de Metros REALES YA PRODUCIDOS (Status OK)
                    (
                        SELECT SUM(ISNULL(AO2.Metros, 0) * ISNULL(AO2.Copias, 1))
                        FROM dbo.ArchivosOrden AO2
                        INNER JOIN dbo.Ordenes O2 ON AO2.OrdenID = O2.OrdenID
                        WHERE CAST(O2.RolloID AS VARCHAR(50)) = CAST(@RID AS VARCHAR(50)) 
                        AND AO2.EstadoArchivo IN ('OK', 'Finalizado')
                    ) as MetrosProducidos

                FROM dbo.Ordenes O
                LEFT JOIN dbo.ArchivosOrden AO ON O.OrdenID = AO.OrdenID
                WHERE CAST(O.RolloID AS VARCHAR(50)) = CAST(@RID AS VARCHAR(50))
            `);

        const m = metricsRes.recordset[0] || {};

        const totalOrders = m.TotalOrders || 0;
        const totalFiles = m.TotalFiles || 0;
        const okFiles = m.OKFiles || 0;

        // Si MetrosTotalesLote es nulo (no hay ordenes o magnitud vacia), asumimos 0
        const metrosTotales = m.MetrosTotalesLote || 0;
        const metrosProducidos = m.MetrosProducidos || 0;

        let execution = 0;
        // Calculo de Ejecución: Preferimos Metros, si no Archivos
        if (metrosTotales > 0) {
            execution = ((metrosProducidos / metrosTotales) * 100).toFixed(0);
        } else if (totalFiles > 0) {
            execution = ((okFiles / totalFiles) * 100).toFixed(0);
        }

        // Capar a 100% visualmente
        if (execution > 100) execution = 100;

        res.json({
            rolloId: realRolloId,
            nombre: rolloData.Nombre,
            estadoMaquina: rolloData.Estado || 'Desconocido',
            maquinaId: rolloData.MaquinaID,
            maquinaNombre: rolloData.NombreMaquina || 'Sin Asignar',
            stats: {
                totalOrders,
                completedOrders: m.CompletedOrders || 0,
                failOrders: m.FailOrders || 0,
                execution: parseInt(execution),
                metrosTotales: parseFloat(metrosTotales).toFixed(2),
                metrosProducidos: parseFloat(metrosProducidos).toFixed(2)
            },
            fileStats: {
                total: totalFiles,
                ok: okFiles,
                fail: m.FailFiles || 0,
                pending: totalFiles - okFiles - (m.FailFiles || 0)
            }
        });

    } catch (err) {
        console.error("Error en getRolloMetrics:", err);
        res.status(500).json({ error: 'Error al obtener métricas de rollo', message: err.message });
    }
};

// ==========================================
// 8. OBTENER DETALLE DE UN ROLLO (Orders + Files)
// ==========================================
exports.getRollDetails = async (req, res) => {
    const { rolloId } = req.params;
    try {
        const pool = await getPool();

        // A. TRAER ROLLO
        const rollsRes = await pool.request()
            .input('RolloID', sql.VarChar(50), rolloId)
            .query("SELECT * FROM dbo.Rollos WHERE CAST(RolloID AS VARCHAR(50)) = @RolloID");

        if (rollsRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Rollo no encontrado' });
        }
        const r = rollsRes.recordset[0];

        // NEW: Get Labels Count for Roll
        const labelsCountRes = await pool.request()
            .input('RolloID', sql.Int, r.RolloID)
            .query("SELECT COUNT(*) as Cnt FROM Etiquetas e JOIN Ordenes o ON e.OrdenID = o.OrdenID WHERE o.RolloID = @RolloID");
        const labelsCount = labelsCountRes.recordset[0].Cnt;

        const rollObj = {
            id: r.RolloID,
            name: r.Nombre || `Lote ${r.RolloID}`,
            capacity: r.CapacidadMaxima || 100,
            color: r.ColorHex || '#cbd5e1',
            status: r.Estado,
            machineId: r.MaquinaID,
            currentUsage: 0,
            labelsCount: labelsCount, // PASS TO FRONT
            orders: []
        };

        // B. TRAER ÓRDENES DEL ROLLO
        const ordersRes = await pool.request()
            .input('RolloID', sql.VarChar(50), rolloId)
            .query(`
                SELECT 
                    o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, 
                    o.Magnitud, o.Material, o.Variante, o.RolloID, 
                    o.Prioridad, o.Estado, o.FechaIngreso, o.Secuencia, o.Tinta, o.NoDocERP, o.IdCabezalERP,
                    (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) AS CantidadArchivos,
                    (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) AS fileCount,
                    -- ✅ SUBQUERY FOR GLOBAL STATUS (Sibling Orders via Root Match)
                    (
                        SELECT O2.AreaID, O2.Estado 
                        FROM Ordenes O2 
                        WHERE 
                            (o.NoDocERP IS NOT NULL AND O2.NoDocERP = o.NoDocERP AND O2.NoDocERP != '')
                            OR 
                            (
                               -- Match text before first parenthesis (The Root Pedido ID)
                               LTRIM(RTRIM(LEFT(O2.CodigoOrden, CHARINDEX('(', O2.CodigoOrden + '(') - 1)))
                               = 
                               LTRIM(RTRIM(LEFT(o.CodigoOrden, CHARINDEX('(', o.CodigoOrden + '(') - 1)))
                            )
                        FOR JSON PATH
                    ) as RelatedStatus
                FROM dbo.Ordenes o 
                WHERE CAST(o.RolloID AS VARCHAR(50)) = @RolloID
                ORDER BY ISNULL(o.Secuencia, 999999), o.OrdenID ASC
            `);

        ordersRes.recordset.forEach(o => {
            const magStr = String(o.Magnitud || '0');
            const magVal = parseFloat(magStr.replace(/[^\d.]/g, '') || 0);

            rollObj.orders.push({
                id: o.OrdenID,
                code: o.CodigoOrden,
                client: o.Cliente,
                desc: o.DescripcionTrabajo,
                magnitude: magVal,
                material: o.Material,
                variantCode: o.Variante,
                entryDate: o.FechaIngreso,
                priority: o.Prioridad,
                status: o.Estado,
                rollId: o.RolloID,
                sequence: o.Secuencia,
                ink: o.Tinta,
                fileCount: o.CantidadArchivos || o.fileCount || 0,
                services: o.RelatedStatus ? JSON.parse(o.RelatedStatus).map(s => ({ area: s.AreaID, status: s.Estado })) : []
            });

            rollObj.currentUsage += magVal;
        });

        res.json(rollObj);

    } catch (err) {
        console.error("Error obteniendo detalle rollo:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 7. LISTADO SIMPLE DE ROLLOS ACTIVOS (Compatibilidad Legacy)
// ==========================================
exports.getRollosActivos = async (req, res) => {
    try {
        let { areaId } = req.query;
        if (areaId && areaId.toLowerCase().startsWith('planilla-')) {
            areaId = areaId.replace('planilla-', '').toUpperCase();
        }
        console.log(`[getRollosActivos] Buscando rollos para AreaID: '${areaId}'`);

        const pool = await getPool();
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), areaId || null)
            .query(`
                SELECT 
                    r.RolloID as id, 
                    r.Nombre as nombre, 
                    r.ColorHex as color, 
                    r.CapacidadMaxima as MetrosTotales,
                    r.Estado, 
                    r.MaquinaID,
                    ce.Nombre as NombreMaquina
                FROM dbo.Rollos r
                LEFT JOIN dbo.ConfigEquipos ce ON r.MaquinaID = ce.EquipoID
                WHERE r.Estado != 'Cerrado' 
                AND (@AreaID IS NULL OR r.AreaID = @AreaID)
                ORDER BY r.FechaCreacion DESC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error("Error en getRollosActivos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.generateRollLabels = async (req, res) => {
    const { id } = req.params;
    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        console.log(`[RollLabels] Generando etiquetas para Rollo ${id} (Usuario: ${userId})`);

        // 1. Obtener órdenes del rollo (activas) con DETALLES
        const ordersRes = await pool.request()
            .input('RolloID', sql.Int, id)
            // Agregamos selection de detalles necesarios
            .query("SELECT OrdenID, CodigoOrden, Cliente, DescripcionTrabajo, Prioridad, Material, Magnitud, AreaID FROM Ordenes WHERE RolloID = @RolloID AND Estado != 'Cancelado'");

        const orders = ordersRes.recordset;
        let generated = 0;
        let errors = 0;

        // 2. Iterar y generar
        for (const o of orders) {
            try {
                const check = await pool.request()
                    .input('OID', sql.Int, o.OrdenID)
                    .query("SELECT COUNT(*) as Cnt FROM Etiquetas WHERE OrdenID = @OID");

                if (check.recordset[0].Cnt === 0) {
                    // Lógica Bultos (Configurable DB)
                    let metrosPorBulto = 60;
                    const areaOrd = o.AreaID || 'GEN';

                    try {
                        const configRes = await pool.request()
                            .input('Clave', sql.VarChar(50), 'METROSBULTOS')
                            .input('AreaID', sql.VarChar(20), areaOrd)
                            .query("SELECT TOP 1 Valor FROM ConfiguracionGlobal WHERE Clave = @Clave AND (AreaID = @AreaID OR AreaID = 'ADMIN') ORDER BY CASE WHEN AreaID = @AreaID THEN 1 ELSE 2 END ASC");

                        if (configRes.recordset.length > 0) {
                            metrosPorBulto = parseFloat(configRes.recordset[0].Valor) || 60;
                        }
                    } catch (e) { }

                    let numBultos = 1;
                    const magClean = (o.Magnitud || '').toString().toLowerCase();
                    const magVal = parseFloat(magClean.replace(/[^\d.]/g, '')) || 0;
                    if (magVal > 0 && !magClean.includes('mm') && !magClean.includes('cm')) {
                        numBultos = Math.max(1, Math.ceil(magVal / metrosPorBulto));
                    }

                    const safeDesc = (o.DescripcionTrabajo || '').replace(/\$\*/g, ' ');
                    const safeMat = (o.Material || '').replace(/\$\*/g, ' ');
                    const area = o.AreaID || 'GEN';

                    for (let i = 1; i <= numBultos; i++) {
                        const qrString = `${o.CodigoOrden} $ * ${i} $ * ${o.Cliente || ''} $ * ${safeDesc} $ * ${o.Prioridad || 'Normal'} $ * ${safeMat} $ * ${o.Magnitud || ''} `;

                        await pool.request()
                            .input('OID', sql.Int, o.OrdenID)
                            .input('Num', sql.Int, i)
                            .input('Tot', sql.Int, numBultos)
                            .input('QR', sql.NVarChar(sql.MAX), qrString)
                            .input('User', sql.VarChar(100), 'Sistema')
                            .input('Area', sql.VarChar(20), area)
                            .query(`
                                INSERT INTO Etiquetas(OrdenID, NumeroBulto, TotalBultos, CodigoQR, FechaGeneracion, Usuario)
                                VALUES(@OID, @Num, @Tot, @QR, GETDATE(), @User);

                                DECLARE @NewID INT = SCOPE_IDENTITY();
                                DECLARE @Code NVARCHAR(50) = @Area + FORMAT(GETDATE(), 'MMdd') + '-' + CAST(@NewID AS NVARCHAR);
                                
                                DECLARE @FinalQR NVARCHAR(MAX) = @QR + ' $ * ' + @Code;
                                UPDATE Etiquetas SET CodigoEtiqueta = @Code, CodigoQR = @FinalQR WHERE EtiquetaID = @NewID;
                            `);
                        generated++;
                    }
                }
            } catch (err) {
                console.error(`Error etiqueta orden ${o.CodigoOrden}:`, err.message);
                errors++;
            }
        }

        res.json({ success: true, generated, errors, message: `Se generaron ${generated} etiquetas nuevas.` });

    } catch (err) {
        console.error("Error bulk generating labels:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.getRollLabels = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('RolloID', sql.Int, id)
            .query(`
                SELECT 
                    e.*, 
                    o.CodigoOrden as OrderCode,
                    o.Cliente,
                    o.DescripcionTrabajo as OrderDesc,
                    o.Material,
                    o.Prioridad,
                    o.Prioridad,
                    o.AreaID as OrderArea,
                    o.ProximoServicio as nextService,
                    -- ✅ SUBQUERY FOR GLOBAL STATUS (Sibling Orders via NoDocERP or Root Match)
                    (
                        SELECT O2.AreaID, O2.Estado 
                        FROM Ordenes O2 
                        WHERE 
                            (o.NoDocERP IS NOT NULL AND O2.NoDocERP = o.NoDocERP AND O2.NoDocERP != '')
                            OR 
                            (
                               LTRIM(RTRIM(LEFT(O2.CodigoOrden, CHARINDEX('(', O2.CodigoOrden + '(') - 1)))
                               = 
                               LTRIM(RTRIM(LEFT(o.CodigoOrden, CHARINDEX('(', o.CodigoOrden + '(') - 1)))
                            )
                        FOR JSON PATH
                    ) as RelatedStatus
                FROM Etiquetas e
                JOIN Ordenes o ON e.OrdenID = o.OrdenID
                WHERE o.RolloID = @RolloID
                ORDER BY o.OrdenID, e.NumeroBulto ASC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getRollHistory = async (req, res) => {
    const { search, area } = req.query;
    try {
        const pool = await getPool();
        let query = `
            SELECT TOP 50
                r.RolloID as id,
                r.Nombre as name,
                r.Estado as status,
                r.FechaCreacion,
                r.AreaID,
                (SELECT COUNT(*) FROM dbo.Ordenes WHERE RolloID = r.RolloID) as orderCount,
                r.MaquinaID,
                ce.Nombre as machineName
            FROM dbo.Rollos r
            LEFT JOIN dbo.ConfigEquipos ce ON r.MaquinaID = ce.EquipoID
            WHERE 1=1
        `;

        const request = pool.request();

        if (area) {
            query += ` AND r.AreaID = @AreaID`;
            request.input('AreaID', sql.VarChar, area);
        }

        if (search) {
            query += ` AND (r.Nombre LIKE @Search OR CAST(r.RolloID AS VARCHAR) LIKE @Search)`;
            request.input('Search', sql.NVarChar, `%${search}%`);
        } else {
            // Si no hay búsqueda específica, solo mostrar finalizados/cerrados por defecto
            // Si hay búsqueda, busca en todo el historial sin importar estado
            query += ` AND r.Estado IN ('Finalizado', 'Cerrado')`;
        }

        query += ` ORDER BY r.FechaCreacion DESC`;

        const result = await request.query(query);
        res.json(result.recordset);

    } catch (err) {
        console.error("Error en getRollHistory:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 8. ASIGNACIÓN MÁGICA DE ROLLOS (DTF / ECOUV)
// ==========================================
exports.magicRollAssignment = async (req, res) => {
    const { areaId } = req.body;
    if (!areaId) return res.status(400).json({ error: "Falta areaId" });

    let cleanArea = areaId.replace('planilla-', '').toUpperCase();
    if (cleanArea === 'DF') cleanArea = 'DTF';
    console.log(`[MagicAssignment] Iniciando armado mágico para ${cleanArea}...`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener órdenes pendientes sin rollo
            const pendingParams = new sql.Request(transaction);
            pendingParams.input('AreaID', sql.VarChar(20), cleanArea);

            const pendingRes = await pendingParams.query(`
                SELECT OrdenID, CodigoOrden, Cliente, Material, Variante, Prioridad, Magnitud
                FROM dbo.Ordenes
                WHERE AreaID = @AreaID 
                AND Estado = 'Pendiente' 
                AND RolloID IS NULL
            `);

            const orders = pendingRes.recordset;
            if (orders.length === 0) {
                await transaction.rollback();
                return res.json({ success: true, message: "No hay órdenes pendientes para agrupar." });
            }

            // 2. Agrupación Lógica: Variante -> Material
            const groups = {};

            orders.forEach(o => {
                const variante = (o.Variante || 'GENERAL').trim().toUpperCase();
                const material = (o.Material || 'VARIOS').trim().toUpperCase();

                // Clave compuesta para agrupar
                const key = `${variante}|||${material}`;

                if (!groups[key]) groups[key] = [];
                groups[key].push(o);
            });

            // Helper de prioridad numérico para ordenar
            const getPrioVal = (p) => {
                const s = (p || '').toUpperCase();
                if (s === 'URGENTE') return 0;
                if (s === 'FALLA') return 1;
                if (s === 'REPOSICION' || s === 'REPOSICIÓN') return 2;
                return 3; // Normal
            };

            let rollsCreated = 0;
            let ordersAssigned = 0;

            // 3. Procesar Grupos
            for (const [key, groupOrders] of Object.entries(groups)) {
                const [varianteName, materialName] = key.split('|||');

                // A. Ordenar por prioridad dentro del grupo
                groupOrders.sort((a, b) => getPrioVal(a.Prioridad) - getPrioVal(b.Prioridad));

                // B. Crear Rollo
                const rollId = `R-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000)}`;
                const rollName = `Lote ${varianteName} - ${materialName.split(' ').slice(0, 3).join(' ')}`; // Nombre corto material
                const capacity = 1000; // Capacidad alta por defecto para mágico

                await new sql.Request(transaction)
                    .input('RolloID', sql.VarChar(20), rollId)
                    .input('Nombre', sql.NVarChar(100), rollName)
                    .input('AreaID', sql.VarChar(20), cleanArea)
                    .input('Capacidad', sql.Decimal(10, 2), capacity)
                    .input('Color', sql.VarChar(10), '#8b5cf6') // Violeta mágico
                    .query(`
                        INSERT INTO dbo.Rollos (RolloID, Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, FechaCreacion)
                        VALUES (@RolloID, @Nombre, @AreaID, @Capacidad, @Color, 'Abierto', GETDATE())
                    `);

                rollsCreated++;

                // C. Asignar Órdenes al Rollo (Con secuencia ordenada)
                let seq = 1;
                for (const ord of groupOrders) {
                    await new sql.Request(transaction)
                        .input('OrdenID', sql.Int, ord.OrdenID)
                        .input('RolloID', sql.VarChar(20), rollId)
                        .input('Secuencia', sql.Int, seq)
                        .query(`
                            UPDATE dbo.Ordenes 
                            SET RolloID = @RolloID, 
                                Estado = 'En Lote', 
                                Secuencia = @Secuencia
                            WHERE OrdenID = @OrdenID
                        `);
                    seq++;
                    ordersAssigned++;
                }
            }

            await transaction.commit();

            res.json({
                success: true,
                rollsCreated,
                ordersAssigned,
                message: `¡Mágia completada! Se crearon ${rollsCreated} lotes con ${ordersAssigned} órdenes asignadas.`
            });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        console.error("Error magicRollAssignment:", err);
        res.status(500).json({ error: err.message });
    }
};