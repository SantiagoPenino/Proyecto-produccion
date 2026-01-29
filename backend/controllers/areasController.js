const { getPool, sql } = require('../config/db');

// =====================================================================
// 1. OBTENER LISTA DE ÁREAS (Para el Sidebar)
// =====================================================================
// =====================================================================
// 1. OBTENER LISTA DE ÁREAS (Para el Sidebar y Configuración)
// =====================================================================
exports.getAllAreas = async (req, res) => {
    try {
        const pool = await getPool();

        // 🛑 CONSULTA MODIFICADA: Devuelve nombres de columna estándar para consistencia
        const { productive, withStock } = req.query;
        let query = "SELECT DISTINCT a.AreaID, a.Nombre, a.Categoria, a.RenderKey, a.ui_config, a.TieneLogisticaBultos FROM dbo.Areas a";

        const conditions = [];

        if (productive === 'true') {
            conditions.push("a.Productiva = 1");
        }

        if (withStock === 'true') {
            // Filtrar áreas que tienen insumos relacionados (por asignación explícita, mapeo ERP o stock físico)
            conditions.push(`(
                EXISTS (SELECT 1 FROM InsumosPorArea ipa WHERE ipa.AreaID = a.AreaID) 
                OR EXISTS (SELECT 1 FROM ConfigMapeoERP map WHERE map.AreaID_Interno = a.AreaID)
                OR EXISTS (SELECT 1 FROM InventarioBobinas ib WHERE ib.AreaID = a.AreaID)
            )`);
        }

        if (conditions.length > 0) {
            query += " WHERE " + conditions.join(" AND ");
        }

        query += " ORDER BY a.Nombre ASC";

        const result = await pool.request().query(query);

        // Retornamos directamente, el front usa AreaID y Nombre
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
    const { areaId, nombre, capacidad, velocidad, estado, estadoProceso } = req.body;
    if (!areaId || !nombre) return res.status(400).json({ error: "Faltan datos" });

    try {
        const pool = await getPool();
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Nombre', sql.NVarChar(100), nombre)
            .input('Capacidad', sql.Int, capacidad === '' ? 100 : (capacidad || 100))
            .input('Velocidad', sql.Int, velocidad === '' ? 10 : (velocidad || 10))
            .input('Estado', sql.NVarChar(50), estado || 'DISPONIBLE')
            .input('EstadoProceso', sql.NVarChar(50), estadoProceso || 'DETENIDO')
            .query("INSERT INTO dbo.ConfigEquipos (AreaID, Nombre, Activo, Capacidad, Velocidad, Estado, EstadoProceso) VALUES (@AreaID, @Nombre, 1, @Capacidad, @Velocidad, @Estado, @EstadoProceso)");
        res.json({ success: true, message: 'Equipo agregado' });
    } catch (err) {
        console.error("❌ ERROR CRÍTICO AL AGREGAR EQUIPO:");
        console.error("Datos recibidos:", { areaId, nombre, capacidad, velocidad, estado, estadoProceso });
        console.error("Mensaje de error SQL:", err.message);
        console.error("Stack trace:", err.stack);
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
// =====================================================================
// 5. GESTIÓN DE ESTADOS (CRUD)
// =====================================================================

// AGREGAR ESTADO
exports.addStatus = async (req, res) => {
    const { areaId, nombre, colorHex, orden, esFinal, tipoEstado } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('AreaID', sql.VarChar(20), areaId)
            .input('Nombre', sql.NVarChar(50), nombre)
            .input('Color', sql.VarChar(20), colorHex || '#cccccc')
            .input('Orden', sql.Int, orden || 0)
            .input('Final', sql.Bit, esFinal ? 1 : 0)
            .input('TipoEstado', sql.NVarChar(50), tipoEstado || 'ESTADOENAREA')
            .query("INSERT INTO dbo.ConfigEstados (AreaID, Nombre, ColorHex, Orden, EsFinal, TipoEstado) VALUES (@AreaID, @Nombre, @Color, @Orden, @Final, @TipoEstado)");

        res.json({ success: true, message: 'Estado agregado' });
    } catch (err) {
        console.error("Error adding status:", err);
        res.status(500).json({ error: err.message });
    }
};

// ACTUALIZAR ESTADO
exports.updateStatus = async (req, res) => {
    const { id } = req.params;
    const { nombre, colorHex, orden, esFinal, tipoEstado } = req.body;
    try {
        const pool = await getPool();
        await pool.request()
            .input('ID', sql.Int, id)
            .input('Nombre', sql.NVarChar(50), nombre)
            .input('Color', sql.VarChar(20), colorHex)
            .input('Orden', sql.Int, orden)
            .input('Final', sql.Bit, esFinal ? 1 : 0)
            .input('TipoEstado', sql.NVarChar(50), tipoEstado)
            .query(`
                UPDATE dbo.ConfigEstados
                SET Nombre = ISNULL(@Nombre, Nombre),
                    ColorHex = ISNULL(@Color, ColorHex),
                    Orden = ISNULL(@Orden, Orden),
                    EsFinal = ISNULL(@Final, EsFinal),
                    TipoEstado = ISNULL(@TipoEstado, TipoEstado)
                WHERE EstadoID = @ID
            `);
        res.json({ success: true, message: 'Estado actualizado' });
    } catch (err) {
        console.error("Error updating status:", err);
        res.status(500).json({ error: err.message });
    }
};

// ELIMINAR ESTADO
exports.deleteStatus = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ID', sql.Int, id)
            .query("DELETE FROM dbo.ConfigEstados WHERE EstadoID = @ID");

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Estado eliminado' });
        } else {
            res.status(404).json({ error: 'Estado no encontrado' });
        }
    } catch (err) {
        console.error("Error deleting status:", err);
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

// ELIMINAR EQUIPO
exports.deletePrinter = async (req, res) => {
    const { id } = req.params;
    try {
        const pool = await getPool();
        const result = await pool.request()
            .input('ID', sql.Int, id)
            .query("DELETE FROM dbo.ConfigEquipos WHERE EquipoID = @ID");

        if (result.rowsAffected[0] > 0) {
            res.json({ success: true, message: 'Equipo eliminado' });
        } else {
            res.status(404).json({ error: 'Equipo no encontrado' });
        }
    } catch (err) {
        console.error("Error deleting printer:", err);
        res.status(500).json({ error: err.message });
    }
};

// EDITAR EQUIPO EXISTENTE (Nombre, Capacidad, Velocidad, Estado, EstadoProceso, Activo)
exports.updatePrinter = async (req, res) => {
    const { id } = req.params; // EquipoID
    const { nombre, capacidad, velocidad, estado, estadoProceso, activo } = req.body;

    try {
        const pool = await getPool();
        const request = pool.request()
            .input('ID', sql.Int, id)
            .input('Nombre', sql.NVarChar(100), nombre)
            .input('Capacidad', sql.Int, capacidad === '' ? 0 : (capacidad || 0))
            .input('Velocidad', sql.Int, velocidad === '' ? 0 : (velocidad || 0))
            .input('Estado', sql.NVarChar(50), estado || null)
            .input('EstadoProceso', sql.NVarChar(50), estadoProceso || null);

        // Solo actualizar Activo si viene en el body explicitly (puede ser boolean o bit)
        let query = `
            UPDATE dbo.ConfigEquipos 
            SET Nombre = @Nombre, Capacidad = @Capacidad, Velocidad = @Velocidad, 
                Estado = ISNULL(@Estado, Estado),
                EstadoProceso = ISNULL(@EstadoProceso, EstadoProceso)
        `;

        if (activo !== undefined) {
            request.input('Activo', sql.Bit, activo ? 1 : 0);
            query += `, Activo = @Activo`;
        }

        query += ` WHERE EquipoID = @ID`;

        await request.query(query);

        res.json({ success: true, message: 'Equipo actualizado' });
    } catch (err) {
        console.error("Error updating printer:", err);
        res.status(500).json({ error: err.message });
    }
};

// ...