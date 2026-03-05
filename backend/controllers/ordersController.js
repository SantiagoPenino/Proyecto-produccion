const { getPool, sql } = require('../config/db');

// HELPER: Recalcular Magnitud de la Orden (Suma de piezas de Archivos + Servicios)
// Se usa en add, update, delete y cancel para mantener la coherencia.
const recalculateOrderMagnitude = async (transaction, ordenId) => {
    if (!ordenId) return;
    try {
        await new sql.Request(transaction)
            .input('OID', sql.Int, ordenId)
            .query(`
                DECLARE @Total FLOAT = 0;
                
                -- Suma de Copias en ArchivosOrden (ignorando cancelados)
                SELECT @Total = @Total + ISNULL(SUM(CAST(ISNULL(Copias, 0) AS FLOAT)), 0)
                FROM dbo.ArchivosOrden 
                WHERE OrdenID = @OID AND ISNULL(EstadoArchivo, '') != 'CANCELADO';
                
                -- Suma de Cantidad en ServiciosExtraOrden
                SELECT @Total = @Total + ISNULL(SUM(CAST(ISNULL(Cantidad, 0) AS FLOAT)), 0)
                FROM dbo.ServiciosExtraOrden 
                WHERE OrdenID = @OID;
                
                UPDATE dbo.Ordenes 
                SET Magnitud = CAST(FORMAT(@Total, '0.##') AS NVARCHAR(20)) + ' u'
                WHERE OrdenID = @OID;
            `);
    } catch (e) {
        console.error("❌ Error recalculateOrderMagnitude:", e.message);
    }
};

// =====================================================================
// 1. OBTENER ÓRDENES (ACTUALIZADO: Lee Material, Variante y CodigoOrden)
// =====================================================================
exports.getOrdersByArea = async (req, res) => {
    // Soporte para params o query
    let area = req.query.area || req.params.area;
    const { mode, q } = req.query;

    // console.log(`🔎 [getOrdersByArea] Request for Area: '${area}', Mode: '${mode}'`);

    try {
        // Limpieza de nombre de área (Tu lógica original)
        if (area && area.toLowerCase().startsWith('planilla-')) {
            area = area.replace('planilla-', '').toUpperCase();
        }
        if (area === 'SUBLIMACION') area = 'SUB';
        if (area === 'BORDADO') area = 'BORD';

        // DEBUG: Force print final area
        // console.log(`🔎 [getOrdersByArea] Querying DB with AreaID = '${area}'`);


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
            unit: o.UM,                 // <--- Mapeo para el frontend

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
        cliente, prioridad, fechaEntrega,
        servicios, // <--- ARRAY UNIFICADO
        notasGenerales,
        nombreTrabajo
    } = req.body;

    const pool = await getPool();
    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // Generar un ID Agrupador Único para todo el "Pedido" (Header)
        const commonUUID = require('crypto').randomUUID();
        const createdIds = [];

        // Validar que hay servicios
        if (!servicios || !Array.isArray(servicios) || servicios.length === 0) {
            throw new Error("El pedido no contiene servicios válidos.");
        }

        // Iterar y crear una Orden por cada servicio en la lista
        for (let i = 0; i < servicios.length; i++) {
            const srv = servicios[i];

            // Datos del Servicio Especifico
            const areaId = srv.areaId || 'PENDIENTE';
            const material = srv.cabecera?.material || '';
            const variante = srv.cabecera?.variante || '';
            const codArt = srv.cabecera?.codArticulo || null; // <--- YA NO ES HARDCODED

            // Nota combinada: Nota del servicio + General (solo en el principal?)
            // Decisión: Poner nota general en todos o solo en el principal. 
            // Ponemos nota especifica + ref a general si es consultable.
            const notaServicio = (srv.notas || '') + (i === 0 && notasGenerales ? `\n[GRAL]: ${notasGenerales}` : '');

            const requestOrder = new sql.Request(transaction);
            const resultOrder = await requestOrder
                .input('AreaID', sql.VarChar(20), areaId)
                .input('Cliente', sql.NVarChar(200), cliente)
                .input('Descripcion', sql.NVarChar(300), nombreTrabajo || `Pedido ${cliente}`)
                .input('Prioridad', sql.VarChar(20), prioridad)
                .input('Material', sql.VarChar(255), material)
                .input('Variante', sql.VarChar(100), variante)
                .input('CodArticulo', sql.VarChar(50), codArt)
                .input('Nota', sql.NVarChar(sql.MAX), notaServicio)
                .input('FechaEstimada', sql.DateTime, fechaEntrega ? new Date(fechaEntrega) : null)
                .input('UUID', sql.VarChar(50), commonUUID) // <--- VINCULACIÓN
                .input('ArchivosCount', sql.Int, (srv.archivos || []).length)
                .query(`
                    INSERT INTO dbo.Ordenes (
                        AreaID, Cliente, DescripcionTrabajo, Prioridad, 
                        Material, Variante, CodArticulo, 
                        Nota, FechaEstimadaEntrega, ArchivosCount, 
                        Estado, FechaIngreso, IdCabezalERP
                    )
                    OUTPUT INSERTED.OrdenID
                    VALUES (
                        @AreaID, @Cliente, @Descripcion, @Prioridad, 
                        @Material, @Variante, @CodArticulo,
                        @Nota, @FechaEstimada, @ArchivosCount, 
                        'Pendiente', GETDATE(), @UUID
                    )
                `);

            const newOrderId = resultOrder.recordset[0].OrdenID;
            createdIds.push(newOrderId);

            // Insertar Archivos del Servicio
            if (srv.archivos && Array.isArray(srv.archivos)) {
                for (const file of srv.archivos) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOrderId)
                        .input('Nom', sql.VarChar(255), file.name || 'Archivo')
                        .input('Tipo', sql.VarChar(50), file.tipo || 'GENERAL')
                        .input('Ruta', sql.VarChar(500), file.url || '') // Si ya tienes URL
                        .input('Copias', sql.Int, file.copias || 1) // Asegurar que copias se inserta
                        .query(`
                            INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, RutaAlmacenamiento, EstadoArchivo, FechaSubida, Copias)
                            VALUES (@OID, @Nom, @Tipo, @Ruta, 'Pendiente', GETDATE(), @Copias)
                        `);
                }
            }

            // Insertar Servicios Extra
            if (srv.serviciosExtra && Array.isArray(srv.serviciosExtra)) {
                for (const service of srv.serviciosExtra) {
                    await new sql.Request(transaction)
                        .input('OID', sql.Int, newOrderId)
                        .input('Desc', sql.NVarChar(255), service.descripcion || 'Servicio Extra')
                        .input('Cant', sql.Decimal(18, 2), service.cantidad || 0)
                        .input('Obs', sql.NVarChar(sql.MAX), service.observacion || '')
                        .input('Puntadas', sql.Int, service.puntadas || null)
                        .input('Bajadas', sql.Int, service.bajadas || null)
                        .input('BajadasAdicionales', sql.Int, service.bajadasAdicionales || null)
                        .query(`
                            INSERT INTO ServiciosExtraOrden (OrdenID, Descripcion, Cantidad, Observacion, FechaRegistro, Puntadas, Bajadas, BajadasAdicionales)
                            VALUES (@OID, @Desc, @Cant, @Obs, GETDATE(), @Puntadas, @Bajadas, @BajadasAdicionales)
                        `);
                }
            }

            // Recalcular magnitud inicial de la orden
            await recalculateOrderMagnitude(transaction, newOrderId);

            // LOG HISTORIAL
            const safeUser = String((req.body.usuario && (req.body.usuario.id || req.body.usuario.UsuarioID)) || 'Sistema');
            await new sql.Request(transaction)
                .input('OID', sql.Int, newOrderId)
                .input('Est', sql.VarChar, 'Pendiente')
                .input('User', sql.VarChar, safeUser)
                .input('Det', sql.NVarChar, `Orden Creada (Multi-Servicio). Parte de Grupo: ${commonUUID}`)
                .query(`
                    INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                    VALUES (@OID, @Est, GETDATE(), GETDATE(), @User, @Det)
                 `);
        }

        await transaction.commit();

        const io = req.app.get('socketio');
        if (io) io.emit('server:ordersUpdated', { count: createdIds.length });

        res.json({ success: true, orderIds: createdIds, groupId: commonUUID, message: "Pedido Multi-Servicio creado correctamente." });

    } catch (err) {
        await transaction.rollback();
        console.error("❌ Error creando pedido multi-servicio:", err);
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

            // 2. VINCULAR ÓRDENES (Primero las asignamos al rollo sin tocar secuencia aun)
            // Esto es necesario para que luego al consultar "todas las ordenes del rollo"
            // incluyan a las nuevas y podamos reordenar el conjunto completo.

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
                            END,
                            -- Importante: Si la orden es 'Reposicion' o tiene 'falla' en true, aseguramos su marca.
                            -- Pero aqui solo actualizamos la vinculacion.
                            Observaciones = Observaciones -- No-op
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

            // 3. RECALCULAR SECUENCIA INTELIGENTE (Priority Rules)
            // Obtenemos TODAS las órdenes del rollo para reordenarlas completas
            const allOrdersInRoll = await new sql.Request(transaction)
                .input('RID_ALL', typeof rollId === 'number' ? sql.Int : sql.VarChar(20), rollId)
                .query(`
                    SELECT OrdenID, Prioridad, falla, FechaEntradaSector, FechaIngreso 
                    FROM Ordenes 
                    WHERE RolloID = @RID_ALL
                `);

            let ordersToSort = allOrdersInRoll.recordset;

            // Sorting Logic:
            // 1. Fallas / Reposiciones (falla = 1) -> TOP
            // 2. Prioridad = 'Urgente' -> SECOND
            // 3. Fecha (FIFO) -> LAST
            ordersToSort.sort((a, b) => {
                // 1. Falla Check (Assume bit 1/0)
                const isFallaA = a.falla ? 1 : 0;
                const isFallaB = b.falla ? 1 : 0;
                if (isFallaA !== isFallaB) return isFallaB - isFallaA; // 1 goes first

                // 2. Priority Check
                const isUrgenteA = (a.Prioridad === 'Urgente');
                const isUrgenteB = (b.Prioridad === 'Urgente');
                if (isUrgenteA !== isUrgenteB) return isUrgenteB - isUrgenteA; // True goes first

                // 3. Date Check (FIFO)
                // Usamos FechaEntradaSector (que arreglamos hace poco) o FechaIngreso como fallback
                const dateA = new Date(a.FechaEntradaSector || a.FechaIngreso).getTime();
                const dateB = new Date(b.FechaEntradaSector || b.FechaIngreso).getTime();
                return dateA - dateB; // Ascending (older first)
            });

            // 4. Update Secuencia
            for (let i = 0; i < ordersToSort.length; i++) {
                const o = ordersToSort[i];
                await new sql.Request(transaction)
                    .input('OID_SEQ', sql.Int, o.OrdenID)
                    .input('SEQ_VAL', sql.Int, i + 1)
                    .query("UPDATE Ordenes SET Secuencia = @SEQ_VAL WHERE OrdenID = @OID_SEQ");
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
    const { fileId, copias, metros, link, ancho, alto, nombre } = req.body;
    console.log(`📝 UpdateFile: ID=${fileId}, Copias=${copias}, Metros=${metros}, Ancho=${ancho}, Alto=${alto}, Nombre=${nombre}`);

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el Archivo
            const reqUpdate = new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .input('Copias', sql.Int, copias)
                .input('Metros', sql.Decimal(10, 2), metros)
                .input('Ancho', sql.Decimal(10, 2), ancho || 0)
                .input('Alto', sql.Decimal(10, 2), alto || 0)
                .input('Ruta', sql.VarChar(500), link);

            let queryUpdate = "UPDATE dbo.ArchivosOrden SET Copias = @Copias, Metros = @Metros, Ancho = @Ancho, Alto = @Alto, RutaAlmacenamiento = @Ruta";

            if (nombre) {
                reqUpdate.input('Nom', sql.VarChar(255), nombre);
                queryUpdate += ", NombreArchivo = @Nom";
            }

            queryUpdate += " WHERE ArchivoID = @ID";
            await reqUpdate.query(queryUpdate);

            // 2. Obtener OrdenID (Crucial: Verificar que obtenemos un ID)
            const orderRes = await new sql.Request(transaction)
                .input('ID', sql.Int, fileId)
                .query("SELECT OrdenID FROM ArchivosOrden WHERE ArchivoID = @ID");

            const ordenId = orderRes.recordset[0]?.OrdenID;

            if (ordenId) {
                await recalculateOrderMagnitude(transaction, ordenId);
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
        const transaction = new sql.Transaction(pool); // Add transaction for consistency
        await transaction.begin();

        try {
            if (tipo?.toLowerCase() === 'servicio') {
                // INSERTAR EN TABLA DE SERVICIOS
                const { puntadas, bajadas, bajadasAdicionales } = req.body;
                await new sql.Request(transaction)
                    .input('OrdenID', sql.Int, ordenId)
                    .input('Desc', sql.NVarChar(255), nombre || 'Servicio Extra')
                    .input('Cant', sql.Decimal(18, 2), copias || 1)
                    .input('Obs', sql.NVarChar(sql.MAX), '')
                    .input('Puntadas', sql.Int, puntadas || null)
                    .input('Bajadas', sql.Int, bajadas || null)
                    .input('BajadasAdicionales', sql.Int, bajadasAdicionales || null)
                    .query(`
                        INSERT INTO dbo.ServiciosExtraOrden 
                        (OrdenID, Descripcion, Cantidad, Observacion, FechaRegistro, Puntadas, Bajadas, BajadasAdicionales) 
                        VALUES (@OrdenID, @Desc, @Cant, @Obs, GETDATE(), @Puntadas, @Bajadas, @BajadasAdicionales)
                    `);
            } else {
                // INSERTAR EN TABLA DE ARCHIVOS
                await new sql.Request(transaction)
                    .input('OrdenID', sql.Int, ordenId)
                    .input('Nombre', sql.VarChar(200), nombre)
                    .input('Ruta', sql.VarChar(500), link)
                    .input('Tipo', sql.VarChar(50), tipo)
                    .input('Copias', sql.Int, copias)
                    .input('Metros', sql.Decimal(10, 2), metros)
                    .query("INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida) VALUES (@OrdenID, @Nombre, @Ruta, @Tipo, @Copias, @Metros, GETDATE())");
            }

            // Recalcular magnitud tras agregar item
            await recalculateOrderMagnitude(transaction, ordenId);

            // LOG HISTORIAL
            const safeUser = String((req.body.userId || req.body.usuario || 'Sistema'));
            await new sql.Request(transaction)
                .input('OID', sql.Int, ordenId)
                .input('Est', sql.VarChar, 'Nuevo Archivo')
                .input('User', sql.VarChar, safeUser)
                .input('Det', sql.NVarChar, `Archivo agregado: ${nombre}`)
                .query(`
                    INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                    VALUES (@OID, 'EN PROCESO', GETDATE(), GETDATE(), @User, @Det)
                 `);

            await transaction.commit();
            res.json({ success: true });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteFile = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Buscamos el OrdenID antes de borrar para poder recalcular
            const findRes = await new sql.Request(transaction)
                .input('ID', sql.Int, id)
                .query(`
                    SELECT OrdenID FROM dbo.ArchivosOrden WHERE ArchivoID = @ID
                    UNION
                    SELECT OrdenID FROM dbo.ServiciosExtraOrden WHERE ServicioID = @ID
                `);
            const ordenId = findRes.recordset[0]?.OrdenID;

            // Intentamos borrar de ambas tablas ya que el frontend los unifica
            await new sql.Request(transaction)
                .input('ID', sql.Int, id)
                .query(`
                    DELETE FROM dbo.ArchivosOrden WHERE ArchivoID = @ID;
                    DELETE FROM dbo.ServiciosExtraOrden WHERE ServicioID = @ID;
                `);

            if (ordenId) {
                await recalculateOrderMagnitude(transaction, ordenId);
            }

            await transaction.commit();
            res.json({ success: true });
        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("❌ Error deleteFile:", e);
        res.status(500).json({ error: e.message });
    }
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

exports.updateAreaStatus = async (req, res) => {
    const { id } = req.params;
    const { areaStatus, usuario } = req.body;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            await new sql.Request(transaction)
                .input('OrdenID', sql.Int, id)
                .input('NuevoEstadoArea', sql.VarChar(50), areaStatus)
                .query("UPDATE dbo.Ordenes SET EstadoenArea = @NuevoEstadoArea WHERE OrdenID = @OrdenID");

            const rawUser = (usuario && typeof usuario === 'object') ? (usuario.UsuarioID || usuario.id || 'Sistema') : usuario;
            const safeUser = String(rawUser || 'Sistema').substring(0, 99);

            await new sql.Request(transaction)
                .input('OID', sql.Int, id)
                .input('User', sql.VarChar, safeUser)
                .input('Det', sql.NVarChar, `Cambio de estado en area a ${areaStatus}`)
                .query(`
                   INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                   VALUES (@OID, 'CAMBIO_ESTADO_AREA', GETDATE(), GETDATE(), @User, @Det)
               `);

            await transaction.commit();

            const io = req.app.get('socketio');
            if (io) {
                io.emit('server:order_updated', { orderId: id, timestamp: new Date() });
                io.emit('server:ordersUpdated', { count: 1 });
            }

            res.json({ success: true });

        } catch (inner) {
            await transaction.rollback();
            throw inner;
        }
    } catch (e) {
        console.error("Error updateAreaStatus:", e);
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
    const { serviceId, cantidad, obs, nombre } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // 1. Actualizar el Servicio
            const { puntadas, bajadas, bajadasAdicionales } = req.body;

            const reqUpdate = new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .input('Cant', sql.Decimal(18, 2), cantidad) // Cantidad decimal
                .input('Obs', sql.NVarChar, obs || '')      // Obs opcional
                .input('Puntadas', sql.Int, puntadas || null)
                .input('Bajadas', sql.Int, bajadas || null)
                .input('BajadasAdicionales', sql.Int, bajadasAdicionales || null);

            let queryUpdate = `
                UPDATE dbo.ServiciosExtraOrden 
                SET Cantidad = @Cant, 
                    Observacion = @Obs,
                    Puntadas = @Puntadas,
                    Bajadas = @Bajadas,
                    BajadasAdicionales = @BajadasAdicionales
            `;

            if (nombre) {
                reqUpdate.input('Nom', sql.VarChar(255), nombre);
                queryUpdate += ", Descripcion = @Nom";
            }

            queryUpdate += " WHERE ServicioID = @ID";
            await reqUpdate.query(queryUpdate);

            // 2. Obtener OrdenID
            const serviceRes = await new sql.Request(transaction)
                .input('ID', sql.Int, serviceId)
                .query("SELECT OrdenID FROM ServiciosExtraOrden WHERE ServicioID = @ID");

            const ordenId = serviceRes.recordset[0]?.OrdenID;

            if (ordenId) {
                console.log(`🔄 Recalculando Magnitud Global (Producción + Servicios) para OrdenID: ${ordenId}`);

                // 3. Recálculo Unificado (Producción + Servicios)
                await recalculateOrderMagnitude(transaction, ordenId);

                const safeUser = String((req.body.usuario || 'Sistema'));
                await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .input('Est', sql.VarChar, 'Servicio Modif.')
                    .input('User', sql.VarChar, safeUser)
                    .input('Det', sql.NVarChar, `Servicio Extra Actualizado ID: ${serviceId}`)
                    .query(`
                        INSERT INTO [SecureAppDB].[dbo].[HistorialOrdenes] (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                        VALUES (@OID, 'EN PROCESO', GETDATE(), GETDATE(), @User, @Det)
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
        
        // 1. Obtener NoDocERP
        const orderRes = await pool.request().input('ID', sql.Int, id).query(`
            SELECT NoDocERP FROM dbo.Ordenes WHERE OrdenID = @ID
        `);
        const noDocERP = orderRes.recordset[0]?.NoDocERP;

        let result;
        if (noDocERP) {
            // 2a. Traer referencias de todo el pedido
            result = await pool.request().input('NoDoc', sql.VarChar, noDocERP).query(`
                SELECT r.RefID as id, r.NombreOriginal as nombre, r.UbicacionStorage as link, 
                       ISNULL(r.TipoArchivo, 'Referencia') as tipo, r.NotasAdicionales as notas
                FROM dbo.ArchivosReferencia r
                INNER JOIN dbo.Ordenes o ON r.OrdenID = o.OrdenID
                WHERE o.NoDocERP = @NoDoc
            `);
        } else {
            // 2b. Fallback por orden individual
            result = await pool.request().input('ID', sql.Int, id).query(`
                SELECT RefID as id, NombreOriginal as nombre, UbicacionStorage as link, 
                       ISNULL(TipoArchivo, 'Referencia') as tipo, NotasAdicionales as notas
                FROM dbo.ArchivosReferencia WHERE OrdenID = @ID
            `);
        }

        // Agrupar visualmente por link (archivo) para evitar que el mismo archivo 
        // aparezca repetido si fue subido a varias órdenes del mismo carrito
        const uniqueRefs = new Map();
        result.recordset.forEach(f => {
            // Usamos el link como clave única para que no se muestre 3 veces el mismo logo
            if (f.link && !uniqueRefs.has(f.link)) {
                uniqueRefs.set(f.link, f);
            } else if (!f.link && !uniqueRefs.has(f.id)) {
                // Fallback si no hay link (raro), agrupamos por ID
                uniqueRefs.set(f.id, f);
            }
        });

        const mappedData = Array.from(uniqueRefs.values()).map(f => ({
            ...f,
            urlProxy: (f.link && f.link.includes('drive.google.com'))
                ? `/api/production-file-control/view-drive-file?url=${encodeURIComponent(f.link)}`
                : null
        }));
        res.json(mappedData);
    } catch (e) {
        console.warn("⚠️ Error leyendo Referencias:", e.message);
        res.json([]);
    }
};

exports.getOrderServices = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request().input('ID', sql.Int, id).query(`
            SELECT 
                ServicioID as id, 
                Descripcion as nombre, 
                Cantidad as copias, 
                Observacion as notas, 
                'Servicio' as tipo,
                ISNULL(Estado, 'PENDIENTE') as Estado,
                Observaciones as ObservacionesControl,
                UsuarioControl,
                FechaControl,
                Puntadas,
                Bajadas,
                BajadasAdicionales
            FROM dbo.ServiciosExtraOrden 
            WHERE OrdenID = @ID
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
                // 3. Recalcular Magnitud Total (Unificado)
                await recalculateOrderMagnitude(transaction, ordenId);

                // Obtener datos extras para el resto de la lógica de cancelación
                const statsRes = await new sql.Request(transaction)
                    .input('OID', sql.Int, ordenId)
                    .query(`
                        SELECT COUNT(*) as Activos
                        FROM ArchivosOrden 
                        WHERE OrdenID = @OID AND (EstadoArchivo IS NULL OR EstadoArchivo != 'CANCELADO')
                    `);
                const activos = statsRes.recordset[0]?.Activos || 0;

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
