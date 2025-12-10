const { getPool, sql } = require('../config/db');

// =====================================================================
// 1. OBTENER MÁQUINAS (Desde ConfigEquipos)
// =====================================================================
exports.getMachinesByArea = async (req, res) => {
    const { area } = req.query; // ?area=DTF
    try {
        const pool = await getPool();
        // CORRECCIÓN: Usamos ConfigEquipos en lugar de Maquinas
        // Mapeamos EquipoID -> MaquinaID para que el frontend no se rompa
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT EquipoID as MaquinaID, Nombre, Estado 
                FROM dbo.ConfigEquipos 
                WHERE AreaID = @AreaID AND Activo = 1 
                ORDER BY Nombre ASC
            `);
        res.json(result.recordset);
    } catch (err) {
        console.error("Error getMachines:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 2. BUSCAR TÍTULOS DE FALLA (Nomenclador)
// =====================================================================
exports.searchFailureTitles = async (req, res) => {
    const { q, area } = req.query;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('term', sql.NVarChar(100), `%${q}%`)
            .input('area', sql.VarChar(20), area)
            .query(`
                SELECT Top 10 Titulo 
                FROM dbo.TiposFallas 
                WHERE AreaID = @area AND Titulo LIKE @term
                ORDER BY EsFrecuente DESC, Titulo ASC
            `);
        res.json(result.recordset); 
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 3. CREAR NUEVO TIPO DE FALLA (Catálogo)
// =====================================================================
exports.createFailureType = async (req, res) => {
    const { areaId, titulo } = req.body;
    
    if (!areaId || !titulo) return res.status(400).json({ error: "Faltan datos" });

    try {
        const pool = await getPool();
        
        // Insertar directo (con validación de existencia implícita en SQL)
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Titulo', sql.NVarChar(200), titulo)
            .query(`
                IF NOT EXISTS (SELECT * FROM dbo.TiposFallas WHERE AreaID = @AreaID AND Titulo = @Titulo)
                BEGIN
                    INSERT INTO dbo.TiposFallas (AreaID, Titulo) VALUES (@AreaID, @Titulo)
                END
            `);

        res.json({ success: true, message: 'Catálogo actualizado' });
    } catch (err) {
        console.error("Error crear tipo falla:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 4. CREAR TICKET DE FALLA
// =====================================================================
exports.createTicket = async (req, res) => {
    const { maquinaId, titulo, descripcion, prioridad, reportadoPor } = req.body;
    
    // Generar ID de Ticket (Ej: T-820192)
    const ticketId = `T-${Date.now().toString().slice(-6)}`;

    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        // A. Insertar Ticket (maquinaId ahora es un EquipoID de ConfigEquipos)
        await new sql.Request(transaction)
            .input('TicketID', sql.VarChar(20), ticketId)
            .input('MaquinaID', sql.Int, maquinaId)
            .input('Titulo', sql.NVarChar(200), titulo)
            .input('Descripcion', sql.NVarChar(sql.MAX), descripcion)
            .input('Prioridad', sql.VarChar(20), prioridad)
            .input('ReportadoPor', sql.VarChar(100), reportadoPor || 'Operario')
            .query(`
                INSERT INTO dbo.TicketsMantenimiento (TicketID, MaquinaID, Titulo, Descripcion, Prioridad, Estado, FechaReporte, ReportadoPor)
                VALUES (@TicketID, @MaquinaID, @Titulo, @Descripcion, @Prioridad, 'Abierto', GETDATE(), @ReportadoPor)
            `);

        // B. Actualizar Estado de la Máquina en ConfigEquipos
        await new sql.Request(transaction)
            .input('ID', sql.Int, maquinaId)
            .query("UPDATE dbo.ConfigEquipos SET Estado = 'FALLA' WHERE EquipoID = @ID");

        await transaction.commit();
        res.json({ success: true, ticketId });

    } catch (err) {
        if (transaction) await transaction.rollback();
        console.error("Error creando ticket:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 5. HISTORIAL DE TICKETS (Por Área)
// =====================================================================
exports.getHistory = async (req, res) => {
    const { area } = req.query;
    try {
        const pool = await getPool();
        // CORRECCIÓN: Join con ConfigEquipos
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT 
                    t.TicketID,
                    t.Titulo,
                    t.Descripcion,
                    t.Prioridad,
                    t.Estado,
                    t.FechaReporte,
                    m.Nombre as MaquinaNombre,
                    m.AreaID
                FROM dbo.TicketsMantenimiento t
                INNER JOIN dbo.ConfigEquipos m ON t.MaquinaID = m.EquipoID
                WHERE m.AreaID = @AreaID
                ORDER BY t.FechaReporte DESC
            `);
        
        res.json(result.recordset);
    } catch (err) {
        console.error("Error historial:", err);
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 6. HISTORIAL GLOBAL (Para Servicio Técnico)
// =====================================================================
exports.getAllTickets = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            SELECT 
                t.TicketID, t.Titulo, t.Descripcion, t.Prioridad, t.Estado, t.FechaReporte, t.ReportadoPor,
                m.Nombre as Maquina,
                m.AreaID
            FROM dbo.TicketsMantenimiento t
            LEFT JOIN dbo.ConfigEquipos m ON t.MaquinaID = m.EquipoID
            ORDER BY CASE WHEN t.Estado = 'Abierto' THEN 1 ELSE 2 END, t.FechaReporte DESC
        `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};