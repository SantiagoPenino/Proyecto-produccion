const { getPool, sql } = require('../config/db');

// =====================================================================
// 1. OBTENER ÓRDENES (ACTUALIZADO: Lee Material, Variante y CodigoOrden)
// =====================================================================
exports.getOrdersByArea = async (req, res) => {
    // Soporte para params o query
    let area = req.query.area || req.params.area;
    const { mode, q } = req.query; 

    try {
        // Limpieza de nombre de área (Tu lógica original)
        if (area && area.toLowerCase().startsWith('planilla-')) {
            area = area.replace('planilla-', '').toUpperCase();
        }
        if (area === 'SUBLIMACION') area = 'SUB';
        if (area === 'BORDADO') area = 'BORD';

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
                o.Prioridad,
                o.FechaIngreso,
                o.FechaEstimadaEntrega,
                o.Magnitud,
                o.Material,         -- <--- NUEVO: Descripción del Material
                o.Variante,         -- <--- NUEVO: Código de Stock (1.1.3.1)
                o.RolloID,
                o.Nota,
                o.meta_data,
                o.ArchivosCount,
                
                m.Nombre as NombreMaquina,
                
                (
                    SELECT 
                        ArchivoID,
                        NombreArchivo as nombre,
                        RutaAlmacenamiento as link,
                        TipoArchivo as tipo,
                        Copias as copias,
                        Metros as metros,
                        DetalleLinea
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
            priority: o.Prioridad,
            entryDate: o.FechaIngreso,
            deliveryDate: o.FechaEstimadaEntrega,
            printer: o.NombreMaquina,
            rollId: o.RolloID,
            magnitude: o.Magnitud,
            
            material: o.Material,       // Descripción
            variantCode: o.Variante,    // CodStock
            
            note: o.Nota,
            filesCount: o.ArchivosCount,
            meta: o.meta_data ? JSON.parse(o.meta_data) : {},
            filesData: o.files_data ? JSON.parse(o.files_data) : []
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

        if (archivos && archivos.length > 0) {
            for (const file of archivos) {
                const requestFile = new sql.Request(transaction);
                await requestFile
                    .input('OrdenID', sql.Int, newOrderId)
                    .input('Nombre', sql.VarChar(200), file.nombre)
                    .input('Ruta', sql.VarChar(500), file.link)
                    .input('Tipo', sql.VarChar(50), file.tipo)
                    .input('Copias', sql.Int, file.copias || 1)
                    .input('Metros', sql.Decimal(10,2), file.metros || 0)
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

// Mantenemos 'assignRoll' para que coincida con tu router.post('/assign-roll')
exports.assignRoll = async (req, res) => {
    // Soportamos ambos: un solo ID por URL o múltiples por body
    const { orderId } = req.params;
    const { orderIds, rollId } = req.body;
    
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        
        const idsToUpdate = orderIds || [orderId];

        for (const id of idsToUpdate) {
            await new sql.Request(transaction)
                .input('R', rollId)
                .input('ID', id)
                .query("UPDATE dbo.Ordenes SET RolloID=@R, Estado='Imprimiendo' WHERE OrdenID=@ID");
        }
        await transaction.commit();
        res.json({ success: true });
    } catch (e) { 
        if(transaction) transaction.rollback(); 
        res.status(500).json({ error: e.message }); 
    }
};
// Creamos alias por si acaso
exports.assignRollToOrder = exports.assignRoll;

exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const pool = await getPool();
        await pool.request().input('ID', id).input('St', status).query("UPDATE dbo.Ordenes SET Estado=@St WHERE OrdenID=@ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};
// Alias para compatibilidad con router.put('/status', updateOrderStatus)
exports.updateOrderStatus = exports.updateStatus;

exports.deleteOrder = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        // Borramos primero archivos (FK)
        await pool.request().input('ID', id).query("DELETE FROM dbo.ArchivosOrden WHERE OrdenID = @ID");
        // Luego la orden
        await pool.request().input('ID', id).query("DELETE FROM dbo.Ordenes WHERE OrdenID = @ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

// --- GESTIÓN DE ARCHIVOS (Tus funciones originales) ---

exports.updateFile = async (req, res) => {
    const { fileId, copias, metros, link } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, fileId)
            .input('Copias', sql.Int, copias)
            .input('Metros', sql.Decimal(10,2), metros)
            .input('Ruta', sql.VarChar(500), link)
            .query("UPDATE dbo.ArchivosOrden SET Copias = @Copias, Metros = @Metros, RutaAlmacenamiento = @Ruta WHERE ArchivoID = @ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
            .input('Metros', sql.Decimal(10,2), metros)
            .query("INSERT INTO dbo.ArchivosOrden (OrdenID, NombreArchivo, RutaAlmacenamiento, TipoArchivo, Copias, Metros, FechaSubida) VALUES (@OrdenID, @Nombre, @Ruta, @Tipo, @Copias, @Metros, GETDATE())");
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

exports.getPrioritiesConfig = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request().input('AreaID', sql.VarChar(20), area).query('SELECT * FROM dbo.ConfigPrioridades WHERE AreaID = @AreaID');
        res.json(result.recordset);
    } catch (err) { res.status(500).json({ error: err.message }); }
};
// Obtener historial con duración calculada
exports.getOrderHistory = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('OrdenID', sql.Int, id)
            .query(`
                SELECT 
                    Estado,
                    FechaInicio,
                    FechaFin,
                    -- Si ya terminó, usa DuracionMinutos. Si sigue activo, calcula tiempo hasta ahora.
                    ISNULL(DuracionMinutos, DATEDIFF(MINUTE, FechaInicio, GETDATE())) as DuracionMinutos,
                    Detalle
                FROM dbo.HistorialOrdenes
                WHERE OrdenID = @OrdenID
                ORDER BY FechaInicio DESC
            `);
        
        // Formateamos para el frontend
        const history = result.recordset.map(h => ({
            status: h.Estado,
            start: h.FechaInicio,
            end: h.FechaFin,
            duration: formatDuration(h.DuracionMinutos), // Función helper abajo
            detail: h.Detalle,
            isActive: !h.FechaFin // Si no tiene fecha fin, es el actual
        }));

        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Helper para convertir minutos a "2h 15m"
function formatDuration(minutes) {
    if (!minutes) return '0m';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
};