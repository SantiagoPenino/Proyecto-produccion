const { getPool, sql } = require('../config/db');

// =====================================================================
// 1. OBTENER ÓRDENES (ACTUALIZADO: Lee Material, Variante y CodigoOrden)
// =====================================================================
exports.getOrdersByArea = async (req, res) => {
    // Soporte para params o query
    let area = req.query.area || req.params.area;
    const { mode, q } = req.query;

    console.log(`🔎 [getOrdersByArea] Request for Area: '${area}', Mode: '${mode}'`);

    try {
        // Limpieza de nombre de área (Tu lógica original)
        if (area && area.toLowerCase().startsWith('planilla-')) {
            area = area.replace('planilla-', '').toUpperCase();
        }
        if (area === 'SUBLIMACION') area = 'SUB';
        if (area === 'BORDADO') area = 'BORD';

        // DEBUG: Force print final area
        console.log(`🔎 [getOrdersByArea] Querying DB with AreaID = '${area}'`);


        const pool = await getPool();

        let query = `
            SELECT 
                o.OrdenID,
                o.CodigoOrden,      -- <--- NUEVO: Código Visual (UV-14 1/3)
                o.IdCabezalERP,
                o.Cliente,
                o.DescripcionTrabajo,
                o.AreaID,
                o.Estado,
                o.EstadoenArea,     -- <--- NUEVO: Estado especifico del area
                o.Prioridad,
                o.FechaIngreso,
                o.FechaHabilitacion,    -- <--- NUEVO: Fecha Real de Habilitación
                o.EstadoDependencia,    -- <--- NUEVO: Dependencia (OK, ESPERANDO_INSUMO)
                o.FechaEstimadaEntrega,
                o.Magnitud,
                o.Material,         -- <--- NUEVO: Descripción del Material
                o.Variante,         -- <--- NUEVO: Código de Stock (1.1.3.1)
                o.RolloID,
                o.Nota,
                o.Tinta,            -- <--- NUEVO: Tinta recuperada
                o.ModoRetiro,       -- <--- NUEVO: Retiro recuperado
                o.UM,               -- <--- NUEVO: Unidad de Medida recuperada
                o.meta_data,
                o.ArchivosCount,
                o.ProximoServicio,
                
                m.Nombre as NombreMaquina,
                
                (
                    SELECT 
                        ArchivoID as id,
                        NombreArchivo as nombre,
                        RutaAlmacenamiento as link,
                        TipoArchivo as tipo,
                        Copias as copias,
                        Metros as metros,
                        Ancho as ancho,
                        Alto as alto,
                        EstadoArchivo as estado,
                        DetalleLinea,
                        Observaciones as notas
                    FROM dbo.ArchivosOrden 
                    WHERE OrdenID = o.OrdenID 
                    FOR JSON PATH
                ) as files_data

            FROM dbo.Ordenes o
            LEFT JOIN dbo.ConfigEquipos m ON o.MaquinaID = m.EquipoID
            WHERE o.AreaID = @Area 
        `;

        const request = pool.request();
        request.input('Area', sql.VarChar(20), area);

        const estadosFinales = "'Entregado', 'Finalizado', 'Cancelado'";
        if (mode === 'history') {
            query += ` AND o.Estado IN (${estadosFinales})`;
        } else if (mode === 'all') {
            // No filtrar por estado
        } else {
            query += ` AND o.Estado NOT IN (${estadosFinales})`;
        }

        if (q) {
            query += ' AND (o.Cliente LIKE @q OR o.CodigoOrden LIKE @q OR CAST(o.OrdenID AS VARCHAR) LIKE @q)';
            request.input('q', sql.NVarChar(100), `%${q}%`);
        }

        query += ` ORDER BY o.Prioridad DESC, o.FechaIngreso ASC`;

        const result = await request.query(query);

        // Mapeo EXACTO para que tu Frontend AG Grid funcione
        const orders = result.recordset.map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden,
            erpId: o.IdCabezalERP,
            client: o.Cliente,
            desc: o.DescripcionTrabajo,
            area: o.AreaID,
            status: o.Estado,
            areaStatus: o.EstadoenArea, // <--- Mapeamos EstadoenArea
            priority: o.Prioridad,
            entryDate: o.FechaIngreso,

            // --- NUEVOS CAMPOS DE SLA REAL ---
            enabledDate: o.FechaHabilitacion, // Cuando se liberó la restricción
            dependencyStatus: o.EstadoDependencia || 'OK', // 'ESPERANDO_INSUMOS', 'OK'
            // --------------------------------

            deliveryDate: o.FechaEstimadaEntrega,
            printer: o.NombreMaquina,
            rollId: o.RolloID,
            magnitude: o.Magnitud,
            unit: o.UM,                 // <--- Mapeamos Unidad

            material: o.Material,       // Descripción
            variantCode: o.Variante,    // CodStock

            note: o.Nota,
            ink: o.Tinta || '',         // <--- Mapeo para el frontend
            retiro: o.ModoRetiro || '',
            filesCount: o.ArchivosCount,
            nextService: o.ProximoServicio || '-',
            meta: o.meta_data ? JSON.parse(o.meta_data) : {},
            filesData: o.files_data ? JSON.parse(o.files_data).map(f => ({
                ...f,
                urlProxy: (f.link && f.link.includes('drive.google.com'))
                    ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.link)}`
                    : null
            })) : []
        }));

        res.json(orders);

    } catch (err) {
        console.error("❌ Error obteniendo órdenes:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 2. CREAR ORDEN (ACTUALIZADO: Inserta Material y Variante)
// =====================================================================
exports.createOrder = async (req, res) => {
    const {
        areaId, cliente, descripcion, prioridad,
        material, variante, // <--- Recibimos los nuevos campos
        magnitud, nota, fechaEntrega, archivos
    } = req.body;

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        const requestOrder = new sql.Request(transaction);
        const resultOrder = await requestOrder
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Cliente', sql.NVarChar(200), cliente)
            .input('Descripcion', sql.NVarChar(300), descripcion)
            .input('Prioridad', sql.VarChar(20), prioridad)

            // --- NUEVOS CAMPOS ---
            .input('Material', sql.VarChar(255), material || '')
            .input('Variante', sql.VarChar(100), variante || '')

            .input('Magnitud', sql.VarChar(50), magnitud)
            .input('Nota', sql.NVarChar(sql.MAX), nota)
            .input('FechaEstimada', sql.DateTime, fechaEntrega ? new Date(fechaEntrega) : null)
            .input('ArchivosCount', sql.Int, archivos ? archivos.length : 0)
            .query(`
                INSERT INTO dbo.Ordenes (
                    AreaID, Cliente, DescripcionTrabajo, Prioridad, 
                    Material, Variante, -- Insertamos en las columnas correctas
                    Magnitud, Nota, FechaEstimadaEntrega, ArchivosCount, Estado, FechaIngreso
                )
                OUTPUT INSERTED.OrdenID
                VALUES (
                    @AreaID, @Cliente, @Descripcion, @Prioridad, 
                    @Material, @Variante,
                    @Magnitud, @Nota, @FechaEstimada, @ArchivosCount, 'Pendiente', GETDATE()
                )
            `);

        const newOrderId = resultOrder.recordset[0].OrdenID;
        const safeUser = String((req.body.usuario && (req.body.usuario.id || req.body.usuario.UsuarioID)) || req.body.usuario || 'Sistema');

        // LOG HISTORIAL
        await new sql.Request(transaction)
            .input('OID', sql.Int, newOrderId)
            .input('Est', sql.VarChar, 'Pendiente')
            .input('User', sql.VarChar, safeUser)
            .input('Det', sql.NVarChar, 'Orden Creada')
            .query(`
                INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                VALUES (@OID, @Est, GETDATE(), GETDATE(), @User, @Det)
            `);

        if (archivos && archivos.length > 0) {
            for (const file of archivos) {
                const requestFile = new sql.Request(transaction);
                await requestFile
                    .input('OrdenID', sql.Int, newOrderId)
                    .input('Nombre', sql.VarChar(200), file.nombre)
                    .input('Ruta', sql.VarChar(500), file.link)
                    .input('Tipo', sql.VarChar(50), file.tipo)
                    .input('Copias', sql.Int, file.copias || 1)
                    .input('Metros', sql.Decimal(10, 2), file.metros || 0)
                    .query(`
                        INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida)
                        VALUES (@OrdenID, @Nombre, @Ruta, @Tipo, @Copias, @Metros, GETDATE())
                    `);
            }
        }

        await transaction.commit();
        res.json({ success: true, orderId: newOrderId, message: 'Orden creada exitosamente' });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("❌ Error creando orden:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 3. FUNCIONES ORIGINALES (Restauradas tal cual estaban)
// =====================================================================

exports.assignRoll = async (req, res) => {
    // Soportamos ambos: un solo ID por URL o múltiples por body
    const { orderId } = req.params;
    let { orderIds, rollId, isNew, rollName, areaCode, capacity, color, bobinaId } = req.body;

    // Normalizar areaCode si viene 'DF'
    // if (areaCode === 'DF') areaCode = 'DTF'; // DISABLED: User requested to keep DF

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. SI ES NUEVO ROLLO, LO CREAMOS PRIMERO
            if (isNew) {
                rollId = `R-${Date.now().toString().slice(-6)}`;
                const finalName = rollName || `Lote ${rollId}`;

                // A. Gestionar Bobina si viene
                if (bobinaId) {
                    // Verificar disponibilidad (doble check seguro)
                    const bobinaCheck = await new sql.Request(transaction)
                        .input('BID', sql.Int, bobinaId)
                        .query("SELECT BobinaID, MetrosRestantes FROM InventarioBobinas WHERE BobinaID = @BID AND (Estado = 'Disponible' OR Estado = 'En Uso')");

                    if (bobinaCheck.recordset.length === 0) {
                        throw new Error("La bobina seleccionada no está disponible.");
                    }

                    // Marcar En Uso
                    await new sql.Request(transaction)
                        .input('BID', sql.Int, bobinaId)
                        .query("UPDATE InventarioBobinas SET Estado = 'En Uso' WHERE BobinaID = @BID");

                    // Capacity fallback
                    if (!capacity) capacity = bobinaCheck.recordset[0].MetrosRestantes;
                }

                // B. Insertar Rollo
                // B. Insertar Rollo (Let DB handle ID)
                const insertRollRes = await new sql.Request(transaction)
                    .input('Nombre', sql.NVarChar(100), finalName)
                    .input('Area', sql.VarChar(20), areaCode || 'General')
                    .input('Cap', sql.Decimal(10, 2), capacity || 100)
                    .input('Col', sql.VarChar(10), color || '#3b82f6')
                    .input('BID', sql.Int, bobinaId || null)
                    .query(`
                        INSERT INTO dbo.Rollos (Nombre, AreaID, CapacidadMaxima, ColorHex, Estado, MaquinaID, FechaCreacion, BobinaID)
                        OUTPUT INSERTED.RolloID
                        VALUES (@Nombre, @Area, @Cap, @Col, 'Abierto', NULL, GETDATE(), @BID)
                    `);

                // Capture the real Numeric ID generated by DB
                rollId = insertRollRes.recordset[0].RolloID;
                console.log(`[assignRoll] Nuevo Rollo Creado: ID=${rollId} (${finalName})`);

            }

            // Unify inputs
            let targetOrderIds = [];
            if (orderIds && Array.isArray(orderIds)) targetOrderIds = orderIds;
            else if (orderId) targetOrderIds.push(orderId);

            if (targetOrderIds.length === 0) throw new Error("No se especificaron órdenes.");

            // 2. ASIGNAR ÓRDENES
            for (const oid of targetOrderIds) {
                await new sql.Request(transaction)
                    .input('OID', sql.Int, oid)
                    // Detect if ID is Number or String to avoid validation error
                    .input('RID', typeof rollId === 'number' ? sql.Int : sql.VarChar(20), rollId)
                    .query(`
                        UPDATE dbo.Ordenes 
                        SET 
                            RolloID = @RID,
                            Estado = CASE 
                                WHEN @RID IS NOT NULL THEN 'En Lote'
                                ELSE 'Pendiente'
                            END,
                            EstadoenArea = CASE 
                                WHEN @RID IS NOT NULL THEN 'En Lote'
                                ELSE 'Pendiente'
                            END
                        WHERE OrdenID = @OID
                    `);

                // LOG HISTORIAL
                const safeUserRoll = String((req.body.usuario && (req.body.usuario.id || req.body.usuario.UsuarioID)) || req.body.usuario || 'Sistema');
                await new sql.Request(transaction)
                    .input('OID', sql.Int, oid)
                    .input('Est', sql.VarChar, 'Asignado')
                    .input('User', sql.VarChar, safeUserRoll)
                    .input('Det', sql.NVarChar, `Asignado a Rollo/Lote ${rollId}`)
                    .query(`
                        INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        VALUES (@OID, 'PREPARACION', GETDATE(), GETDATE(), @User, @Det)
                     `);
            }

            await transaction.commit();
            res.json({ success: true, rollId });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error assignRoll:", err);
        res.status(500).json({ error: err.message });
    }
};

exports.updateFile = async (req, res) => {
    const { fileId, copias, metros, link, ancho, alto } = req.body;
    console.log(`📝 UpdateFile: ID=${fileId}, Copias=${copias}, Metros=${metros}, Ancho=${ancho}, Alto=${alto}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el Archivo
            await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .input('Copias', sql.Int, copias)
                .input('Metros', sql.Decimal(10, 2), metros)
                .input('Ancho', sql.Decimal(10, 2), ancho || 0)
                .input('Alto', sql.Decimal(10, 2), alto || 0)
                .input('Ruta', sql.VarChar(500), link)
                .query("UPDATE dbo.ArchivosOrden SET Copias = @Copias, Metros = @Metros, Ancho = @Ancho, Alto = @Alto, RutaAlmacenamiento = @Ruta WHERE ArchivoID = @ID");

            // 2. Obtener OrdenID (Crucial: Verificar que obtenemos un ID)
            const orderRes = await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .query("SELECT OrdenID FROM ArchivosOrden WHERE ArchivoID = @ID");

            const ordenId = orderRes.recordset[0]?.OrdenID;

            if (ordenId) {
                console.log(`🔄 Recalculando Magnitud para OrdenID: ${ordenId}`);

                // 3. Recalcular Magnitud Total de la Orden
                // Usamos una lógica más simple y directa para evitar problemas de tipos
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        DECLARE @TotalMetros DECIMAL(10,2);
                        DECLARE @TotalCopias INT;

                        SELECT 
                            @TotalMetros = SUM(ISNULL(Metros, 0) * ISNULL(Copias, 1)),
                            @TotalCopias = SUM(ISNULL(Copias, 1))
                        FROM ArchivosOrden 
                        WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO'; -- Ignoramos cancelados

                        UPDATE Ordenes 
                        SET Magnitud = CASE 
                            WHEN @TotalMetros > 0 THEN CAST(FORMAT(@TotalMetros, '0.##') AS NVARCHAR(20)) + ' m'
                            ELSE CAST(@TotalCopias AS NVARCHAR(20)) + ' u'
                        END
                        WHERE OrdenID = @OID;
                    `);
            } else {
                console.warn(`⚠️ No se encontró OrdenID para el archivo ${fileId}`);
            }

            await transaction.commit();

            // LOG HISTORIAL
            const safeUser = String((req.body.userId || req.body.usuario || 'Sistema'));
            if (ordenId) {
                pool.request()
                    .input('OID', sql.Int, ordenId)
                    .input('Est', sql.VarChar, 'Modificado')
                    .input('User', sql.VarChar, safeUser)
                    .input('Det', sql.NVarChar, `Archivo modificado (ID: ${fileId})`)
                    .query(`
                        INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        VALUES (@OID, 'EN PROCESO', GETDATE(), GETDATE(), @User, @Det)
                    `).catch(e => console.error("Log Error:", e));
            }

            // 4. Notificar actualización
            const io = req.app.get('socketio');
            if (io && ordenId) {
                io.emit('server:order_updated', { orderId: ordenId });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("❌ Error updating file:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.addFile = async (req, res) => {
    const { ordenId, nombre, link, tipo, copias, metros } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('OrdenID', sql.Int, ordenId)
            .input('Nombre', sql.VarChar(200), nombre)
            .input('Ruta', sql.VarChar(500), link)
            .input('Tipo', sql.VarChar(50), tipo)
            .input('Copias', sql.Int, copias)
            .input('Metros', sql.Decimal(10, 2), metros)
            .query("INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida) VALUES (@OrdenID, @Nombre, @Ruta, @Tipo, @Copias, @Metros, GETDATE())");

        // LOG HISTORIAL
        const safeUser = String((req.body.userId || req.body.usuario || 'Sistema'));
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Est', sql.VarChar, 'Nuevo Archivo')
            .input('User', sql.VarChar, safeUser)
            .input('Det', sql.NVarChar, `Archivo agregado: ${nombre}`)
            .query(`
                INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                VALUES (@OID, 'EN PROCESO', GETDATE(), GETDATE(), @User, @Det)
             `).catch(e => console.error("Log Error:", e));

        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteFile = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request().input('ID', sql.Int, id).query("DELETE FROM dbo.ArchivosOrden WHERE ArchivoID = @ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { status, usuario } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Update Estado
            await new sql.Request(transaction)
                .input('OrdenID', sql.Int, id)
                .input('NuevoEstado', sql.VarChar(50), status)
                .query("UPDATE dbo.Ordenes SET Estado = @NuevoEstado WHERE OrdenID = @OrdenID");

            // Preparar datos de usuario
            const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
            const safeUser = String(rawUser || 'Sistema').substring(0, 99);
            let userIdInt = 1;
            if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
            else if (typeof usuario === 'number') userIdInt = usuario;

            // 2. Insertar Historial
            await new sql.Request(transaction)
                .input('OID', sql.Int, id)
                .input('Est', sql.VarChar, status)
                .input('User', sql.VarChar, safeUser)
                .input('Det', sql.NVarChar, `Cambio de estado a ${status}`)
                .query(`
                   INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                   VALUES (@OID, @Est, GETDATE(), GETDATE(), @User, @Det)
               `);

            // 3. Insertar Auditoria
            await new sql.Request(transaction)
                .input('IdUser', sql.Int, userIdInt)
                .input('Accion', sql.VarChar, 'CAMBIO_ESTADO')
                .input('Detalle', sql.NVarChar, `Orden ${id} cambio a ${status}`)
                .input('IP', sql.VarChar, req.ip || '::1')
                .query(`INSERT INTO Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@IdUser, @Accion, @Detalle, @IP, GETDATE())`);

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('server:order_updated', { orderId: id, status: status, timestamp: new Date() });
                io.emit('server:ordersUpdated', { count: 1 });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("Error updateStatus:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.deleteOrder = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request().input('ID', id).query("DELETE FROM dbo.ArchivosOrden WHERE OrdenID = @ID");
        await pool.request().input('ID', id).query("DELETE FROM dbo.Ordenes WHERE OrdenID = @ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// (Duplicado antiguo eliminado)

// =====================================================================
// 4. RESTAURAR FUNCIONES FALTANTES (Placeholders Funcionales)
// =====================================================================

exports.advancedSearchOrders = async (req, res) => {
    try {
        const { filters } = req.body || {};
        const params = filters || {}; // Safety fallback
        const pool = await getPool();
        const request = pool.request();

        let query = `
            SELECT 
                o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.AreaID, 
                o.Estado, o.Prioridad, o.FechaIngreso, o.FechaEstimadaEntrega,
                o.Material, o.Variante, o.Tinta, o.ModoRetiro, o.ArchivosCount, o.ProximoServicio
            FROM dbo.Ordenes o
            WHERE 1=1
        `;

        if (params.client) {
            query += " AND o.Cliente LIKE @Client";
            request.input('Client', sql.NVarChar, `%${params.client}%`);
        }

        if (params.code) {
            query += " AND (o.CodigoOrden LIKE @Code OR CAST(o.OrdenID AS VARCHAR) LIKE @Code OR o.NoDocERP LIKE @Code)";
            request.input('Code', sql.VarChar, `%${params.code}%`);
        }

        if (params.status && params.status !== 'ALL') {
            query += " AND o.Estado = @Status";
            request.input('Status', sql.VarChar, params.status);
        }

        if (params.area && params.area !== 'ALL') {
            if (Array.isArray(params.area)) {
                if (params.area.length > 0) {
                    const areaPlaceholders = params.area.map((_, i) => `@Area${i}`).join(',');
                    query += ` AND o.AreaID IN (${areaPlaceholders})`;
                    params.area.forEach((a, i) => request.input(`Area${i}`, sql.VarChar, a));
                }
            } else {
                query += " AND o.AreaID LIKE @Area";
                request.input('Area', sql.VarChar, `%${params.area}%`);
            }
        }

        if (params.dateFrom) {
            query += " AND o.FechaIngreso >= @DateFrom";
            request.input('DateFrom', sql.DateTime, new Date(params.dateFrom));
        }

        if (params.dateTo) {
            query += " AND o.FechaIngreso <= @DateTo";
            const d = new Date(params.dateTo);
            d.setHours(23, 59, 59, 999); // Final del día
            request.input('DateTo', sql.DateTime, d);
        }

        query += " ORDER BY o.FechaIngreso DESC";

        const result = await request.query(query);

        const orders = result.recordset.map(o => ({
            id: o.OrdenID,
            code: o.CodigoOrden || `ORD-${o.OrdenID}`,
            client: o.Cliente || 'Sin Cliente',
            desc: o.DescripcionTrabajo || '',
            area: o.AreaID || '',
            status: o.Estado || 'Pendiente',
            priority: o.Prioridad || 'Normal',

            // Sanitización de Fechas
            entryDate: o.FechaIngreso ? new Date(o.FechaIngreso).toISOString() : null,
            deliveryDate: o.FechaEstimadaEntrega ? new Date(o.FechaEstimadaEntrega).toISOString() : null,

            material: o.Material || '',
            variantCode: o.Variante || '',
            ink: o.Tinta || '',
            retiro: o.ModoRetiro || '',
            filesCount: o.ArchivosCount || 0,
            nextService: o.ProximoServicio || '-'
        }));

        console.log(`🔍 Búsqueda Avanzada: ${orders.length} resultados encontrados.`);
        res.json(orders);

    } catch (e) {
        console.error("❌ Error en Búsqueda Avanzada:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getOrderFullDetails = async (req, res) => {
    try {
        // Simple fetch fallback
        const pool = await getPool();
        const r = await pool.request().input('ID', sql.Int, req.params.id).query("SELECT * FROM Ordenes WHERE OrdenID = @ID");
        res.json(r.recordset[0]);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getIntegralPedidoDetailsV2 = async (req, res) => {
    try {
        const { ref } = req.params;
        const pool = await getPool();
        const request = pool.request();

        // 1. Buscar Órdenes Relacionadas
        // Intentamos buscar por NroDocERP primero (para agrupar 1/X, 2/X)
        // O si parece un ID o Codigo específico
        request.input('Ref', sql.VarChar, ref);

        // Estrategia: Buscar todo lo que coincida con el ERP o el Código exacto
        const queryOrders = `
            SELECT * FROM Ordenes 
            WHERE NoDocERP = @Ref 
               OR CodigoOrden LIKE @Ref + '%' 
               OR CAST(OrdenID AS VARCHAR) = @Ref
        `;

        const result = await request.query(queryOrders);
        const orders = result.recordset;

        if (orders.length === 0) {
            return res.status(404).json({ error: "No se encontraron órdenes con esa referencia." });
        }

        // 2. Construir Header (Datos Agregados)
        const first = orders[0];
        const total = orders.length;
        const terminados = orders.filter(o => ['Finalizado', 'Entregado', 'Cancelado'].includes(o.Estado)).length;
        const avance = total > 0 ? Math.round((terminados / total) * 100) : 0;

        const header = {
            pedidoRef: first.NoDocERP || ref,
            cliente: first.Cliente,
            descripcion: first.DescripcionTrabajo,
            avance: avance,
            estadoGlobal: avance === 100 ? 'COMPLETADO' : 'EN PROCESO'
        };

        // 3. Mapear Órdenes para la tabla
        // Ordenamos por la secuencia del código (ej. 1/3, 2/3) para garantizar el orden del flujo
        orders.sort((a, b) => a.CodigoOrden.localeCompare(b.CodigoOrden, undefined, { numeric: true }));

        const mappedOrders = orders.map(o => ({
            OrdenID: o.OrdenID,
            CodigoOrden: o.CodigoOrden,
            AreaID: o.AreaID,
            Material: o.Material,
            FechaIngreso: o.FechaIngreso,
            Estado: o.Estado,
            Magnitud: o.Magnitud,
            AreaUM: first.UnidadMedida || '',
            ProximoServicio: o.ProximoServicio
        }));

        // 4. Recuperar Historial y LOGÍSTICA (Moved up for Routing Logic)
        const orderIds = orders.map(o => o.OrdenID);
        let historialData = [];
        let bultosData = [];

        if (orderIds.length > 0) {
            const safeIds = orderIds.join(',');

            // A. Historial
            const hQuery = `
                SELECT 
                    H.*, 
                    H.FechaInicio as Fecha, 
                    O.CodigoOrden,
                    COALESCE(U.Nombre, U.Usuario, H.Usuario) as NombreUsuario
                FROM HistorialOrdenes H
                INNER JOIN Ordenes O ON H.OrdenID = O.OrdenID
                LEFT JOIN Usuarios U ON CAST(U.IdUsuario AS VARCHAR) = H.Usuario
                WHERE H.OrdenID IN (${safeIds}) 
                ORDER BY H.FechaInicio DESC
            `;
            const hResult = await pool.request().query(hQuery);
            historialData = hResult.recordset;

            // B. Logística (Bultos asociados a estas órdenes)
            const bQuery = `
                SELECT 
                    LB.BultoID, 
                    LB.CodigoEtiqueta, 
                    LB.Descripcion, 
                    LB.Tipocontenido as Tipo, 
                    LB.UbicacionActual as Ubicacion, 
                    LB.Estado, 
                    O.CodigoOrden,
                    LB.OrdenID
                FROM Logistica_Bultos LB
                INNER JOIN Ordenes O ON LB.OrdenID = O.OrdenID
                WHERE LB.OrdenID IN (${safeIds})
                ORDER BY LB.BultoID ASC
            `;
            const bResult = await pool.request().query(bQuery);
            bultosData = bResult.recordset;
        }

        // 3.5 Construir Ruta Visual (Step Tracker) - AGRUPADA POR ÁREA
        const areaSteps = new Map();

        orders.forEach(o => {
            if (!areaSteps.has(o.AreaID)) {
                areaSteps.set(o.AreaID, {
                    id: o.AreaID,
                    label: o.AreaID,
                    orders: [],
                    date: o.FechaHabilitacion || o.FechaIngreso
                });
            }
            areaSteps.get(o.AreaID).orders.push(o);
        });

        // WMS Logic Flags (Without Injection)
        let hasDepoStock = false;
        let hasDepoDelivered = false;
        if (bultosData.length > 0) {
            hasDepoStock = bultosData.some(b => b.Ubicacion === 'DEPOSITO');
            hasDepoDelivered = bultosData.some(b => b.Ubicacion === 'CLIENTE' || b.Estado === 'ENTREGADO');

            // INYECCIÓN SEGURA: Si hay actividad logística pero la orden no tiene área de depósito explícita
            if (hasDepoStock || hasDepoDelivered) {
                const existingKey = Array.from(areaSteps.keys()).find(k => /(DEPOSITO|DEPÓSITO|LOGISTICA|LOGÍSTICA)/i.test(k));
                if (!existingKey) {
                    areaSteps.set('DEPOSITO', {
                        id: 'DEPOSITO',
                        label: 'DEPOSITO',
                        orders: [],
                        date: new Date()
                    });
                }
            }
        }

        const ruta = Array.from(areaSteps.values()).map(step => {
            const statuses = step.orders.map(o => (o.Estado || '').toUpperCase());

            // Lógica de Prioridad: VIVO > CANCELADO
            const isCancelled = (s) => ['CANCELADO', 'ANULADO', 'RECHAZADO'].includes(s);
            const isCompleted = (s) => ['FINALIZADO', 'ENTREGADO', 'TERMINADO', 'PRONTO', 'COMPLETADO', 'DESPACHADO'].includes(s);
            const isInProcess = (s) => ['PRODUCCION', 'IMPRIMIENDO', 'EN PROCESO', 'EN LOTE', 'CONTROL Y CALIDAD', 'EN_PROCESO', 'DEPOSITO'].includes(s);

            const allCancelled = statuses.every(s => isCancelled(s));
            // Si hay alguna viva (no cancelada), el estado NO es cancelado.
            const hasAlive = statuses.some(s => !isCancelled(s));

            let stepStatus = 'PENDIENTE';

            // Check robusto para detectar si es paso de Depósito (con o sin tilde, espacios, etc)
            const isStorageStep = /(DEPOSITO|DEPÓSITO|LOGISTICA|LOGÍSTICA)/i.test(step.label || step.id);

            if (isStorageStep) {
                // Lógica Especial WMS para Depósito (Enganchada al nodo existente)
                if (hasDepoDelivered && !hasDepoStock) stepStatus = 'COMPLETADO';
                else if (hasDepoStock) stepStatus = 'EN PROCESO'; // Stock disponible
                else if (hasAlive) {
                    const aliveStatuses = statuses.filter(s => !isCancelled(s));
                    if (aliveStatuses.every(s => isCompleted(s))) stepStatus = 'COMPLETADO';
                    else if (aliveStatuses.some(s => isInProcess(s))) stepStatus = 'EN PROCESO';
                }
            } else {
                // Lógica Standard
                if (allCancelled && statuses.length > 0) {
                    stepStatus = 'CANCELADO';
                } else if (hasAlive) {
                    // Analizamos el estado de las vivas
                    const aliveStatuses = statuses.filter(s => !isCancelled(s));
                    if (aliveStatuses.every(s => isCompleted(s))) stepStatus = 'COMPLETADO';
                    else if (aliveStatuses.some(s => isInProcess(s))) stepStatus = 'EN PROCESO';
                    else stepStatus = 'PENDIENTE';
                }
            }

            return {
                id: step.id,
                label: step.label,
                status: stepStatus,
                date: step.date,
                count: step.orders.length // Info extra útil
            };
        });



        // 5. Data Final
        const responseData = {
            header,
            ordenes: mappedOrders,
            ruta: ruta,
            logistica: { bultos: bultosData }, // Ahora con datos reales
            fallas: [], // Se podría expandir luego con lógica de fallas detectadas en bultos
            historial: historialData
        };

        res.json(responseData);

    } catch (e) {
        console.error("❌ Error Integral Details:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getPrioritiesConfig = async (req, res) => {
    try {
        const pool = await getPool();
        const r = await pool.request().query("SELECT * FROM ConfigPrioridades");
        res.json(r.recordset);
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.getActiveOrdersSummary = async (req, res) => {
    try {
        const { area } = req.query;
        const pool = await getPool();
        const request = pool.request();

        let queryBase = "FROM Ordenes WHERE Estado NOT IN ('Entregado', 'Finalizado', 'Cancelado')";

        // 1. Total General
        let queryTotal = `SELECT COUNT(*) as count ${queryBase}`;

        // 2. Desglose por Área
        let queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} GROUP BY AreaID`;

        if (area) {
            queryTotal += " AND AreaID = @Area";
            queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} AND AreaID = @Area GROUP BY AreaID`; // Ajuste si hay filtro
            request.input('Area', sql.VarChar, area);
        }

        const resTotal = await request.query(queryTotal);
        const resGroup = await request.query(queryGroup);

        // Construir objeto perArea { "ECOUV": 5, "DTF": 2 }
        const perArea = {};
        resGroup.recordset.forEach(row => {
            if (row.AreaID) perArea[row.AreaID] = row.count;
        });

        res.json({
            totalGeneral: resTotal.recordset[0].count,
            perArea: perArea,
            pending: 0 // Legacy support if needed
        });
    } catch (e) {
        console.error("❌ Error Dashboard Summary:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.getCancelledOrdersSummary = async (req, res) => {
    try {
        const { area } = req.query;
        const pool = await getPool();
        const request = pool.request();

        // Base Query
        let queryBase = "FROM Ordenes WHERE Estado IN ('Cancelado', 'CANCELADO', 'Anulado', 'RECHAZADO')";

        // 1. Total General
        let queryTotal = `SELECT COUNT(*) as count ${queryBase}`;

        // 2. Desglose por Área
        let queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} GROUP BY AreaID`;

        if (area) {
            queryTotal += " AND AreaID = @Area";
            queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} AND AreaID = @Area GROUP BY AreaID`;
            request.input('Area', sql.VarChar, area);
        }

        const resTotal = await request.query(queryTotal);
        const resGroup = await request.query(queryGroup);

        const perArea = {};
        resGroup.recordset.forEach(row => {
            if (row.AreaID) perArea[row.AreaID] = row.count;
        });

        res.json({
            totalGeneral: resTotal.recordset[0].count,
            perArea: perArea
        });

    } catch (e) {
        console.error("❌ Error Dash Cancelled:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getFailedOrdersSummary = async (req, res) => {
    try {
        const { area } = req.query;
        const pool = await getPool();
        const request = pool.request();

        // Base Query - Asumimos 'FALLA' como estado principal para el dashboard rápido,
        // Y TAMBIÉN patrones visuales en el código (-F)
        let queryBase = `FROM Ordenes WHERE (
            Estado IN ('FALLA', 'Falla', 'DEFECTO')
            OR CodigoOrden LIKE 'F%'
            OR CodigoOrden LIKE '%-F%'
            OR CodigoOrden LIKE '% F%'
        )`;

        // 1. Total General
        let queryTotal = `SELECT COUNT(*) as count ${queryBase}`;

        // 2. Desglose por Área
        let queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} GROUP BY AreaID`;

        if (area) {
            queryTotal += " AND AreaID = @Area";
            queryGroup = `SELECT AreaID, COUNT(*) as count ${queryBase} AND AreaID = @Area GROUP BY AreaID`;
            request.input('Area', sql.VarChar, area);
        }

        const resTotal = await request.query(queryTotal);
        const resGroup = await request.query(queryGroup);

        const perArea = {};
        resGroup.recordset.forEach(row => {
            if (row.AreaID) perArea[row.AreaID] = row.count;
        });

        res.json({
            totalGeneral: resTotal.recordset[0].count,
            perArea: perArea
        });
    } catch (e) {
        console.error("❌ Error Dash Failed:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.unassignOrder = async (req, res) => {
    const { orderId } = req.body;
    const userId = (req.user && req.user.id) ? req.user.id : 1;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener RolloID actual antes de quitarlo
            const current = await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query("SELECT RolloID, CodigoOrden FROM Ordenes WHERE OrdenID = @OID");

            const rollId = current.recordset[0]?.RolloID;
            const codOrden = current.recordset[0]?.CodigoOrden;

            // 2. Desasignar Orden (Volver a pendiente)
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .query(`
                    UPDATE Ordenes 
                    SET RolloID = NULL, 
                        Estado = 'Pendiente', 
                        Secuencia = NULL, 
                        MaquinaID = NULL,
                        EstadoenArea = 'Pendiente'
                    WHERE OrdenID = @OID
                `);

            // LOG
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .input('User', sql.VarChar, String(userId))
                .input('Det', sql.NVarChar, `Retirado del Rollo ${rollId || '?'}`)
                .query(`
                    INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                    VALUES (@OID, 'PREPARACION', GETDATE(), GETDATE(), @User, @Det)
                `);

            // 3. Verificar si el rollo quedó vacío
            let rollCancelled = false;
            if (rollId) {
                const countRes = await new sql.Request(transaction)
                    .input('RID', sql.VarChar(50), String(rollId))
                    .query("SELECT COUNT(*) as Cnt FROM Ordenes WHERE RolloID = @RID");

                if (countRes.recordset[0].Cnt === 0) {
                    // Cancelar Rollo vacio (Limpieza Automática)
                    console.log(`[AutoCleanup] Rollo ${rollId} quedó vacío. Cancelando...`);

                    // A. Obtener Máquina asignada (si existe) para liberarla visualmente (EstadoProceso)
                    const rollInfo = await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), String(rollId))
                        .query("SELECT MaquinaID FROM Rollos WHERE RolloID = @RID");

                    const maqId = rollInfo.recordset[0]?.MaquinaID;

                    // B. Actualizar Rollo a Cancelado y quitar Máquina
                    await new sql.Request(transaction)
                        .input('RID', sql.VarChar(50), String(rollId))
                        .query("UPDATE Rollos SET Estado = 'Cancelado', MaquinaID = NULL WHERE RolloID = @RID");

                    // C. Resetear EstadoProceso de la Máquina (si tenía)
                    if (maqId) {
                        await new sql.Request(transaction)
                            .input('MID', sql.Int, maqId)
                            .query("UPDATE ConfigEquipos SET EstadoProceso = 'Detenido' WHERE EquipoID = @MID");
                    }

                    // D. Importante: Desvincular Órdenes de la Máquina (aunque estén desasignadas, por seguridad)
                    // (Ya se hizo en el paso 2 con MaquinaID=NULL, OrdenID=@OID)
                    // Pero asegurarse de que ninguna otra orden quede pegada a ese rollo (CNT=0 garantiza esto).

                    rollCancelled = true;
                }
            }

            await transaction.commit();
            res.json({ success: true, rollCancelled, message: "Orden retirada del lote." });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (err) {
        console.error("Error unassignOrder:", err);
        res.status(500).json({ error: err.message });
    }
};
// (Versión antigua eliminada)

// ===================================
// ... (Otras funciones) ...

exports.cancelOrder = async (req, res) => {
    const { orderId, reason, usuario } = req.body;
    console.log(`🚫 Cancelando Orden ID: ${orderId}`);

    try {
        const safeReason = (reason && typeof reason === 'string') ? reason : 'Cancelado por usuario';
        const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
        const safeUser = String(rawUser || 'Sistema').substring(0, 99);
        const obsText = ` [CANCELADO: ${safeReason}]`;

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Cancelar la Orden
            await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .input('Obs', sql.NVarChar, obsText)
                .query(`
                    UPDATE Ordenes 
                    SET Estado = 'Cancelado', 
                        EstadoenArea = 'Cancelado', 
                        Nota = CONCAT(ISNULL(Nota, ''), @Obs),
                        Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs)
                    WHERE OrdenID = @ID
                `);

            // 2. Cancelar sus archivos
            await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .input('User', sql.VarChar(100), safeUser)
                .query(`
                    UPDATE ArchivosOrden 
                    SET EstadoArchivo = 'CANCELADO',
                        UsuarioControl = @User,
                        FechaControl = GETDATE(),
                        Observaciones = CONCAT(ISNULL(Observaciones, ''), ' [ORDEN CANCELADA]')
                    WHERE OrdenID = @ID AND EstadoArchivo != 'CANCELADO'
                `);

            // 3. Insertar Auditoria (Restored)
            let userIdInt = 1;
            if (typeof usuario === 'object' && usuario.UsuarioID) userIdInt = parseInt(usuario.UsuarioID);
            else if (typeof usuario === 'number') userIdInt = usuario;

            await new sql.Request(transaction)
                .input('IdUser', sql.Int, userIdInt)
                .input('Accion', sql.VarChar, 'CANCELAR_ORDEN')
                .input('Detalle', sql.NVarChar, `Orden ${orderId} cancelada. Motivo: ${safeReason}`)
                .input('IP', sql.VarChar, req.ip || '::1')
                .query(`INSERT INTO Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora) VALUES (@IdUser, @Accion, @Detalle, @IP, GETDATE())`);

            // 4. Insertar HistorialOrdenes (Restored)
            await new sql.Request(transaction)
                .input('OID', sql.Int, orderId)
                .input('Est', sql.VarChar, 'Cancelado')
                .input('User', sql.VarChar, safeUser)
                .input('Det', sql.NVarChar, safeReason)
                .query(`
                   INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                   VALUES (@OID, @Est, GETDATE(), GETDATE(), @User, @Det)
               `);

            await transaction.commit();

            // 3. Notificación SOCKET (Dual para compatibilidad)
            try {
                const io = req.app.get('socketio');
                if (io) {
                    // Evento específico para detalles
                    io.emit('server:order_updated', { orderId, status: 'Cancelado' });
                    // Evento general para refrescar listas (Dashboard)
                    io.emit('server:ordersUpdated', { count: 1 });
                }
            } catch (sockErr) { console.error("Socket error:", sockErr); }

            res.json({ success: true, message: 'Orden cancelada correctamente.' });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("❌ Error cancelOrder:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.updateService = async (req, res) => {
    const { serviceId, cantidad, obs } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el Servicio
            await new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .input('Cant', sql.Decimal(18, 2), cantidad) // Cantidad decimal
                .input('Obs', sql.NVarChar, obs || '')       // Obs opcional
                .query("UPDATE dbo.ServiciosExtraOrden SET Cantidad = @Cant, Observacion = @Obs WHERE ServicioID = @ID");

            // LOG HISTORIAL
            // Obtenemos OrdenID
            const oRes = await new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .query("SELECT OrdenID FROM ServiciosExtraOrden WHERE ServicioID = @ID");

            const oId = oRes.recordset[0]?.OrdenID;
            if (oId) {
                const safeUser = String((req.body.usuario || 'Sistema'));
                await new sql.Request(transaction)
                    .input('OID', sql.Int, oId)
                    .input('Est', sql.VarChar, 'Servicio Modif.')
                    .input('User', sql.VarChar, safeUser)
                    .input('Det', sql.NVarChar, `Servicio Extra Actualizado ID: ${serviceId}`)
                    .query(`
                        INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        VALUES (@OID, 'EN PROCESO', GETDATE(), GETDATE(), @User, @Det)
                    `);
            }

            // 2. Obtener OrdenID
            const serviceRes = await new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .query("SELECT OrdenID FROM ServiciosExtraOrden WHERE ServicioID = @ID");

            const ordenId = serviceRes.recordset[0]?.OrdenID;

            if (ordenId) {
                console.log(`🔄 Recalculando Magnitud Global (Producción + Servicios) para OrdenID: ${ordenId}`);

                // 3. Recálculo Unificado (Producción + Servicios)
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        DECLARE @TotalProd DECIMAL(18,2) = 0;
                        DECLARE @TotalServ DECIMAL(18,2) = 0;

                        -- Suma de Producción (Metros * Copias)
                        SELECT @TotalProd = SUM(ISNULL(Metros, 0) * ISNULL(Copias, 1))
                        FROM ArchivosOrden 
                        WHERE OrdenID = @OID AND EstadoArchivo != 'CANCELADO';

                        -- Suma de Servicios (Cantidad Directa)
                        SELECT @TotalServ = SUM(ISNULL(Cantidad, 0))
                        FROM ServiciosExtraOrden 
                        WHERE OrdenID = @OID;

                        -- Actualizar Magnitud Global
                        UPDATE Ordenes 
                        SET Magnitud = CAST((ISNULL(@TotalProd, 0) + ISNULL(@TotalServ, 0)) AS NVARCHAR(50))
                        WHERE OrdenID = @OID;
                    `);
            }

            await transaction.commit();

            // 4. Notificar actualización en tiempo real
            const io = req.app.get('socketio');
            if (io && ordenId) {
                // Notificar a todos que la orden cambió (AreaView se actualizará)
                io.emit('orders:updated', { orderId: ordenId });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }

    } catch (e) {
        console.error("❌ Error updateService:", e);
        res.status(500).json({ error: e.message });
    }
};

exports.getOrderReferences = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request().input('ID', sql.Int, id).query(`
            SELECT RefID as id, NombreOriginal as nombre, UbicacionStorage as link, 
                   ISNULL(TipoArchivo, 'Referencia') as tipo, NotasAdicionales as notas
            FROM dbo.ArchivosReferencia WHERE OrdenID = @ID
        `);
        const mappedData = result.recordset.map(f => ({
            ...f,
            urlProxy: (f.link && f.link.includes('drive.google.com'))
                ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.link)}`
                : null
        }));
        res.json(mappedData);
    } catch (e) {
        // Si la tabla no existe o hay error, devolvemos array vacío para no romper el front
        console.warn("⚠️ Error leyendo Referencias:", e.message);
        res.json([]);
    }
};

exports.getOrderServices = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request().input('ID', sql.Int, id).query(`
            SELECT ServicioID as id, Descripcion as nombre, Cantidad as copias, Observacion as notas, 'Servicio' as tipo
            FROM dbo.ServiciosExtraOrden WHERE OrdenID = @ID
        `);
        res.json(result.recordset);
    } catch (e) {
        console.warn("⚠️ Error leyendo Servicios:", e.message);
        res.json([]);
    }
};

exports.cancelRequest = async (req, res) => {
    const { orderId, reason, usuario } = req.body;
    console.log(`🔥 Cancelando PEDIDO COMPLETO (Request), Ref Order: ${orderId}`);

    try {
        // Sanitización estricta
        const safeReason = (reason && typeof reason === 'string') ? reason : 'Cancelado por solicitud';
        const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
        const safeUser = String(rawUser || 'Sistema').substring(0, 99);
        const obsText = ` [PEDIDO CANCELADO: ${safeReason}]`;

        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Obtener NoDocERP
            const docRes = await new sql.Request(transaction)
                .input('ID', sql.Int, orderId)
                .query("SELECT NoDocERP, CodigoOrden FROM Ordenes WHERE OrdenID = @ID");

            const noDoc = docRes.recordset[0]?.NoDocERP;
            let rowsAffected = 0;

            if (noDoc) {
                // Cancelar TODAS las órdenes con ese NoDocERP
                const r1 = await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar(50), noDoc)
                    .input('Obs', sql.NVarChar, obsText)
                    .query(`
                        UPDATE Ordenes 
                        SET Estado = 'CANCELADO', 
                            EstadoenArea = 'Cancelado',
                            Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs)
                        WHERE NoDocERP = @NoDoc AND Estado != 'CANCELADO'
                    `);
                rowsAffected = r1.rowsAffected[0];

                // Cancelar archivos de esas órdenes
                await new sql.Request(transaction)
                    .input('NoDoc', sql.VarChar(50), noDoc)
                    .input('User', sql.VarChar(100), safeUser)
                    .query(`
                        UPDATE AO
                        SET AO.EstadoArchivo = 'CANCELADO',
                            AO.UsuarioControl = @User,
                            AO.FechaControl = GETDATE(),
                            AO.Observaciones = CONCAT(ISNULL(AO.Observaciones, ''), ' [PEDIDO CANCELADO]')
                        FROM ArchivosOrden AO
                        INNER JOIN Ordenes O ON AO.OrdenID = O.OrdenID
                        WHERE O.NoDocERP = @NoDoc AND AO.EstadoArchivo != 'CANCELADO'
                    `);
            } else {
                // Fallback: Cancelar solo esta orden
                const r2 = await new sql.Request(transaction)
                    .input('ID', sql.Int, orderId)
                    .input('Obs', sql.NVarChar, obsText)
                    .query(`
                        UPDATE Ordenes 
                        SET Estado = 'CANCELADO', 
                            EstadoenArea = 'Cancelado',
                            Observaciones = CONCAT(ISNULL(Observaciones, ''), @Obs)
                        WHERE OrdenID = @ID
                    `);
                rowsAffected = r2.rowsAffected[0];
                // Cancelar archivos
                await new sql.Request(transaction)
                    .input('ID', sql.Int, orderId)
                    .input('User', sql.VarChar(100), safeUser)
                    .query(`
                     UPDATE ArchivosOrden 
                     SET EstadoArchivo = 'CANCELADO',
                         UsuarioControl = @User,
                         FechaControl = GETDATE()
                     WHERE OrdenID = @ID AND EstadoArchivo != 'CANCELADO'
                 `);
            }

            await transaction.commit();

            try {
                const io = req.app.get('socketio');
                if (io) io.emit('server:order_updated', { orderId });
            } catch (sockErr) { console.error(sockErr); }

            res.json({ success: true, message: `Pedido cancelado. ${rowsAffected} órdenes afectadas.` });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("❌ Error cancelRequest:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.cancelRoll = async (req, res) => { res.json({ success: true }); };
exports.getOrderHistory = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        // Intentamos buscar en una tabla de auditoría si existe, o construimos historial básico
        // Asumiendo que existe una tabla de auditoría o log. Si no, devolvemos info básica de la orden como "Creada".
        // Por ahora, simularemos historial con la fecha de ingreso y control de archivos.

        const result = await pool.request()
            .input('ID', sql.Int, id)
            .query(`
                SELECT 'Orden Ingresada' as Detalle, FechaIngreso as Fecha, 'Pendiente' as Estado, UsuarioID as Usuario FROM Ordenes WHERE OrdenID = @ID
                UNION ALL
                SELECT CONCAT('Archivo Controlado: ', NombreArchivo, ' [', EstadoArchivo, ']'), FechaControl, EstadoArchivo, UsuarioControl FROM ArchivosOrden WHERE OrdenID = @ID AND FechaControl IS NOT NULL
                ORDER BY Fecha DESC
            `);

        res.json(result.recordset);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
};
exports.cancelFile = async (req, res) => {
    const { fileId, reason, usuario } = req.body;
    console.log(`🚫 Cancelando Archivo ID: ${fileId} | Motivo: ${reason}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Marcar Archivo como Cancelado
            await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .input('Obs', sql.NVarChar, reason || 'Cancelado por usuario')
                .input('User', sql.VarChar(100), String(usuario || 'Sistema'))
                .query(`
                    UPDATE dbo.ArchivosOrden 
                    SET EstadoArchivo = 'CANCELADO', 
                        Observaciones = CONCAT(Observaciones, ' [CANCELADO: ', @Obs, ']'),
                        UsuarioControl = @User,
                        FechaControl = GETDATE()
                    WHERE ArchivoID = @ID
                `);

            // 2. Obtener OrdenID
            const orderRes = await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .query("SELECT OrdenID FROM ArchivosOrden WHERE ArchivoID = @ID");

            const ordenId = orderRes.recordset[0]?.OrdenID;
            let orderCancelled = false;

            if (ordenId) {
                // 3. Obtener sumas para recálculo (Lógica en JS para evitar errores SQL)
                const sumRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        SELECT 
                            SUM(ISNULL(Metros, 0) * ISNULL(Copias, 1)) as TotalMetros,
                            SUM(ISNULL(Copias, 1)) as TotalCopias,
                            COUNT(*) as Activos
                        FROM ArchivosOrden 
                        WHERE OrdenID = @OID AND (EstadoArchivo IS NULL OR EstadoArchivo != 'CANCELADO')
                    `);

                const totalMetros = sumRes.recordset[0]?.TotalMetros || 0;
                const totalCopias = sumRes.recordset[0]?.TotalCopias || 0;
                const activos = sumRes.recordset[0]?.Activos || 0;

                let nuevaMagnitud = '0 u';
                if (totalMetros > 0) {
                    nuevaMagnitud = parseFloat(totalMetros).toFixed(2) + ' m';
                } else if (totalCopias > 0) {
                    nuevaMagnitud = totalCopias + ' u';
                }

                // 4. Actualizar Magnitud en Orden
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Mag', sql.VarChar(20), nuevaMagnitud)
                    .query("UPDATE Ordenes SET Magnitud = @Mag WHERE OrdenID = @OID");

                // 5. Verificar si hay que cancelar la orden completa
                if (activos === 0) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, ordenId)
                        .input('Obs', sql.NVarChar, 'Todos los archivos fueron cancelados.')
                        .query(`
                            UPDATE Ordenes 
                            SET Estado = 'CANCELADO', 
                                EstadoenArea = 'Cancelado',
                                Observaciones = CONCAT(Observaciones, ' [AUTO-CANCEL: ', @Obs, ']')
                            WHERE OrdenID = @OID
                        `);

                    // LOG ORDER CANCELADO
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, ordenId)
                        .input('Est', sql.VarChar, 'Cancelado')
                        .input('User', sql.VarChar, String(usuario || 'Sistema'))
                        .input('Det', sql.NVarChar, 'Orden Auto-Cancelada (Sin archivos activos)')
                        .query(`
                           INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                           VALUES (@OID, @Est, GETDATE(), GETDATE(), @User, @Det)
                       `);
                    orderCancelled = true;
                }

                // LOG FILE CANCELADO (Siempre)
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Est', sql.VarChar, 'Archivo Cancelado')
                    .input('User', sql.VarChar, String(usuario || 'Sistema'))
                    .input('Det', sql.NVarChar, `Archivo cancelado: ${reason}`)
                    .query(`
                       INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                       VALUES (@OID, 'EN PROCESO', GETDATE(), GETDATE(), @User, @Det)
                   `);
            }

            await transaction.commit();

            // Socket fuera de transacción
            try {
                const io = req.app.get('socketio');
                if (io && ordenId) {
                    io.emit('server:order_updated', { orderId: ordenId });
                }
            } catch (sockErr) { console.error("Socket emit error:", sockErr); }

            res.json({ success: true, orderCancelled });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("❌ Error cancelling file:", e);
        res.status(500).json({ error: e.message });
    }
};
exports.assignFabricBobbin = async (req, res) => { res.json({ success: true }); };