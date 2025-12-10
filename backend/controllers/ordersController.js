const { getPool, sql } = require('../config/db');

// =====================================================================
// 1. OBTENER ÓRDENES (Con Archivos Incluidos)
// =====================================================================
exports.getOrdersByArea = async (req, res) => {
    const { area, mode, q } = req.query; 

    try {
        const pool = await getPool();
        
        let query = `
            SELECT 
                o.OrdenID,
                o.Cliente,
                o.DescripcionTrabajo,
                o.AreaID,
                o.Estado,
                o.Prioridad,
                o.FechaIngreso,
                o.FechaEstimadaEntrega,
                o.Magnitud,
                o.Variante,
                o.RolloID,
                o.Nota,
                o.meta_data,
                o.ArchivosCount,
                
                -- 👇 CORRECCIÓN 1: Tomamos el nombre de la nueva tabla ConfigEquipos
                m.Nombre as NombreMaquina,
                
                (
                    SELECT 
                        ArchivoID,
                        NombreArchivo as nombre,
                        RutaAlmacenamiento as link,
                        TipoArchivo as tipo,
                        Copias as copias,
                        Metros as metros
                    FROM dbo.ArchivosOrden 
                    WHERE OrdenID = o.OrdenID 
                    FOR JSON PATH
                ) as files_data

            FROM dbo.Ordenes o
            -- 👇 CORRECCIÓN 2: JOIN con ConfigEquipos (la tabla Maquinas ya no existe)
            LEFT JOIN dbo.ConfigEquipos m ON o.MaquinaID = m.EquipoID
            WHERE 1=1 
        `;
        
        const request = pool.request();

        // Filtros
        if (area) {
            query += ' AND o.AreaID = @area';
            request.input('area', sql.VarChar(20), area);
        }

        const estadosFinales = "'Entregado', 'Finalizado', 'Cancelado'";
        if (mode === 'history') {
            query += ` AND o.Estado IN (${estadosFinales})`;
        } else {
            query += ` AND o.Estado NOT IN (${estadosFinales})`;
        }

        if (q) {
            query += ' AND (o.Cliente LIKE @q OR CAST(o.OrdenID AS VARCHAR) LIKE @q)';
            request.input('q', sql.NVarChar(100), `%${q}%`);
        }

        query += ` ORDER BY o.FechaIngreso DESC`;

        const result = await request.query(query);
        
        // Mapeo para el Frontend
        const orders = result.recordset.map(o => ({
            id: o.OrdenID,
            client: o.Cliente,
            desc: o.DescripcionTrabajo,
            area: o.AreaID,
            status: o.Estado,
            priority: o.Prioridad,
            entryDate: o.FechaIngreso,
            deliveryDate: o.FechaEstimadaEntrega,
            printer: o.NombreMaquina, // Ahora vendrá lleno correctamente
            rollId: o.RolloID,
            magnitude: o.Magnitud,
            variant: o.Variante,
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
// 2. CREAR ORDEN (Transaccional)
// =====================================================================
exports.createOrder = async (req, res) => {
    const { 
        areaId, cliente, descripcion, prioridad, variante, 
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
            .input('Variante', sql.VarChar(50), variante)
            .input('Magnitud', sql.VarChar(50), magnitud)
            .input('Nota', sql.NVarChar(sql.MAX), nota)
            .input('FechaEstimada', sql.DateTime, fechaEntrega ? new Date(fechaEntrega) : null)
            .input('ArchivosCount', sql.Int, archivos ? archivos.length : 0)
            .query(`
                INSERT INTO dbo.Ordenes (AreaID, Cliente, DescripcionTrabajo, Prioridad, Variante, Magnitud, Nota, FechaEstimadaEntrega, ArchivosCount, Estado, FechaIngreso)
                OUTPUT INSERTED.OrdenID
                VALUES (@AreaID, @Cliente, @Descripcion, @Prioridad, @Variante, @Magnitud, @Nota, @FechaEstimada, @ArchivosCount, 'Pendiente', GETDATE())
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

// ... RESTO DE FUNCIONES (UpdateStatus, etc.) SE MANTIENEN IGUAL ...
exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const pool = await getPool();
        await pool.request().input('ID', id).input('St', status).query("UPDATE dbo.Ordenes SET Estado=@St WHERE OrdenID=@ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.assignRoll = async (req, res) => {
    const { orderIds, rollId } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        for (const id of orderIds) {
            await new sql.Request(transaction).input('R', rollId).input('ID', id).query("UPDATE dbo.Ordenes SET RolloID=@R, Estado='Imprimiendo' WHERE OrdenID=@ID");
        }
        await transaction.commit();
        res.json({ success: true });
    } catch (e) { if(transaction) transaction.rollback(); res.status(500).json({ error: e.message }); }
};

exports.deleteOrder = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        await pool.request().input('ID', id).query("UPDATE dbo.Ordenes SET Estado='Cancelado' WHERE OrdenID=@ID");
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
};

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