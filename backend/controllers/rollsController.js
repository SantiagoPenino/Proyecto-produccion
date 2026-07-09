const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

// Asegura columnas para impreso (todas las áreas) y agrupado manual (SB) de órdenes en el lote.
// Se ejecuta una sola vez por proceso (el flag evita el chequeo en cada request).
let _orderColsEnsured = false;
async function ensureOrderColumns(pool) {
    if (_orderColsEnsured) return;
    await pool.request().query(`
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'Impreso' AND Object_ID = Object_ID('dbo.Ordenes'))
            ALTER TABLE dbo.Ordenes ADD Impreso BIT NOT NULL CONSTRAINT DF_Ordenes_Impreso DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'Calandrado' AND Object_ID = Object_ID('dbo.Ordenes'))
            ALTER TABLE dbo.Ordenes ADD Calandrado BIT NOT NULL CONSTRAINT DF_Ordenes_Calandrado DEFAULT 0;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'MetrosGrupoFalla' AND Object_ID = Object_ID('dbo.Ordenes'))
            ALTER TABLE dbo.Ordenes ADD MetrosGrupoFalla DECIMAL(10,2) NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'GrupoManual' AND Object_ID = Object_ID('dbo.Ordenes'))
            ALTER TABLE dbo.Ordenes ADD GrupoManual INT NULL;
        IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'OrdenadoSB' AND Object_ID = Object_ID('dbo.Rollos'))
            ALTER TABLE dbo.Rollos ADD OrdenadoSB BIT NOT NULL CONSTRAINT DF_Rollos_OrdenadoSB DEFAULT 0;
    `);
    _orderColsEnsured = true;
}

// ==========================================
// 0. SIGUIENTE NOMBRE DE LOTE (GET)
// Formato: YYYYMMDD-{area}{N}  — secuencia diaria por área
// Ej: 20260603-df1, 20260603-df2, 20260603-sb1
// ==========================================
exports.getNextRollName = async (req, res) => {
    const { area } = req.query;
    if (!area) return res.status(400).json({ error: 'area requerida' });

    try {
        const pool  = await getPool();
        const now   = new Date();
        const monthNames = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
        const yy    = String(now.getFullYear()).slice(2);
        const mmm   = monthNames[now.getMonth()];
        const dd    = String(now.getDate()).padStart(2, '0');
        const datePrefix = `${yy}${mmm}${dd}`;                 // Ej: "26jun08"
        const areaLower  = area.toLowerCase();            // "df"

        // Contar lotes de esta área creados hoy (cualquier estado)
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .input('Today',  sql.Date, now)
            .query(`
                SELECT COUNT(*) AS Hoy
                FROM dbo.Rollos
                WHERE AreaID = @AreaID
                  AND CAST(FechaCreacion AS DATE) = CAST(@Today AS DATE)
            `);

        const seq  = String((result.recordset[0]?.Hoy || 0) + 1).padStart(2, '0');
        const name = `${datePrefix}-${areaLower}-${seq}`;   // "20260603-df-01"

        res.json({ name });
    } catch (err) {
        logger.error('[getNextRollName] Error:', err);
        res.status(500).json({ error: err.message });
    }
};

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

        // Log suprimido — alta frecuencia de polling
        // Se asume que area viene limpia (AreaKey) desde el frontend

        const pool = await getPool();

        // A. TRAER ROLLOS ACTIVOS
        const rollsRes = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT r.*, u.Nombre AS CreadorNombre, u.IdUsuario AS CreadorId
                FROM dbo.Rollos r
                LEFT JOIN dbo.Usuarios u ON r.UsuarioID = u.IdUsuario
                WHERE r.AreaID = @AreaID
                  AND r.Estado IN ('Abierto', 'En Cola', 'En maquina', 'Producción', 'Pausado')
            `);

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
                    o.EstadoenArea, -- ✅ AGREGADO PARA TABLERO
                    o.FechaIngreso, 
                    o.Secuencia,
                    o.Tinta, -- ✅ AGREGADO
                    
                    -- ✅ SUBCONSULTA PARA CONTAR ARCHIVOS (Usando tu tabla dbo.ArchivosOrden)
                    (SELECT COUNT(*) FROM dbo.ArchivosOrden WHERE OrdenID = o.OrdenID) AS CantidadArchivos

                FROM dbo.Ordenes o
                WHERE o.AreaID = @AreaID
                AND (
                    -- Órdenes dentro de un lote ACTIVO: se cuentan TODAS (total del lote, igual que el detalle)
                    o.RolloID IN (SELECT RolloID FROM dbo.Rollos WHERE AreaID = @AreaID AND Estado IN ('Abierto', 'En Cola', 'En maquina', 'Producción', 'Pausado'))
                    -- Órdenes sin lote (pendientes en la mesa): solo las activas
                    OR (o.RolloID IS NULL AND o.Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado') AND ISNULL(o.EstadoenArea,'') NOT IN ('Pronto', 'PRONTO'))
                )

                -- Ordenamos por Secuencia para mantener el orden del Drag & Drop
                ORDER BY ISNULL(o.Secuencia, 999999), o.OrdenID ASC
            `);

        // Mapeo de Rollos (ordenados por Secuencia DESC si existe, sino por FechaCreacion)
        const rolls = rollsRes.recordset
            .sort((a, b) => {
                const sa = a.Secuencia ?? 0;
                const sb = b.Secuencia ?? 0;
                if (sb !== sa) return sb - sa;
                return new Date(a.FechaCreacion || 0) - new Date(b.FechaCreacion || 0);
            })
            .map(r => ({
            id: r.RolloID,
            name: `${r.Nombre || `Lote ${r.RolloID}`}`,
            rawName: r.Nombre,
            capacity: r.CapacidadMaxima || 100,
            color: r.ColorHex || '#cbd5e1',
            status: r.Estado,
            machineId: r.MaquinaID,
            currentUsage: 0,
            creador: r.CreadorNombre,
            userId: r.CreadorId,
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
                areaStatus: o.EstadoenArea, // ✅ Mapeado
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

            if (uniqueMaterials.length === 0) r.material = '-';
            else if (uniqueMaterials.length === 1) r.material = uniqueMaterials[0];
            else r.material = 'Varios Materiales';

            // Actualizar nombre con material si es un nombre autogenerado o genérico
            if (r.material !== '-') {
                // Si el nombre no tiene el material ya incluido, se lo concatenamos visualmente
                // Ojo: Esto es solo para el frontend, no cambia la DB
                r.name = `${r.rawName || ('Lote ' + r.id)} - ${r.material}`;
            }


        });

        res.json({ rolls, pendingOrders });

    } catch (err) {
        logger.error("Error obteniendo tablero:", err);
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

        // 2. VALIDACION DTF (DF)
        if (idsToMove.length === 0) return res.status(400).json({ error: "No se especificaron órdenes." });

            // VALIDACION DTF (DF)
            if (targetRollId) {
                const orderData = await pool.request()
                    .query(`SELECT AreaID, Variante, Material FROM dbo.Ordenes WHERE OrdenID IN (${idsToMove.join(',')})`);
                
                const isDTF = orderData.recordset.some(o => o.AreaID === 'DF' || o.AreaID === 'DTF');
                
                if (isDTF) {
                    const variantSet = new Set();
                    const materialSet = new Set();
                    
                    orderData.recordset.forEach(o => {
                        variantSet.add((o.Variante || '').trim().toLowerCase());
                        materialSet.add((o.Material || '').trim().toLowerCase());
                    });

                    if (variantSet.size > 1) {
                        return res.status(400).json({ error: "⛔ En DTF no se permite mover órdenes con distintas variantes juntas." });
                    }
                    if (materialSet.size > 1) {
                        return res.status(400).json({ error: "⛔ En DTF no se permite mover órdenes con distintos materiales juntas." });
                    }

                    const existingOrdersData = await pool.request()
                        .input('RID_CHECK', sql.VarChar(20), String(targetRollId))
                        .query(`SELECT TOP 1 Variante, Material FROM dbo.Ordenes WHERE RolloID = @RID_CHECK`);
                    
                    if (existingOrdersData.recordset.length > 0) {
                        const existingOrder = existingOrdersData.recordset[0];
                        const existingVariant = (existingOrder.Variante || '').trim().toLowerCase();
                        const existingMaterial = (existingOrder.Material || '').trim().toLowerCase();
                        
                        const newVariant = Array.from(variantSet)[0];
                        const newMaterial = Array.from(materialSet)[0];

                        if (existingVariant && existingVariant !== newVariant) {
                            return res.status(400).json({ error: `⛔ El lote de destino ya contiene órdenes con variante '${existingOrder.Variante}'. No puedes mezclar variantes en DTF.` });
                        }
                        if (existingMaterial && existingMaterial !== newMaterial) {
                            return res.status(400).json({ error: `⛔ El lote de destino ya contiene órdenes con material '${existingOrder.Material}'. No puedes mezclar materiales en DTF.` });
                        }
                    }
                } // fin if (isDTF)

                // VALIDACION SB
                const isSB = orderData.recordset.some(o => o.AreaID === 'SB');

                if (isSB && targetRollId) {
                    const PAPEL = 'impresión papel';

                    // ¿Las órdenes entrantes son de papel?
                    const incomingEsPapel = orderData.recordset.some(
                        o => (o.Variante || '').trim().toLowerCase() === PAPEL
                    );
                    const incomingEsOtro = orderData.recordset.some(
                        o => (o.Variante || '').trim().toLowerCase() !== PAPEL
                    );

                    // No se puede mover un mix papel+otro en el mismo movimiento
                    if (incomingEsPapel && incomingEsOtro) {
                        return res.status(400).json({
                            error: '⛔ En SB no se pueden mezclar órdenes de "Impresión Papel" con otras variantes en el mismo lote.'
                        });
                    }

                    // Verificar qué hay ya en el lote de destino
                    const existingSB = await pool.request()
                        .input('RID_SB', sql.VarChar(20), String(targetRollId))
                        .query(`SELECT TOP 1 Variante FROM dbo.Ordenes WHERE RolloID = @RID_SB`);

                    if (existingSB.recordset.length > 0) {
                        const existingVariante = (existingSB.recordset[0].Variante || '').trim().toLowerCase();
                        const existingEsPapel = existingVariante === PAPEL;

                        if (existingEsPapel && !incomingEsPapel) {
                            return res.status(400).json({
                                error: '⛔ El lote ya contiene órdenes de "Impresión Papel". No se pueden agregar otras variantes.'
                            });
                        }
                        if (!existingEsPapel && incomingEsPapel) {
                            return res.status(400).json({
                                error: '⛔ El lote ya contiene órdenes de otras variantes. No se puede agregar "Impresión Papel".'
                            });
                        }
                    }
                }
            } // fin if (targetRollId)

            // 2. Transacción para mover las órdenes
            const transaction = new sql.Transaction(pool);
            await transaction.begin();

        try {
            const { changeOrderState } = require('../services/stateManagerService');

            // Principio: si el LOTE destino está en una máquina (tiene MaquinaID, sea impresora o
            // calandra) sus órdenes van 'En Maquina'; si no está en ninguna máquina → 'En Lote'. La
            // orden que se agrega hereda el estado según el MaquinaID del lote (fuente de verdad).
            let loteEstado = 'En Lote';
            if (targetRollId) {
                const loteSt = await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), String(targetRollId))
                    .query(`SELECT MaquinaID FROM dbo.Rollos WHERE CAST(RolloID AS VARCHAR(50)) = @RID`);
                if (loteSt.recordset[0]?.MaquinaID != null) loteEstado = 'En Maquina';
            }

            for (const id of idsToMove) {
                // Columnas estructurales (rollo/secuencia/máquina) en UPDATE directo (no son "estado")
                await new sql.Request(transaction)
                    .input('OrdenID', sql.Int, id)
                    .input('RolloID', sql.VarChar(20), targetRollId ? String(targetRollId) : null)
                    .query(`
                        UPDATE dbo.Ordenes
                        SET RolloID = @RolloID,
                            Secuencia = CASE WHEN @RolloID IS NULL THEN NULL ELSE (SELECT ISNULL(MAX(Secuencia), 0) + 1 FROM dbo.Ordenes WHERE RolloID = @RolloID) END,
                            MaquinaID = CASE WHEN @RolloID IS NULL THEN NULL ELSE (SELECT MaquinaID FROM dbo.Rollos WHERE RolloID = @RolloID) END
                        WHERE OrdenID = @OrdenID
                    `);
                // Estado/EstadoenArea vía servicio central ('En Lote' deriva a Produccion)
                await changeOrderState(transaction, {
                    target : { type: 'ORDER', id },
                    estado : targetRollId ? loteEstado : 'Pendiente',
                    userObj: req.user || 'Sistema',
                    detalle: targetRollId
                        ? (loteEstado === 'En Maquina' ? 'Agregada a lote en máquina' : 'Movida a lote')
                        : 'Movida a Pendientes',
                    io     : req.app.get('socketio'),
                });
            }


            // 3. AUTO-CLEANUP: Verificar si quedamos rollos vacíos y cancelarlos
            // Obtenemos los IDs de los rollos afectados por el movimiento (los "orígenes" que ahora podrían estar vacíos)
            // Ojo: No tenemos el origen explícito en el body, así que hacemos un barrido rápido de rollos abiertos sin órdenes.

            // Estrategia más segura: Buscar rollos que tengan 0 órdenes asociadas y eliminarlos físicamente de la base de datos.
            await new sql.Request(transaction).query(`
                DELETE FROM dbo.Rollos
                WHERE (SELECT COUNT(*) FROM dbo.Ordenes WHERE RolloID = CAST(dbo.Rollos.RolloID AS VARCHAR(50))) = 0
            `);

            await transaction.commit();

            if (req.app.get('socketio')) {
                req.app.get('socketio').emit('server:order_updated', { type: 'order_moved' });
            }

            res.json({ success: true });

        } catch (innerErr) {
            await transaction.rollback();
            logger.error("Rollback ejecutado por error interno:", innerErr);
            throw innerErr;
        }

    } catch (err) {
        logger.error("Error moviendo orden:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 3. CREAR NUEVO ROLLO (POST)
// ==========================================
exports.createRoll = async (req, res) => {
    let { areaId, name, capacity, color, bobinaId } = req.body;
    const userId = req.user ? (req.user.id || req.user.IdUsuario) : null;
    // if (areaId === 'DF') areaId = 'DTF'; // DISABLED: User requested to keep DF

    try {
        const pool = await getPool();

        // Validación: no permitir dos lotes ABIERTOS con el mismo nombre en la misma área.
        if (name && name.trim()) {
            const dup = await pool.request()
                .input('Nombre', sql.NVarChar(100), name.trim())
                .input('AreaID', sql.VarChar(20), areaId)
                .query(`
                    SELECT TOP 1 RolloID FROM dbo.Rollos
                    WHERE AreaID = @AreaID
                      AND LTRIM(RTRIM(Nombre)) = @Nombre
                      AND Estado IN ('Abierto', 'En Cola', 'En maquina', 'Producción', 'Pausado')
                `);
            if (dup.recordset.length > 0) {
                return res.status(409).json({ error: `Ya existe un lote abierto con el nombre "${name.trim()}" en esta área.` });
            }
        }

        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
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

            // 2. Crear Rollo (Dejamos que IDENTITY genere el ID)
            const insertResult = await new sql.Request(transaction)
                .input('Nombre', sql.NVarChar(100), name || '') // Vacío si no hay manual para asignar después
                .input('AreaID', sql.VarChar(20), areaId)
                .input('Capacidad', sql.Decimal(10, 2), capacity || 100)
                .input('Color', sql.VarChar(10), color || '#3b82f6')
                .input('BobinaID', sql.Int, bobinaId || null)
                .input('UsuarioID', sql.Int, userId)
                .query(`
                    INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, MaquinaID, FechaCreacion, BobinaID, UsuarioID)
                    OUTPUT INSERTED.RolloID
                    VALUES (NULLIF(@Nombre, ''), @AreaID, @Capacidad, @Color, 'Abierto', NULL, GETDATE(), @BobinaID, @UsuarioID);
                `);

            const rollId = insertResult.recordset[0].RolloID;

            // 3. Generar Código L-Lote si no venía nombre manual
            if (!name) {
                const autoName = `L-Lote ${areaId} ${rollId}`;
                await new sql.Request(transaction)
                    .input('RID', sql.Int, rollId)
                    .input('AutoName', sql.NVarChar(100), autoName)
                    .query("UPDATE dbo.Rollos SET Nombre = @AutoName WHERE RolloID = @RID");
            }

            await transaction.commit();

            // Emitir evento socket para actualizar el frontend (tablero de planeación)
            if (req.app.get('socketio')) {
                req.app.get('socketio').emit('server:order_updated', { type: 'roll_created', rollId });
            }

            res.json({ success: true, rollId, message: 'Rollo creado exitosamente' });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        logger.error("Error creando rollo:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 4. REORDENAR ÓRDENES DENTRO DE UN ROLLO (POST)
// ==========================================
exports.reorderOrders = async (req, res) => {
    const { rollId, orderIds } = req.body;
    // orderIds espera un array ej: [105, 102, 108] en el orden deseado

    // RolloID en la tabla Ordenes es un Int, así que lo parseamos
    const rollIdInt = parseInt(rollId, 10);

    if (!rollId || isNaN(rollIdInt) || !Array.isArray(orderIds)) {
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
                    .input('RolloID', sql.Int, rollIdInt)
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
        logger.error("Error reordenando:", error);
        res.status(500).json({ error: error.message });
    }
};
// ... (Tus otras funciones getBoardData, moveOrder, etc.)

// 5. ACTUALIZAR DETALLES GENERALE DEL ROLLO (Nombre, Color, Bobina, Capacidad)
exports.updateRollGeneral = async (req, res) => {
    // Frontend sends 'BobinaID' (PascalCase) usually, but we check both just in case
    let { rollId, name, color, BobinaID, bobinaId, capacity, estado } = req.body;

    // Normalize bobinaId
    if (BobinaID !== undefined) bobinaId = BobinaID;

    // Si viene solo rollId sin nada que actualizar, retornamos error
    if (!rollId) return res.status(400).json({ error: "Falta rollId" });

    try {
        const pool = await getPool();

        // Validación: no permitir renombrar a un nombre ya usado por OTRO lote abierto de la misma área.
        if (name !== undefined && name && name.trim()) {
            const dup = await pool.request()
                .input('RID', sql.VarChar(50), String(rollId))
                .input('Nombre', sql.NVarChar(100), name.trim())
                .query(`
                    SELECT TOP 1 r2.RolloID
                    FROM dbo.Rollos r2
                    WHERE LTRIM(RTRIM(r2.Nombre)) = @Nombre
                      AND r2.AreaID = (SELECT AreaID FROM dbo.Rollos WHERE CAST(RolloID AS VARCHAR(50)) = @RID)
                      AND CAST(r2.RolloID AS VARCHAR(50)) <> @RID
                      AND r2.Estado IN ('Abierto', 'En Cola', 'En maquina', 'Producción', 'Pausado')
                `);
            if (dup.recordset.length > 0) {
                return res.status(409).json({ error: `Ya existe un lote abierto con el nombre "${name.trim()}" en esta área.` });
            }
        }

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
            if (estado !== undefined) {
                updates.push("Estado = @Estado");
                request.input('Estado', sql.VarChar(50), estado);
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

            if (req.app.get('socketio')) {
                req.app.get('socketio').emit('server:order_updated', { type: 'roll_updated', rollId });
            }

            res.json({ success: true, message: "Rollo actualizado" });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }

    } catch (err) {
        logger.error("Error actualizando rollo:", err);
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
                            // Consumo/merma SIEMPRE negativo (convención MovimientosInsumos): es una salida.
                            .input('Cant', sql.Decimal(10, 2), -Math.abs(wasteMeters))
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
                            // Consumo SIEMPRE negativo (convención MovimientosInsumos): es una salida.
                            .input('Cant', sql.Decimal(10, 2), -Math.abs(consumoRegistrado))
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

            if (req.app.get('socketio')) {
                req.app.get('socketio').emit('server:order_updated', { type: 'bobina_swapped', rollId });
            }

            res.json({ success: true, message: "Cambio de bobina registrado exitosamente." });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error("Error swapBobina:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// 6. DESARMAR ROLLO (DEVOLVER TODO)
// ==========================================
exports.dismantleRoll = async (req, res) => {
    const { rollId } = req.body;
    if (!rollId) return res.status(400).json({ error: "Falta rollId" });

    logger.info(`[dismantleRoll] Desarmando rollo: ${rollId}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Liberar Ordenes (Vuelta a Pendientes) — vía servicio central (guarda: no tocar finalizadas)
            const { changeOrderState } = require('../services/stateManagerService');
            await changeOrderState(transaction, {
                target  : { type: 'ROLL', id: rollId },
                estado  : 'Pendiente',
                userObj : req.user || 'Sistema',
                detalle : 'Lote desarmado',
                guard   : "Estado != 'Finalizado'",
                extraSet: { RolloID: null, BobinaID: null, MaquinaID: null, Secuencia: null },
                io      : req.app.get('socketio'),
            });

            // 2. Eliminar el Rollo físicamente
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(50), rollId.toString())
                .query(`
                    DELETE FROM dbo.Rollos 
                    WHERE CAST(RolloID AS VARCHAR(50)) = @RID
                `);

            await transaction.commit();

            if (req.app.get('socketio')) {
                req.app.get('socketio').emit('server:order_updated', { type: 'roll_dismantled', rollId });
            }

            res.json({ success: true, message: "Rollo desarmado." });

        } catch (innerErr) {
            await transaction.rollback();
            throw innerErr;
        }
    } catch (err) {
        logger.error("Error desarmando rollo:", err);
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
            const newRollName = `${oldRoll.Nombre} (Parte 2)`;

            // Si hay nueva bobina, la marcamos en uso
            if (newBobinaId) {
                await new sql.Request(transaction)
                    .input('BID', sql.Int, newBobinaId)
                    .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");
            }

            // Insertar Nuevo Rollo
            const splitResult = await new sql.Request(transaction)
                .input('Nom', sql.NVarChar(100), newRollName)
                .input('Area', sql.VarChar(20), oldRoll.AreaID)
                .input('Cap', sql.Decimal(10, 2), oldRoll.CapacidadMaxima)
                .input('Col', sql.VarChar(10), oldRoll.ColorHex || '#cbd5e1')
                .input('BID', sql.Int, newBobinaId || null)
                .query(`
                    INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, FechaCreacion, BobinaID)
                    OUTPUT INSERTED.RolloID
                    VALUES (@Nom, @Area, @Cap, @Col, 'Abierto', GETDATE(), @BID)
                `);

            const newRollId = splitResult.recordset[0].RolloID;

            // 3. MOVER ÓRDENES RESTANTES AL NUEVO ROLLO
            // Seleccionamos las ordenes del rollo actual cuya secuencia sea MAYOR a la de lastOrderId
            const seqRes = await new sql.Request(transaction)
                .input('OID', sql.Int, lastOrderId)
                .query("SELECT Secuencia FROM Ordenes WHERE OrdenID = @OID");

            const cutOffSeq = seqRes.recordset[0]?.Secuencia || 0;

            const { changeOrderState } = require('../services/stateManagerService');
            await changeOrderState(transaction, {
                target  : { type: 'ROLL', id: rollId },
                estado  : 'En Lote',
                userObj : req.user || 'Sistema',
                detalle : 'Lote dividido: órdenes movidas al nuevo lote',
                guard   : `(Secuencia > ${cutOffSeq} OR (Secuencia IS NULL AND OrdenID > ${lastOrderId}))`,
                extraSet: { RolloID: newRollId, MaquinaID: null },
                io      : req.app.get('socketio'),
            });

            // 4. ACTUALIZAR ROLLO VIEJO (FINALIZAR)
            await new sql.Request(transaction)
                .input('RID', sql.VarChar(20), rollId)
                .query("UPDATE Rollos SET Estado = 'Finalizado', MaquinaID = NULL WHERE RolloID = @RID");

            // Marcar ordenes viejas como finalizadas/impresas
            // IMPORTANTE: Solo las que quedaron en el rollo viejo (las que tienen secuencia <= cutOffSeq)
            await changeOrderState(transaction, {
                target : { type: 'ROLL', id: rollId },
                estado : 'Finalizado',
                userObj: req.user || 'Sistema',
                detalle: 'Lote impreso, órdenes finalizadas',
                io     : req.app.get('socketio'),
            });

            await transaction.commit();

            if (req.app.get('socketio')) {
                req.app.get('socketio').emit('server:order_updated', { type: 'roll_split', rollId, newRollId });
            }

            res.json({ success: true, newRollId, message: "Lote dividido correctamente." });

        } catch (inner) {
            await transaction.rollback();
            logger.error("Rollback splitRoll:", inner);
            throw inner;
        }

    } catch (err) {
        logger.error("Error splitRoll:", err);
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
                FROM dbo.Rollos r WITH (NOLOCK)
                LEFT JOIN dbo.ConfigEquipos ce WITH (NOLOCK) ON r.MaquinaID = ce.EquipoID
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
                    SUM(CASE WHEN O.Estado IN ('Completo', 'Finalizado', 'PRONTO SECTOR') OR ISNULL(O.EstadoenArea,'') IN ('Pronto', 'PRONTO') THEN 1 ELSE 0 END) as CompletedOrders,
                    SUM(CASE WHEN O.Estado IN ('Falla', 'FALLA') THEN 1 ELSE 0 END) as FailOrders,

                    -- Contadores de Archivos
                    COUNT(AO.ArchivoID) as TotalFiles,
                    SUM(CASE WHEN AO.EstadoArchivo IN ('OK', 'Finalizado', 'CANCELADO', 'Cancelado') THEN 1 ELSE 0 END) as OKFiles,
                    SUM(CASE WHEN AO.EstadoArchivo IN ('FALLA', 'Falla') THEN 1 ELSE 0 END) as FailFiles,
                    
                    -- Metros TOTALES del Lote: suma de metros reales de TODOS los archivos (base consistente)
                    (
                        SELECT SUM(ISNULL(AO3.Metros, 0) * ISNULL(AO3.Copias, 1))
                        FROM dbo.ArchivosOrden AO3 WITH (NOLOCK)
                        INNER JOIN dbo.Ordenes O3 WITH (NOLOCK) ON AO3.OrdenID = O3.OrdenID
                        WHERE CAST(O3.RolloID AS VARCHAR(50)) = CAST(@RID AS VARCHAR(50))
                    ) as MetrosTotalesLote,
                    
                    -- Metros YA CONTROLADOS (OK, Falla o Cancelado)
                    (
                        SELECT SUM(ISNULL(AO2.Metros, 0) * ISNULL(AO2.Copias, 1))
                        FROM dbo.ArchivosOrden AO2 WITH (NOLOCK)
                        INNER JOIN dbo.Ordenes O2 WITH (NOLOCK) ON AO2.OrdenID = O2.OrdenID
                        WHERE CAST(O2.RolloID AS VARCHAR(50)) = CAST(@RID AS VARCHAR(50)) 
                        AND AO2.EstadoArchivo IN ('OK', 'Finalizado', 'FALLA', 'Falla', 'CANCELADO', 'Cancelado')
                    ) as MetrosProducidos

                FROM dbo.Ordenes O WITH (NOLOCK)
                LEFT JOIN dbo.ArchivosOrden AO WITH (NOLOCK) ON O.OrdenID = AO.OrdenID
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
        logger.error("Error en getRolloMetrics:", err);
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
        await ensureOrderColumns(pool);

        // A. TRAER ROLLO
        const rollsRes = await pool.request()
            .input('RolloID', sql.VarChar(50), rolloId)
            .query("SELECT * FROM dbo.Rollos WHERE CAST(RolloID AS VARCHAR(50)) = @RolloID");

        if (rollsRes.recordset.length === 0) {
            return res.status(404).json({ error: 'Rollo no encontrado' });
        }
        const r = rollsRes.recordset[0];

        // SB: la PRIMERA vez que se abre el lote, fijar la Secuencia por Material A-Z (default
        // histórico) y marcarlo. Después se respeta el orden manual que guarde el usuario.
        // NO se toca un lote ya terminado (Finalizado/Cerrado): en el Historial la vista es de solo
        // lectura y no debe reescribir la secuencia de datos históricos.
        if (String(r.AreaID || '').toUpperCase() === 'SB' && !r.OrdenadoSB && !['Finalizado', 'Cerrado'].includes(r.Estado)) {
            await pool.request()
                .input('RID', sql.VarChar(50), rolloId)
                .query(`
                    ;WITH O AS (
                        SELECT OrdenID, ROW_NUMBER() OVER (
                            ORDER BY LTRIM(RTRIM(ISNULL(Material,''))), LTRIM(RTRIM(ISNULL(Variante,''))), CodigoOrden
                        ) AS rn
                        FROM dbo.Ordenes WHERE CAST(RolloID AS VARCHAR(50)) = @RID
                    )
                    UPDATE ord SET Secuencia = O.rn FROM dbo.Ordenes ord JOIN O ON ord.OrdenID = O.OrdenID;
                    UPDATE dbo.Rollos SET OrdenadoSB = 1 WHERE CAST(RolloID AS VARCHAR(50)) = @RID;
                `);
        }

        // NEW: Get Labels Count for Roll
        const labelsCountRes = await pool.request()
            .input('RolloID', sql.Int, r.RolloID)
            .query("SELECT COUNT(*) as Cnt FROM Etiquetas e JOIN Ordenes o ON e.OrdenID = o.OrdenID WHERE o.RolloID = @RolloID");
        const labelsCount = labelsCountRes.recordset[0].Cnt;

        const rollObj = {
            id: r.RolloID,
            name: r.Nombre || `Lote ${r.RolloID}`,
            areaId: r.AreaID, // el front lo usa para agrupar por material (SB) también desde el Historial
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
                    o.Prioridad, o.Estado, o.FechaIngreso, o.Secuencia, o.Tinta, o.NoDocERP, o.IdCabezalERP, o.Nota, o.Impreso, o.Calandrado, o.MetrosGrupoFalla, o.GrupoManual,
                    o.BobinaTelaID,
                    -- TELA DE CLIENTE: partes de la bobina elegida (para mostrar como material y agrupar por Referencia)
                    ibt.Referencia AS BobRef, ibt.DescripcionTela AS BobDesc, COALESCE(ibt.AnchoReal, ibt.Ancho) AS BobAncho,
                    c.IDCliente AS ClienteIdStr,
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
                LEFT JOIN dbo.Clientes c ON c.CliIdCliente = o.CliIdCliente
                LEFT JOIN dbo.InventarioBobinas ibt ON ibt.BobinaID = o.BobinaTelaID
                WHERE CAST(o.RolloID AS VARCHAR(50)) = @RolloID
                ORDER BY ISNULL(o.Secuencia, 999999), o.OrdenID ASC
            `);

        // Tela de Cliente (variante con "cliente"): material a mostrar = Referencia + DescripcionTela
        // (capitalizada) + Ancho; y la Referencia se usa para agrupar (solo se agrupa si es igual).
        const capTela = (s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

        ordersRes.recordset.forEach(o => {
            const magStr = String(o.Magnitud || '0');
            const magVal = parseFloat(magStr.replace(/[^\d.]/g, '') || 0);

            const esTelaCliente = /cliente/i.test(o.Variante || '');
            const referencia = (esTelaCliente && o.BobRef != null && String(o.BobRef).trim() !== '') ? String(o.BobRef).trim() : null;
            const materialBobina = (esTelaCliente && o.BobDesc)
                ? [o.BobRef, capTela(o.BobDesc), o.BobAncho].filter(x => x != null && String(x).trim() !== '').join(' ')
                : null;

            rollObj.orders.push({
                id: o.OrdenID,
                code: o.CodigoOrden,
                client: o.Cliente,
                clientId: o.ClienteIdStr || '',
                desc: o.DescripcionTrabajo,
                magnitude: magVal,
                groupFallaMeters: (o.MetrosGrupoFalla !== null && o.MetrosGrupoFalla !== undefined) ? parseFloat(o.MetrosGrupoFalla) : null,
                material: o.Material,
                materialBobina,     // Tela de Cliente: material a mostrar (bobina)
                referencia,         // Tela de Cliente: clave de agrupado (Referencia de la bobina)
                variantCode: o.Variante,
                entryDate: o.FechaIngreso,
                priority: o.Prioridad,
                status: o.Estado,
                rollId: o.RolloID,
                sequence: o.Secuencia,
                printed: !!o.Impreso,
                calandered: !!o.Calandrado,
                groupId: o.GrupoManual,
                ink: o.Tinta,
                fileCount: o.CantidadArchivos || o.fileCount || 0,
                note: o.Nota,
                services: o.RelatedStatus ? JSON.parse(o.RelatedStatus).map(s => ({ area: s.AreaID, status: s.Estado })) : []
            });

            rollObj.currentUsage += magVal;
        });

        res.json(rollObj);

    } catch (err) {
        logger.error("Error obteniendo detalle rollo:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// Marcar / desmarcar una orden como IMPRESA (persistente, todas las áreas)
// ==========================================
exports.setOrderPrinted = async (req, res) => {
    const { orderId, printed } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    try {
        const pool = await getPool();
        await ensureOrderColumns(pool);
        await pool.request()
            .input('OID', sql.Int, Number(orderId))
            .input('P', sql.Bit, printed ? 1 : 0)
            .query('UPDATE dbo.Ordenes SET Impreso = @P WHERE OrdenID = @OID');
        res.json({ ok: true });
    } catch (err) {
        logger.error('Error seteando Impreso:', err);
        res.status(500).json({ error: err.message });
    }
};

// Marcar/desmarcar una orden como CALANDRADA (SB, lote en calandra). Espeja setOrderPrinted.
exports.setOrderCalandered = async (req, res) => {
    const { orderId, calandered } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    try {
        const pool = await getPool();
        await ensureOrderColumns(pool);
        await pool.request()
            .input('OID', sql.Int, Number(orderId))
            .input('C', sql.Bit, calandered ? 1 : 0)
            .query('UPDATE dbo.Ordenes SET Calandrado = @C WHERE OrdenID = @OID');
        res.json({ ok: true });
    } catch (err) {
        logger.error('Error seteando Calandrado:', err);
        res.status(500).json({ error: err.message });
    }
};

// Setear la Magnitud (metros) de UNA orden — se usa para editar los metros de las órdenes -F.
exports.setOrderMagnitud = async (req, res) => {
    const { orderId, magnitud } = req.body;
    if (!orderId) return res.status(400).json({ error: 'orderId requerido' });
    try {
        const pool = await getPool();
        const val = (magnitud === '' || magnitud === null || magnitud === undefined) ? null : Number(magnitud);
        if (val !== null && Number.isNaN(val)) return res.status(400).json({ error: 'magnitud inválida' });
        await pool.request()
            .input('OID', sql.Int, Number(orderId))
            .input('M', sql.Decimal(10, 2), val)
            .query('UPDATE dbo.Ordenes SET Magnitud = @M WHERE OrdenID = @OID');
        res.json({ ok: true });
    } catch (err) {
        logger.error('Error seteando Magnitud:', err);
        res.status(500).json({ error: err.message });
    }
};

// Setear el total de metros de un GRUPO de falla (independiente de la Magnitud por orden).
// Guarda el mismo valor en MetrosGrupoFalla de TODAS las órdenes del grupo (orderIds).
exports.setFallaGroupMeters = async (req, res) => {
    const { orderIds, metros } = req.body;
    if (!Array.isArray(orderIds) || orderIds.length === 0) return res.status(400).json({ error: 'orderIds requerido' });
    try {
        const pool = await getPool();
        await ensureOrderColumns(pool);
        const val = (metros === '' || metros === null || metros === undefined) ? null : Number(metros);
        if (val !== null && Number.isNaN(val)) return res.status(400).json({ error: 'metros inválido' });
        const ids = orderIds.map(Number).filter(n => Number.isFinite(n));
        if (ids.length === 0) return res.status(400).json({ error: 'orderIds inválidos' });
        await pool.request()
            .input('M', sql.Decimal(10, 2), val)
            .query(`UPDATE dbo.Ordenes SET MetrosGrupoFalla = @M WHERE OrdenID IN (${ids.join(',')})`);
        res.json({ ok: true });
    } catch (err) {
        logger.error('Error seteando MetrosGrupoFalla:', err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// Agrupar / desagrupar órdenes dentro de un lote (GrupoManual, visual SB)
// ==========================================
exports.setOrderGroup = async (req, res) => {
    const { rollId, orderIds, group } = req.body; // group: true = agrupar, false = desagrupar
    if (!rollId || !Array.isArray(orderIds) || orderIds.length === 0) {
        return res.status(400).json({ error: 'rollId y orderIds requeridos' });
    }
    try {
        const pool = await getPool();
        await ensureOrderColumns(pool);
        const ids = orderIds.map(Number).filter(n => Number.isFinite(n));
        if (ids.length === 0) return res.status(400).json({ error: 'orderIds inválidos' });
        const inList = ids.join(',');
        if (group) {
            const gidRes = await pool.request()
                .input('RID', sql.VarChar(50), String(rollId))
                .query('SELECT ISNULL(MAX(GrupoManual), 0) + 1 AS Gid FROM dbo.Ordenes WHERE CAST(RolloID AS VARCHAR(50)) = @RID');
            const gid = gidRes.recordset[0].Gid;
            await pool.request()
                .input('G', sql.Int, gid)
                .query(`UPDATE dbo.Ordenes SET GrupoManual = @G WHERE OrdenID IN (${inList})`);
        } else {
            await pool.request()
                .query(`UPDATE dbo.Ordenes SET GrupoManual = NULL WHERE OrdenID IN (${inList})`);
        }
        res.json({ ok: true });
    } catch (err) {
        logger.error('Error agrupando/desagrupando órdenes:', err);
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

        // DETECCIÓN DE CONTEXTO
        // Si viene desde '/api/production-file-control', es la Vista de Control de Calidad
        // y el usuario pidió explícitamente ver SOLO los finalizados.
        const isControlView = req.baseUrl && req.baseUrl.includes('production-file-control');

        // Log suprimido — alta frecuencia de polling

        const pool = await getPool();

        // Re-construcción limpia de la query con NOLOCK
        const finalQuery = `
            SELECT 
                r.RolloID as id, 
                r.Nombre as nombre, 
                r.ColorHex as color, 
                r.CapacidadMaxima as MetrosTotales,
                r.Estado, 
                r.MaquinaID,
                ce.Nombre as NombreMaquina
            FROM dbo.Rollos r WITH (NOLOCK)
            LEFT JOIN dbo.ConfigEquipos ce WITH (NOLOCK) ON r.MaquinaID = ce.EquipoID
            WHERE (@AreaID IS NULL OR r.AreaID = @AreaID)
            AND r.Estado NOT IN ('Cerrado', 'Cancelado')
            AND (
                (${isControlView ? 1 : 0} = 0 AND r.Estado != 'Finalizado')
                OR (
                    ${isControlView ? 1 : 0} = 1 AND (
                        r.Estado IN ('En maquina', 'Produccion', 'Imprimiendo')
                        -- Incluir Finalizado solo si aún tiene órdenes no completadas
                        OR (
                            r.Estado = 'Finalizado'
                            AND EXISTS (
                                SELECT 1 FROM dbo.Ordenes o WITH (NOLOCK)
                                WHERE o.RolloID = r.RolloID
                                  AND o.Estado NOT IN ('Finalizado', 'CANCELADO', 'Entregado')
                                  AND ISNULL(o.EstadoenArea,'') NOT IN ('Pronto', 'PRONTO', 'En Transito', 'EN TRANSITO')
                            )
                        )
                    )
                )
            )
            -- SB Control: ocultar lotes en una IMPRESORA (SeparacionImpresion=1) que tengan órdenes de tela
            -- (Sublimacion Tela / Tela de Cliente). Esas van impresora → calandra → control, así que no deben
            -- aparecer en Control hasta pasar a la calandra. Un lote mixto (tela+papel) se oculta entero.
            AND (
                ${isControlView ? 1 : 0} = 0
                OR NOT (
                    ISNULL(ce.SeparacionImpresion, 0) = 1
                    AND EXISTS (
                        SELECT 1 FROM dbo.Ordenes o WITH (NOLOCK)
                        WHERE o.RolloID = r.RolloID AND o.Variante LIKE '%Tela%'
                    )
                )
            )
            ORDER BY r.FechaCreacion DESC
        `;

        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), areaId || null)
            .query(finalQuery);

        res.json(result.recordset);
    } catch (err) {
        logger.error("Error en getRollosActivos:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.generateRollLabels = async (req, res) => {
    const { id } = req.params;
    const userId = req.user ? req.user.id : 1;

    try {
        const pool = await getPool();
        logger.info(`[RollLabels] Generando etiquetas para Rollo ${id} (Usuario: ${userId})`);

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
                logger.error(`Error etiqueta orden ${o.CodigoOrden}:`, err.message);
                errors++;
            }
        }

        res.json({ success: true, generated, errors, message: `Se generaron ${generated} etiquetas nuevas.` });

    } catch (err) {
        logger.error("Error bulk generating labels:", err);
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
        logger.error(err);
        res.status(500).json({ error: err.message });
    }
};

exports.getRollHistory = async (req, res) => {
    const { search, area } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    try {
        const pool = await getPool();
        let query = `
            SELECT
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
        request.input('Offset', sql.Int, offset);
        request.input('Limit', sql.Int, limit);

        if (area) {
            query += ` AND r.AreaID = @AreaID`;
            request.input('AreaID', sql.VarChar, area);
        }

        if (search) {
            query += ` AND (r.Nombre LIKE @Search OR CAST(r.RolloID AS VARCHAR) LIKE @Search)`;
            request.input('Search', sql.NVarChar, `%${search}%`);
        }

        query += ` ORDER BY r.FechaCreacion DESC OFFSET @Offset ROWS FETCH NEXT @Limit ROWS ONLY`;

        const result = await request.query(query);
        res.json({
            data: result.recordset,
            page,
            hasMore: result.recordset.length === limit
        });

    } catch (err) {
        logger.error("Error en getRollHistory:", err);
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
    logger.info(`[MagicAssignment] Iniciando armado mágico para ${cleanArea}...`);

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

                // B. Crear Rollo (Sin ID manual, dejamos que la BD asigne el consecutivo)
                const materialSuffix = materialName.split(' ').slice(0, 3).join(' ');
                const tempName = `L-Lote ${cleanArea} - ${materialSuffix}`;

                const insertRollResult = await new sql.Request(transaction)
                    .input('Nombre', sql.NVarChar(100), tempName)
                    .input('AreaID', sql.VarChar(20), cleanArea)
                    .input('Capacidad', sql.Decimal(10, 2), 1000)
                    .input('Color', sql.VarChar(10), '#8b5cf6') // Violeta mágico
                    .query(`
                        INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, FechaCreacion)
                        OUTPUT INSERTED.RolloID
                        VALUES (@Nombre, @AreaID, @Capacidad, @Color, 'Abierto', GETDATE())
                    `);

                const rollId = insertRollResult.recordset[0].RolloID;

                // Actualizar el nombre final incluyendo el ID real
                const finalName = `L-Lote ${cleanArea} ${rollId} - ${materialSuffix}`;
                await new sql.Request(transaction)
                    .input('RID', sql.Int, rollId)
                    .input('FinalName', sql.NVarChar(100), finalName)
                    .query("UPDATE dbo.Rollos SET Nombre = @FinalName WHERE RolloID = @RID");

                rollsCreated++;

                // C. Asignar Órdenes al Rollo (Con secuencia ordenada)
                const { changeOrderState } = require('../services/stateManagerService');
                let seq = 1;
                for (const ord of groupOrders) {
                    // Estructural: rollo + secuencia
                    await new sql.Request(transaction)
                        .input('OrdenID', sql.Int, ord.OrdenID)
                        .input('RolloID', sql.VarChar(20), rollId)
                        .input('Secuencia', sql.Int, seq)
                        .query(`UPDATE dbo.Ordenes SET RolloID = @RolloID, Secuencia = @Secuencia WHERE OrdenID = @OrdenID`);
                    // Estado/EstadoenArea vía servicio central ('En Lote' deriva a Produccion)
                    await changeOrderState(transaction, {
                        target : { type: 'ORDER', id: ord.OrdenID },
                        estado : 'En Lote',
                        userObj: req.user || 'Sistema',
                        detalle: 'Asignada a lote',
                        io     : req.app.get('socketio'),
                    });
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
        logger.error("Error magicRollAssignment:", err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// COORDINACION: REORDENAR ÓRDENES PENDIENTES
// ==========================================
exports.reorderPendingOrders = async (req, res) => {
    const { areaId, orderIds, movedId } = req.body;
    if (!areaId || !Array.isArray(orderIds) || orderIds.length === 0)
        return res.status(400).json({ error: 'areaId y orderIds son requeridos.' });

    try {
        const pool = await getPool();
        const n = orderIds.length;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            for (let i = 0; i < n; i++) {
                // Mayor índice = más al tope = Secuencia más alta
                const secuencia = n - i;
                await new sql.Request(transaction)
                    .input('OID', sql.Int, orderIds[i])
                    .input('SEQ', sql.Int, secuencia)
                    .input('AREA', sql.VarChar(20), areaId)
                    .query(`UPDATE dbo.Ordenes SET Secuencia = @SEQ
                            WHERE OrdenID = @OID AND AreaID = @AREA AND Estado = 'Pendiente'`);
            }
            await transaction.commit();
            if (req.app.get('socketio')) {
                const idsToFlash = movedId ? [movedId] : orderIds;
                req.app.get('socketio').emit('server:order_updated', { type: 'reorder_pending_orders', areaId, movedIds: idsToFlash });
            }
            res.json({ success: true });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error('reorderPendingOrders error:', err);
        res.status(500).json({ error: err.message });
    }
};

// ==========================================
// COORDINACION: REORDENAR LOTES
// ==========================================
exports.reorderRolls = async (req, res) => {
    const { areaId, rollIds, movedId } = req.body;
    if (!areaId || !Array.isArray(rollIds) || rollIds.length === 0)
        return res.status(400).json({ error: 'areaId y rollIds son requeridos.' });

    try {
        const pool = await getPool();

        // Agregar columna Secuencia a Rollos si no existe
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE Name = 'Secuencia' AND Object_ID = Object_ID('dbo.Rollos')
            )
            ALTER TABLE dbo.Rollos ADD Secuencia INT NULL;
        `);

        const n = rollIds.length;
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            for (let i = 0; i < n; i++) {
                const secuencia = n - i; // primer elemento = más alto
                await new sql.Request(transaction)
                    .input('RID', sql.Int, rollIds[i])
                    .input('SEQ', sql.Int, secuencia)
                    .input('AREA', sql.VarChar(20), areaId)
                    .query(`UPDATE dbo.Rollos SET Secuencia = @SEQ
                            WHERE RolloID = @RID AND AreaID = @AREA
                            -- Incluir TODOS los lotes activos (también 'En Maquina'/'Pausado'). Antes el
                            -- filtro era IN ('Abierto','En Cola') → el lote en máquina no se reordenaba y
                            -- al refrescar el board (sort por Secuencia) volvía a su lugar. Mismo criterio
                            -- de exclusión que la query del board.
                            AND Estado NOT IN ('Cerrado', 'Finalizado', 'Cancelado')`);
            }
            await transaction.commit();
            if (req.app.get('socketio')) {
                const idsToFlash = movedId ? [movedId] : rollIds;
                req.app.get('socketio').emit('server:order_updated', { type: 'reorder_rolls', areaId, movedIds: idsToFlash });
            }
            res.json({ success: true });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        logger.error('reorderRolls error:', err);
        res.status(500).json({ error: err.message });
    }
};

