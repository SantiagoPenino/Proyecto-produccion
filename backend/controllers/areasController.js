const { getPool, sql } = require('../config/db');

// =====================================================================
// 1. OBTENER LISTA DE ÁREAS (Para el Sidebar)
// =====================================================================
exports.getAllAreas = async (req, res) => {
    try {
        const pool = await getPool();
        // Filtramos por EsEstandar si la columna existe, si no, trae todo
        const result = await pool.request().query(`
            SELECT AreaID as code, Nombre as name, Categoria as category 
            FROM dbo.Areas
            WHERE EsEstandar = 1
            ORDER BY Nombre ASC
        `);
        res.json(result.recordset);
    } catch (err) {
        console.error("❌ Error en getAllAreas:", err.message);
        res.status(500).json({ error: "Error cargando áreas." });
    }
};

// =====================================================================
// 2. OBTENER DETALLE COMPLETO (Configuración del Área)
// =====================================================================
exports.getAreaDetails = async (req, res) => {
    const { code } = req.params; // Ej: 'DTF'
    try {
        const pool = await getPool();
        const reqSql = pool.request().input('id', sql.VarChar(20), code);

        // A. Equipos
        const equipos = await reqSql.query("SELECT * FROM dbo.ConfigEquipos WHERE AreaID = @id AND Activo = 1");
        
        // B. Insumos (Marcando asignados)
        const insumos = await reqSql.query(`
            SELECT i.InsumoID, i.Nombre, i.UnidadDefault, 
                   CASE WHEN ia.ID IS NOT NULL THEN 1 ELSE 0 END as Asignado
            FROM dbo.Insumos i 
            LEFT JOIN dbo.InsumosPorArea ia ON i.InsumoID = ia.InsumoID AND ia.AreaID = @id
            WHERE i.EsProductivo = 1
            ORDER BY i.Nombre
        `);

        // C. Columnas
        const columnas = await reqSql.query("SELECT * FROM dbo.ConfigColumnas WHERE AreaID = @id ORDER BY Orden ASC");

        // D. Estados (Workflow)
        const estados = await reqSql.query("SELECT * FROM dbo.ConfigEstados WHERE AreaID = @id ORDER BY Orden ASC");

        res.json({
            equipos: equipos.recordset,
            insumos: insumos.recordset,
            columnas: columnas.recordset,
            estados: estados.recordset
        });
    } catch (err) {
        console.error("Error en getDetails:", err);
        // Respuesta segura para evitar crash en frontend
        res.json({ equipos: [], insumos: [], columnas: [], estados: [] });
    }
};

// =====================================================================
// 3. GESTIÓN DE EQUIPOS
// =====================================================================
exports.addPrinter = async (req, res) => {
    const { areaId, nombre } = req.body;
    if (!areaId || !nombre) return res.status(400).json({ error: "Faltan datos" });

    try {
        const pool = await getPool();
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Nombre', sql.NVarChar(100), nombre)
            .query("INSERT INTO dbo.ConfigEquipos (AreaID, Nombre, Activo) VALUES (@AreaID, @Nombre, 1)");
        res.json({ success: true, message: 'Equipo agregado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 4. GESTIÓN DE INSUMOS (Vincular/Desvincular)
// =====================================================================
exports.toggleInsumoArea = async (req, res) => {
    const { areaId, insumoId, asignar } = req.body;
    try {
        const pool = await getPool();
        const reqSql = pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('InsumoID', sql.Int, insumoId);

        if (asignar) {
            await reqSql.query(`
                IF NOT EXISTS (SELECT * FROM dbo.InsumosPorArea WHERE AreaID=@AreaID AND InsumoID=@InsumoID)
                BEGIN
                    INSERT INTO dbo.InsumosPorArea (AreaID, InsumoID) VALUES (@AreaID, @InsumoID)
                END
            `);
        } else {
            await reqSql.query("DELETE FROM dbo.InsumosPorArea WHERE AreaID=@AreaID AND InsumoID=@InsumoID");
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 5. GESTIÓN DE ESTADOS (Guardar Orden y Colores)
// =====================================================================
exports.saveStatuses = async (req, res) => {
    const { areaId, estados } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        // Borrar y reinsertar (Estrategia simple para reordenamiento)
        await new sql.Request(transaction).input('id', sql.VarChar(20), areaId)
            .query("DELETE FROM dbo.ConfigEstados WHERE AreaID = @id");

        for (const st of estados) {
            await new sql.Request(transaction)
                .input('AreaID', sql.VarChar(20), areaId)
                .input('Nombre', sql.NVarChar(50), st.Nombre)
                .input('Color', sql.VarChar(20), st.ColorHex)
                .input('Orden', sql.Int, st.Orden)
                .input('Final', sql.Bit, st.EsFinal ? 1 : 0)
                .query("INSERT INTO dbo.ConfigEstados (AreaID, Nombre, ColorHex, Orden, EsFinal) VALUES (@AreaID, @Nombre, @Color, @Orden, @Final)");
        }

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 6. GESTIÓN DE COLUMNAS (Vistas de Tabla)
// =====================================================================
exports.saveColumns = async (req, res) => {
    const { areaId, columnas } = req.body;
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        await new sql.Request(transaction).input('id', sql.VarChar(20), areaId)
            .query("DELETE FROM dbo.ConfigColumnas WHERE AreaID = @id");

        for (const col of columnas) {
            await new sql.Request(transaction)
                .input('AreaID', sql.VarChar(20), areaId)
                .input('Titulo', sql.NVarChar(50), col.Titulo)
                .input('Clave', sql.NVarChar(50), col.ClaveData)
                .input('Ancho', sql.VarChar(20), col.Ancho)
                .input('Orden', sql.Int, col.Orden)
                .input('Visible', sql.Bit, col.EsVisible ? 1 : 0)
                .input('Filtro', sql.Bit, col.TieneFiltro ? 1 : 0)
                .query("INSERT INTO dbo.ConfigColumnas (AreaID, Titulo, ClaveData, Ancho, Orden, EsVisible, TieneFiltro) VALUES (@AreaID, @Titulo, @Clave, @Ancho, @Orden, @Visible, @Filtro)");
        }

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 7. DICCIONARIO MAESTRO (Para el Modal de Columnas)
// =====================================================================
exports.getColumnsDictionary = async (req, res) => {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT * FROM dbo.DiccionarioDatos ORDER BY Clave");
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// =====================================================================
// 8. LEGACY (Por si acaso quedó algo viejo llamando a JSON)
// =====================================================================
exports.updateAreaConfig = async (req, res) => {
    const { code } = req.params;
    const { ui_config } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('config', sql.NVarChar(sql.MAX), JSON.stringify(ui_config))
            .input('code', sql.VarChar(20), code)
            .query('UPDATE dbo.Areas SET ui_config = @config WHERE AreaID = @code');
        res.json({ message: 'Configuración JSON actualizada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
// ...

// EDITAR EQUIPO EXISTENTE (Nombre, Capacidad, Velocidad)
exports.updatePrinter = async (req, res) => {
    const { id } = req.params; // EquipoID
    const { nombre, capacidad, velocidad } = req.body;

    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .input('Nombre', sql.NVarChar(100), nombre)
            .input('Capacidad', sql.Int, capacidad || 0)
            .input('Velocidad', sql.Int, velocidad || 0)
            .query(`
                UPDATE dbo.ConfigEquipos 
                SET Nombre = @Nombre, Capacidad = @Capacidad, Velocidad = @Velocidad 
                WHERE EquipoID = @ID
            `);

        res.json({ success: true, message: 'Equipo actualizado' });
    } catch (err) {
        console.error("Error updating printer:", err);
        res.status(500).json({ error: err.message });
    }
};

// ...